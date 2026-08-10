import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  getIpcBridgeWatchTargets,
  isIpcBridgeRelevantFile,
  resolveIpcBridgeOptions,
  runIpcBridgeGeneration,
} from "../../src/bridge/ipc-bridge.js";
import {
  DEFAULT_IPC_DIR,
  DEFAULT_OUT_FILE,
  DEFAULT_TSCONFIG,
  toAbsolutePosix,
} from "../../src/shared/utils.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/bridge", import.meta.url));
const FIXTURE_IPC_DIR = join(FIXTURES_DIR, "ipc");
const FIXTURE_TSCONFIG = join(FIXTURES_DIR, "tsconfig.json");
const DEMO_IPC_FILE = join(FIXTURE_IPC_DIR, "demo.ipc.ts");
const SPREAD_IPC_FILE = join(FIXTURE_IPC_DIR, "spread.ipc.ts");

describe("resolveIpcBridgeOptions", () => {
  it("applies defaults and resolves absolute posix paths", () => {
    const resolved = resolveIpcBridgeOptions();

    expect(resolved.ipcDir).toBe(DEFAULT_IPC_DIR);
    expect(resolved.outFile).toBe(toAbsolutePosix(DEFAULT_OUT_FILE));
    expect(resolved.tsconfig).toBe(toAbsolutePosix(DEFAULT_TSCONFIG));
  });

  it("preserves custom options", () => {
    const resolved = resolveIpcBridgeOptions({
      ipcDir: FIXTURE_IPC_DIR,
      outFile: "./tmp/bridge.ts",
      tsconfig: FIXTURE_TSCONFIG,
    });

    expect(resolved.ipcDir).toBe(FIXTURE_IPC_DIR);
    expect(resolved.outFile).toBe(toAbsolutePosix("./tmp/bridge.ts"));
    expect(resolved.tsconfig).toBe(toAbsolutePosix(FIXTURE_TSCONFIG));
  });
});

describe("getIpcBridgeWatchTargets", () => {
  it("includes tsconfig and ipc directory, but not generated output, for plain dirs", () => {
    const options = {
      ipcDir: FIXTURE_IPC_DIR,
      outFile: "./tmp/bridge.ts",
      tsconfig: FIXTURE_TSCONFIG,
    };
    const resolved = resolveIpcBridgeOptions(options);
    const targets = getIpcBridgeWatchTargets(options);

    expect(targets).toContain(resolved.tsconfig);
    expect(targets).not.toContain(resolved.outFile);
    expect(targets).toContain(toAbsolutePosix(FIXTURE_IPC_DIR));
  });

  it("watches the nearest non-glob ancestor when ipcDir is a glob", () => {
    const globDir = join(FIXTURE_IPC_DIR, "*.ipc.ts").replaceAll("\\", "/");
    const targets = getIpcBridgeWatchTargets({
      ipcDir: globDir,
      tsconfig: FIXTURE_TSCONFIG,
    });

    expect(targets).toContain(toAbsolutePosix(FIXTURE_IPC_DIR));
    expect(targets).not.toContain(toAbsolutePosix(DEMO_IPC_FILE));
  });
});

describe("isIpcBridgeRelevantFile", () => {
  const options = {
    ipcDir: FIXTURE_IPC_DIR,
    tsconfig: FIXTURE_TSCONFIG,
  };

  it("matches tsconfig and ipc files inside ipcDir", () => {
    expect(isIpcBridgeRelevantFile(FIXTURE_TSCONFIG, options)).toBe(true);
    expect(isIpcBridgeRelevantFile(DEMO_IPC_FILE, options)).toBe(true);
  });

  it("ignores unrelated files", () => {
    expect(isIpcBridgeRelevantFile(__filename, options)).toBe(false);
    expect(isIpcBridgeRelevantFile(join(FIXTURES_DIR, "missing.ipc.ts"), options)).toBe(false);
  });

  it("matches files selected by a glob ipcDir", () => {
    const globOptions = {
      ipcDir: `${toAbsolutePosix(FIXTURE_IPC_DIR)}/**/demo.ipc.ts`,
      tsconfig: FIXTURE_TSCONFIG,
    };

    expect(isIpcBridgeRelevantFile(DEMO_IPC_FILE, globOptions)).toBe(true);
    expect(isIpcBridgeRelevantFile(SPREAD_IPC_FILE, globOptions)).toBe(false);
  });

  it("matches newly created or deleted ipc files against a glob without scanning disk", () => {
    const globOptions = {
      ipcDir: `${toAbsolutePosix(FIXTURE_IPC_DIR)}/*.ipc.ts`,
      tsconfig: FIXTURE_TSCONFIG,
    };

    expect(isIpcBridgeRelevantFile(join(FIXTURE_IPC_DIR, "brand-new.ipc.ts"), globOptions)).toBe(
      true,
    );
    expect(isIpcBridgeRelevantFile(join(FIXTURE_IPC_DIR, "nested/x.ipc.ts"), globOptions)).toBe(
      false,
    );
  });
});

