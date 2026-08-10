import { resolve } from "node:path";

import type { LoggerLike } from "./types/runtime.js";

export type { MethodsOnly, MaybePromise, LoggerLike, Serializable } from "./types/runtime.js";

/** Default directory scanned for `*.ipc.ts` module files. */
export const DEFAULT_IPC_DIR = "./src/ipc";
/** Default path for the generated preload bridge. */
export const DEFAULT_OUT_FILE = "./src/generated/ipc-bridge.ts";
/** Default tsconfig used when analyzing IPC files. */
export const DEFAULT_TSCONFIG = "./tsconfig.json";

const COLORS = {
  debug: 34,
  error: 31,
  info: 32,
  log: 32,
  warn: 33,
} as const;

const noop = () => void 0;

/**
 * Create a labelled console logger for generator output.
 *
 * `debug` is always dropped: it is per-module detail that would bury the two
 * lines worth reading on every rebuild. `quiet` additionally drops `info`,
 * keeping `warn` and `error` — a warning means the generated bridge is
 * incompletely typed, which is never noise.
 *
 * Pass `IpcBridgeOptions.logger` instead to receive every level, including
 * `debug`, or to route output somewhere other than the console.
 */
export function createLogger(label: string, quiet = false): LoggerLike {
  const write =
    (level: keyof typeof COLORS) =>
    (...args: unknown[]) => {
      const timestamp = new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        hourCycle: "h23",
      });
      console[level](`\x1b[${COLORS[level]}m${timestamp} [${label}]\x1b[0m`, ...args);
    };

  return {
    debug: noop,
    error: write("error"),
    info: quiet ? noop : write("info"),
    log: quiet ? noop : write("log"),
    warn: write("warn"),
  };
}

/** Convert `kebab-case`, `snake_case`, or spaced text to `camelCase`. */
export function toCamelCase(str: string) {
  return str
    .replace(/[-_ ]+(\w)/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

/** Convert `kebab-case`, `snake_case`, or spaced text to `PascalCase`. */
export function toPascalCase(str: string) {
  return str
    .replace(/[-_ ]+(\w)/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Normalize Windows backslashes to POSIX forward slashes. */
export function toPosixPath(filePath: string) {
  return filePath.replaceAll("\\", "/");
}

/** Whether `filePath` contains glob metacharacters. */
export function hasGlobMagic(filePath: string) {
  return /[*?[\]{}()!]/.test(filePath);
}

/** Resolve `filePath` to an absolute path with POSIX separators. */
export function toAbsolutePosix(filePath: string) {
  return toPosixPath(resolve(filePath));
}

/** Nearest absolute directory ancestor of a path/glob that has no glob magic. */
export function globWatchRoot(pattern: string) {
  const normalized = toAbsolutePosix(pattern);
  const magicIndex = normalized.search(/[*?[\]{}()!]/);
  if (magicIndex === -1) return normalized;
  const slashIndex = normalized.lastIndexOf("/", magicIndex);
  return slashIndex > 0 ? normalized.slice(0, slashIndex) : toAbsolutePosix(".");
}

/** Build the default `**\/*.ipc.ts` glob for a plain directory. */
export function defaultPatternFromDir(dir: string) {
  const normalizedDir = dir.replace(/[\\/]+$/, "");
  return `${normalizedDir}/**/*.ipc.ts`;
}

/** Return `ipcDir` if it is already a glob, otherwise derive the default glob. */
export function resolveIpcPattern(ipcDir: string) {
  return hasGlobMagic(ipcDir) ? ipcDir : defaultPatternFromDir(ipcDir);
}
