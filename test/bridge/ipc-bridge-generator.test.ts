import { describe, it, expect } from "vitest";

import { generateBridge } from "../../src/bridge/ipc-bridge-generator.js";
import type { AnalyzedIpcModule } from "../../src/shared/types/bridge.js";

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

  it("rejects an expose key Window already defines", () => {
    expect(() =>
      generateBridge([moduleFixture({ name: "profile", channels: [] })], { expose: "name" }),
    ).toThrow("is already a Window property");
  });
});
