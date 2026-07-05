import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { extractModules } from "../../src/bridge/ipc-bridge-analyzer.js";
import { createTsProgram } from "../../src/shared/ts-utils.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/analyzer", import.meta.url));
const FIXTURE_IPC_DIR = join(FIXTURES_DIR, "ipc");
const FIXTURE_TSCONFIG = join(FIXTURES_DIR, "tsconfig.json");
const IGNORED_TEST_FILE = join(FIXTURE_IPC_DIR, "ignored.test.ipc.ts");

const analyzeFixtureModules = () => {
  const program = createTsProgram(FIXTURE_TSCONFIG);
  return extractModules(program, FIXTURE_IPC_DIR);
};

describe("extractModules", () => {
  it("extracts modules from ipc fixtures", () => {
    const modules = analyzeFixtureModules();

    expect(modules.map((module) => module.name)).toEqual([
      "channel-types",
      "define-ipc-events",
      "duplicate-events",
      "factory",
      "typed-args",
    ]);
  });

  it("ignores test ipc files and files without defineIpcModule", () => {
    const modules = analyzeFixtureModules();

    expect(modules.some((module) => module.name === "ignored.test")).toBe(false);
    expect(modules.some((module) => module.name === "no-module")).toBe(false);
  });

  it("finds defineIpcModule inside factory functions", () => {
    const factory = analyzeFixtureModules().find((module) => module.name === "factory");

    expect(factory?.prefix).toBe("factory");
    expect(factory?.channels.map((channel) => channel.key)).toEqual(["ping"]);
    expect(factory?.channels[0]?.isHandler).toBe(true);
  });

  it("classifies handleOnce and listenOnce as handlers and listeners", () => {
    const channelTypes = analyzeFixtureModules().find((module) => module.name === "channel-types");

    expect(channelTypes?.channels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "onceHandle", isHandler: true }),
        expect.objectContaining({ key: "onceListen", isHandler: false }),
        expect.objectContaining({ key: "regularHandle", isHandler: true }),
        expect.objectContaining({ key: "regularListen", isHandler: false }),
      ]),
    );
  });

  it("serializes optional, rest, and async handler signatures", () => {
    const typed = analyzeFixtureModules().find((module) => module.name === "typed-args");

    const optional = typed?.channels.find((channel) => channel.key === "optional");
    const rest = typed?.channels.find((channel) => channel.key === "rest");
    const asyncReturn = typed?.channels.find((channel) => channel.key === "asyncReturn");

    expect(optional?.argsType).toBe("[id: string, label?: string | undefined]");
    expect(rest?.argsType).toBe("string[]");
    expect(asyncReturn?.returnType).toContain("done");
  });

  it("collects emitted events from exported defineIpcEvents", () => {
    const status = analyzeFixtureModules().find((module) => module.name === "define-ipc-events");

    expect(status?.emittedEvents).toEqual([
      { key: "status-changed", argsType: "[online: boolean]" },
    ]);
  });

  it("warns when the same emitted event is declared twice", () => {
    const duplicate = analyzeFixtureModules().find((module) => module.name === "duplicate-events");

    expect(duplicate?.emittedEvents).toEqual([
      { key: "shared-event", argsType: "[source: string]" },
    ]);
    expect(duplicate?.warnings).toContain(
      'Duplicate emitted event "shared-event" - using first declaration',
    );
  });

  it("does not analyze ignored.test.ipc.ts even when present on disk", () => {
    const modules = analyzeFixtureModules();
    const fileNames = modules.map((module) => module.fileName);

    expect(fileNames.some((fileName) => fileName.endsWith("ignored.test.ipc.ts"))).toBe(false);
    expect(IGNORED_TEST_FILE.length).toBeGreaterThan(0);
  });
});
