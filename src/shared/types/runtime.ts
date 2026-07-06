import type {
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
  WebFrameMain,
} from "electron";

/** Keep only the method-valued properties of `T`, dropping data fields. */
export type MethodsOnly<T> = {
  [K in keyof T as T[K] extends (...args: any[]) => any ? K : never]: T[K];
};

/** A value that may be provided synchronously or as a promise. */
export type MaybePromise<T> = T | Promise<T>;

/** Minimal console-like logging surface. */
export type LoggerLike = Pick<Console, "debug" | "info" | "warn" | "error" | "log">;

/** Map of emitted event name to its argument tuple. */
export type IpcEventMap = Record<string, readonly unknown[]>;

/** Loosely-typed event map used as the default when none is supplied. */
type AnyIpcEventMap = Record<string, any[]>;

/** String keys of an {@link IpcEventMap}. */
type IpcEventKey<TEmit extends IpcEventMap> = Extract<keyof TEmit, string>;

/** Argument tuple for a specific event key of an {@link IpcEventMap}. */
type IpcEventArgs<
  TEmit extends IpcEventMap,
  TKey extends IpcEventKey<TEmit>,
> = TEmit[TKey] extends readonly unknown[] ? [...TEmit[TKey]] : never;

/** `WebContents` whose `send` is typed against the module's event map. */
export type TypedWebContents<TEmit extends IpcEventMap = AnyIpcEventMap> = Omit<
  WebContents,
  "send"
> & {
  send<TKey extends IpcEventKey<TEmit>>(channel: TKey, ...args: IpcEventArgs<TEmit, TKey>): void;
};

/** `WebFrameMain` whose `send` is typed against the module's event map. */
export type TypedWebFrameMain<TEmit extends IpcEventMap = AnyIpcEventMap> = Omit<
  WebFrameMain,
  "send"
> & {
  send<TKey extends IpcEventKey<TEmit>>(channel: TKey, ...args: IpcEventArgs<TEmit, TKey>): void;
};

/** `IpcMainEvent` (for `listen`/`listenOnce`) with typed `reply`/`sender`. */
export type TypedIpcMainEvent<TEmit extends IpcEventMap = AnyIpcEventMap> = Omit<
  IpcMainEvent,
  "reply" | "sender" | "senderFrame"
> & {
  reply<TKey extends IpcEventKey<TEmit>>(channel: TKey, ...args: IpcEventArgs<TEmit, TKey>): void;
  sender: TypedWebContents<TEmit>;
  senderFrame: TypedWebFrameMain<TEmit> | null;
};

/** `IpcMainInvokeEvent` (for `handle`/`handleOnce`) with a typed `sender`. */
export type TypedIpcMainInvokeEvent<TEmit extends IpcEventMap = AnyIpcEventMap> = Omit<
  IpcMainInvokeEvent,
  "sender" | "senderFrame"
> & {
  sender: TypedWebContents<TEmit>;
  senderFrame: TypedWebFrameMain<TEmit> | null;
};

/** Callback for a `handle`/`handleOnce` channel — returns a value to the caller. */
export type IpcHandler<
  TArgs extends any[] = any[],
  TResult = any,
  TEmit extends IpcEventMap = AnyIpcEventMap,
> = (e: TypedIpcMainInvokeEvent<TEmit>, ...args: TArgs) => MaybePromise<TResult>;

/** Callback for a `listen`/`listenOnce` channel — fire-and-forget. */
export type IpcListener<
  TArgs extends any[] = any[],
  TResult = any,
  TEmit extends IpcEventMap = AnyIpcEventMap,
> = (e: TypedIpcMainEvent<TEmit>, ...args: TArgs) => MaybePromise<TResult>;

/** The four channel flavors understood by {@link defineChannel}. */
export type ChannelType = "handle" | "handleOnce" | "listen" | "listenOnce";

/** A single channel definition produced by `handle`/`listen`/etc. */
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

/** A channel name paired with the callback that unregisters it. */
export type IpcCleanup = readonly [channel: string, cleanup: () => void];

/** Optional teardown run once when a module is unloaded. */
export type IpcModuleCleanup = () => void;

/** The result of registering a module: its channels and optional cleanup. */
export type IpcModuleRegistration = {
  channels: IpcCleanup[];
  cleanup?: IpcModuleCleanup;
};

/** A function that attaches a module's channels to `ipcMain`. */
export type IpcModuleRegister = (ipc: IpcMain) => MaybePromise<IpcModuleRegistration>;

/** Events emitted by an {@link IpcContainerEmitter}. */
export type IpcContainerEvents = {
  loaded: [name: string, channels: string[]];
  unloaded: [name: string];
  error: [name: string, error: unknown];
};

/** Strongly-typed event emitter interface for the IPC container. */
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
  emit<K extends keyof IpcContainerEvents>(event: K, ...args: IpcContainerEvents[K]): boolean;
}
