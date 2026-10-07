import { EventEmitter } from "node:events";

import ts from "typescript";
import { describe, it, expect, vi } from "vitest";

import { generateBridge } from "../../src/bridge/ipc-bridge-generator.js";
import { defineIpcModule, stream } from "../../src/runtime/ipc-module.js";
import type { AnalyzedIpcModule, ChannelInfo } from "../../src/shared/types/bridge.js";
import type { IpcStream } from "../../src/shared/types/runtime.js";

const moduleFixture = (
  overrides: Partial<AnalyzedIpcModule> & Pick<AnalyzedIpcModule, "name" | "channels">,
): AnalyzedIpcModule => ({
  prefix: overrides.prefix ?? overrides.name,
  emittedEvents: [],
  warnings: [],
  fileName: `${overrides.name}.ipc.ts`,
  ...overrides,
});

describe("generateBridge", () => {
  it("generates invoke for handlers and send for listeners", () => {
    const code = generateBridge([
      moduleFixture({
        name: "app",
        prefix: "app",
        channels: [
          {
            key: "ping",
            isHandler: true,
            argsType: null,
            returnType: "string",
          },
          {
            key: "notify",
            isHandler: false,
            argsType: null,
            returnType: "any",
          },
        ],
      }),
    ]);

    expect(code).toContain("import { ipcRenderer } from 'electron';");
    expect(code).not.toContain("IpcRendererEvent");
    expect(code).toContain(
      'ping: (): Promise<Serializable<string>> => ipcRenderer.invoke("app:ping")',
    );
    expect(code).toContain('notify: (): void => ipcRenderer.send("app:notify")');
  });

  it("includes typed args and Promise return annotations for handlers", () => {
    const code = generateBridge([
      moduleFixture({
        name: "math",
        prefix: "math",
        channels: [
          {
            key: "add",
            isHandler: true,
            argsType: "[a: number, b: number]",
            returnType: "number",
          },
        ],
      }),
    ]);

    expect(code).toContain(
      'add: (...args: Serializable<[a: number, b: number]>): Promise<Serializable<number>> => ipcRenderer.invoke("math:add", ...args)',
    );
  });

  it("generates event listener helpers when modules emit events", () => {
    const code = generateBridge([
      moduleFixture({
        name: "events",
        prefix: "events",
        channels: [],
        emittedEvents: [{ key: "profile-updated", argsType: "[id: string, name: string]" }],
      }),
    ]);

    expect(code).toContain("import { ipcRenderer } from 'electron';");
    expect(code).toContain("function createOnHelper");
    expect(code).toContain("function createOnceHelper");
    expect(code).toContain("const wrapped = (...rawArgs: any[]) =>");
    expect(code).toContain("listener(...(rawArgs.slice(1) as TArgs))");
    expect(code).toContain(
      'onProfileUpdated: (listener: (...args: Serializable<[id: string, name: string]>) => void): Unsubscribe => createOnHelper<Serializable<[id: string, name: string]>>("profile-updated", listener)',
    );
    expect(code).toContain(
      'onceProfileUpdated: (listener: (...args: Serializable<[id: string, name: string]>) => void): Unsubscribe => createOnceHelper<Serializable<[id: string, name: string]>>("profile-updated", listener)',
    );
  });

  it("converts kebab-case channel and event keys", () => {
    const code = generateBridge([
      moduleFixture({
        name: "user-profile",
        prefix: "user-profile",
        channels: [
          {
            key: "get-all",
            isHandler: true,
            argsType: null,
            returnType: "string[]",
          },
        ],
        emittedEvents: [{ key: "profile-updated", argsType: null }],
      }),
    ]);

    expect(code).toContain("userProfile: {");
    expect(code).toContain("getAll:");
    expect(code).toContain("onProfileUpdated");
    expect(code).toContain("onceProfileUpdated");
  });

  it("uses unprefixed channel names when prefix is empty", () => {
    const code = generateBridge([
      moduleFixture({
        name: "root",
        prefix: "",
        channels: [
          {
            key: "ping",
            isHandler: true,
            argsType: null,
            returnType: "string",
          },
        ],
      }),
    ]);

    expect(code).toContain('ipcRenderer.invoke("ping")');
    expect(code).not.toContain('":ping"');
  });

  it("rejects generated method and module name collisions", () => {
    expect(() =>
      generateBridge([
        moduleFixture({
          name: "collision",
          channels: [
            { key: "get-all", isHandler: true, argsType: null, returnType: "void" },
            { key: "get_all", isHandler: true, argsType: null, returnType: "void" },
          ],
        }),
      ]),
    ).toThrow("generated identifier collision");

    expect(() =>
      generateBridge([
        moduleFixture({ name: "user-profile", channels: [] }),
        moduleFixture({ name: "user_profile", channels: [] }),
      ]),
    ).toThrow("generated identifier collision");
  });

  it("generates an IpcStream method and the shared helper for stream channels", () => {
    const code = generateBridge([
      moduleFixture({
        name: "export",
        channels: [
          {
            key: "run",
            isHandler: false,
            isStream: true,
            argsType: "[input: string]",
            returnType: "number",
          },
          { key: "ticks", isHandler: false, isStream: true, argsType: null, returnType: "Date" },
        ],
      }),
    ]);

    expect(code).toContain("import type { IpcStream, Serializable } from 'electron-ipc-module';");
    expect(code.match(/function createStreamHelper</g)).toHaveLength(1);
    expect(code).not.toContain("createOnHelper");
    expect(code).toContain(
      'run: (...args: Serializable<[input: string]>): IpcStream<Serializable<number>> => createStreamHelper<Serializable<number>>("export:run", "export:run:event", "export:run:cancel", args)',
    );
    expect(code).toContain(
      'ticks: (): IpcStream<Serializable<Date>> => createStreamHelper<Serializable<Date>>("export:ticks", "export:ticks:event", "export:ticks:cancel", [])',
    );
  });

  it("emits no stream helper or IpcStream import without a stream channel", () => {
    const code = generateBridge([
      moduleFixture({
        name: "app",
        channels: [{ key: "ping", isHandler: true, argsType: null, returnType: "string" }],
        emittedEvents: [{ key: "changed", argsType: null }],
      }),
    ]);

    expect(code).toContain("import type { Serializable } from 'electron-ipc-module';");
    expect(code).not.toContain("IpcStream");
    expect(code).not.toContain("createStreamHelper");
  });

  it("uses the configured physical event prefix", () => {
    const code = generateBridge([
      moduleFixture({
        name: "profile",
        channels: [],
        eventPrefix: "profile",
        emittedEvents: [{ key: "updated", argsType: null }],
      }),
    ]);

    expect(code).toContain('createOnHelper<[]>("profile:updated", listener)');
  });

  it("exposes the bridge and declares the global when expose is set", () => {
    const code = generateBridge(
      [
        moduleFixture({
          name: "profile",
          channels: [{ key: "get", isHandler: true, argsType: null, returnType: "void" }],
        }),
      ],
      { expose: "ipc" },
    );

    expect(code).toContain("import { contextBridge, ipcRenderer } from 'electron';");
    expect(code).toContain('contextBridge.exposeInMainWorld("ipc", bridge);');
    expect(code).toContain("declare global {");
    expect(code).toContain("    ipc: typeof bridge;");
  });

  it("leaves the bridge exported only when expose is unset", () => {
    const code = generateBridge([moduleFixture({ name: "profile", channels: [] })]);

    expect(code).toContain("import { ipcRenderer } from 'electron';");
    expect(code).not.toContain("contextBridge");
    expect(code).not.toContain("declare global");
  });

  it("rejects an expose key that is not a valid identifier", () => {
    expect(() =>
      generateBridge([moduleFixture({ name: "profile", channels: [] })], { expose: "my-ipc" }),
    ).toThrow("expose option produces invalid bridge identifier");

    // An empty key is a misconfiguration, not a request for no exposure.
    expect(() =>
      generateBridge([moduleFixture({ name: "profile", channels: [] })], { expose: "" }),
    ).toThrow("expose option produces invalid bridge identifier");
  });

  it.each(["name", "innerWidth", "localStorage", "Array", "constructor"])(
    "rejects the existing global expose key %s",
    (expose) => {
      expect(() =>
        generateBridge([moduleFixture({ name: "profile", channels: [] })], { expose }),
      ).toThrow("is already a standard global property");
    },
  );
});

