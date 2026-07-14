import { resolve } from "node:path";

export type { MethodsOnly, MaybePromise, LoggerLike } from "./types/runtime.js";

/** Default directory scanned for `*.ipc.ts` module files. */
export const DEFAULT_IPC_DIR = "./src/ipc";
/** Default path for the generated preload bridge. */
export const DEFAULT_OUT_FILE = "./src/generated/ipc-bridge.ts";
/** Default tsconfig used when analyzing IPC files. */
export const DEFAULT_TSCONFIG = "./tsconfig.json";

const COLORS = {
  info: 32,
  error: 31,
  warn: 33,
  debug: 34,
} as const;

const LEVELS = ["error", "warn", "info", "debug"] as const;
type LogLevel = (typeof LEVELS)[number];

/**
 * Create a labelled console logger. Levels at or above `level` are emitted;
 * quieter levels become no-ops.
 */
export function createLogger(label: string, level = "info") {
  const index = LEVELS.indexOf(level as LogLevel);
  return Object.fromEntries(
    LEVELS.map((level) => {
      const method = (...args: unknown[]) => {
        const timestamp = new Date().toLocaleTimeString('en-US', {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          timeZone: "UTC",
          timeZoneName: "short",
        });
        console[level](`\x1b[${COLORS[level]}m${timestamp} [${label}]\x1b[0m`, ...args);
      };
      return [level, index >= LEVELS.indexOf(level) ? method : () => void 0];
    }) as [LogLevel, (...args: unknown[]) => void][],
  );
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

/** Build the default `**\/*.ipc.ts` glob for a plain directory. */
export function defaultPatternFromDir(dir: string) {
  const normalizedDir = dir.replace(/[\\/]+$/, "");
  return `${normalizedDir}/**/*.ipc.ts`;
}

/** Return `ipcDir` if it is already a glob, otherwise derive the default glob. */
export function resolveIpcPattern(ipcDir: string) {
  return hasGlobMagic(ipcDir) ? ipcDir : defaultPatternFromDir(ipcDir);
}
