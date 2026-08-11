import { globSync } from "node:fs";
import { basename, resolve } from "node:path";

import ts from "typescript";

import {
  collectEmittedEvents,
  findCallsTo,
  getCallToExport,
  isCallToExportExpression,
  serializeType,
  unwrapAwaitedType,
} from "../shared/ts-utils.js";
import type { AnalyzedIpcModule, ChannelInfo, EmittedEventInfo } from "../shared/types/bridge.js";
import { resolveIpcPattern, toPosixPath } from "../shared/utils.js";

/**
 * Absolute POSIX paths of the non-test `*.ipc.ts` files `ipcDir` selects.
 *
 * The pattern is normalized to forward slashes first: a backslash is an escape
 * character to the matcher, so a Windows-style `.\src\ipc` would otherwise
 * silently match nothing. Directories are dropped by the suffix filter — `**`
 * matches them too, but they can never be a program source file.
 *
 * Pure filesystem work, needing no program. That is what lets the generator
 * scope compiler diagnostics to these files before a program exists.
 */
export function collectIpcFilePaths(ipcDir: string): string[] {
  const pattern = toPosixPath(resolveIpcPattern(ipcDir));
  return globSync(pattern)
    .map((filePath) => toPosixPath(resolve(filePath)))
    .filter((filePath) => filePath.endsWith(".ipc.ts") && !filePath.includes(".test."));
}

/** Warn about spread entries in the channels object — they can't be typed. */
function collectSpreadWarnings(channelsArg: ts.Node): string[] {
  if (!ts.isObjectLiteralExpression(channelsArg)) return [];

  const warnings: string[] = [];
  for (const property of channelsArg.properties) {
    if (ts.isSpreadAssignment(property)) {
      warnings.push("Spread in channels object - those entries cannot be typed in the bridge");
    }
  }
  return warnings;
}

/** Whether a parameter declaration is optional (`?` or has a default). */
function isOptionalParameter(declarationNode: ts.Declaration | undefined): boolean {
  if (!declarationNode || !ts.isParameter(declarationNode)) return false;
  return Boolean(declarationNode.questionToken) || Boolean(declarationNode.initializer);
}

/** Serialize a `...rest` parameter's tuple type, or `null` if it is `[]`. */
function serializeRestArgsType(
  checker: ts.TypeChecker,
  restParam: ts.Symbol,
  declaration: ts.ParameterDeclaration,
): string | null {
  const restType = checker.getTypeOfSymbolAtLocation(restParam, declaration);
  const serialized = serializeType(checker, restType);
  return serialized === "[]" ? null : serialized;
}

/** Serialize the explicit (non-rest) parameters after the event into a tuple. */
function serializeNamedArgsType(
  checker: ts.TypeChecker,
  params: readonly ts.Symbol[],
  channelsArg: ts.Node,
): string | null {
  const parts: string[] = [];
  for (let index = 1; index < params.length; index += 1) {
    const param = params[index];
    const declarationNode = param.valueDeclaration;
    const paramType = checker.getTypeOfSymbolAtLocation(param, declarationNode || channelsArg);
    const typeString = serializeType(checker, paramType);
    const optional = isOptionalParameter(declarationNode);
    parts.push(`${param.getName()}${optional ? "?" : ""}: ${typeString}`);
  }
  return parts.length > 0 ? `[${parts.join(", ")}]` : null;
}

/** Serialize a channel callback's argument types (everything after the event). */
function serializeArgsType(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  channelsArg: ts.Node,
): string | null {
  const params = signature.getParameters();
  if (params.length <= 1) return null;

  const restParam = params[1];
  const declaration = restParam.valueDeclaration;
  const isRest = declaration && ts.isParameter(declaration) && Boolean(declaration.dotDotDotToken);

  if (isRest) {
    return serializeRestArgsType(checker, restParam, declaration);
  }

  return serializeNamedArgsType(checker, params, channelsArg);
}

