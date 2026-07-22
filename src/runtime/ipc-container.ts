import { EventEmitter } from "node:events";
import { ipcMain } from "electron";

import type {
  IpcContainerEmitter,
  IpcModuleRegister,
  IpcModuleRegistration,
} from "../shared/types/runtime.js";

export type { IpcContainerEmitter } from "../shared/types/runtime.js";

/** Thrown when a lifecycle operation is requested after `dispose()`. */
export class IpcContainerDisposedError extends Error {
  readonly code = "IPC_CONTAINER_DISPOSED";

  constructor() {
    super("The IPC container has been disposed");
    this.name = "IpcContainerDisposedError";
  }
}

/** Thrown when two loaded modules claim the same physical Electron channel. */
export class IpcChannelCollisionError extends Error {
  readonly code = "IPC_CHANNEL_COLLISION";

  constructor(
    readonly channel: string,
    readonly existingModule: string,
    readonly incomingModule: string,
  ) {
    super(
      `IPC channel ${JSON.stringify(channel)} from module ${JSON.stringify(incomingModule)} ` +
        `is already registered by module ${JSON.stringify(existingModule)}`,
    );
    this.name = "IpcChannelCollisionError";
  }
}

/**
 * Create a registry that loads, unloads, and observes named IPC modules.
 *
 * Mutating lifecycle calls are executed in invocation order through one queue.
 * This makes overlap deterministic across module names as well as for the same
 * name. `dispose()` is terminal: calls requested after it reject.
 */
export function createIpcContainer() {
  const modules = new Map<string, IpcModuleRegistration>();
  const rawEmitter = new EventEmitter();
  const emitter: IpcContainerEmitter = rawEmitter;
  let lifecycle: Promise<void> = Promise.resolve();
  let disposeRequested = false;
  let disposePromise: Promise<void> | undefined;

  const enqueue = <T>(task: () => Promise<T> | T): Promise<T> => {
    const result = lifecycle.catch(() => undefined).then(task);
    lifecycle = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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

  const findCollision = (name: string, registration: IpcModuleRegistration) => {
    const ownChannels = new Set<string>();
    for (const [channel] of registration.channels) {
      if (ownChannels.has(channel)) return new IpcChannelCollisionError(channel, name, name);
      ownChannels.add(channel);
    }

    for (const [existingName, existing] of modules) {
      if (existingName === name) continue;
      const existingChannels = new Set(existing.channels.map(([channel]) => channel));
      for (const channel of ownChannels) {
        if (existingChannels.has(channel)) {
          return new IpcChannelCollisionError(channel, existingName, name);
        }
      }
    }
    return undefined;
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

  const emitLoadError = (name: string, error: unknown) => {
    // An unobserved Node `error` event throws and would mask the real failure.
    if (rawEmitter.listenerCount("error") > 0) emitter.emit("error", name, error);
  };

  const commitLoad = async (
    name: string,
    register: IpcModuleRegister,
    ipc: typeof ipcMain,
    mode: "replace" | "create",
  ) => {
    try {
      if (modules.has(name)) {
        if (mode === "create") {
          throw new Error(`IPC module ${JSON.stringify(name)} is already loaded`);
        }
        unloadCommitted(name);
      }

      const registration = await register(ipc);
      const collision = findCollision(name, registration);
      if (collision) {
        try {
          disposeRegistration(registration);
        } catch (cleanupError) {
          throw new AggregateError(
            [collision, cleanupError],
            "IPC channel collision and registration cleanup both failed",
          );
        }
        throw collision;
      }

      modules.set(name, registration);
      const channelNames = registration.channels.map(([channel]) => channel);
      emitter.emit("loaded", name, channelNames);
      return channelNames;
    } catch (error) {
      emitLoadError(name, error);
      throw error;
    }
  };

  /** Load or replace one module. Resolves after all earlier lifecycle calls. */
  const load = (name: string, register: IpcModuleRegister, ipc = ipcMain) => {
    if (disposeRequested) return Promise.reject(new IpcContainerDisposedError());
    return enqueue(() => commitLoad(name, register, ipc, "replace"));
  };

  /**
   * Insert a transactional batch and return channels keyed by module name.
   * Existing names are rejected before any registration starts.
   */
  const loadAll = (entries: Record<string, IpcModuleRegister>, ipc = ipcMain) => {
    if (disposeRequested) return Promise.reject(new IpcContainerDisposedError());
    return enqueue(async () => {
      const conflicts = Object.keys(entries).filter((name) => modules.has(name));
      if (conflicts.length > 0) {
        throw new Error(
          `loadAll cannot replace already-loaded modules (${conflicts
            .map((name) => JSON.stringify(name))
            .join(", ")}); use load() to replace individual modules`,
        );
      }

      const loaded: string[] = [];
      const result: Record<string, string[]> = {};
      try {
        for (const [name, register] of Object.entries(entries)) {
          result[name] = await commitLoad(name, register, ipc, "create");
          loaded.push(name);
        }
        return result;
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const name of loaded.reverse()) {
          try {
            unloadCommitted(name);
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
    });
  };

  /** Unload one module after all earlier lifecycle calls. */
  const unload = (name: string) => {
    if (disposeRequested) return Promise.reject(new IpcContainerDisposedError());
    return enqueue(() => unloadCommitted(name));
  };

  const unloadAllCommitted = () => {
    const errors: unknown[] = [];
    for (const name of Array.from(modules.keys())) {
      try {
        unloadCommitted(name);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to completely unload all IPC modules");
    }
  };

  /** Unload every module; the container remains reusable. */
  const unloadAll = () => {
    if (disposeRequested) return Promise.reject(new IpcContainerDisposedError());
    return enqueue(unloadAllCommitted);
  };

  /** Unload every module and permanently reject later lifecycle calls. */
  const dispose = () => {
    if (disposePromise) return disposePromise;
    disposeRequested = true;
    disposePromise = enqueue(unloadAllCommitted);
    return disposePromise;
  };

  const has = (name: string) => modules.has(name);
  const getChannels = (name: string) => modules.get(name)?.channels.map(([ch]) => ch) ?? [];

  return {
    load,
    loadAll,
    unload,
    unloadAll,
    dispose,
    has,
    getChannels,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),
    get names() {
      return [...modules.keys()];
    },
    get allChannels() {
      return [...modules.values()].flatMap((registration) =>
        registration.channels.map(([channel]) => channel),
      );
    },
    get size() {
      return modules.size;
    },
  };
}