describe("runIpcBridgeGeneration", () => {
  let outDir: string;
  let outFile: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "ipc-bridge-test-"));
    outFile = join(outDir, "ipc-bridge.ts");
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  const runFixtureGeneration = (ipcDir = FIXTURE_IPC_DIR) =>
    runIpcBridgeGeneration({
      ipcDir,
      outFile,
      tsconfig: FIXTURE_TSCONFIG,
    });

  it("generates a typed bridge from ipc modules", () => {
    const result = runFixtureGeneration();

    expect(result.changed).toBe(true);
    expect(existsSync(outFile)).toBe(true);
    expect(result.outFile).toBe(toAbsolutePosix(outFile));
    expect(result.modules.map((module) => module.name)).toEqual(["demo", "spread", "with-events"]);

    const demo = result.modules.find((module) => module.name === "demo");
    expect(demo?.prefix).toBe("demo");
    expect(demo?.channels.map((channel) => channel.key)).toEqual(["ping", "notify", "get-user"]);

    const code = readFileSync(outFile, "utf-8");
    expect(code).toContain("import { ipcRenderer } from 'electron';");
    expect(code).toContain("createOnHelper");
    expect(code).toContain('ipcRenderer.invoke("demo:ping")');
    expect(code).toContain('ipcRenderer.send("demo:notify")');
    expect(code).toContain('ipcRenderer.invoke("demo:get-user"');
    expect(code).toContain("onItemUpdated");
    expect(code).toContain("onceItemUpdated");
    expect(code).toContain("export const bridge = {");
  });

  it("skips writing when generated output is unchanged", () => {
    const first = runFixtureGeneration();
    const mtimeMs = readFileSync(outFile).length;

    writeFileSync(outFile, first.code, "utf-8");

    const second = runFixtureGeneration();

    expect(second.changed).toBe(false);
    expect(second.code).toBe(first.code);
    expect(readFileSync(outFile, "utf-8")).toBe(first.code);
    expect(readFileSync(outFile).length).toBe(mtimeMs);
  });

  it("can check for stale output without writing it", () => {
    const result = runIpcBridgeGeneration(
      {
        ipcDir: FIXTURE_IPC_DIR,
        outFile,
        tsconfig: FIXTURE_TSCONFIG,
      },
      { write: false },
    );

    expect(result.changed).toBe(true);
    expect(existsSync(outFile)).toBe(false);
  });

  it("reports spread warnings for channels using object spread", () => {
    const result = runFixtureGeneration();

    const spread = result.modules.find((module) => module.name === "spread");
    expect(spread?.warnings).toContain(
      "Spread in channels object - those entries cannot be typed in the bridge",
    );
  });

  it("routes progress and analyzer warnings to a supplied logger", () => {
    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    };
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});

    runIpcBridgeGeneration({
      ipcDir: FIXTURE_IPC_DIR,
      outFile,
      tsconfig: FIXTURE_TSCONFIG,
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith("Analyzing IPC modules...");
    expect(logger.warn).toHaveBeenCalledWith(
      "[spread] Spread in channels object - those entries cannot be typed in the bridge",
    );
    // The default logger drops debug; a supplied one is trusted with all of it.
    expect(logger.debug).toHaveBeenCalled();
    // Nothing leaks to the console once a logger is supplied.
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  it("collects emitted events from createIpcHelpers", () => {
    const result = runFixtureGeneration();

    const eventsModule = result.modules.find((module) => module.name === "with-events");
    expect(eventsModule?.emittedEvents).toEqual([
      { key: "item-updated", argsType: "[id: string, value: number]" },
    ]);
  });
});
