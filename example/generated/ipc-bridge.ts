import { ipcRenderer } from 'electron';
import type { IpcStream, Serializable } from 'electron-ipc-module';

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

function createStreamHelper<T>(
  channel: string,
  eventChannel: string,
  cancelChannel: string,
  args: unknown[],
): IpcStream<T> {
  const id = crypto.getRandomValues(new Uint32Array(4)).join("-");
  const chunks: T[] = [];
  let closed = false;
  let failure: unknown;
  let wake = () => {};

  const close = (error?: unknown) => {
    if (closed) return;
    closed = true;
    failure = error;
    ipcRenderer.removeListener(eventChannel, onEvent);
    wake();
  };
  const onEvent = (_event: unknown, callId: string, type: string, payload: unknown) => {
    if (callId !== id) return;
    if (type === "chunk") {
      chunks.push(payload as T);
      wake();
    } else {
      close(type === "error" ? new Error(`Error invoking remote method '${channel}': ${payload}`) : undefined);
    }
  };
  const cancel = () => {
    if (closed) return;
    chunks.length = 0;
    ipcRenderer.send(cancelChannel, id);
    close();
  };

  ipcRenderer.on(eventChannel, onEvent);
  ipcRenderer.invoke(channel, id, ...args).catch(close);

  return {
    async next() {
      while (chunks.length === 0 && !closed) {
        await new Promise<void>((resolve) => (wake = resolve));
      }
      if (chunks.length > 0) return { done: false, value: chunks.shift() as T };
      if (failure !== undefined) {
        const error = failure;
        failure = undefined;
        throw error;
      }
      return { done: true, value: undefined };
    },
    async return() {
      cancel();
      return { done: true, value: undefined };
    },
    cancel,
  };
}

export const bridge = {
  greeting: {
    get: (): Promise<Serializable<string>> => ipcRenderer.invoke("greeting:get"),
    set: (...args: Serializable<[name: string]>): void => ipcRenderer.send("greeting:set", ...args),
    notify: (...args: Serializable<[message: string]>): void => ipcRenderer.send("greeting:notify", ...args),
    countdown: (...args: Serializable<[from: number]>): IpcStream<Serializable<number>> => createStreamHelper<Serializable<number>>("greeting:countdown", "greeting:countdown:event", "greeting:countdown:cancel", args),
    onGreetingChanged: (listener: (...args: Serializable<[greeting: string]>) => void): Unsubscribe => createOnHelper<Serializable<[greeting: string]>>("greeting:greeting-changed", listener),
    onceGreetingChanged: (listener: (...args: Serializable<[greeting: string]>) => void): Unsubscribe => createOnceHelper<Serializable<[greeting: string]>>("greeting:greeting-changed", listener),
    onNoticeReceived: (listener: (...args: Serializable<[message: string]>) => void): Unsubscribe => createOnHelper<Serializable<[message: string]>>("greeting:notice-received", listener),
    onceNoticeReceived: (listener: (...args: Serializable<[message: string]>) => void): Unsubscribe => createOnceHelper<Serializable<[message: string]>>("greeting:notice-received", listener),
  },
} as const;
