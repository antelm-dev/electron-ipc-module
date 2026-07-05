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

export function defineIpcModule(
  prefix: string,
  channels: Record<string, ChannelDef>,
  options: Partial<{
    ready: (ipc: IpcMain) => MaybePromise<void | IpcModuleCleanup>;
  }> = {},
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

export function createIpcHelpers<TEmit extends IpcEventMap>() {
  return {
    handle<TArgs extends any[] = any[], TResult = any>(fn: IpcHandler<TArgs, TResult, TEmit>) {
      return defineChannel("handle", fn);
    },

    handleOnce<TArgs extends any[] = any[], TResult = any>(fn: IpcHandler<TArgs, TResult, TEmit>) {
      return defineChannel("handleOnce", fn);
    },

    listen<TArgs extends any[] = any[], TResult = any>(fn: IpcListener<TArgs, TResult, TEmit>) {
      return defineChannel("listen", fn);
    },

    listenOnce<TArgs extends any[] = any[], TResult = any>(fn: IpcListener<TArgs, TResult, TEmit>) {
      return defineChannel("listenOnce", fn);
    },
  };
}

export const { handle, handleOnce, listen, listenOnce } = createIpcHelpers();
