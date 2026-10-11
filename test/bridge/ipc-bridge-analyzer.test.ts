import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { extractModules } from "../../src/bridge/ipc-bridge-analyzer.js";
import { createTsProgram } from "../../src/shared/ts-utils.js";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/analyzer", import.meta.url));
const FIXTURE_IPC_DIR = join(FIXTURES_DIR, "ipc");
const FIXTURE_MULTI_DIR = join(FIXTURES_DIR, "multi");
const FIXTURE_BAD_PREFIX_DIR = join(FIXTURES_DIR, "bad-prefix");
const FIXTURE_EDGE_DIR = join(FIXTURES_DIR, "edge");
const FIXTURE_TSCONFIG = join(FIXTURES_DIR, "tsconfig.json");
const IGNORED_TEST_FILE = join(FIXTURE_IPC_DIR, "ignored.test.ipc.ts");

const analyzeFixtureModules = () => {
  const program = createTsProgram(FIXTURE_TSCONFIG);
  return extractModules(program, FIXTURE_IPC_DIR);
};

const analyzeEdgeModules = () => {
  const program = createTsProgram(FIXTURE_TSCONFIG);
  return extractModules(program, FIXTURE_EDGE_DIR);
};

const edgeModule = (name: string) => analyzeEdgeModules().find((module) => module.name === name);

