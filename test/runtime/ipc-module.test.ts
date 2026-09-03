import type { StandardSchemaV1 } from "@standard-schema/spec";
import { EventEmitter } from "node:events";

import {
  createIpcEmitter,
  defineIpcEvents,
  defineIpcModule,
  handle,
  handleOnce,
  listen,
  listenOnce,
  IpcAuthorizationError,
  IpcValidationError,
} from "../../src/runtime/ipc-module.js";
import { BrowserWindow } from "electron";
import { beforeEach, vi, describe, it, expect } from "vitest";

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

const createInvokeSender = () => {
  let destroyed = false;
  const sender = Object.assign(new EventEmitter(), {
    send: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    destroy: () => {
      destroyed = true;
      sender.emit("destroyed");
    },
  });
  return sender;
};

const createInvokeEvent = (sender = createInvokeSender()) => ({ sender, senderFrame: null });

describe("createIpcEmitter", () => {
  const getAllWindows = vi.mocked(BrowserWindow.getAllWindows);

  beforeEach(() => {
    getAllWindows.mockReset();
    getAllWindows.mockReturnValue([]);
  });

  it.each([
    ["true", true as const, "profile:profile-updated"],
    ["a string", "app" as const, "app:profile-updated"],
    ["omitted", undefined, "profile-updated"],
  ])(
    "takes the module's own event prefix when eventPrefix is %s",
    (_label, eventPrefix, channel) => {
      const contents = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
      getAllWindows.mockReturnValue([{ webContents: contents }] as never);

      const register = defineIpcModule("profile", { save: handle(() => 1) }, { eventPrefix });
      createIpcEmitter<{ "profile-updated": [id: string] }>(register).emit("profile-updated", "u1");

      expect(contents.send).toHaveBeenCalledWith(channel, "u1");
    },
  );

  it("prefixes once when the target is a handler's already-prefixing sender", async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = {
      handle: vi.fn((channel, fn) => handlers.set(channel, fn)),
      handleOnce: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeHandler: vi.fn(),
      removeListener: vi.fn(),
    };
    const send = vi.fn();
    const isDestroyed = vi.fn(() => false);
    let sender: unknown;

    await defineIpcModule(
      "profile",
      { save: handle((event) => void (sender = event.sender)) },
      { eventPrefix: true },
    )(ipc as never);
    await handlers.get("profile:save")?.({ sender: { send, isDestroyed }, senderFrame: null });

    createIpcEmitter<{ updated: [id: string] }>("profile").emitTo(
      sender as never,
      "updated",
      "user-1",
    );

    expect(send).toHaveBeenCalledWith("profile:updated", "user-1");
  });

  it("broadcasts a prefixed event to every live window and skips destroyed contents", () => {
    const first = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
    const second = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
    const destroyed = { send: vi.fn(), isDestroyed: vi.fn(() => true) };
    getAllWindows.mockReturnValue([
      { webContents: first },
      { webContents: destroyed },
      { webContents: second },
    ] as never);

    const emitter = createIpcEmitter<{ "profile-updated": [id: string, active: boolean] }>(
      "profile",
    );
    const result = emitter.emit("profile-updated", "user-1", true);

    expect(result).toBeUndefined();
    expect(first.send).toHaveBeenCalledOnce();
    expect(first.send).toHaveBeenCalledWith("profile:profile-updated", "user-1", true);
    expect(second.send).toHaveBeenCalledOnce();
    expect(second.send).toHaveBeenCalledWith("profile:profile-updated", "user-1", true);
    expect(destroyed.send).not.toHaveBeenCalled();
  });

  it.each([undefined, ""])("leaves the event channel unchanged for prefix %j", (prefix) => {
    const contents = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
    getAllWindows.mockReturnValue([{ webContents: contents }] as never);

    createIpcEmitter<{ "profile-updated": [id: string] }>(prefix).emit("profile-updated", "user-1");

    expect(contents.send).toHaveBeenCalledWith("profile-updated", "user-1");
  });

  it("sends only to the explicit target without enumerating windows", () => {
    const target = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
    const other = { send: vi.fn(), isDestroyed: vi.fn(() => false) };
    getAllWindows.mockReturnValue([{ webContents: other }] as never);

    const result = createIpcEmitter<{ completed: [jobId: number] }>("jobs").emitTo(
      target as never,
      "completed",
      42,
    );

    expect(result).toBeUndefined();
    expect(target.send).toHaveBeenCalledOnce();
    expect(target.send).toHaveBeenCalledWith("jobs:completed", 42);
    expect(getAllWindows).not.toHaveBeenCalled();
    expect(other.send).not.toHaveBeenCalled();
  });

  it("does not send to a destroyed explicit target", () => {
    const target = { send: vi.fn(), isDestroyed: vi.fn(() => true) };

    createIpcEmitter<{ completed: [jobId: number] }>("jobs").emitTo(
      target as never,
      "completed",
      42,
    );

    expect(target.send).not.toHaveBeenCalled();
    expect(getAllWindows).not.toHaveBeenCalled();
  });
});

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

    const event = createInvokeEvent();
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

    await expect(handlers.get("secure:read")?.(createInvokeEvent())).rejects.toBeInstanceOf(
      IpcAuthorizationError,
    );
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

    await expect(handlers.get("secure:save")?.(createInvokeEvent())).rejects.toBe(error);
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

    // Asserted on the argument rather than the whole call: the handler sees a
    // proxied event, so the raw one is not deep-equal to what it received.
    await expect(handlers.get("secure:double")?.(createInvokeEvent(), "21")).resolves.toBe(42);
    expect(handler.mock.lastCall?.[1]).toBe(21);
  });

  it("treats a callable schema as a schema, not as a callback validator", async () => {
    // ArkType's schemas are callable and carry `~standard`. Discriminating on
    // `typeof === "function"` first would invoke this as a plain callback and
    // throw the result away, admitting a payload the schema had rejected.
    const callableSchema = Object.assign(
      vi.fn(() => "called as a callback"),
      {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: vi.fn((value: unknown) => {
            const [first] = value as readonly unknown[];
            return typeof first === "string"
              ? { value: [first.trim()] as [string] }
              : { issues: [{ message: "expected a string" }] };
          }),
        },
      } satisfies StandardSchemaV1<readonly unknown[], [string]>,
    );

    const { handlers, ipc } = createIpc();
    const handler = vi.fn((_event, name: string) => `hi ${name}`);
    await defineIpcModule(
      "secure",
      { greet: handle(handler) },
      { validate: { greet: callableSchema } },
    )(ipc as never);

    const event = createInvokeEvent();
    const call = handlers.get("secure:greet");

    // The schema's own API runs, and its parsed output reaches the handler.
    await expect(call?.(event, "  ada  ")).resolves.toBe("hi ada");
    expect(callableSchema["~standard"].validate).toHaveBeenCalledWith(["  ada  "]);
    expect(handler.mock.lastCall?.[1]).toBe("ada");

    // Invalid input is rejected rather than silently passed through.
    await expect(call?.(event, 42)).rejects.toBeInstanceOf(IpcValidationError);
    expect(handler).toHaveBeenCalledTimes(1);

    // The callable side was never used as a validator.
    expect(callableSchema).not.toHaveBeenCalled();
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

    const rejection = handlers.get("secure:save")?.(createInvokeEvent(), 1);
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

    const sender = createInvokeSender();
    sender.send = send;
    await handlers.get("profile:save")?.({ sender, senderFrame: null });
    expect(send).toHaveBeenCalledWith("profile:updated", "id");
  });

  it("registers handlers that can be invoked with args and return values", async () => {
    const { ipc, handlers } = createIpc();

    await defineIpcModule("math", {
      add: handle(async (_event, a: number, b: number) => a + b),
    })(ipc as never);

    const handler = handlers.get("math:add");
    expect(handler).toBeTypeOf("function");
    expect(await handler?.(createInvokeEvent(), 2, 3)).toBe(5);
  });
});