/** Serialize a handler's awaited return type; listeners are always `any`. */
function serializeReturnType(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  isHandler: boolean,
): string {
  if (!isHandler) return "any";
  const rawReturn = signature.getReturnType();
  const inner = unwrapAwaitedType(checker, rawReturn);
  return serializeType(checker, inner);
}

/** Build {@link ChannelInfo} for one property of the channels object. */
function extractChannelInfo(
  checker: ts.TypeChecker,
  symbol: ts.Symbol,
  channelsArg: ts.Node,
): ChannelInfo | null {
  const channelName = symbol.getName();
  if (channelName.startsWith("__")) return null;

  const propType = checker.getTypeOfSymbolAtLocation(symbol, channelsArg);
  const kindProp = propType.getProperty("kind");
  if (!kindProp) return null;

  const kindType = checker.getTypeOfSymbolAtLocation(kindProp, channelsArg);
  const kindStr = checker.typeToString(kindType).replaceAll('"', "");
  const isHandler = kindStr === "handler";

  const fnProp = propType.getProperty("fn");
  if (!fnProp) return null;

  const fnType = checker.getTypeOfSymbolAtLocation(fnProp, channelsArg);
  const signatures = fnType.getCallSignatures();
  if (signatures.length === 0) {
    return {
      key: channelName,
      isHandler,
      argsType: null,
      returnType: "any",
    };
  }

  const signature = signatures[0];
  return {
    key: channelName,
    isHandler,
    argsType: serializeArgsType(checker, signature, channelsArg),
    returnType: serializeReturnType(checker, signature, isHandler),
  };
}

/** Extract {@link ChannelInfo} for every property of the channels object. */
function extractChannels(
  checker: ts.TypeChecker,
  channelsType: ts.Type,
  channelsArg: ts.Node,
): ChannelInfo[] {
  const channels: ChannelInfo[] = [];
  for (const symbol of channelsType.getProperties()) {
    const channel = extractChannelInfo(checker, symbol, channelsArg);
    if (channel) channels.push(channel);
  }
  return channels;
}

/** Collect emitted events from the `TEmit` argument of `createIpcHelpers<…>()`. */
function collectHelpersEmittedEvents(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  emittedEvents: EmittedEventInfo[],
  seenEmittedEvents: Set<string>,
  warnings: string[],
): void {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;

      const helpersCall = getCallToExport(checker, declaration.initializer, "createIpcHelpers");
      const eventMapNode = helpersCall?.typeArguments?.[0];
      if (!eventMapNode) continue;

      collectEmittedEvents(checker, eventMapNode, emittedEvents, seenEmittedEvents, warnings);
    }
  }
}

