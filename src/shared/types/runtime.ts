import type {
  IpcMain,
  IpcMainEvent,
  IpcMainInvokeEvent,
  WebContents,
  WebFrameMain,
} from "electron";

/**
 * Keep only the method-valued properties of `T`, dropping data fields.
 *
 * @deprecated This generic helper is not specific to IPC. Define an equivalent
 * mapped type in your project instead. It will be removed in the next major version.
 */
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
 * Values structured clone always rejects with `DataCloneError`.
 *
 * Rejection is for the whole payload, not the offending member: one function
 * anywhere inside an object means nothing arrives.
 */
type Uncloneable =
  | ((...args: any[]) => any)
  | symbol
  | Promise<unknown>
  | WeakMap<object, unknown>
  | WeakSet<object>;

/**
 * Whether every part of `T` survives structured clone.
 *
 * Folds a union to `true` only when all its members pass, so an optional or
 * union-typed member that *could* hold an uncloneable value fails the whole
 * check — matching a runtime that rejects the payload rather than trimming it.
 */
type IsCloneable<T> = [T] extends [never] ? true : [CloneCheck<T>] extends [true] ? true : false;

/** Distributes over unions, so a mixed union yields `boolean` and fails the fold. */
type CloneCheck<T> =
  IsAny<T> extends true
    ? true
    : T extends Uncloneable
      ? false
      : T extends StructuredCloneNative
        ? true
        : T extends Map<infer TKey, infer TValue>
          ? IsCloneable<TKey> extends true
            ? IsCloneable<TValue>
            : false
          : T extends Set<infer TItem>
            ? IsCloneable<TItem>
            : T extends readonly unknown[]
              ? IsCloneable<T[number]>
              : T extends object
                ? // Indexing by `keyof T` unions every member, including inherited
                  // methods, which is what makes a class instance fail.
                  IsCloneable<T[keyof T]>
                : true;

/**
 * Returned by {@link Serializable} in place of a payload that cannot cross IPC.
 *
 * It is deliberately not assignable to anything useful: a channel declared with
 * one is rejected by `defineIpcModule`, and a renderer cannot read it.
 */
export interface IpcUncloneable<TPayload> {
  readonly __ipcUncloneable: "This payload cannot cross the Electron IPC boundary: structured clone rejects the whole value";
  readonly payload: TPayload;
}

/** Rewrite `T` into the value the renderer actually receives. Assumes `T` clones. */
type Cloned<T> =
  // Electron converts Buffer to Uint8Array, so Buffer-only methods are absent.
  T extends Buffer
    ? Uint8Array
    : // Subclass prototypes and custom fields do not survive; the base does.
      T extends Error
      ? Error
      : T extends StructuredCloneNative
        ? T
        : T extends Map<infer TKey, infer TValue>
          ? Map<Cloned<TKey>, Cloned<TValue>>
          : T extends Set<infer TItem>
            ? Set<Cloned<TItem>>
            : // Homomorphic, so arrays and tuples keep their shape, labels, and
              // `readonly`/optional modifiers instead of collapsing to objects.
              T extends object
              ? { [K in keyof T]: Cloned<T[K]> }
              : T;

/**
 * Model what survives the IPC boundary.
 *
 * Electron serializes IPC payloads with the structured clone algorithm, which
 * does not carry JavaScript semantics across intact. Declared types describe
 * the value the main process returned; this type describes the value the
 * renderer actually receives:
 *
 * - **An uncloneable member invalidates the whole payload.** Functions, symbols,
 *   promises, `WeakMap`, and `WeakSet` make structured clone throw
 *   `DataCloneError`, and nothing arrives — so the result is
 *   {@link IpcUncloneable}, not a partially-mapped object. This propagates out
 *   of arrays, tuples, `Map`, `Set`, and nested objects.
 * - **Class instances are rejected when they carry methods**, because a type
 *   cannot distinguish an own function property (which throws) from a prototype
 *   method (which is silently dropped). Return a plain data object instead.
 *   A class with only data properties survives as a plain object, so
 *   `instanceof` is false in the renderer.
 * - **`Buffer` arrives as `Uint8Array`.** Electron converts it, so
 *   `readUInt32LE()` and friends are absent on the other side.
 * - **`Date`, `RegExp`, `Map`, `Set`, `Error`, `ArrayBuffer`, and typed arrays
 *   survive** and keep their prototypes. Subclasses of them do not: a custom
 *   `Error` arrives as a plain `Error`, without its added fields or methods.
 * - **Getters are flattened** to the value they evaluated to at send time.
 *
 * Applied automatically to the generated bridge's parameters and return types,
 * so a payload that cannot cross the boundary is a compile error at the call
 * site instead of `undefined is not a function` in the renderer.
 */
export type Serializable<T> =
  IsAny<T> extends true ? T : IsCloneable<T> extends true ? Cloned<T> : IpcUncloneable<T>;

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

/** `IpcMainInvokeEvent` (for `handle`/`handleOnce`) with a typed `sender` and lifecycle signal. */
export type TypedIpcMainInvokeEvent<TEmit extends IpcEventMap = AnyIpcEventMap> = Omit<
  IpcMainInvokeEvent,
  "sender" | "senderFrame" | "signal"
> & {
  sender: TypedWebContents<TEmit>;
  senderFrame: TypedWebFrameMain<TEmit> | null;
  /** Aborts when the `WebContents` that initiated this invocation is destroyed. */
  readonly signal: AbortSignal;
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

/** A request/response channel definition, from `handle` / `handleOnce`. */
export type HandlerDef<
  TArgs extends any[] = any[],
  TResult = any,
  TEmit extends IpcEventMap = AnyIpcEventMap,
> = {
  kind: "handler";
  fn: IpcHandler<TArgs, TResult, TEmit>;
  once: boolean;
};

/** A fire-and-forget channel definition, from `listen` / `listenOnce`. */
export type ListenerDef<
  TArgs extends any[] = any[],
  TResult = any,
  TEmit extends IpcEventMap = AnyIpcEventMap,
> = {
  kind: "listener";
  fn: IpcListener<TArgs, TResult, TEmit>;
  once: boolean;
};

/** A single channel definition produced by `handle`/`listen`/etc. */
export type ChannelDef = HandlerDef | ListenerDef;

/**
 * A channel definition, or an {@link IpcUncloneable} marker when its payload
 * cannot cross IPC.
 *
 * The marker is not assignable to {@link ChannelDef}, so `defineIpcModule`
 * rejects the channel where it is declared. Without this the mistake would only
 * surface in the generated bridge, far from the handler that caused it.
 *
 * `TResult` is checked for `handle`/`handleOnce` only. A `listen` callback's
 * return value is never sent back to the renderer, so it never gets cloned.
 */
export type CloneableChannel<TDef, TArgs, TResult> =
  IsCloneable<TArgs> extends true
    ? IsCloneable<TResult> extends true
      ? TDef
      : IpcUncloneable<TResult>
    : IpcUncloneable<TArgs>;

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
