import { EventEmitter } from "node:events";
import { ipcMain } from "electron";

import type {
  IpcContainerEmitter,
  IpcModuleRegister,
  IpcModuleRegistration,
} from "../shared/types/runtime.js";

export type { IpcContainerEmitter } from "../shared/types/runtime.js";

/**
 * Create a registry that loads, unloads, and observes named IPC modules.
 *
 * Each module is registered under a unique `name`; loading a name that already
 * exists unloads the previous version first. Concurrent `load` calls for the
 * same name are serialized. The container is an event emitter: subscribe with
 * `on`/`once`/`off` to `loaded`, `unloaded`, and `error`.
 */
export function createIpcContainer() {
  const modules = new Map<string, IpcModuleRegistration>();
  const pending = new Map<string, Promise<unknown>>();
  const epochs = new Map<string, number>();
  const rawEmitter = new EventEmitter();
  const emitter: IpcContainerEmitter = rawEmitter;

  const bumpEpoch = (name: string) => {
    epochs.set(name, (epochs.get(name) ?? 0) + 1);
  };

  const runExclusive = <T>(name: string, task: () => Promise<T>): Promise<T> => {
    const previous = pending.get(name) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const tracked = next.then(
      () => undefined,
      () => undefined,
    );
    pending.set(name, tracked);
    void tracked.then(() => {
      if (pending.get(name) === tracked) pending.delete(name);
    });
    return next;
  };

  const disposeRegistration = (registration: IpcModuleRegistration) => {
    const errors: unknown[] = [];
    for (const [, cleanup] of registration.channels) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      registration.cleanup?.();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to completely dispose IPC module registration");
    }
  };

  const commitLoad = async (
    name: string,
    register: IpcModuleRegister,
    ipc: typeof ipcMain,
    mode: "replace" | "create",
  ) => {
    const epoch = epochs.get(name) ?? 0;
    if (modules.has(name)) {
      if (mode === "create") {
        throw new Error(`IPC module ${JSON.stringify(name)} is already loaded`);
      }
      unloadCommitted(name);
    }

    try {
      const registration = await register(ipc);
      if ((epochs.get(name) ?? 0) !== epoch) {
        disposeRegistration(registration);
        throw Object.assign(
          new Error(`IPC module ${JSON.stringify(name)} was unloaded during registration`),
          { code: "IPC_LOAD_CANCELLED" as const },
        );
      }
      modules.set(name, registration);
      const channelNames = registration.channels.map(([ch]) => ch);
      emitter.emit("loaded", name, channelNames);
      return channelNames;
    } catch (error) {
      const cancelled =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "IPC_LOAD_CANCELLED";
      // Node treats an unobserved `error` event specially and would replace the
      // registration failure with ERR_UNHANDLED_ERROR.
      if (!cancelled && rawEmitter.listenerCount("error") > 0) {
        emitter.emit("error", name, error);
      }
      throw error;
    }
  };

  /**
   * Register a module under `name` and return its channel names. Any module
   * already loaded under the same name is unloaded first. Emits `loaded` on
   * success or `error` (and rethrows) if `register` fails.
   */
  const load = (name: string, register: IpcModuleRegister, ipc = ipcMain) =>
    runExclusive(name, () => commitLoad(name, register, ipc, "replace"));

  /**
   * Load several modules as one transactional batch. Refuses names that are
   * already loaded — replacements would destroy the previous registration and
   * could not be restored if a later entry failed. Use `load` to replace a
   * single module. If a registration fails, modules loaded earlier in this
   * batch are unloaded before rejecting.
   */
  const loadAll = async (entries: Record<string, IpcModuleRegister>, ipc = ipcMain) => {
    const conflicts = Object.keys(entries).filter((name) => modules.has(name));
    if (conflicts.length > 0) {
      throw new Error(
        `loadAll cannot replace already-loaded modules (${conflicts
          .map((name) => JSON.stringify(name))
          .join(", ")}); use load() to replace individual modules`,
      );
    }

    const loaded: string[] = [];
    const channelGroups: string[][] = [];

    try {
      for (const [name, register] of Object.entries(entries)) {
        channelGroups.push(
          await runExclusive(name, () => commitLoad(name, register, ipc, "create")),
        );
        loaded.push(name);
      }
      return channelGroups;
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const name of loaded.reverse()) {
        try {
          unload(name);
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }

      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "IPC module batch registration and rollback both failed",
        );
      }
      throw error;
    }
  };

  const unloadCommitted = (name: string) => {
    const registration = modules.get(name);
    if (!registration) return false;

    const errors: unknown[] = [];
    try {
      disposeRegistration(registration);
    } catch (error) {
      if (error instanceof AggregateError) errors.push(...error.errors);
      else errors.push(error);
    }

    modules.delete(name);
    emitter.emit("unloaded", name);

    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to completely unload IPC module ${JSON.stringify(name)}`,
      );
    }
    return true;
  };

  /**
   * Tear down a module: run every channel cleanup, then the module cleanup,
   * then forget it. Returns `false` if no module is registered under `name`.
   * Also invalidates any in-flight `load` for the same name so its registration
   * is disposed instead of committed.
   */
  const unload = (name: string) => {
    bumpEpoch(name);
    return unloadCommitted(name);
  };

  /** Unload every registered module. */
  const unloadAll = () => {
    for (const name of pending.keys()) {
      if (!modules.has(name)) bumpEpoch(name);
    }

    const errors: unknown[] = [];
    for (const name of Array.from(modules.keys())) {
      try {
        unload(name);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to completely unload all IPC modules");
    }
  };

  /** Whether a module is registered under `name`. */
  const has = (name: string) => modules.has(name);

  /** Channel names registered by `name`, or `[]` if it is not loaded. */
  const getChannels = (name: string) => modules.get(name)?.channels.map(([ch]) => ch) ?? [];

  return {
    load,
    loadAll,
    unload,
    unloadAll,
    dispose: unloadAll,
    has,
    getChannels,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),
    /** Names of every currently loaded module. */
    get names() {
      return [...modules.keys()];
    },
    /** Every channel name across all loaded modules. */
    get allChannels() {
      return [...modules.values()].flatMap((chs) => chs.channels.map(([ch]) => ch));
    },
    /** Number of loaded modules. */
    get size() {
      return modules.size;
    },
  };
}