describe("defineIpcModule invoke lifecycle signals", () => {
  it("shares one signal per sender and keeps senders isolated", async () => {
    const { handlers, ipc } = createIpc();
    const signals: AbortSignal[] = [];
    const resolvers: Array<() => void> = [];

    await defineIpcModule("jobs", {
      run: handle((event) => {
        signals.push(event.signal);
        return new Promise<void>((resolve) => resolvers.push(resolve));
      }),
    })(ipc as never);

    const firstSender = createInvokeSender();
    const secondSender = createInvokeSender();
    const first = handlers.get("jobs:run")?.(createInvokeEvent(firstSender));
    const concurrent = handlers.get("jobs:run")?.(createInvokeEvent(firstSender));
    const second = handlers.get("jobs:run")?.(createInvokeEvent(secondSender));

    // Destruction is terminal for a sender, so its pending invocations all
    // share one signal; a different window is a different lifetime.
    expect(signals).toHaveLength(3);
    expect(signals[0]).toBe(signals[1]);
    expect(signals[0]).not.toBe(signals[2]);
    expect(signals.map((signal) => signal.aborted)).toEqual([false, false, false]);

    firstSender.destroy();
    expect(signals.map((signal) => signal.aborted)).toEqual([true, true, false]);

    resolvers.forEach((resolve) => resolve());
    await Promise.all([first, concurrent, second]);
  });

  it("registers one destroyed listener however many invocations run", async () => {
    const { handlers, ipc } = createIpc();
    const sender = createInvokeSender();
    const failure = new Error("nope");

    await defineIpcModule("jobs", {
      ok: handle((event) => (event.signal.aborted ? "gone" : "done")),
      boom: handle(async (event) => {
        void event.signal;
        throw failure;
      }),
    })(ipc as never);

    const pending = Array.from({ length: 20 }, (_, index) =>
      index % 2
        ? handlers.get("jobs:ok")?.(createInvokeEvent(sender))
        : expect(handlers.get("jobs:boom")?.(createInvokeEvent(sender))).rejects.toBe(failure),
    );

    // The default EventEmitter cap is 10: one listener per invocation would
    // warn about a leak on any window that fans out its invokes.
    expect(sender.listenerCount("destroyed")).toBe(1);
    await Promise.all(pending);
    expect(sender.listenerCount("destroyed")).toBe(1);
  });

  it("stays off the sender until a handler reads the signal", async () => {
    const { handlers, ipc } = createIpc();
    const sender = createInvokeSender();

    await defineIpcModule("jobs", { run: handle(() => "done") })(ipc as never);
    expect(handlers.get("jobs:run")?.(createInvokeEvent(sender))).toBe("done");

    // Nothing observes the sender, and no AbortController is constructed, for
    // handlers that never touch `event.signal` — which is what keeps the
    // Electron 12 peer floor working, since Node 14 has no global one.
    expect(sender.listenerCount("destroyed")).toBe(0);
  });

  it("explains itself when the runtime has no global AbortController", async () => {
    const { handlers, ipc } = createIpc();
    const original = globalThis.AbortController;
    let thrown: unknown;

    await defineIpcModule("jobs", {
      run: handle((event) => {
        try {
          return event.signal;
        } catch (error) {
          thrown = error;
          return "caught";
        }
      }),
    })(ipc as never);

    // @ts-expect-error Simulating a Node 14 runtime, where the global is absent.
    delete globalThis.AbortController;
    try {
      expect(handlers.get("jobs:run")?.(createInvokeEvent())).toBe("caught");
    } finally {
      globalThis.AbortController = original;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/Electron ships from 15.0.0/);
  });

  it("starts aborted when the sender was already destroyed", async () => {
    const { handlers, ipc } = createIpc();
    let signal: AbortSignal | undefined;

    await defineIpcModule("jobs", {
      run: handle((event) => void (signal = event.signal)),
    })(ipc as never);

    const sender = createInvokeSender();
    sender.destroy();
    await handlers.get("jobs:run")?.(createInvokeEvent(sender));

    expect(signal?.aborted).toBe(true);
    expect(sender.listenerCount("destroyed")).toBe(0);
  });

  it("aborts a retained signal when the sender is destroyed after settlement", async () => {
    const { handlers, ipc } = createIpc();
    const sender = createInvokeSender();
    let signal: AbortSignal | undefined;

    await defineIpcModule("jobs", {
      run: handle((event) => {
        signal = event.signal;
        return "done";
      }),
    })(ipc as never);

    expect(await handlers.get("jobs:run")?.(createInvokeEvent(sender))).toBe("done");
    expect(signal?.aborted).toBe(false);

    sender.destroy();
    expect(signal?.aborted).toBe(true);
  });

  it("passes the signal through authorize and validate guards", async () => {
    const { handlers, ipc } = createIpc();
    const sender = createInvokeSender();
    let signal: AbortSignal | undefined;

    await defineIpcModule(
      "jobs",
      {
        run: handle((event, value: number) => {
          signal = event.signal;
          return value;
        }),
      },
      { authorize: () => true, validate: { run: () => undefined } },
    )(ipc as never);

    await handlers.get("jobs:run")?.(createInvokeEvent(sender), 1);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    sender.destroy();
    expect(signal?.aborted).toBe(true);
  });

  it("provides the lifecycle signal to handleOnce callbacks", async () => {
    const { handlers, ipc } = createIpc();
    let signal: AbortSignal | undefined;

    await defineIpcModule("jobs", {
      run: handleOnce((event) => void (signal = event.signal)),
    })(ipc as never);

    await handlers.get("jobs:run")?.(createInvokeEvent());
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("destroyed sender", () => {
  it.each([undefined, true as const])(
    "drops event.sender.send after the window closes mid-invoke, eventPrefix %j",
    async (eventPrefix) => {
      const { handlers, ipc } = createIpc();
      const sender = createInvokeSender();
      let release: (() => void) | undefined;

      await defineIpcModule(
        "jobs",
        {
          run: handle(async (event) => {
            await new Promise<void>((resolve) => (release = resolve));
            // The window is gone by now; this must no-op instead of throwing.
            event.sender.send("done" as never);
            return "ok";
          }),
        },
        { eventPrefix },
      )(ipc as never);

      const pending = handlers.get("jobs:run")?.(createInvokeEvent(sender));
      sender.destroy();
      release?.();

      await expect(pending).resolves.toBe("ok");
      expect(sender.send).not.toHaveBeenCalled();
    },
  );

  it("drops event.reply from a listener whose sender is gone", async () => {
    const { listeners, ipc } = createIpc();
    const sender = createInvokeSender();
    const reply = vi.fn();

    await defineIpcModule("jobs", {
      notify: listen((event) => {
        sender.destroy();
        event.reply("noted" as never);
      }),
    })(ipc as never);

    listeners.get("jobs:notify")?.({ reply, sender, senderFrame: null });

    expect(reply).not.toHaveBeenCalled();
  });

  it("drops senderFrame.send once the frame is destroyed", async () => {
    const { handlers, ipc } = createIpc();
    const senderFrame = { send: vi.fn(), isDestroyed: vi.fn(() => true) };

    await defineIpcModule("jobs", {
      run: handle((event) => void event.senderFrame?.send("done" as never)),
    })(ipc as never);

    await handlers.get("jobs:run")?.({ sender: createInvokeSender(), senderFrame });

    expect(senderFrame.send).not.toHaveBeenCalled();
  });

  it("still sends while the sender is alive", async () => {
    const { handlers, ipc } = createIpc();
    const sender = createInvokeSender();

    await defineIpcModule("jobs", {
      run: handle((event) => void event.sender.send("done" as never, 1 as never)),
    })(ipc as never);

    await handlers.get("jobs:run")?.(createInvokeEvent(sender));

    expect(sender.send).toHaveBeenCalledWith("done", 1);
  });

  it("keeps event.sender identity stable so a WeakSet can track windows", async () => {
    const { handlers, ipc } = createIpc();
    const sender = createInvokeSender();
    const seen = new WeakSet<object>();
    const results: boolean[] = [];

    await defineIpcModule("jobs", {
      run: handle((event) => {
        results.push(seen.has(event.sender));
        seen.add(event.sender);
      }),
    })(ipc as never);

    await handlers.get("jobs:run")?.(createInvokeEvent(sender));
    await handlers.get("jobs:run")?.(createInvokeEvent(sender));

    expect(results).toEqual([false, true]);
  });

  it("treats a send target without isDestroyed as live", async () => {
    const { handlers, ipc } = createIpc();
    // WebFrameMain predates the peer floor's `isDestroyed`; the guard must not
    // be the thing that throws.
    const sender = { send: vi.fn() };

    await defineIpcModule("jobs", {
      run: handle((event) => void event.sender.send("done" as never)),
    })(ipc as never);

    await handlers.get("jobs:run")?.({ sender, senderFrame: null });

    expect(sender.send).toHaveBeenCalledWith("done");
  });
});

describe("defineIpcModule event prefixing", () => {
  /** A sender rich enough to show what the proxy forwards, binds, and rewrites. */
  const createSender = () =>
    Object.assign(createInvokeSender(), {
      id: 7,
      describe(this: { id: number }) {
        return this.id;
      },
    });

  it("prefixes senderFrame.send and leaves other members intact", async () => {
    const { handlers, ipc } = createIpc();
    const senderFrame = createSender();
    const seen: Record<string, unknown> = {};

    await defineIpcModule(
      "profile",
      {
        save: handle((event) => {
          const frame = event.senderFrame as unknown as ReturnType<typeof createSender>;
          frame.send("updated" as never, "id" as never);
          // A plain value passes through; a method stays bound to the real
          // target, which `Reflect.get` alone would not guarantee.
          seen.id = frame.id;
          seen.described = frame.describe();
        }),
      },
      { eventPrefix: true },
    )(ipc as never);

    await handlers.get("profile:save")?.({ sender: createSender(), senderFrame });

    expect(senderFrame.send).toHaveBeenCalledWith("profile:updated", "id");
    expect(seen).toEqual({ id: 7, described: 7 });
  });

  it("passes through and binds members of the event itself", async () => {
    const { handlers, ipc } = createIpc();
    const seen: Record<string, unknown> = {};

    await defineIpcModule(
      "profile",
      {
        save: handle((event) => {
          const raw = event as unknown as { processId: number; describeSelf(): number };
          // Anything that is not sender/senderFrame/reply falls through the
          // proxy: data unchanged, methods still bound to the real event.
          seen.processId = raw.processId;
          seen.described = raw.describeSelf();
        }),
      },
      { eventPrefix: true },
    )(ipc as never);

    await handlers.get("profile:save")?.({
      processId: 42,
      sender: createSender(),
      senderFrame: null,
      describeSelf(this: { processId: number }) {
        return this.processId;
      },
    });

    expect(seen).toEqual({ processId: 42, described: 42 });
  });

  it("keeps a null senderFrame null rather than wrapping it", async () => {
    const { handlers, ipc } = createIpc();
    let frame: unknown = "unset";

    await defineIpcModule(
      "profile",
      { save: handle((event) => void (frame = event.senderFrame)) },
      { eventPrefix: true },
    )(ipc as never);

    await handlers.get("profile:save")?.({ sender: createSender(), senderFrame: null });

    expect(frame).toBeNull();
  });

  it("prefixes event.reply on a listener", async () => {
    const { listeners, ipc } = createIpc();
    const reply = vi.fn();

    await defineIpcModule(
      "profile",
      { notify: listen((event) => event.reply("noted" as never, 1 as never)) },
      { eventPrefix: true },
    )(ipc as never);

    listeners.get("profile:notify")?.({ reply, sender: createSender(), senderFrame: null });

    expect(reply).toHaveBeenCalledWith("profile:noted", 1);
  });

  it("uses a string eventPrefix in place of the module prefix", async () => {
    const { handlers, ipc } = createIpc();
    const sender = createSender();

    await defineIpcModule(
      "profile",
      { save: handle((event) => event.sender.send("updated" as never, "id" as never)) },
      { eventPrefix: "app" },
    )(ipc as never);

    // The registered channel still uses the module prefix; only the emitted
    // event channel takes the custom one.
    expect(handlers.has("profile:save")).toBe(true);
    await handlers.get("profile:save")?.({ sender, senderFrame: null });
    expect(sender.send).toHaveBeenCalledWith("app:updated", "id");
  });
});

describe("defineIpcModule guard dispatch", () => {
  it("always wraps handlers for lifecycle signals", async () => {
    const { handlers, ipc } = createIpc();
    const channel = handle(() => "pong");

    await defineIpcModule("fast", { ping: channel })(ipc as never);

    // Every handler needs an event proxy now to carry `event.signal`, but the
    // guard-free path still returns whatever the callback returned, unwrapped.
    expect(handlers.get("fast:ping")).not.toBe(channel.fn);
    expect(handlers.get("fast:ping")?.(createInvokeEvent())).toBe("pong");
  });

  it("wraps a listener for eventPrefix even without authorize or validate", async () => {
    const { listeners, ipc } = createIpc();
    const sender = { send: vi.fn() };

    await defineIpcModule(
      "profile",
      { touch: listen((event) => event.sender.send("touched" as never)) },
      { eventPrefix: true },
    )(ipc as never);

    listeners.get("profile:touch")?.({ sender, senderFrame: null });

    expect(sender.send).toHaveBeenCalledWith("profile:touched");
  });

  it("runs authorize even when no validator is configured", async () => {
    const { handlers, ipc } = createIpc();
    const authorize = vi.fn(() => true);
    const body = vi.fn(() => "ok");

    await defineIpcModule("secure", { read: handle(body) }, { authorize })(ipc as never);

    await expect(handlers.get("secure:read")?.(createInvokeEvent())).resolves.toBe("ok");
    expect(authorize).toHaveBeenCalledOnce();
    expect(body).toHaveBeenCalledOnce();
  });

  it("logs when the onListenerError hook itself throws", async () => {
    const { listeners, ipc } = createIpc();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const hookFailure = new Error("hook exploded");

    await defineIpcModule(
      "demo",
      {
        notify: listen(() => {
          throw new Error("listener failed");
        }),
      },
      {
        onListenerError: () => {
          throw hookFailure;
        },
      },
    )(ipc as never);

    listeners.get("demo:notify")?.({} as never);

    // The hook's own failure has nowhere to be reported but the console, and
    // must never propagate into Electron's emitter.
    expect(error).toHaveBeenCalledWith(
      '[electron-ipc-module] onListenerError failed for "demo:notify"',
      hookFailure,
    );
  });

  it("aggregates a rollback failure with the error that caused the rollback", async () => {
    const { ipc } = createIpc();
    const readyFailure = new Error("ready failed");
    const cleanupFailure = new Error("removeHandler failed");
    ipc.removeHandler.mockImplementation(() => {
      throw cleanupFailure;
    });

    const register = defineIpcModule(
      "demo",
      { ping: handle(() => "pong") },
      {
        ready: () => {
          throw readyFailure;
        },
      },
    );

    const failure = await register(ipc as never).catch((thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(AggregateError);
    // Original error first, so the cause is not buried under the fallout.
    expect((failure as AggregateError).errors).toEqual([readyFailure, cleanupFailure]);
  });
});

describe("IpcValidationError message", () => {
  it("renders object path segments and issues that carry no path", async () => {
    const { handlers, ipc } = createIpc();

    await defineIpcModule(
      "secure",
      { save: handle(vi.fn()) },
      {
        validate: {
          save: schemaOf(() => ({
            issues: [
              // Standard Schema allows a segment to be a `{ key }` object
              // rather than a bare string.
              { message: "bad", path: ["user", { key: "name" }] },
              // …and allows no path at all, which must not render a stray ": ".
              { message: "must be set" },
            ],
          })),
        },
      },
    )(ipc as never);

    const rejection = handlers.get("secure:save")?.(createInvokeEvent(), 1);

    await expect(rejection).rejects.toThrow(
      'IPC payload failed validation for channel "secure:save": user.name: bad; must be set',
    );
  });
});

describe("defineIpcEvents", () => {
  it("is a type-level declaration with no runtime payload", () => {
    // The bridge generator reads its type argument; the value must stay inert
    // so nothing is tempted to depend on it at runtime.
    expect(defineIpcEvents<{ changed: [value: string] }>()).toEqual({});
  });
});
