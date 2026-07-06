import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { globSync } from "glob";

import { extractModules } from "./ipc-bridge-analyzer.js";
import { generateBridge } from "./ipc-bridge-generator.js";
import { createTsProgram, makeRelativeImports } from "../shared/ts-utils.js";
import type { IpcBridgeOptions, ResolvedIpcBridgeOptions } from "../shared/types/bridge.js";
import {
  createLogger,
  DEFAULT_IPC_DIR,
  DEFAULT_OUT_FILE,
  DEFAULT_TSCONFIG,
  hasGlobMagic,
  resolveIpcPattern,
  toAbsolutePosix,
  toPosixPath,
} from "../shared/utils.js";

export type { IpcBridgeOptions } from "../shared/types/bridge.js";

const logger = createLogger("ipc-bridge");

/** Apply defaults and normalize paths for the bridge options. */
export function resolveIpcBridgeOptions(options: IpcBridgeOptions = {}): ResolvedIpcBridgeOptions {
  return {
    ipcDir: options.ipcDir ?? DEFAULT_IPC_DIR,
    outFile: toAbsolutePosix(options.outFile ?? DEFAULT_OUT_FILE),
    tsconfig: toAbsolutePosix(options.tsconfig ?? DEFAULT_TSCONFIG),
  };
}

/**
 * Files a watcher should follow to know when to regenerate the bridge: the
 * tsconfig, the output file, and either the matched `*.ipc.ts` files (when
 * `ipcDir` is a glob) or the `ipcDir` itself.
 */
export function getIpcBridgeWatchTargets(options: IpcBridgeOptions = {}): string[] {
  const resolved = resolveIpcBridgeOptions(options);
  const watchTargets = new Set<string>([resolved.tsconfig, resolved.outFile]);

  if (hasGlobMagic(resolved.ipcDir)) {
    for (const matchedFile of globSync(resolveIpcPattern(resolved.ipcDir), {
      nodir: true,
      absolute: true,
    })) {
      watchTargets.add(toPosixPath(matchedFile));
    }
    return [...watchTargets];
  }

  watchTargets.add(toAbsolutePosix(resolved.ipcDir));
  return [...watchTargets];
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

  const matchedFiles = new Set(
    globSync(resolveIpcPattern(resolved.ipcDir), {
      nodir: true,
      absolute: true,
    }).map((matchedFile) => toPosixPath(matchedFile)),
  );

  return matchedFiles.has(normalizedFile);
}

/**
 * Analyze the IPC modules and (re)write the typed preload bridge.
 *
 * The file is only written when its contents change, so it is safe to call on
 * every rebuild. Returns whether it `changed`, the generated `code`, the
 * analyzed `modules`, and the resolved `outFile` path.
 */
export function runIpcBridgeGeneration(options: IpcBridgeOptions = {}) {
  const resolved = resolveIpcBridgeOptions(options);

  logger.info("Analyzing IPC modules...");
  const program = createTsProgram(resolved.tsconfig);
  const modules = extractModules(program, resolved.ipcDir);

  for (const ipcModule of modules) {
    for (const warning of ipcModule.warnings) {
      logger.warn(`[${ipcModule.name}] ${warning}`);
    }
    logger.debug(
      `${ipcModule.name}: ${ipcModule.channels.length} channels, ${ipcModule.emittedEvents.length} emitted events`,
    );
  }

  let code = generateBridge(modules);
  code = makeRelativeImports(code, resolved.outFile);

  const previousCode = (() => {
    try {
      return readFileSync(resolved.outFile, "utf-8");
    } catch {
      return null;
    }
  })();

  const changed = previousCode !== code;
  if (changed) {
    mkdirSync(dirname(resolved.outFile), { recursive: true });
    writeFileSync(resolved.outFile, code, "utf-8");
  }

  const totalChannels = modules.reduce((count, ipcModule) => count + ipcModule.channels.length, 0);
  const totalEvents = modules.reduce(
    (count, ipcModule) => count + ipcModule.emittedEvents.length,
    0,
  );

  logger.info(
    `Generated bridge: ${modules.length} modules, ${totalChannels} channels, ${totalEvents} emitted events -> ${resolved.outFile}`,
  );

  return {
    changed,
    code,
    modules,
    outFile: resolved.outFile,
  };
}
