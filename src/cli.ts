#!/usr/bin/env node

import { realpathSync, watch } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  isIpcBridgeRelevantFile,
  resolveIpcBridgeOptions,
  runIpcBridgeGeneration,
  type IpcBridgeOptions,
} from "./bridge/ipc-bridge.js";
import { createLogger, globWatchRoot, hasGlobMagic, toAbsolutePosix } from "./shared/utils.js";

const HELP = `electron-ipc-module <generate|check> [options]

Commands:
  generate          Generate the bridge once (default)
  generate --watch  Regenerate when IPC sources or tsconfig change
  check             Exit non-zero when the generated bridge is stale

Options:
  --ipc-dir <path>  IPC source directory or glob
  --out-file <path> Generated TypeScript file
  --tsconfig <path> TypeScript configuration
  --watch           Keep watching after generation
  --quiet           Suppress progress output; warnings and errors still print
  --help            Show this help
`;

function takeValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArguments(args: string[]) {
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "generate";
  const options: IpcBridgeOptions = {};
  let watchMode = false;

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--ipc-dir") options.ipcDir = takeValue(args, index++, flag);
    else if (flag === "--out-file") options.outFile = takeValue(args, index++, flag);
    else if (flag === "--tsconfig") options.tsconfig = takeValue(args, index++, flag);
    else if (flag === "--watch") watchMode = true;
    else if (flag === "--quiet") options.logger = createLogger("ipc-bridge", true);
    else if (flag === "--help" || flag === "-h") return { command: "help", options, watchMode };
    else throw new Error(`Unknown option ${flag}`);
  }

  if (command !== "generate" && command !== "check") throw new Error(`Unknown command ${command}`);
  if (command === "check" && watchMode) throw new Error("check does not support --watch");
  return { command, options, watchMode };
}

function startWatch(options: IpcBridgeOptions) {
  const resolved = resolveIpcBridgeOptions(options);
  const ipcTarget = hasGlobMagic(resolved.ipcDir)
    ? globWatchRoot(resolved.ipcDir)
    : toAbsolutePosix(resolved.ipcDir);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const regenerate = (filePath?: string) => {
    if (filePath && !isIpcBridgeRelevantFile(filePath, options)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        runIpcBridgeGeneration(options);
      } catch (error) {
        resolved.logger.error(error);
      }
    }, 50);
  };

  watch(ipcTarget, { recursive: true }, (_event, filename) => {
    regenerate(filename == null ? undefined : toAbsolutePosix(join(ipcTarget, filename)));
  });
  watch(resolved.tsconfig, () => regenerate(resolved.tsconfig));
  resolved.logger.info(`Watching ${ipcTarget} and ${resolved.tsconfig}`);
}

export function runCli(args = process.argv.slice(2)) {
  const parsed = parseArguments([...args]);
  if (parsed.command === "help") {
    console.info(HELP);
    return;
  }

  const result = runIpcBridgeGeneration(parsed.options, { write: parsed.command === "generate" });
  if (parsed.command === "check" && result.changed) {
    console.error(`Generated bridge is stale: ${result.outFile}`);
    process.exitCode = 1;
  }
  if (parsed.watchMode) startWatch(parsed.options);
}

/** True only when this file is the process entry point, not an import. */
function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // argv[1] is the `.bin` symlink; import.meta.url is already the realpath.
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isDirectRun()) runCli();
