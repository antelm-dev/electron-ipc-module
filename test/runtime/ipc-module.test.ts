import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
  defineIpcModule,
  handle,
  handleOnce,
  listen,
  listenOnce,
  IpcAuthorizationError,
  IpcValidationError,
} from "../../src/runtime/ipc-module.js";
import { vi, describe, it, expect } from "vitest";

/**
 * A minimal Standard Schema, so the contract is exercised without pulling in
 * Zod or Valibot just to prove the shape is honored.
 */
const schemaOf = <TOutput extends readonly unknown[]>(
  validate: (args: readonly unknown[]) => StandardSchemaV1.Result<TOutput>,
): StandardSchemaV1<readonly unknown[], TOutput> => ({
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => validate(value as readonly unknown[]),
  },
});

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

  it("preserves validation failures and does not invoke the handler", async () => {
    const { handlers, ipc } = createIpc();
    const error = new TypeError("invalid payload");
    const handler = vi.fn();
    await defineIpcModule(
      "secure",
      { save: handle(handler) },
      {
        validate: {
          save: () => {
            throw error;
          },
        },
      },
    )(ipc as never);

    await expect(handlers.get("secure:save")?.({ sender: {}, senderFrame: null })).rejects.toBe(
      error,
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes a schema validator's parsed output to the handler", async () => {
    const { handlers, ipc } = createIpc();
    const handler = vi.fn((_event, count: number) => count * 2);

    await defineIpcModule(
      "secure",
      { double: handle(handler) },
      {
        // Coercion has to reach the handler, otherwise validating a payload and
        // acting on it would disagree about what was actually checked.
        validate: { double: schemaOf((args) => ({ value: [Number(args[0])] as [number] })) },
      },
    )(ipc as never);

    const event = { sender: {}, senderFrame: null };
    await expect(handlers.get("secure:double")?.(event, "21")).resolves.toBe(42);
    expect(handler).toHaveBeenCalledWith(event, 21);
  });

  it("rejects a handler with IpcValidationError when a schema reports issues", async () => {
    const { handlers, ipc } = createIpc();
    const handler = vi.fn();

    await defineIpcModule(
      "secure",
      { save: handle(handler) },
      {
        validate: {
          save: schemaOf(() => ({ issues: [{ message: "expected string", path: ["0", "id"] }] })),
        },
      },
    )(ipc as never);

    const rejection = handlers.get("secure:save")?.({ sender: {}, senderFrame: null }, 1);
    await expect(rejection).rejects.toBeInstanceOf(IpcValidationError);
    await expect(rejection).rejects.toThrow('channel "secure:save": 0.id: expected string');
    expect(handler).not.toHaveBeenCalled();
  });

  it("awaits an asynchronous schema and reports its issues on a listener", async () => {
    const { listeners, ipc } = createIpc();
    const listener = vi.fn();
    const onListenerError = vi.fn();

    await defineIpcModule(
      "secure",
      { track: listen(listener) },
      {
        validate: {
          track: {
            "~standard": {
              version: 1,
              vendor: "test",
              validate: async () => ({ issues: [{ message: "not allowed" }] }),
            },
          },
        },
        onListenerError,
      },
    )(ipc as never);

    listeners.get("secure:track")?.({ sender: {}, senderFrame: null }, "payload");
    await vi.waitFor(() => expect(onListenerError).toHaveBeenCalled());

    const [error] = onListenerError.mock.calls[0] as [IpcValidationError];
    expect(error).toBeInstanceOf(IpcValidationError);
    expect(error.issues).toEqual([{ message: "not allowed" }]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("preserves registration collisions and rolls back earlier channels", async () => {
    const { handlers, ipc } = createIpc();
    const collision = new Error("handler already registered");
    ipc.handle
      .mockImplementationOnce((channel, fn) => handlers.set(channel, fn))
      .mockImplementationOnce(() => {
        throw collision;
      });

    await expect(
      defineIpcModule("demo", {
        first: handle(() => undefined),
        second: handle(() => undefined),
      })(ipc as never),
    ).rejects.toBe(collision);

    expect(ipc.removeHandler).toHaveBeenCalledOnce();
    expect(ipc.removeHandler).toHaveBeenCalledWith("demo:first");
  });

  it("routes unauthorized listen failures to onListenerError", async () => {
    const { listeners, ipc } = createIpc();
    const listener = vi.fn();
    const onListenerError = vi.fn();
    const event = { sender: {}, senderFrame: null };

    await defineIpcModule(
      "secure",
      { notify: listen(listener) },
      { authorize: async () => false, onListenerError },
    )(ipc as never);

    listeners.get("secure:notify")?.(event, "payload");
    await vi.waitFor(() => expect(onListenerError).toHaveBeenCalledOnce());

    expect(onListenerError.mock.calls[0]?.[0]).toBeInstanceOf(IpcAuthorizationError);
    expect(onListenerError.mock.calls[0]?.[1]).toEqual({
      channel: "secure:notify",
      key: "notify",
      prefix: "secure",
    });
    expect(onListenerError.mock.calls[0]?.[2]).toBe(event);
    expect(listener).not.toHaveBeenCalled();
  });

  it("catches rejected listen promises without unhandled rejections", async () => {
    const { listeners, ipc } = createIpc();
    const error = new Error("listener failed");
    const onListenerError = vi.fn();
    const rejectionHandler = vi.fn();
    process.on("unhandledRejection", rejectionHandler);

    try {
      await defineIpcModule(
        "demo",
        {
          notify: listen(async () => {
            throw error;
          }),
        },
        { onListenerError },
      )(ipc as never);

      listeners.get("demo:notify")?.({ sender: {}, senderFrame: null });
      await vi.waitFor(() =>
        expect(onListenerError).toHaveBeenCalledWith(error, expect.any(Object), expect.any(Object)),
      );
      await Promise.resolve();
      expect(rejectionHandler).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", rejectionHandler);
    }
  });

  it("logs listen failures when onListenerError is omitted", async () => {
    const { listeners, ipc } = createIpc();
    const error = new Error("boom");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await defineIpcModule(
        "demo",
        {
          notify: listen(async () => {
            throw error;
          }),
        },
        { authorize: () => true },
      )(ipc as never);

      listeners.get("demo:notify")?.({ sender: {}, senderFrame: null });
      await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
      expect(consoleError.mock.calls[0]?.[0]).toContain("demo:notify");
      expect(consoleError.mock.calls[0]?.[1]).toBe(error);
    } finally {
      consoleError.mockRestore();
    }
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
