import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  BrowserWindow,
  ipcMain,
  type IpcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";

import type {
  ChannelDef,
  ChannelType,
  CloneableChannel,
  HandlerDef,
  IpcEventMap,
  IpcEmitter,
  IpcHandler,
  IpcListener,
  ListenerDef,
  IpcModuleCleanup,
  IpcModuleRegister,
  IpcModuleRegistration,
  MaybePromise,
} from "../shared/types/runtime.js";

export type {
  IpcEventMap,
  IpcEmitter,
  TypedWebContents,
  TypedWebFrameMain,
  TypedIpcMainEvent,
  TypedIpcMainInvokeEvent,
  IpcHandler,
  IpcListener,
  IpcCleanup,
  IpcModuleCleanup,
  IpcModuleRegistration,
  IpcModuleRegister,
} from "../shared/types/runtime.js";

/**
 * Wrap a handler/listener function into a channel definition tagged with its
 * kind (`handler` vs `listener`) and whether it should only fire `once`.
 *
 * Prefer the {@link createIpcHelpers} helpers (`handle`, `listen`, …) over
 * calling this directly — they preset the `type` argument for you.
 *
 * @param type - One of `handle`, `handleOnce`, `listen`, `listenOnce`.
 * @param fn - The handler (for `handle*`) or listener (for `listen*`) callback.
 */
export function defineChannel<
  T extends ChannelType,
  TArgs extends any[] = any[],
  TResult = any,
  TEmit extends IpcEventMap = Record<string, any[]>,
>(
  type: T,
  fn: T extends "handle" | "handleOnce"
    ? IpcHandler<TArgs, TResult, TEmit>
    : IpcListener<TArgs, TResult, TEmit>,
) {
  return {
    fn,
    kind: type.startsWith("handle") ? "handler" : "listener",
    once: type.endsWith("Once"),
  } as T extends "handle" | "handleOnce"
    ? HandlerDef<TArgs, TResult, TEmit>
    : ListenerDef<TArgs, TResult, TEmit>;
}

/** Options accepted by {@link defineIpcModule}. */
export interface IpcChannelContext {
  /** Fully-qualified runtime channel name. */
  channel: string;
  /** Channel key as declared in the module. */
  key: string;
  /** Module prefix. */
  prefix: string;
}

export class IpcAuthorizationError extends Error {
  constructor(channel: string) {
    super(`IPC request was not authorized for channel ${JSON.stringify(channel)}`);
    this.name = "IpcAuthorizationError";
  }
}

