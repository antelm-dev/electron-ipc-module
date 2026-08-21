import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, matchesGlob } from "node:path";

import { collectIpcFilePaths, extractModules } from "./ipc-bridge-analyzer.js";
import { generateBridge } from "./ipc-bridge-generator.js";
import { createTsProgram, makeRelativeImports } from "../shared/ts-utils.js";
import type { IpcBridgeOptions, ResolvedIpcBridgeOptions } from "../shared/types/bridge.js";
import {
  createLogger,
  DEFAULT_IPC_DIR,
  DEFAULT_OUT_FILE,
  DEFAULT_TSCONFIG,
  globWatchRoot,
  hasGlobMagic,
  resolveIpcPattern,
  toAbsolutePosix,
} from "../shared/utils.js";

// The generator's whole type surface lives on this entry point, not the root:
// these describe how the bridge is produced, not what a main-process consumer
// depends on. `LoggerLike` rides along so a caller configuring `logger` does
// not need a second import.
export type {
  AnalyzedIpcModule,
  ChannelInfo,
  EmittedEventInfo,
  IpcBridgeOptions,
  ResolvedIpcBridgeOptions,
} from "../shared/types/bridge.js";
export type { LoggerLike } from "../shared/types/runtime.js";

/** Apply defaults and normalize paths for the bridge options. */
export function resolveIpcBridgeOptions(options: IpcBridgeOptions = {}): ResolvedIpcBridgeOptions {
  return {
    ipcDir: options.ipcDir ?? DEFAULT_IPC_DIR,
    outFile: toAbsolutePosix(options.outFile ?? DEFAULT_OUT_FILE),
    tsconfig: toAbsolutePosix(options.tsconfig ?? DEFAULT_TSCONFIG),
    logger: options.logger ?? createLogger("ipc-bridge"),
    expose: options.expose,
  };
}

/**
 * Paths a watcher should follow to know when to regenerate the bridge: the
 * tsconfig and either `ipcDir` itself, or — when `ipcDir` is a glob — its
 * nearest non-glob ancestor directory (so newly created matches are seen).
 * Filter change events with {@link isIpcBridgeRelevantFile}.
 */
export function getIpcBridgeWatchTargets(options: IpcBridgeOptions = {}): string[] {
  const resolved = resolveIpcBridgeOptions(options);
  const ipcTarget = hasGlobMagic(resolved.ipcDir)
    ? globWatchRoot(resolved.ipcDir)
    : toAbsolutePosix(resolved.ipcDir);

  return [resolved.tsconfig, ipcTarget];
}

/**
 * Whether a changed `filePath` should trigger bridge regeneration — i.e. it is
 * the tsconfig, or a `*.ipc.ts` file within the configured directory/glob.
 */
export function isIpcBridgeRelevantFile(filePath: string, options: IpcBridgeOptions = {}) {
  const normalizedFile = toAbsolutePosix(filePath);
  const resolved = resolveIpcBridgeOptions(options);

  if (normalizedFile === resolved.tsconfig) {
    return true;
  }

  if (!normalizedFile.endsWith(".ipc.ts")) {
    return false;
  }

  if (!hasGlobMagic(resolved.ipcDir)) {
    const normalizedIpcDir = toAbsolutePosix(resolved.ipcDir);
    return normalizedFile.startsWith(`${normalizedIpcDir}/`);
  }

  return matchesGlob(normalizedFile, toAbsolutePosix(resolveIpcPattern(resolved.ipcDir)));
}

/**
 * Analyze the IPC modules and (re)write the typed preload bridge.
 *
 * The file is only written when its contents change, so it is safe to call on
 * every rebuild. Returns whether it `changed`, the generated `code`, the
 * analyzed `modules`, and the resolved `outFile` path.
 */
export function runIpcBridgeGeneration(
  options: IpcBridgeOptions = {},
  generationOptions: { write?: boolean } = {},
) {
  const resolved = resolveIpcBridgeOptions(options);
  const { logger } = resolved;

  logger.info("Analyzing IPC modules...");
  // Diagnostics are scoped to the IPC sources and what they import: an error
  // elsewhere in the project cannot reach the bridge, and aborting on it would
  // make every unrelated compile error a generation failure.
  const program = createTsProgram(resolved.tsconfig, collectIpcFilePaths(resolved.ipcDir));
  const modules = extractModules(program, resolved.ipcDir);

  for (const ipcModule of modules) {
    for (const warning of ipcModule.warnings) {
      logger.warn(`[${ipcModule.name}] ${warning}`);
    }
    logger.debug(
      `${ipcModule.name}: ${ipcModule.channels.length} channels, ${ipcModule.emittedEvents.length} emitted events`,
    );
  }

  let code = generateBridge(modules, { expose: resolved.expose });
  code = makeRelativeImports(code, resolved.outFile);

  const previousCode = (() => {
    try {
      return readFileSync(resolved.outFile, "utf-8");
    } catch {
      return null;
    }
  })();

  const changed = previousCode !== code;
  if (changed && generationOptions.write !== false) {
    mkdirSync(dirname(resolved.outFile), { recursive: true });
    writeFileSync(resolved.outFile, code, "utf-8");
  }

  const totalChannels = modules.reduce((count, ipcModule) => count + ipcModule.channels.length, 0);
  const totalEvents = modules.reduce(
    (count, ipcModule) => count + ipcModule.emittedEvents.length,
    0,
  );

  const action = generationOptions.write === false ? "Checked" : "Generated";
  logger.info(
    `${action} bridge: ${modules.length} modules, ${totalChannels} channels, ${totalEvents} emitted events -> ${resolved.outFile}`,
  );

  return {
    changed,
    code,
    modules,
    outFile: resolved.outFile,
  };
}
