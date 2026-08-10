import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ipcMain, type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";

import type {
  ChannelDef,
  ChannelType,
  CloneableChannel,
  HandlerDef,
  IpcEventMap,
  IpcHandler,
  IpcListener,
  ListenerDef,
  IpcModuleCleanup,
  IpcModuleRegistration,
  MaybePromise,
} from "../shared/types/runtime.js";

export type {
  IpcEventMap,
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

function wrapSendTarget<T extends object>(target: T, eventPrefix: string | undefined): T {
  if (!eventPrefix) return target;
  return new Proxy(target, {
    get(object, property) {
      if (property !== "send") {
        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      }
      return (channel: string, ...args: unknown[]) =>
        Reflect.apply(Reflect.get(object, property) as (...args: unknown[]) => unknown, object, [
          prefixEventChannel(eventPrefix, channel),
          ...args,
        ]);
    },
  });
}

function wrapEvent<T extends IpcMainEvent | IpcMainInvokeEvent>(
  event: T,
  eventPrefix: string | undefined,
): T {
  if (!eventPrefix) return event;
  return new Proxy(event, {
    get(object, property) {
      if (property === "sender") return wrapSendTarget(object.sender, eventPrefix);
      if (property === "senderFrame") {
        return object.senderFrame ? wrapSendTarget(object.senderFrame, eventPrefix) : null;
      }
      if (property === "reply" && "reply" in object) {
        return (channel: string, ...args: unknown[]) =>
          object.reply(prefixEventChannel(eventPrefix, channel), ...args);
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

  return async (ipc = ipcMain) => {
    const registered: IpcModuleRegistration["channels"][number][] = [];

    try {
      for (const [key, def] of Object.entries(channels)) {
        const channel = prefix ? `${prefix}:${key}` : key;
        const context = { channel, key, prefix } satisfies IpcChannelContext;
        const validator = validate?.[key] as IpcChannelValidator<readonly unknown[]> | undefined;
        const callUserFunction = (event: IpcMainEvent | IpcMainInvokeEvent, args: unknown[]) =>
          def.fn(wrapEvent(event, eventPrefix) as never, ...args);
        const runGuarded = async (
          event: IpcMainEvent | IpcMainInvokeEvent,
          args: unknown[],
        ): Promise<unknown> => {
          if ((await authorize?.(event, context)) === false) {
            throw new IpcAuthorizationError(channel);
          }
          const validated = validator ? await runValidator(validator, args, event, context) : args;
          return callUserFunction(event, validated);
        };

        let fn: (...args: any[]) => any;
        if (def.kind === "handler") {
          fn =
            authorize || validator
              ? (event: IpcMainInvokeEvent, ...args: unknown[]) => runGuarded(event, args)
              : eventPrefix
                ? (event: IpcMainInvokeEvent, ...args: unknown[]) => callUserFunction(event, args)
                : def.fn;

          if (def.once) ipc.handleOnce(channel, fn);
          else ipc.handle(channel, fn);

          registered.push([channel, () => ipc.removeHandler(channel)]);
        } else {
          const invoke =
            authorize || validator
              ? (event: IpcMainEvent, args: unknown[]) => runGuarded(event, args)
              : eventPrefix
                ? (event: IpcMainEvent, args: unknown[]) => callUserFunction(event, args)
                : (event: IpcMainEvent, args: unknown[]) => def.fn(event as never, ...args);

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
     * Process-scoped like {@link createIpcHelpers.handleOnce}: the first
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
