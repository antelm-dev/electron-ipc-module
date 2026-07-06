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
  const emitter: IpcContainerEmitter = new EventEmitter();

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
      emitter.emit("error", name, error);
      throw error;
    }
  };

  /** Load several modules concurrently, keyed by name. */
  const loadAll = (entries: Record<string, IpcModuleRegister>, ipc = ipcMain) =>
    Promise.all(Object.entries(entries).map(([name, register]) => load(name, register, ipc)));

  /**
   * Tear down a module: run every channel cleanup, then the module cleanup,
   * then forget it. Returns `false` if no module is registered under `name`.
   */
  const unload = (name: string) => {
    const registration = modules.get(name);
    if (!registration) return false;
    registration.channels.forEach(([, cleanup]) => cleanup());
    registration.cleanup?.();
    modules.delete(name);
    emitter.emit("unloaded", name);
    return true;
  };

  /** Unload every registered module. */
  const unloadAll = () => {
    for (const name of modules.keys()) unload(name);
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