/** Render one Standard Schema issue as `path: message`, or just its message. */
function formatIssue(issue: StandardSchemaV1.Issue) {
  const path = issue.path
    ?.map((segment) => String(typeof segment === "object" ? segment.key : segment))
    .join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Thrown when a schema validator rejects a channel's payload. */
export class IpcValidationError extends Error {
  /** The issues reported by the schema, in the order it produced them. */
  readonly issues: readonly StandardSchemaV1.Issue[];

  constructor(channel: string, issues: readonly StandardSchemaV1.Issue[]) {
    super(
      `IPC payload failed validation for channel ${JSON.stringify(channel)}: ${issues
        .map(formatIssue)
        .join("; ")}`,
    );
    this.name = "IpcValidationError";
    this.issues = issues;
  }
}

/**
 * A runtime guard for one channel's payload — either a callback that throws to
 * reject, or any [Standard Schema](https://standardschema.dev) (Zod, Valibot,
 * ArkType, …).
 *
 * A schema's output replaces the arguments handed to the channel callback, so
 * parsing and coercion carry through. `TArgs` is the callback's declared
 * parameter tuple, which makes a schema that no longer matches its handler a
 * compile error rather than a runtime surprise.
 *
 * A value carrying `~standard` is always treated as a schema, even when it is
 * also callable, so a callable schema is never mistaken for a callback.
 */
export type IpcChannelValidator<TArgs extends readonly unknown[] = readonly unknown[]> =
  | ((
      args: readonly unknown[],
      event: IpcMainEvent | IpcMainInvokeEvent,
      context: IpcChannelContext,
    ) => MaybePromise<void>)
  | StandardSchemaV1<readonly unknown[], TArgs>;

/** The parameter tuple a channel definition's callback accepts, minus the event. */
type ChannelArgs<TChannel> = TChannel extends {
  fn: (event: never, ...args: infer TArgs) => unknown;
}
  ? TArgs
  : readonly unknown[];

export interface DefineIpcModuleOptions<
  TChannels extends Record<string, ChannelDef> = Record<string, ChannelDef>,
> {
  /**
   * Hook run after every channel is registered. May return a cleanup callback
   * that runs when the module is unloaded. If it throws, all channels
   * registered so far are rolled back before the error propagates.
   */
  ready?: (ipc: IpcMain) => MaybePromise<void | IpcModuleCleanup>;
  /** Return `false` to reject calls from an untrusted renderer or frame. */
  authorize?: (
    event: IpcMainEvent | IpcMainInvokeEvent,
    context: IpcChannelContext,
  ) => MaybePromise<boolean | void>;
  /**
   * Per-channel runtime payload validators, keyed by channel key. A callback
   * validator throws to reject; a Standard Schema validator rejects with
   * {@link IpcValidationError} and its parsed output replaces the arguments.
   *
   * Keys are checked against the declared channels, so a misspelled entry is a
   * compile error instead of a guard that silently never runs.
   */
  validate?: { [K in keyof TChannels]?: IpcChannelValidator<ChannelArgs<TChannels[K]>> };
  /**
   * Called when a fire-and-forget `listen` / `listenOnce` channel rejects.
   * Unlike `handle` channels, listener failures are not returned to the
   * renderer — without this hook they are logged to avoid unhandled rejections.
   */
  onListenerError?: (error: unknown, context: IpcChannelContext, event: IpcMainEvent) => void;
  /** Prefix emitted renderer event channels with the module prefix or a custom prefix. */
  eventPrefix?: boolean | string;
}

/**
 * Run one validator and return the arguments the callback should receive.
 *
 * A callback validator only vets `args`, so they pass through untouched; a
 * schema returns its parsed value, which may be coerced or narrowed.
 *
 * The `~standard` marker is checked before `typeof`, because a schema may
 * itself be callable — ArkType's are. Testing for a function first would run
 * such a schema as a plain callback and discard the result it returned,
 * silently admitting the payload it had just rejected.
 */
async function runValidator(
  validator: IpcChannelValidator<readonly unknown[]>,
  args: unknown[],
  event: IpcMainEvent | IpcMainInvokeEvent,
  context: IpcChannelContext,
): Promise<unknown[]> {
  if ("~standard" in validator) {
    const result = await validator["~standard"].validate(args);
    if (result.issues) throw new IpcValidationError(context.channel, result.issues);
    return [...result.value];
  }

  await validator(args, event, context);
  return args;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value != null &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as PromiseLike<unknown>).then === "function"
  );
}

function reportListenerError(
  error: unknown,
  context: IpcChannelContext,
  event: IpcMainEvent,
  onListenerError: DefineIpcModuleOptions["onListenerError"],
) {
  if (onListenerError) {
    try {
      onListenerError(error, context, event);
    } catch (hookError) {
      console.error(
        `[electron-ipc-module] onListenerError failed for ${JSON.stringify(context.channel)}`,
        hookError,
      );
    }
    return;
  }

  console.error(
    `[electron-ipc-module] Unhandled error in listener ${JSON.stringify(context.channel)}`,
    error,
  );
}

function settleListener(result: unknown, onError: (error: unknown) => void): void {
  if (isThenable(result)) {
    void Promise.resolve(result).then(undefined, onError);
  }
}

function prefixEventChannel(eventPrefix: string | undefined, channel: string) {
  return eventPrefix ? `${eventPrefix}:${channel}` : channel;
}

/**
 * Exposes the object behind a {@link wrapSendTarget} proxy.
 *
 * A wrapped `event.sender` already prefixes every channel it is given, and it
 * satisfies `WebContents` structurally, so passing one to `emitTo` type-checks
 * and then prefixes twice — `profile:profile:updated` reaches no listener.
 * Unwrapping first keeps that call correct instead of silently misrouting it.
 */
const RAW_SEND_TARGET = Symbol("electron-ipc-module.rawSendTarget");

/**
 * The event prefix each `defineIpcModule` call resolved, keyed by the register
 * function it returned.
 *
 * Kept beside the function rather than on it: a property would have to appear
 * in the declared return type, and annotating that type is what would drop the
 * optional `ipc` parameter callers rely on.
 */
const moduleEventPrefixes = new WeakMap<IpcModuleRegister, string>();