describe("extractModules", () => {
  it("extracts modules from ipc fixtures", () => {
    const modules = analyzeFixtureModules();

    expect(modules.map((module) => module.name)).toEqual([
      "aliased",
      "channel-types",
      "define-ipc-events",
      "duplicate-events",
      "factory",
      "namespaced",
      "stream",
      "typed-args",
    ]);
  });

  it("ignores test ipc files, files without defineIpcModule, and same-named local helpers", () => {
    const modules = analyzeFixtureModules();

    expect(modules.some((module) => module.name === "ignored.test")).toBe(false);
    expect(modules.some((module) => module.name === "no-module")).toBe(false);
    expect(modules.some((module) => module.name === "shadowed")).toBe(false);
  });

  it("resolves aliased and namespace imports of defineIpcModule", () => {
    const modules = analyzeFixtureModules();
    const aliased = modules.find((module) => module.name === "aliased");
    const namespaced = modules.find((module) => module.name === "namespaced");

    expect(aliased?.prefix).toBe("aliased");
    expect(aliased?.channels.map((channel) => channel.key).sort()).toEqual(["echo", "ping"]);
    expect(aliased?.emittedEvents).toEqual(
      expect.arrayContaining([
        { key: "aliased-ready", argsType: "[ok: boolean]" },
        { key: "aliased-ping", argsType: "[n: number]" },
      ]),
    );
    expect(namespaced?.prefix).toBe("namespaced");
    expect(namespaced?.channels.map((channel) => channel.key)).toEqual(["ping"]);
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

  it("classifies stream channels and records the yielded chunk type", () => {
    const streams = analyzeFixtureModules().find((module) => module.name === "stream");

    expect(streams?.channels).toEqual([
      {
        key: "render",
        isHandler: false,
        isStream: true,
        argsType: "[input: string]",
        returnType: "{ index: number; input: string; }",
      },
      { key: "lines", isHandler: false, isStream: true, argsType: null, returnType: "string" },
      { key: "dates", isHandler: false, isStream: true, argsType: null, returnType: "Date" },
      {
        key: "ticks",
        isHandler: false,
        isStream: true,
        argsType: "[count: number]",
        returnType: "number",
      },
      { key: "ping", isHandler: false, isStream: true, argsType: null, returnType: "number" },
    ]);
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

  it("rejects a file declaring more than one defineIpcModule", () => {
    const program = createTsProgram(FIXTURE_TSCONFIG);

    expect(() => extractModules(program, FIXTURE_MULTI_DIR)).toThrow(
      /two-modules\.ipc\.ts:6:\d+ a file may declare only one defineIpcModule/,
    );
  });

  it("does not analyze ignored.test.ipc.ts even when present on disk", () => {
    const modules = analyzeFixtureModules();
    const fileNames = modules.map((module) => module.fileName);

    expect(fileNames.some((fileName) => fileName.endsWith("ignored.test.ipc.ts"))).toBe(false);
    expect(IGNORED_TEST_FILE.length).toBeGreaterThan(0);
  });

  it("B1: rejects a non-literal defineIpcModule prefix with its file:line:col", () => {
    const program = createTsProgram(FIXTURE_TSCONFIG);

    expect(() => extractModules(program, FIXTURE_BAD_PREFIX_DIR)).toThrow(
      /dynamic-prefix\.ipc\.ts:6:\d+ defineIpcModule prefix must be a string literal/,
    );
  });

  describe("edge cases", () => {
    it("B2: skips a defineIpcModule call with fewer than two arguments", () => {
      expect(edgeModule("b2-too-few-args")).toBeUndefined();
    });

    it("B3: skips channel keys starting with __", () => {
      expect(edgeModule("b3-reserved-key")?.channels.map((channel) => channel.key)).toEqual([
        "visible",
      ]);
    });

    it("B4: skips channels without kind or without fn", () => {
      expect(edgeModule("b4-malformed-channels")?.channels.map((channel) => channel.key)).toEqual([
        "ok",
      ]);
    });

    it("B5: reports no args and an any return for an fn without call signature", () => {
      expect(edgeModule("b5-no-call-signature")?.channels).toEqual([
        { key: "broken", isHandler: true, argsType: null, returnType: "any" },
      ]);
    });

    it("B6: warns about a spread in the channels object", () => {
      const spread = edgeModule("b6-spread");

      expect(spread?.warnings).toEqual([
        "Spread in channels object - those entries cannot be typed in the bridge",
      ]);
    });

    it("B7: resolves eventPrefix true, string literal, and non-literal values", () => {
      const prefixTrue = edgeModule("b7-event-prefix-true");
      const prefixString = edgeModule("b7-event-prefix-string");
      const prefixDynamic = edgeModule("b7-event-prefix-dynamic");

      expect(prefixTrue?.eventPrefix).toBe("prefix-true");
      expect(prefixString?.eventPrefix).toBe("custom");
      expect(prefixDynamic?.eventPrefix).toBeUndefined();
      expect(prefixDynamic?.warnings).toEqual([
        "eventPrefix must be true or a string literal for bridge generation",
      ]);
    });

    it("B6: reads channels from a channels argument that is not an object literal", () => {
      const module = edgeModule("b6-non-literal-channels");

      expect(module?.channels.map((channel) => channel.key)).toEqual(["ping"]);
      expect(module?.warnings).toEqual([]);
    });

    it("B8: yields no eventPrefix for options literals without that property", () => {
      const module = edgeModule("b8-options-without-prefix");

      expect(module?.eventPrefix).toBeUndefined();
      expect(module?.warnings).toEqual([]);
    });

    it("B8: ignores options that are not an object literal", () => {
      const module = edgeModule("b8-options-not-literal");

      expect(module?.eventPrefix).toBeUndefined();
      expect(module?.warnings).toEqual([]);
    });

    it("B9: tolerates createIpcHelpers() without a type argument and uninitialized declarations", () => {
      const module = edgeModule("b9-helpers");

      expect(module?.channels.map((channel) => channel.key)).toEqual(["ping"]);
      expect(module?.emittedEvents).toEqual([]);
    });

    it("B10: ignores defineIpcEvents that is unexported, destructured, or uninitialized", () => {
      const module = edgeModule("b10-ignored-events");

      expect(module?.channels.map((channel) => channel.key)).toEqual(["ping"]);
      expect(module?.emittedEvents).toEqual([]);
    });

    it("B11: marks a parameter with a default value as optional", () => {
      expect(edgeModule("b11-default-param")?.channels[0]?.argsType).toBe(
        "[label: string, count?: number]",
      );
    });

    it("B12: falls back to any for a stream without an iterated chunk type", () => {
      expect(edgeModule("b12-stream-no-iterable")?.channels).toEqual([
        { key: "broken", isHandler: false, isStream: true, argsType: null, returnType: "any" },
      ]);
    });
  });
});
