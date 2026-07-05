import { EventEmitter } from 'node:events';
import { ipcMain } from 'electron';

import type {
  IpcContainerEmitter,
  IpcModuleRegister,
  IpcModuleRegistration,
} from './types.js';

export type { IpcContainerEmitter } from './types.js';

export function createIpcContainer() {
  const modules = new Map<string, IpcModuleRegistration>();
  const emitter: IpcContainerEmitter = new EventEmitter();

  const load = async (
    name: string,
    register: IpcModuleRegister,
    ipc = ipcMain,
  ) => {
    if (modules.has(name)) unload(name);

    try {
      const registration = await register(ipc);
      modules.set(name, registration);
      const channelNames = registration.channels.map(([ch]) => ch);
      emitter.emit('loaded', name, channelNames);
      return channelNames;
    } catch (error) {
      emitter.emit('error', name, error);
      throw error;
    }
  };

  const loadAll = (
    entries: Record<string, IpcModuleRegister>,
    ipc = ipcMain,
  ) =>
    Promise.all(
      Object.entries(entries).map(([name, register]) =>
        load(name, register, ipc),
      ),
    );

  const unload = (name: string) => {
    const registration = modules.get(name);
    if (!registration) return false;
    registration.channels.forEach(([, cleanup]) => cleanup());
    registration.cleanup?.();
    modules.delete(name);
    emitter.emit('unloaded', name);
    return true;
  };

  const unloadAll = () => {
    for (const name of modules.keys()) unload(name);
  };

  const has = (name: string) => modules.has(name);

  const getChannels = (name: string) =>
    modules.get(name)?.channels.map(([ch]) => ch) ?? [];

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
    get names() {
      return [...modules.keys()];
    },
    get allChannels() {
      return [...modules.values()].flatMap((chs) =>
        chs.channels.map(([ch]) => ch),
      );
    },
    get size() {
      return modules.size;
    },
  };
}