/**
 * Create a typed sender for events produced independently of an incoming IPC
 * call, such as timers, file watchers, or background jobs.
 *
 * Pass the `defineIpcModule` register function to take the module's own
 * resolved `eventPrefix`, so renaming it cannot leave the emitter sending to a
 * channel the bridge no longer listens on. A literal string is still accepted
 * for producers that have no module to point at.
 *
 * ```ts
 * const registerProfile = defineIpcModule("profile", channels, { eventPrefix: true });
 * const profile = createIpcEmitter<ProfileEvents>(registerProfile);
 * ```
 *
 * Both methods drop the event when the target `WebContents` is already
 * destroyed, and `emitTo` accepts a handler's `event.sender` without prefixing
 * the channel a second time.
 */
export function createIpcEmitter<TEvents extends IpcEventMap>(
  source?: string | IpcModuleRegister,
): IpcEmitter<TEvents> {
  const eventPrefix = typeof source === "function" ? moduleEventPrefixes.get(source) : source;

  const send = (target: WebContents, event: string, args: readonly unknown[]) => {
    const raw = (target as { [RAW_SEND_TARGET]?: WebContents })[RAW_SEND_TARGET] ?? target;
    if (raw.isDestroyed()) return;
    raw.send(prefixEventChannel(eventPrefix, event), ...args);
  };

  return {
    emit(event, ...args) {
      for (const window of BrowserWindow.getAllWindows()) {
        send(window.webContents, event, args);
      }
    },
    emitTo(target, event, ...args) {
      send(target, event, args);
    },
  };
}

/**
 * Whether a send target is gone, so sending to it would throw in main.
 *
 * `isDestroyed` is read defensively rather than called outright: `WebContents`
 * has always carried it, but `WebFrameMain` is newer than the declared Electron
 * 12 peer floor, and a frame without the method is treated as live instead of
 * making the guard itself the thing that throws.
 */
function isGone(target: object | null | undefined): boolean {
  const isDestroyed = (target as { isDestroyed?: () => boolean } | null | undefined)?.isDestroyed;
  return typeof isDestroyed === "function" && isDestroyed.call(target);
}

/**
 * Wrapped send targets, keyed by target and then by event prefix.
 *
 * A fresh proxy per property read would make `event.sender !== event.sender`,
 * which breaks tracking a window across calls in a `WeakSet<WebContents>` — the
 * per-window initialization pattern the guides document. One proxy per
 * (target, prefix) pair keeps that identity stable.
 */
const wrappedSendTargets = new WeakMap<object, Map<string, object>>();

/**
 * Wrap a `WebContents` or `WebFrameMain` so `send` prefixes its channel and
 * drops the event once the target is destroyed.
 *
 * A window can close while an invoke is still in flight, and Electron throws
 * `Object has been destroyed` when the handler finally resolves into `send`.
 * Guarding here covers `event.sender` and `event.senderFrame` for every module,
 * prefixed or not, so no handler has to test sender liveness itself.
 */
function wrapSendTarget<T extends object>(target: T, eventPrefix: string | undefined): T {
  const prefixKey = eventPrefix ?? "";
  let byPrefix = wrappedSendTargets.get(target);
  const cached = byPrefix?.get(prefixKey);
  if (cached) return cached as T;

  const wrapped = new Proxy(target, {
    get(object, property) {
      if (property === RAW_SEND_TARGET) return object;
      if (property !== "send") {
        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      }
      return (channel: string, ...args: unknown[]) => {
        if (isGone(object)) return;
        Reflect.apply(Reflect.get(object, property) as (...args: unknown[]) => unknown, object, [
          prefixEventChannel(eventPrefix, channel),
          ...args,
        ]);
      };
    },
  });

  if (!byPrefix) {
    byPrefix = new Map<string, object>();
    wrappedSendTargets.set(target, byPrefix);
  }
  byPrefix.set(prefixKey, wrapped);
  return wrapped as T;
}

const senderSignals = new WeakMap<WebContents, AbortSignal>();

/**
 * The lifecycle {@link AbortSignal} for a sender, aborted once it is destroyed.
 *
 * Cached per `WebContents` rather than per invocation: destruction is terminal,
 * so every invoke from the same window shares one outcome, and one listener per
 * sender stays clear of the default `EventEmitter` cap of 10 however many
 * invocations are in flight.
 *
 * Built on first read rather than on every invocation, so the declared peer
 * floor of Electron 12 keeps working: `AbortController` only became an
 * unflagged global in Node 15, which Electron ships from 15.0.0. Handlers that
 * never touch `event.signal` never construct one.
 */
