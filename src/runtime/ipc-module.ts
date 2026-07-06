import { ipcMain, type IpcMain } from "electron";

import type {
  ChannelDef,
  ChannelType,
  IpcEventMap,
  IpcHandler,
  IpcListener,
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
    ? {
        kind: "handler";
        fn: IpcHandler<TArgs, TResult, TEmit>;
        once: boolean;
      }
    : {
        kind: "listener";
        fn: IpcListener<TArgs, TResult, TEmit>;
        once: boolean;
      };
}

/** Options accepted by {@link defineIpcModule}. */
export interface DefineIpcModuleOptions {
  /**
   * Hook run after every channel is registered. May return a cleanup callback
   * that runs when the module is unloaded. If it throws, all channels
   * registered so far are rolled back before the error propagates.
   */
  ready?: (ipc: IpcMain) => MaybePromise<void | IpcModuleCleanup>;
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
export function defineIpcModule(
  prefix: string,
  channels: Record<string, ChannelDef>,
  options: DefineIpcModuleOptions = {},
) {
  const { ready } = options;

  return async (ipc = ipcMain) => {
    const registered: IpcModuleRegistration["channels"][number][] = [];

    try {
      for (const [key, def] of Object.entries(channels)) {
        const channel = prefix ? `${prefix}:${key}` : key;

        if (def.kind === "handler") {
          if (def.once) ipc.handleOnce(channel, def.fn);
          else ipc.handle(channel, def.fn);

          registered.push([channel, () => ipc.removeHandler(channel)]);
        } else {
          if (def.once) ipc.once(channel, def.fn);
          else ipc.on(channel, def.fn);

          registered.push([channel, () => ipc.removeListener(channel, def.fn)]);
        }
      }

      const cleanup = await ready?.(ipc);

      return {
        channels: registered,
        cleanup: cleanup ?? undefined,
      };
    } catch (error) {
      for (const [, cleanup] of registered.reverse()) {
        cleanup();
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
    handle<TArgs extends any[] = any[], TResult = any>(fn: IpcHandler<TArgs, TResult, TEmit>) {
      return defineChannel("handle", fn);
    },

    /** Register a one-shot request/response channel via `ipcMain.handleOnce`. */
    handleOnce<TArgs extends any[] = any[], TResult = any>(fn: IpcHandler<TArgs, TResult, TEmit>) {
      return defineChannel("handleOnce", fn);
    },

    /** Register a fire-and-forget channel via `ipcMain.on`. */
    listen<TArgs extends any[] = any[], TResult = any>(fn: IpcListener<TArgs, TResult, TEmit>) {
      return defineChannel("listen", fn);
    },

    /** Register a one-shot fire-and-forget channel via `ipcMain.once`. */
    listenOnce<TArgs extends any[] = any[], TResult = any>(fn: IpcListener<TArgs, TResult, TEmit>) {
      return defineChannel("listenOnce", fn);
    },
  };
}

/**
 * Default, untyped channel helpers. Use {@link createIpcHelpers} instead when
 * you want typed emitted events.
 */
export const { handle, handleOnce, listen, listenOnce } = createIpcHelpers();