/**
 * The emitted `createStreamHelper`, run against the real runtime.
 *
 * The generated bridge is transpiled and evaluated with `electron` stubbed by
 * an `ipcRenderer` wired straight to a fake `ipcMain`, so these exercise the
 * code users actually ship, and would catch the generator and the runtime
 * disagreeing about a derived channel name.
 */
describe("generated createStreamHelper", () => {
  // The pump yields one `setImmediate` per chunk, so drain enough turns for any
  // stream these tests run rather than racing a single timer.
  const flush = async () => {
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
  };

  const wire = async (
    channels: Parameters<typeof defineIpcModule>[1],
    authorize?: () => boolean,
  ) => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const mainListeners = new Map<string, (...args: unknown[]) => void>();
    const renderer = new EventEmitter();
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      send: (channel: string, ...args: unknown[]) => renderer.emit(channel, {}, ...args),
    });
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
      on: (channel: string, fn: (...args: unknown[]) => void) => mainListeners.set(channel, fn),
    };
    const ipcRenderer = {
      // Electron's own invoke rejection shape, so the helper's errors can be
      // compared with what a failed `handle` produces.
      invoke: async (channel: string, ...args: unknown[]) => {
        try {
          return await handlers.get(channel)?.({ sender, senderFrame: null }, ...args);
        } catch (error) {
          throw new Error(`Error invoking remote method '${channel}': ${error}`);
        }
      },
      send: vi.fn((channel: string, ...args: unknown[]) =>
        mainListeners.get(channel)?.({ sender }, ...args),
      ),
      on: (channel: string, listener: (...args: unknown[]) => void) =>
        renderer.on(channel, listener),
      removeListener: (channel: string, listener: (...args: unknown[]) => void) =>
        renderer.removeListener(channel, listener),
    };

    await defineIpcModule("export", channels, { authorize })(ipcMain as never);

    const channelInfo: ChannelInfo = {
      key: "run",
      isHandler: false,
      isStream: true,
      argsType: "[input: string]",
      returnType: "string",
    };
    const { outputText } = ts.transpileModule(
      generateBridge([moduleFixture({ name: "export", channels: [channelInfo] })]),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    );
    const exports: { bridge?: { export: { run(input: string): IpcStream<string> } } } = {};
    new Function("require", "exports", outputText)(() => ({ ipcRenderer }), exports);

    return {
      run: (input: string) => exports.bridge!.export.run(input),
      ipcRenderer,
      listenerCount: () => renderer.listenerCount("export:run:event"),
    };
  };

  it("buffers chunks that arrive before next() and unsubscribes at the end", async () => {
    const { run, listenerCount } = await wire({
      run: stream(async function* (_event, input: string) {
        yield `${input}-1`;
        yield `${input}-2`;
      }),
    });

    const chunks = run("in");
    expect(listenerCount()).toBe(1);
    await flush();

    expect(await chunks.next()).toEqual({ done: false, value: "in-1" });
    expect(await chunks.next()).toEqual({ done: false, value: "in-2" });
    expect(await chunks.next()).toEqual({ done: true, value: undefined });
    expect(listenerCount()).toBe(0);
  });

  it("sends cancel when for await breaks, and main runs the generator's finally", async () => {
    const finalized = vi.fn();
    const { run, ipcRenderer, listenerCount } = await wire({
      run: stream(async function* () {
        try {
          for (let index = 0; ; index += 1) {
            yield String(index);
            await flush();
          }
        } finally {
          finalized();
        }
      }),
    });

    const chunks = run("in");
    const seen: string[] = [];
    for await (const chunk of { [Symbol.asyncIterator]: () => chunks }) {
      seen.push(chunk);
      if (seen.length === 2) break;
    }
    await flush();

    expect(seen).toEqual(["0", "1"]);
    expect(ipcRenderer.send).toHaveBeenCalledWith("export:run:cancel", expect.any(String));
    expect(finalized).toHaveBeenCalledOnce();
    expect(listenerCount()).toBe(0);
  });

  it("settles a pending next() with done when cancel() is called", async () => {
    const { run, listenerCount } = await wire({
      run: stream(async function* () {
        await new Promise(() => undefined);
        yield "never";
      }),
    });

    const chunks = run("in");
    const pending = chunks.next();
    chunks.cancel();

    await expect(pending).resolves.toEqual({ done: true, value: undefined });
    expect(listenerCount()).toBe(0);
  });

  it("settles every concurrent next() in order", async () => {
    const { run } = await wire({
      run: stream(async function* () {
        yield "a";
        await flush();
        yield "b";
      }),
    });

    const chunks = run("in");
    const reads = await Promise.all([chunks.next(), chunks.next(), chunks.next()]);

    expect(reads).toEqual([
      { done: false, value: "a" },
      { done: false, value: "b" },
      { done: true, value: undefined },
    ]);
  });

  it("drops buffered chunks on cancel() after main has already finished", async () => {
    const { run, ipcRenderer } = await wire({
      run: stream(function* () {
        yield "1";
        yield "2";
        yield "3";
      }),
    });

    const chunks = run("in");
    await flush();
    await flush();
    chunks.cancel();

    expect(await chunks.next()).toEqual({ done: true, value: undefined });
    expect(ipcRenderer.send).not.toHaveBeenCalledWith("export:run:cancel", expect.anything());
  });

  it("rejects with the invoke error shape for generator and guard failures", async () => {
    const failing = await wire({
      run: stream(async function* () {
        yield "first";
        throw new Error("boom");
      }),
    });
    const chunks = failing.run("in");
    expect(await chunks.next()).toEqual({ done: false, value: "first" });
    await expect(chunks.next()).rejects.toThrow(
      "Error invoking remote method 'export:run': Error: boom",
    );
    expect(failing.listenerCount()).toBe(0);

    const unauthorized = await wire({ run: stream(() => ["never"]) }, () => false);
    await expect(unauthorized.run("in").next()).rejects.toThrow(
      /Error invoking remote method 'export:run': IpcAuthorizationError/,
    );
    expect(unauthorized.listenerCount()).toBe(0);
  });
});