function senderSignal(sender: WebContents): AbortSignal {
  const cached = senderSignals.get(sender);
  if (cached) return cached;

  if (typeof AbortController === "undefined") {
    throw new Error(
      "event.signal requires a global AbortController, which Electron ships from 15.0.0 (Node 16). " +
        "Every other channel feature still runs on the declared peer floor of Electron 12.",
    );
  }

  const controller = new AbortController();
  if (sender.isDestroyed()) controller.abort();
  else sender.once("destroyed", () => controller.abort());

  senderSignals.set(sender, controller.signal);
  return controller.signal;
}

function wrapEvent<T extends IpcMainEvent | IpcMainInvokeEvent>(
  event: T,
  eventPrefix: string | undefined,
  lifecycleSignal = false,
): T {
  return new Proxy(event, {
    get(object, property) {
      if (lifecycleSignal && property === "signal") return senderSignal(object.sender);
      if (property === "sender") {
        return object.sender ? wrapSendTarget(object.sender, eventPrefix) : object.sender;
      }
      if (property === "senderFrame") {
        return object.senderFrame ? wrapSendTarget(object.senderFrame, eventPrefix) : null;
      }
      if (property === "reply" && "reply" in object) {
        return (channel: string, ...args: unknown[]) => {
          if (isGone(object.sender)) return;
          object.reply(prefixEventChannel(eventPrefix, channel), ...args);
        };
      }
      const value = Reflect.get(object, property, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}

/**
 * Declare a group of IPC channels under a shared `prefix`.
 *
 * Returns an {@link IpcModuleRegister} — call it (or hand it to
 * {@link createIpcContainer}) to actually attach the channels to `ipcMain`.
 * Each channel is registered as `${prefix}:${key}` (or just `key` when the
 * prefix is empty) and gets a matching teardown callback.
 *
 * Registration is transactional: if `options.ready` throws, every channel
 * registered up to that point is removed before the error is rethrown.
 *
 * @param prefix - Channel namespace, e.g. `"profile"` → `profile:get`.
 * @param channels - Map of channel key to a definition from `handle`/`listen`/…
 * @param options - Optional {@link DefineIpcModuleOptions}.
 */
export function defineIpcModule<TChannels extends Record<string, ChannelDef>>(
  prefix: string,
  channels: TChannels,
  options: DefineIpcModuleOptions<TChannels> = {},
) {
  const { authorize, onListenerError, ready, validate } = options;
  const eventPrefix =
    options.eventPrefix === true
      ? prefix
      : typeof options.eventPrefix === "string"
        ? options.eventPrefix
        : undefined;

  const register = async (ipc = ipcMain) => {
    const registered: IpcModuleRegistration["channels"][number][] = [];

    try {
      for (const [key, def] of Object.entries(channels)) {
        const channel = prefix ? `${prefix}:${key}` : key;
        const context = { channel, key, prefix } satisfies IpcChannelContext;
        const validator = validate?.[key] as IpcChannelValidator<readonly unknown[]> | undefined;
        const callUserFunction = (
          event: IpcMainEvent | IpcMainInvokeEvent,
          args: unknown[],
          lifecycleSignal?: boolean,
        ) => def.fn(wrapEvent(event, eventPrefix, lifecycleSignal) as never, ...args);
        const runGuarded = async (
          event: IpcMainEvent | IpcMainInvokeEvent,
          args: unknown[],
          lifecycleSignal?: boolean,
        ): Promise<unknown> => {
          if ((await authorize?.(event, context)) === false) {
            throw new IpcAuthorizationError(channel);
          }
          const validated = validator ? await runValidator(validator, args, event, context) : args;
          return callUserFunction(event, validated, lifecycleSignal);
        };

        let fn: (...args: any[]) => any;
        if (def.kind === "handler") {
          fn =
            authorize || validator
              ? (event: IpcMainInvokeEvent, ...args: unknown[]) => runGuarded(event, args, true)
              : (event: IpcMainInvokeEvent, ...args: unknown[]) =>
                  callUserFunction(event, args, true);

          if (def.once) ipc.handleOnce(channel, fn);
          else ipc.handle(channel, fn);

          registered.push([channel, () => ipc.removeHandler(channel)]);
        } else {
          // Every listener is wrapped, prefix or not: `event.sender.send` and
          // `event.reply` need the destroyed-sender guard as much as handlers do.
          const invoke =
            authorize || validator
              ? (event: IpcMainEvent, args: unknown[]) => runGuarded(event, args)
              : (event: IpcMainEvent, args: unknown[]) => callUserFunction(event, args);

          fn = (event: IpcMainEvent, ...args: unknown[]) => {
            const onError = (error: unknown) =>
              reportListenerError(error, context, event, onListenerError);
            try {
              settleListener(invoke(event, args), onError);
            } catch (error) {
              onError(error);
            }
          };

          if (def.once) ipc.once(channel, fn);
          else ipc.on(channel, fn);

          registered.push([channel, () => ipc.removeListener(channel, fn)]);
        }
      }

      const cleanup = await ready?.(ipc);

      return {
        channels: registered,
        cleanup: cleanup ?? undefined,
      };
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const [, cleanup] of registered.reverse()) {
        try {
          cleanup();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          "IPC module registration and rollback both failed",
        );
      }
      throw error;
    }
  };

  if (eventPrefix) moduleEventPrefixes.set(register, eventPrefix);
  return register;
}

/**
 * Declare the map of events a module emits to the renderer, purely for typing.
 *
 * Returns an empty object typed as `TEvents`; it carries no runtime value. The
 * Rollup bridge plugin reads the `TEvents` type argument to generate typed
 * `on*` / `once*` listeners in the preload bridge.
 *
 * ```ts
 * type ProfileEvents = { "profile-updated": [profile: Profile] };
 * export const profileEvents = defineIpcEvents<ProfileEvents>();
 * ```
 */
export function defineIpcEvents<TEvents extends IpcEventMap>(): TEvents {
  return {} as TEvents;
}

/**
 * Build `handle` / `handleOnce` / `listen` / `listenOnce` helpers bound to a
 * specific emitted-event map `TEmit`.
 *
 * The `TEmit` type flows into `event.reply`, `event.sender.send`, and
 * `event.senderFrame?.send` inside each callback, giving fully typed emits.
 */
export function createIpcHelpers<TEmit extends IpcEventMap>() {
  return {
    /** Register a request/response channel via `ipcMain.handle`. */
    handle<TArgs extends any[] = any[], TResult = any>(
      fn: IpcHandler<TArgs, TResult, TEmit>,
    ): CloneableChannel<HandlerDef<TArgs, TResult, TEmit>, TArgs, TResult> {
      return defineChannel("handle", fn) as never;
    },

    /**
     * Register a one-shot request/response channel via `ipcMain.handleOnce`.
     *
     * Scoped to the **process**, not a window: `ipcMain` is global, so the
     * first caller from any window consumes the handler and every later
     * `invoke` — including from other windows — rejects with "No handler
     * registered". Use `handle` for anything a multi-window app can call more
     * than once.
     */
    handleOnce<TArgs extends any[] = any[], TResult = any>(
      fn: IpcHandler<TArgs, TResult, TEmit>,
    ): CloneableChannel<HandlerDef<TArgs, TResult, TEmit>, TArgs, TResult> {
      return defineChannel("handleOnce", fn) as never;
    },

    /** Register a fire-and-forget channel via `ipcMain.on`. */
    // `unknown` in the result slot: a listener's return value is never sent
    // back to the renderer, so only its arguments have to survive cloning.
    listen<TArgs extends any[] = any[], TResult = any>(
      fn: IpcListener<TArgs, TResult, TEmit>,
    ): CloneableChannel<ListenerDef<TArgs, TResult, TEmit>, TArgs, unknown> {
      return defineChannel("listen", fn) as never;
    },

    /**
     * Register a one-shot fire-and-forget channel via `ipcMain.once`.
     *
     * Process-scoped like {@link handleOnce}: the first
     * message from any window consumes the listener, and later sends are
     * silently ignored.
     */
    listenOnce<TArgs extends any[] = any[], TResult = any>(
      fn: IpcListener<TArgs, TResult, TEmit>,
    ): CloneableChannel<ListenerDef<TArgs, TResult, TEmit>, TArgs, unknown> {
      return defineChannel("listenOnce", fn) as never;
    },
  };
}

/**
 * Default, untyped channel helpers. Use {@link createIpcHelpers} instead when
 * you want typed emitted events.
 */
export const { handle, handleOnce, listen, listenOnce } = createIpcHelpers();
