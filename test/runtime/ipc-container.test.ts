import { vi } from "vitest";
import { describe, it, expect } from "vitest";

vi.mock("electron", () => ({
  ipcMain: {},
}));

import {
  createIpcContainer,
  IpcChannelCollisionError,
  IpcContainerDisposedError,
} from "../../src/runtime/ipc-container.js";
import type { IpcCleanup, IpcModuleRegister } from "../../src/runtime/ipc-module.js";

const fakeRegister =
  (channels: string[]): IpcModuleRegister =>
  async () => ({
    channels: channels.map((ch) => [ch, vi.fn()] as const satisfies IpcCleanup),
  });

describe("createIpcContainer", () => {
  it("starts empty", () => {
    const container = createIpcContainer();
    expect(container.size).toBe(0);
    expect(container.names).toEqual([]);
    expect(container.allChannels).toEqual([]);
  });

  it("loads a module and tracks its channels", async () => {
    const container = createIpcContainer();
    const channels = await container.load("auth", fakeRegister(["auth:login", "auth:logout"]));

    expect(channels).toEqual(["auth:login", "auth:logout"]);
    expect(container.has("auth")).toBe(true);
    expect(container.getChannels("auth")).toEqual(["auth:login", "auth:logout"]);
    expect(container.size).toBe(1);
    expect(container.names).toEqual(["auth"]);
    expect(container.allChannels).toEqual(["auth:login", "auth:logout"]);
  });

  it("loadAll loads multiple modules", async () => {
    const container = createIpcContainer();

    const result = await container.loadAll({
      config: fakeRegister(["config:get"]),
      theme: fakeRegister(["theme:set"]),
    });

    expect(result).toEqual({ config: ["config:get"], theme: ["theme:set"] });
    expect(container.size).toBe(2);
    expect(container.names).toContain("config");
    expect(container.names).toContain("theme");
  });

  it("unload calls cleanup and removes the module", async () => {
    const channelCleanup = vi.fn();
    const moduleCleanup = vi.fn();
    const register: IpcModuleRegister = async () => ({
      channels: [["ch1", channelCleanup]],
      cleanup: moduleCleanup,
    });
    const container = createIpcContainer();

    await container.load("mod", register);
    const result = await container.unload("mod");

    expect(result).toBe(true);
    expect(channelCleanup).toHaveBeenCalledOnce();
    expect(moduleCleanup).toHaveBeenCalledOnce();
    expect(container.has("mod")).toBe(false);
    expect(container.size).toBe(0);
  });

  it("unload returns false for unknown module", async () => {
    const container = createIpcContainer();
    await expect(container.unload("nope")).resolves.toBe(false);
  });

  it("runs every cleanup and clears state when cleanup functions throw", async () => {
    const firstError = new Error("first cleanup failed");
    const secondCleanup = vi.fn();
    const moduleCleanup = vi.fn(() => {
      throw new Error("module cleanup failed");
    });
    const container = createIpcContainer();
    await container.load("fragile", async () => ({
      channels: [
        [
          "first",
          () => {
            throw firstError;
          },
        ],
        ["second", secondCleanup],
      ],
      cleanup: moduleCleanup,
    }));

    await expect(container.unload("fragile")).rejects.toThrow(AggregateError);
    expect(secondCleanup).toHaveBeenCalledOnce();
    expect(moduleCleanup).toHaveBeenCalledOnce();
    expect(container.has("fragile")).toBe(false);
  });

  it("rolls back modules loaded earlier in a failed batch", async () => {
    const cleanup = vi.fn();
    const container = createIpcContainer();

    await expect(
      container.loadAll({
        good: async () => ({ channels: [["good:one", cleanup]] }),
        bad: async () => {
          throw new Error("bad registration");
        },
      }),
    ).rejects.toThrow("bad registration");

    expect(cleanup).toHaveBeenCalledOnce();
    expect(container.size).toBe(0);
  });

  it("loadAll refuses to replace already-loaded modules", async () => {
    const existingCleanup = vi.fn();
    const container = createIpcContainer();
    await container.load("config", async () => ({
      channels: [["config:get", existingCleanup]],
    }));

    await expect(
      container.loadAll({
        config: fakeRegister(["config:get"]),
        theme: fakeRegister(["theme:set"]),
      }),
    ).rejects.toThrow(/cannot replace already-loaded modules.*"config"/);

    expect(existingCleanup).not.toHaveBeenCalled();
    expect(container.getChannels("config")).toEqual(["config:get"]);
    expect(container.has("theme")).toBe(false);
    expect(container.size).toBe(1);
  });

  it("loadAll rejects the whole batch before loading when a conflict exists", async () => {
    const existingCleanup = vi.fn();
    const container = createIpcContainer();
    await container.load("keep", async () => ({
      channels: [["keep:one", existingCleanup]],
    }));

    await expect(
      container.loadAll({
        fresh: fakeRegister(["fresh:one"]),
        keep: fakeRegister(["keep:two"]),
      }),
    ).rejects.toThrow(/cannot replace already-loaded modules.*"keep"/);

    expect(existingCleanup).not.toHaveBeenCalled();
    expect(container.has("fresh")).toBe(false);
    expect(container.getChannels("keep")).toEqual(["keep:one"]);
  });

  it("unloadAll removes all modules", async () => {
    const container = createIpcContainer();
    await container.loadAll({
      a: fakeRegister(["a:1"]),
      b: fakeRegister(["b:1"]),
    });

    await container.unloadAll();
    expect(container.size).toBe(0);
  });

  it("re-loading a module unloads the previous one first", async () => {
    const cleanup1 = vi.fn();
    const container = createIpcContainer();

    await container.load("mod", async () => ({
      channels: [["ch1", cleanup1]],
    }));
    await container.load("mod", fakeRegister(["ch2"]));

    expect(cleanup1).toHaveBeenCalledOnce();
    expect(container.getChannels("mod")).toEqual(["ch2"]);
  });

  it("serializes overlapping loads for the same name", async () => {
    const container = createIpcContainer();
    const cleanupFirst = vi.fn();
    const cleanupSecond = vi.fn();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let resolveStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const first = container.load("profile", async () => {
      resolveStarted();
      await firstGate;
      return { channels: [["profile:get", cleanupFirst]] };
    });
    const second = container.load("profile", async () => ({
      channels: [["profile:set", cleanupSecond]],
    }));

    await firstStarted;
    releaseFirst();
    await expect(first).resolves.toEqual(["profile:get"]);
    await expect(second).resolves.toEqual(["profile:set"]);

    expect(cleanupFirst).toHaveBeenCalledOnce();
    expect(cleanupSecond).not.toHaveBeenCalled();
    expect(container.getChannels("profile")).toEqual(["profile:set"]);
    expect(container.size).toBe(1);
  });

  it("orders unload after an overlapping load", async () => {
    const container = createIpcContainer();
    const cleanup = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let resolveStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    const loading = container.load("profile", async () => {
      resolveStarted();
      await gate;
      return { channels: [["profile:get", cleanup]] };
    });

    await started;
    const unloading = container.unload("profile");
    release();

    await expect(loading).resolves.toEqual(["profile:get"]);
    await expect(unloading).resolves.toBe(true);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(container.has("profile")).toBe(false);
    expect(container.size).toBe(0);
  });

  it("does not interleave loadAll and dispose with an earlier load", async () => {
    const container = createIpcContainer();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = container.load("first", async () => {
      order.push("register:first:start");
      await gate;
      order.push("register:first:end");
      return { channels: [["first:get", () => order.push("cleanup:first")]] };
    });
    const batch = container.loadAll({
      a: async () => {
        order.push("register:a");
        return { channels: [["a:get", () => order.push("cleanup:a")]] };
      },
      b: async () => {
        order.push("register:b");
        return { channels: [["b:get", () => order.push("cleanup:b")]] };
      },
    });
    const disposing = container.dispose();

    release();
    await first;
    await expect(batch).resolves.toEqual({ a: ["a:get"], b: ["b:get"] });
    await disposing;

    expect(order).toEqual([
      "register:first:start",
      "register:first:end",
      "register:a",
      "register:b",
      "cleanup:first",
      "cleanup:a",
      "cleanup:b",
    ]);
    expect(container.size).toBe(0);
  });

  it("emits loaded event", async () => {
    const spy = vi.fn();
    const container = createIpcContainer();
    container.on("loaded", spy);

    await container.load("test", fakeRegister(["test:ping"]));

    expect(spy).toHaveBeenCalledWith("test", ["test:ping"]);
  });

  it("emits unloaded event", async () => {
    const spy = vi.fn();
    const container = createIpcContainer();
    container.on("unloaded", spy);

    await container.load("test", fakeRegister(["test:ping"]));
    await container.unload("test");

    expect(spy).toHaveBeenCalledWith("test");
  });

  it("emits error event on register failure", async () => {
    const spy = vi.fn();
    const boom = new Error("register failed");
    const container = createIpcContainer();
    container.on("error", spy);

    await expect(
      container.load("broken", async () => {
        throw boom;
      }),
    ).rejects.toThrow(boom);

    expect(spy).toHaveBeenCalledWith("broken", boom);
  });

  it("getChannels returns empty array for unknown module", () => {
    const container = createIpcContainer();
    expect(container.getChannels("ghost")).toEqual([]);
  });

  it("rejects duplicate channels across different modules and cleans up the newcomer", async () => {
    const container = createIpcContainer();
    const cleanup = vi.fn();
    await container.load("first", fakeRegister(["shared:channel"]));

    await expect(
      container.load("second", async () => ({
        channels: [["shared:channel", cleanup]],
      })),
    ).rejects.toBeInstanceOf(IpcChannelCollisionError);

    expect(cleanup).toHaveBeenCalledOnce();
    expect(container.names).toEqual(["first"]);
  });

  it("dispose is ordered, terminal, and idempotent", async () => {
    const container = createIpcContainer();
    const cleanup = vi.fn();
    await container.load("one", async () => ({ channels: [["one:get", cleanup]] }));

    await container.dispose();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(container.size).toBe(0);
    await expect(container.load("two", fakeRegister(["two:get"]))).rejects.toBeInstanceOf(
      IpcContainerDisposedError,
    );
    await expect(container.dispose()).resolves.toBeUndefined();
  });
});
