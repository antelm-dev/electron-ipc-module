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

/** True only for `any`, which would otherwise match every conditional branch. */
type IsAny<T> = 0 extends 1 & T ? true : false;

/** Values the structured clone algorithm reproduces verbatim, prototype included. */
type StructuredCloneNative =
  | ArrayBuffer
  | ArrayBufferView
  | Date
  | Error
  | RegExp
  | bigint
  | boolean
  | null
  | number
  | string
  | undefined;

/**
 * Model what survives the IPC boundary.
 *
 * Electron serializes IPC payloads with the structured clone algorithm, which
 * does not carry JavaScript semantics across intact. Declared types describe
 * the value the main process returned; this type describes the value the
 * renderer actually receives:
 *
 * - **Methods and function-valued properties become `never`.** Structured clone
 *   throws `DataCloneError` on a function, so a payload containing one fails at
 *   runtime rather than arriving incomplete.
 * - **Class instances lose their prototype.** They arrive as plain objects
 *   carrying their own enumerable properties, so `instanceof` is false and
 *   every method is gone. The mapped type reproduces this by dropping the
 *   nominal class identity and mapping methods to `never`.
 * - **`Date`, `RegExp`, `Map`, `Set`, `Error`, `ArrayBuffer`, and typed arrays
 *   survive** and keep their prototypes.
 * - **Getters are flattened** to the value they evaluated to at send time.
 *
 * Applied automatically to the generated bridge's parameters and return types,
 * so a payload that cannot cross the boundary is a compile error at the call
 * site instead of `undefined is not a function` in the renderer.
 */
export type Serializable<T> =
  IsAny<T> extends true
    ? T
    : T extends StructuredCloneNative
      ? T
      : T extends (...args: any[]) => any
        ? never
        : T extends symbol
          ? never
          : T extends Map<infer TKey, infer TValue>
            ? Map<Serializable<TKey>, Serializable<TValue>>
            : T extends Set<infer TItem>
              ? Set<Serializable<TItem>>
              : // Homomorphic, so arrays and tuples keep their shape, labels, and
                // `readonly`/optional modifiers instead of collapsing to objects.
                T extends object
                ? { [K in keyof T]: Serializable<T[K]> }
                : T;

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
