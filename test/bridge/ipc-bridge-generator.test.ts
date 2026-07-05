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
    expect(code).toContain('ping: (): Promise<string> => ipcRenderer.invoke("app:ping")');
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
      'add: (...args: [a: number, b: number]): Promise<number> => ipcRenderer.invoke("math:add", ...args)',
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

    expect(code).toContain("import { ipcRenderer, type IpcRendererEvent } from 'electron';");
    expect(code).toContain("function createOnHelper");
    expect(code).toContain("function createOnceHelper");
    expect(code).toContain(
      'onProfileUpdated: (listener: (...args: [id: string, name: string]) => void): Unsubscribe => createOnHelper<[id: string, name: string]>("profile-updated", listener)',
    );
    expect(code).toContain(
      'onceProfileUpdated: (listener: (...args: [id: string, name: string]) => void): Unsubscribe => createOnceHelper<[id: string, name: string]>("profile-updated", listener)',
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
});
