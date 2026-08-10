import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { runCli } from "../src/cli.js";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures/bridge", import.meta.url));
const FIXTURE_IPC_DIR = join(FIXTURES_DIR, "ipc");
const FIXTURE_TSCONFIG = join(FIXTURES_DIR, "tsconfig.json");

describe("runCli", () => {
  let outDir: string;
  let outFile: string;

  const baseArgs = (command: string) => [
    command,
    "--ipc-dir",
    FIXTURE_IPC_DIR,
    "--out-file",
    outFile,
    "--tsconfig",
    FIXTURE_TSCONFIG,
  ];

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "ipc-bridge-cli-test-"));
    outFile = join(outDir, "ipc-bridge.ts");
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("generates the bridge by default", () => {
    runCli(baseArgs("generate"));

    expect(readFileSync(outFile, "utf-8")).toContain("export const bridge = {");
    expect(process.exitCode).toBeUndefined();
  });

  it("check reports a missing bridge as stale without writing it", () => {
    runCli(baseArgs("check"));

    expect(existsSync(outFile)).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("check reports an outdated bridge as stale", () => {
    runCli(baseArgs("generate"));
    writeFileSync(outFile, "// stale\n", "utf-8");

    runCli(baseArgs("check"));

    expect(readFileSync(outFile, "utf-8")).toBe("// stale\n");
    expect(process.exitCode).toBe(1);
  });

  it("check passes when the bridge is up to date", () => {
    runCli(baseArgs("generate"));
    const generated = readFileSync(outFile, "utf-8");

    runCli(baseArgs("check"));

    expect(readFileSync(outFile, "utf-8")).toBe(generated);
    expect(process.exitCode).toBeUndefined();
  });

  it("prints help without generating", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    runCli([...baseArgs("generate"), "--help"]);

    expect(existsSync(outFile)).toBe(false);
    expect(info.mock.calls[0][0]).toContain("electron-ipc-module <generate|check>");
  });

  it("--quiet suppresses progress output but keeps warnings", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    runCli([...baseArgs("generate"), "--quiet"]);

    expect(existsSync(outFile)).toBe(true);
    expect(info).not.toHaveBeenCalled();
    // The fixture set includes a spread channel, so a warning is always due.
    expect(warn).toHaveBeenCalled();
  });

  it("rejects malformed invocations", () => {
    expect(() => runCli(["publish"])).toThrow("Unknown command publish");
    expect(() => runCli(["generate", "--nope"])).toThrow("Unknown option --nope");
    expect(() => runCli(["generate", "--out-file", "--watch"])).toThrow(
      "--out-file requires a value",
    );
    expect(() => runCli([...baseArgs("check"), "--watch"])).toThrow(
      "check does not support --watch",
    );
    expect(existsSync(outFile)).toBe(false);
  });

  it("does not mutate the caller's argument array", () => {
    const args = baseArgs("generate");
    const copy = [...args];

    runCli(args);

    expect(args).toEqual(copy);
  });
});