/** Whether a statement is an exported `const`/`let`/`var` declaration. */
function isExportedVariableStatement(statement: ts.Statement): statement is ts.VariableStatement {
  if (!ts.isVariableStatement(statement)) return false;
  return Boolean(
    ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

/** Collect emitted events from an `export const x = defineIpcEvents<…>()`. */
function collectDefineIpcEventsFromDeclaration(
  checker: ts.TypeChecker,
  declaration: ts.VariableDeclaration,
  emittedEvents: EmittedEventInfo[],
  seenEmittedEvents: Set<string>,
  warnings: string[],
): void {
  if (!declaration.initializer) return;
  if (!ts.isIdentifier(declaration.name)) return;
  if (!isCallToExportExpression(checker, declaration.initializer, "defineIpcEvents")) return;

  collectEmittedEvents(checker, declaration.name, emittedEvents, seenEmittedEvents, warnings);
}

/** Scan a file's exported declarations for `defineIpcEvents<…>()` event maps. */
function collectExportedDefineIpcEvents(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  emittedEvents: EmittedEventInfo[],
  seenEmittedEvents: Set<string>,
  warnings: string[],
): void {
  for (const statement of sourceFile.statements) {
    if (!isExportedVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      collectDefineIpcEventsFromDeclaration(
        checker,
        declaration,
        emittedEvents,
        seenEmittedEvents,
        warnings,
      );
    }
  }
}

/** `file:line:column` for a node, matching the generator's diagnostic style. */
function formatLocation(sourceFile: ts.SourceFile, node: ts.Node): string {
  const { character, line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `${sourceFile.fileName}:${line + 1}:${character + 1}`;
}

/**
 * Analyze one source file into an {@link AnalyzedIpcModule}, or `null` if it
 * contains no `defineIpcModule(prefix, channels)` call.
 */
function analyzeIpcSourceFile(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): AnalyzedIpcModule | null {
  const defineCalls = findCallsTo(checker, sourceFile, "defineIpcModule");
  // The bridge keys one entry per file, so a second module here has nowhere to
  // go. Registering it still works, which is exactly why this has to be loud:
  // silently generating only the first leaves main and renderer disagreeing.
  if (defineCalls.length > 1) {
    throw new Error(
      `${formatLocation(sourceFile, defineCalls[1])} ` +
        "a file may declare only one defineIpcModule: the generated bridge groups channels " +
        "under a single entry named after the file, so only the first module would reach the " +
        "renderer. Move this module into its own *.ipc.ts file",
    );
  }

  const defineCall = defineCalls[0];
  if (!defineCall || defineCall.arguments.length < 2) return null;

  const prefixArg = defineCall.arguments[0];
  if (!ts.isStringLiteralLike(prefixArg)) {
    throw new Error(
      `${formatLocation(sourceFile, prefixArg)} ` +
        "defineIpcModule prefix must be a string literal so the generated bridge uses the runtime channel name",
    );
  }
  const prefix = prefixArg.text;
  const channelsArg = defineCall.arguments[1];
  const channelsType = checker.getTypeAtLocation(channelsArg);

  const warnings = collectSpreadWarnings(channelsArg);
  const channels = extractChannels(checker, channelsType, channelsArg);
  const emittedEvents: EmittedEventInfo[] = [];
  const seenEmittedEvents = new Set<string>();

  let eventPrefix: string | undefined;
  const optionsArg = defineCall.arguments[2];
  if (optionsArg && ts.isObjectLiteralExpression(optionsArg)) {
    const property = optionsArg.properties.find(
      (candidate): candidate is ts.PropertyAssignment =>
        ts.isPropertyAssignment(candidate) &&
        ((ts.isIdentifier(candidate.name) && candidate.name.text === "eventPrefix") ||
          (ts.isStringLiteral(candidate.name) && candidate.name.text === "eventPrefix")),
    );
    if (property) {
      if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) eventPrefix = prefix;
      else if (ts.isStringLiteralLike(property.initializer))
        eventPrefix = property.initializer.text;
      else warnings.push("eventPrefix must be true or a string literal for bridge generation");
    }
  }

  collectHelpersEmittedEvents(checker, sourceFile, emittedEvents, seenEmittedEvents, warnings);
  collectExportedDefineIpcEvents(checker, sourceFile, emittedEvents, seenEmittedEvents, warnings);

  const fileName = toPosixPath(resolve(sourceFile.fileName));
  return {
    name: basename(fileName, ".ipc.ts"),
    prefix,
    eventPrefix,
    channels,
    emittedEvents,
    warnings,
    fileName,
  };
}

/**
 * Analyze every eligible `*.ipc.ts` file in `program` and return the modules
 * sorted by name.
 */
export function extractModules(program: ts.Program, ipcDir: string): AnalyzedIpcModule[] {
  const checker = program.getTypeChecker();
  const matchedFiles = new Set(collectIpcFilePaths(ipcDir));
  const modules: AnalyzedIpcModule[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    const fileName = toPosixPath(resolve(sourceFile.fileName));
    if (!matchedFiles.has(fileName)) continue;

    const module = analyzeIpcSourceFile(checker, sourceFile);
    if (module) modules.push(module);
  }

  return modules.sort((left, right) => left.name.localeCompare(right.name));
}
