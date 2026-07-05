import type {
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
  WebFrameMain,
} from "electron";

export type MethodsOnly<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: T[K];
};

export type MaybePromise<T> = T | Promise<T>;

export type LoggerLike = Pick<
  Console,
  "debug" | "info" | "warn" | "error" | "log"
>;

export type IpcEventMap = Record<string, readonly unknown[]>;

type AnyIpcEventMap = Record<string, any[]>;

type IpcEventKey<TEmit extends IpcEventMap> = Extract<keyof TEmit, string>;

type IpcEventArgs<
  TEmit extends IpcEventMap,
  TKey extends IpcEventKey<TEmit>,
> = TEmit[TKey] extends readonly unknown[] ? [...TEmit[TKey]] : never;

export type TypedWebContents<TEmit extends IpcEventMap = AnyIpcEventMap> = Omit<
  WebContents,
  "send"
> & {
  send<TKey extends IpcEventKey<TEmit>>(
    channel: TKey,
    ...args: IpcEventArgs<TEmit, TKey>
  ): void;
};

export type TypedWebFrameMain<TEmit extends IpcEventMap = AnyIpcEventMap> = Omit<
  WebFrameMain,
  "send"
> & {
  send<TKey extends IpcEventKey<TEmit>>(
    channel: TKey,
    ...args: IpcEventArgs<TEmit, TKey>
  ): void;
};

export type TypedIpcMainEvent<TEmit extends IpcEventMap = AnyIpcEventMap> = Omit<
  IpcMainEvent,
  "reply" | "sender" | "senderFrame"
> & {
  reply<TKey extends IpcEventKey<TEmit>>(
    channel: TKey,
    ...args: IpcEventArgs<TEmit, TKey>
  ): void;
  sender: TypedWebContents<TEmit>;
  senderFrame: TypedWebFrameMain<TEmit> | null;
};

export type TypedIpcMainInvokeEvent<
  TEmit extends IpcEventMap = AnyIpcEventMap,
> = Omit<IpcMainInvokeEvent, "sender" | "senderFrame"> & {
  sender: TypedWebContents<TEmit>;
  senderFrame: TypedWebFrameMain<TEmit> | null;
};

export type IpcHandler<
  TArgs extends any[] = any[],
  TResult = any,
  TEmit extends IpcEventMap = AnyIpcEventMap,
> = (
  e: TypedIpcMainInvokeEvent<TEmit>,
  ...args: TArgs
) => MaybePromise<TResult>;

export type IpcListener<
  TArgs extends any[] = any[],
  TResult = any,
  TEmit extends IpcEventMap = AnyIpcEventMap,
> = (
  e: TypedIpcMainEvent<TEmit>,
  ...args: TArgs
) => MaybePromise<TResult>;

export type ChannelType = "handle" | "handleOnce" | "listen" | "listenOnce";

export type ChannelDef =
  | {
      kind: "handler";
      fn: IpcHandler<any[], any, any>;
      once: boolean;
    }
  | {
      kind: "listener";
      fn: IpcListener<any[], any, any>;
      once: boolean;
    };

export type IpcCleanup = readonly [channel: string, cleanup: () => void];

export type IpcModuleCleanup = () => void;

export type IpcModuleRegistration = {
  channels: IpcCleanup[];
  cleanup?: IpcModuleCleanup;
};

export type IpcModuleRegister = (ipc: IpcMain) => MaybePromise<IpcModuleRegistration>;

export type IpcContainerEvents = {
  loaded: [name: string, channels: string[]];
  unloaded: [name: string];
  error: [name: string, error: unknown];
};

export interface IpcContainerEmitter {
  on<K extends keyof IpcContainerEvents>(
    event: K,
    listener: (...args: IpcContainerEvents[K]) => void,
  ): this;
  off<K extends keyof IpcContainerEvents>(
    event: K,
    listener: (...args: IpcContainerEvents[K]) => void,
  ): this;
  once<K extends keyof IpcContainerEvents>(
    event: K,
    listener: (...args: IpcContainerEvents[K]) => void,
  ): this;
  emit<K extends keyof IpcContainerEvents>(
    event: K,
    ...args: IpcContainerEvents[K]
  ): boolean;
}
