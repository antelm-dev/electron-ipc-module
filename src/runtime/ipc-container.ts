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
 * exists unloads the previous version first. The container is an event emitter:
 * subscribe with `on`/`once`/`off` to `loaded`, `unloaded`, and `error`.
 */
export function createIpcContainer() {
  const modules = new Map<string, IpcModuleRegistration>();
  const rawEmitter = new EventEmitter();
  const emitter: IpcContainerEmitter = rawEmitter;

  /**
   * Register a module under `name` and return its channel names. Any module
   * already loaded under the same name is unloaded first. Emits `loaded` on
   * success or `error` (and rethrows) if `register` fails.
   */
  const load = async (name: string, register: IpcModuleRegister, ipc = ipcMain) => {
    if (modules.has(name)) unload(name);

    try {
      const registration = await register(ipc);
      modules.set(name, registration);
      const channelNames = registration.channels.map(([ch]) => ch);
      emitter.emit("loaded", name, channelNames);
      return channelNames;
    } catch (error) {
      // Node treats an unobserved `error` event specially and would replace the
      // registration failure with ERR_UNHANDLED_ERROR.
      if (rawEmitter.listenerCount("error") > 0) emitter.emit("error", name, error);
      throw error;
    }
  };

  /**
   * Load several modules as one batch. If a registration fails, modules that
   * were newly loaded earlier in this batch are unloaded before rejecting.
   */
  const loadAll = async (entries: Record<string, IpcModuleRegister>, ipc = ipcMain) => {
    const loaded: string[] = [];
    const channelGroups: string[][] = [];

    try {
      for (const [name, register] of Object.entries(entries)) {
        channelGroups.push(await load(name, register, ipc));
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

  /**
   * Tear down a module: run every channel cleanup, then the module cleanup,
   * then forget it. Returns `false` if no module is registered under `name`.
   */
  const unload = (name: string) => {
    const registration = modules.get(name);
    if (!registration) return false;

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

  /** Unload every registered module. */
  const unloadAll = () => {
    const errors: unknown[] = [];
    for (const name of modules.keys()) {
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
