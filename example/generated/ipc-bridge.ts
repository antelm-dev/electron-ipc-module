import { ipcRenderer, type IpcRendererEvent } from 'electron';

type Unsubscribe = () => void;

function createOnHelper<TArgs extends any[]>(
  channel: string,
  listener: (...args: TArgs) => void,
): Unsubscribe {
  const wrapped = (_event: IpcRendererEvent, ...args: TArgs) => {
    listener(...args);
  };

  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

function createOnceHelper<TArgs extends any[]>(
  channel: string,
  listener: (...args: TArgs) => void,
): Unsubscribe {
  const wrapped = (_event: IpcRendererEvent, ...args: TArgs) => {
    listener(...args);
  };

  ipcRenderer.once(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

export const bridge = {
  greeting: {
    get: (): Promise<string> => ipcRenderer.invoke("greeting:get"),
    set: (...args: [name: string]): void => ipcRenderer.send("greeting:set", ...args),
    notify: (...args: [message: string]): void => ipcRenderer.send("greeting:notify", ...args),
    onGreetingChanged: (listener: (...args: [greeting: string]) => void): Unsubscribe => createOnHelper<[greeting: string]>("greeting:greeting-changed", listener),
    onceGreetingChanged: (listener: (...args: [greeting: string]) => void): Unsubscribe => createOnceHelper<[greeting: string]>("greeting:greeting-changed", listener),
    onNoticeReceived: (listener: (...args: [message: string]) => void): Unsubscribe => createOnHelper<[message: string]>("greeting:notice-received", listener),
    onceNoticeReceived: (listener: (...args: [message: string]) => void): Unsubscribe => createOnceHelper<[message: string]>("greeting:notice-received", listener),
  },
} as const;
