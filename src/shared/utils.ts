import { resolve } from "node:path";

export type { MethodsOnly, MaybePromise, LoggerLike } from "./types/runtime.js";

export const DEFAULT_IPC_DIR = "./src/ipc";
export const DEFAULT_OUT_FILE = "./src/generated/ipc-bridge.ts";
export const DEFAULT_TSCONFIG = "./tsconfig.json";

const COLORS = {
  info: 32,
  error: 31,
  warn: 33,
  debug: 34,
} as const;

const LEVELS = ["error", "warn", "info", "debug"] as const;
type LogLevel = (typeof LEVELS)[number];

export function createLogger(label: string, level = "info") {
  const index = LEVELS.indexOf(level as LogLevel);
  return Object.fromEntries(
    LEVELS.map((level) => {
      const method = (...args: unknown[]) => {
        const timestamp = new Date().toLocaleTimeString();
        console[level](
          `\x1b[${COLORS[level]}m${timestamp} [${label}]\x1b[0m`,
          ...args,
        );
      };
      return [level, index >= LEVELS.indexOf(level) ? method : () => void 0];
    }) as [LogLevel, (...args: unknown[]) => void][],
  );
}

export function toCamelCase(str: string) {
  return str
    .replace(/[-_ ]+(\w)/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

export function toPascalCase(str: string) {
  return str
    .replace(/[-_ ]+(\w)/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function toPosixPath(filePath: string) {
  return filePath.replace(/\\/g, "/");
}

export function hasGlobMagic(filePath: string) {
  return /[*?[\]{}()!]/.test(filePath);
}

export function toAbsolutePosix(filePath: string) {
  return toPosixPath(resolve(filePath));
}

export function defaultPatternFromDir(dir: string) {
  const normalizedDir = dir.replace(/[\\/]+$/, "");
  return `${normalizedDir}/**/*.ipc.ts`;
}

export function resolveIpcPattern(ipcDir: string) {
  return hasGlobMagic(ipcDir) ? ipcDir : defaultPatternFromDir(ipcDir);
}
