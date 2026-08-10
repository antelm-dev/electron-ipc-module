import { ipcRenderer } from 'electron';
import type { Serializable } from 'electron-ipc-module';

type Unsubscribe = () => void;

function createOnHelper<TArgs extends any[]>(
  channel: string,
  listener: (...args: TArgs) => void,
): Unsubscribe {
  const wrapped = (...rawArgs: any[]) => {
    listener(...(rawArgs.slice(1) as TArgs));
  };

  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

function createOnceHelper<TArgs extends any[]>(
  channel: string,
  listener: (...args: TArgs) => void,
): Unsubscribe {
  const wrapped = (...rawArgs: any[]) => {
    listener(...(rawArgs.slice(1) as TArgs));
  };

  ipcRenderer.once(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

export const bridge = {
  greeting: {
    get: (): Promise<Serializable<string>> => ipcRenderer.invoke("greeting:get"),
    set: (...args: Serializable<[name: string]>): void => ipcRenderer.send("greeting:set", ...args),
    notify: (...args: Serializable<[message: string]>): void => ipcRenderer.send("greeting:notify", ...args),
    onGreetingChanged: (listener: (...args: Serializable<[greeting: string]>) => void): Unsubscribe => createOnHelper<Serializable<[greeting: string]>>("greeting:greeting-changed", listener),
    onceGreetingChanged: (listener: (...args: Serializable<[greeting: string]>) => void): Unsubscribe => createOnceHelper<Serializable<[greeting: string]>>("greeting:greeting-changed", listener),
    onNoticeReceived: (listener: (...args: Serializable<[message: string]>) => void): Unsubscribe => createOnHelper<Serializable<[message: string]>>("greeting:notice-received", listener),
    onceNoticeReceived: (listener: (...args: Serializable<[message: string]>) => void): Unsubscribe => createOnceHelper<Serializable<[message: string]>>("greeting:notice-received", listener),
  },
} as const;
