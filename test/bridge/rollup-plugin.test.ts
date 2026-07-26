import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import ipcBridgePlugin from "../../src/rollup-plugin.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/bridge", import.meta.url));
const FIXTURE_IPC_DIR = join(FIXTURES_DIR, "ipc");
const FIXTURE_TSCONFIG = join(FIXTURES_DIR, "tsconfig.json");

describe("ipcBridge rollup plugin", () => {
  let outDir: string;
  let outFile: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "ipc-bridge-plugin-test-"));
    outFile = join(outDir, "ipc-bridge.ts");
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("exposes rollup plugin metadata", () => {
    const plugin = ipcBridgePlugin();

    expect(plugin.name).toBe("ipc-bridge");
    expect(typeof plugin.buildStart).toBe("function");
  });

  it("generates the bridge during buildStart", () => {
    const plugin = ipcBridgePlugin({
      ipcDir: FIXTURE_IPC_DIR,
      outFile,
      tsconfig: FIXTURE_TSCONFIG,
    });

    const addWatchFile = vi.fn();
    const buildStart =
      typeof plugin.buildStart === "function" ? plugin.buildStart : plugin.buildStart?.handler;
    buildStart?.call({ addWatchFile } as never, {} as never);

    expect(existsSync(outFile)).toBe(true);

    const code = readFileSync(outFile, "utf-8");
    expect(code).toContain("export const bridge = {");
    expect(code).toContain("demo: {");
    expect(code).toContain("withEvents: {");
    expect(addWatchFile).toHaveBeenCalledWith(FIXTURE_TSCONFIG.replaceAll("\\", "/"));
    expect(addWatchFile).toHaveBeenCalledWith(FIXTURE_IPC_DIR.replaceAll("\\", "/"));
    expect(addWatchFile).not.toHaveBeenCalledWith(outFile.replaceAll("\\", "/"));
  });

  it("ignores unrelated watchChange events when ipcDir is a glob", () => {
    const plugin = ipcBridgePlugin({
      ipcDir: join(FIXTURE_IPC_DIR, "*.ipc.ts").replaceAll("\\", "/"),
      outFile,
      tsconfig: FIXTURE_TSCONFIG,
    });

    const addWatchFile = vi.fn();
    const buildStart =
      typeof plugin.buildStart === "function" ? plugin.buildStart : plugin.buildStart?.handler;
    buildStart?.call({ addWatchFile } as never, {} as never);

    expect(addWatchFile).toHaveBeenCalledWith(FIXTURE_IPC_DIR.replaceAll("\\", "/"));
    expect(existsSync(outFile)).toBe(true);

    const codeAfterFirstBuild = readFileSync(outFile, "utf-8");
    const watchChange =
      typeof plugin.watchChange === "function" ? plugin.watchChange : plugin.watchChange?.handler;
    watchChange?.call({} as never, join(FIXTURE_IPC_DIR, "readme.md"), { event: "create" });
    buildStart?.call({ addWatchFile } as never, {} as never);

    expect(readFileSync(outFile, "utf-8")).toBe(codeAfterFirstBuild);

    watchChange?.call({} as never, join(FIXTURE_IPC_DIR, "demo.ipc.ts"), { event: "update" });
    rmSync(outFile);
    buildStart?.call({ addWatchFile } as never, {} as never);

    expect(existsSync(outFile)).toBe(true);
  });
});
