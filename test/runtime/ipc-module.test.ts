import {
  defineIpcModule,
  handle,
  handleOnce,
  listen,
  listenOnce,
  IpcAuthorizationError,
} from "../../src/runtime/ipc-module.js";
import { vi, describe, it, expect } from "vitest";

const createIpc = () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const listeners = new Map<string, (...args: unknown[]) => unknown>();

  return {
    handlers,
    listeners,
    ipc: {
      handle: vi.fn((channel, fn) => handlers.set(channel, fn)),
      handleOnce: vi.fn((channel, fn) => handlers.set(channel, fn)),
      on: vi.fn((channel, fn) => listeners.set(channel, fn)),
      once: vi.fn((channel, fn) => listeners.set(channel, fn)),
      removeHandler: vi.fn(),
      removeListener: vi.fn(),
    },
  };
};

describe("defineIpcModule", () => {
  it("registers channels and exposes cleanup callbacks", async () => {
    const { ipc } = createIpc();
    const cleanup = vi.fn();
    const ready = vi.fn(() => cleanup);

    const register = defineIpcModule(
      "demo",
      {
        ping: handle(async () => "pong"),
        notify: listenOnce(() => undefined),
      },
      {
        ready,
      },
    );

    const registration = await register(ipc as never);

    expect(ipc.handle).toHaveBeenCalledWith("demo:ping", expect.any(Function));
    expect(ipc.once).toHaveBeenCalledWith("demo:notify", expect.any(Function));
    expect(ready).toHaveBeenCalledWith(ipc);
    expect(registration.channels.map(([channel]) => channel)).toEqual(["demo:ping", "demo:notify"]);

    registration.channels[0]?.[1]();
    registration.channels[1]?.[1]();
    registration.cleanup?.();

    expect(ipc.removeHandler).toHaveBeenCalledWith("demo:ping");
    expect(ipc.removeListener).toHaveBeenCalledWith("demo:notify", expect.any(Function));
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("rolls back registered channels when ready fails", async () => {
    const { ipc } = createIpc();
    const error = new Error("boom");

    const register = defineIpcModule(
      "demo",
      {
        ping: handle(async () => "pong"),
        notify: listenOnce(() => undefined),
      },
      {
        ready: async () => {
          throw error;
        },
      },
    );

    await expect(register(ipc as never)).rejects.toThrow(error);

    expect(ipc.removeHandler).toHaveBeenCalledWith("demo:ping");
    expect(ipc.removeListener).toHaveBeenCalledWith("demo:notify", expect.any(Function));
  });

  it("registers handleOnce and listen with the expected ipcMain methods", async () => {
    const { ipc } = createIpc();

    const register = defineIpcModule("app", {
      once: handleOnce(async () => "once"),
      notify: listen(() => undefined),
    });

    const registration = await register(ipc as never);

    expect(ipc.handleOnce).toHaveBeenCalledWith("app:once", expect.any(Function));
    expect(ipc.on).toHaveBeenCalledWith("app:notify", expect.any(Function));
    expect(registration.channels.map(([channel]) => channel)).toEqual(["app:once", "app:notify"]);
  });

  it("uses unprefixed channel names when prefix is empty", async () => {
    const { ipc } = createIpc();

    await defineIpcModule("", {
      ping: handle(async () => "pong"),
    })(ipc as never);

    expect(ipc.handle).toHaveBeenCalledWith("ping", expect.any(Function));
  });

  it("authorizes and validates handler calls before invoking user code", async () => {
    const { handlers, ipc } = createIpc();
    const authorize = vi.fn(() => true);
    const validate = vi.fn();
    const handler = vi.fn((_event, value: string) => value.toUpperCase());

    await defineIpcModule(
      "secure",
      { save: handle(handler) },
      { authorize, validate: { save: validate } },
    )(ipc as never);

    const event = { sender: {}, senderFrame: null };
    await expect(handlers.get("secure:save")?.(event, "ok")).resolves.toBe("OK");
    expect(authorize).toHaveBeenCalledWith(event, {
      channel: "secure:save",
      key: "save",
      prefix: "secure",
    });
    expect(validate).toHaveBeenCalledWith(["ok"], event, expect.any(Object));
  });

  it("rejects unauthorized handler calls", async () => {
    const { handlers, ipc } = createIpc();
    const handler = vi.fn();
    await defineIpcModule(
      "secure",
      { read: handle(handler) },
      { authorize: () => false },
    )(ipc as never);

    await expect(
      handlers.get("secure:read")?.({ sender: {}, senderFrame: null }),
    ).rejects.toBeInstanceOf(IpcAuthorizationError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("optionally namespaces emitted renderer events", async () => {
    const { handlers, ipc } = createIpc();
    const send = vi.fn();
    await defineIpcModule(
      "profile",
      { save: handle((event) => event.sender.send("updated", "id")) },
      { eventPrefix: true },
    )(ipc as never);

    await handlers.get("profile:save")?.({ sender: { send }, senderFrame: null });
    expect(send).toHaveBeenCalledWith("profile:updated", "id");
  });

  it("registers handlers that can be invoked with args and return values", async () => {
    const { ipc, handlers } = createIpc();

    await defineIpcModule("math", {
      add: handle(async (_event, a: number, b: number) => a + b),
    })(ipc as never);

    const handler = handlers.get("math:add");
    expect(handler).toBeTypeOf("function");
    expect(await handler?.({} as never, 2, 3)).toBe(5);
  });
});
