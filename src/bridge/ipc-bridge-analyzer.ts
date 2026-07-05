import { basename, resolve } from "node:path";

import { globSync } from "glob";
import ts from "typescript";

import {
  collectEmittedEvents,
  findCallTo,
  getCallToIdentifier,
  isCallToIdentifier,
  serializeType,
  unwrapAwaitedType,
} from "../shared/ts-utils.js";
import type { AnalyzedIpcModule, ChannelInfo, EmittedEventInfo } from "../shared/types/bridge.js";
import { resolveIpcPattern, toPosixPath } from "../shared/utils.js";

function collectMatchedIpcFiles(ipcDir: string): Set<string> {
  const pattern = resolveIpcPattern(ipcDir);
  return new Set(
    globSync(pattern, {
      nodir: true,
      absolute: true,
    }).map((filePath) => toPosixPath(resolve(filePath))),
  );
}

function isAnalyzableIpcFile(
  fileName: string,
  matchedFiles: Set<string>,
): boolean {
  if (!matchedFiles.has(fileName)) return false;
  if (!fileName.endsWith(".ipc.ts")) return false;
  if (fileName.includes(".test.")) return false;
  return true;
}

function collectSpreadWarnings(channelsArg: ts.Node): string[] {
  if (!ts.isObjectLiteralExpression(channelsArg)) return [];

  const warnings: string[] = [];
  for (const property of channelsArg.properties) {
    if (ts.isSpreadAssignment(property)) {
      warnings.push(
        "Spread in channels object - those entries cannot be typed in the bridge",
      );
    }
  }
  return warnings;
}

function isOptionalParameter(declarationNode: ts.Declaration | undefined): boolean {
  if (!declarationNode || !ts.isParameter(declarationNode)) return false;
  return (
    Boolean(declarationNode.questionToken) || Boolean(declarationNode.initializer)
  );
}

function serializeRestArgsType(
  checker: ts.TypeChecker,
  restParam: ts.Symbol,
  declaration: ts.ParameterDeclaration,
): string | null {
  const restType = checker.getTypeOfSymbolAtLocation(restParam, declaration);
  const serialized = serializeType(checker, restType);
  return serialized === "[]" ? null : serialized;
}

function serializeNamedArgsType(
  checker: ts.TypeChecker,
  params: readonly ts.Symbol[],
  channelsArg: ts.Node,
): string | null {
  const parts: string[] = [];
  for (let index = 1; index < params.length; index += 1) {
    const param = params[index];
    const declarationNode = param.valueDeclaration;
    const paramType = checker.getTypeOfSymbolAtLocation(
      param,
      declarationNode || channelsArg,
    );
    const typeString = serializeType(checker, paramType);
    const optional = isOptionalParameter(declarationNode);
    parts.push(`${param.getName()}${optional ? "?" : ""}: ${typeString}`);
  }
  return parts.length > 0 ? `[${parts.join(", ")}]` : null;
}

function serializeArgsType(
  checker: ts.TypeChecker,
  signature: ts.Signature,
  channelsArg: ts.Node,
): string | null {
  const params = signature.getParameters();
  if (params.length <= 1) return null;

  const restParam = params[1];
  const declaration = restParam.valueDeclaration;
  const isRest =
    declaration &&
    ts.isParameter(declaration) &&
    Boolean(declaration.dotDotDotToken);

  if (isRest) {
    return serializeRestArgsType(checker, restParam, declaration);
  }

  return serializeNamedArgsType(checker, params, channelsArg);
}

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

      const helpersCall = getCallToIdentifier(
        declaration.initializer,
        "createIpcHelpers",
      );
      const eventMapNode = helpersCall?.typeArguments?.[0];
      if (!eventMapNode) continue;

      collectEmittedEvents(
        checker,
        eventMapNode,
        emittedEvents,
        seenEmittedEvents,
        warnings,
      );
    }
  }
}

function isExportedVariableStatement(statement: ts.Statement): statement is ts.VariableStatement {
  if (!ts.isVariableStatement(statement)) return false;
  return Boolean(
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function collectDefineIpcEventsFromDeclaration(
  checker: ts.TypeChecker,
  declaration: ts.VariableDeclaration,
  emittedEvents: EmittedEventInfo[],
  seenEmittedEvents: Set<string>,
  warnings: string[],
): void {
  if (!declaration.initializer) return;
  if (!ts.isIdentifier(declaration.name)) return;
  if (!isCallToIdentifier(declaration.initializer, "defineIpcEvents")) return;

  collectEmittedEvents(
    checker,
    declaration.name,
    emittedEvents,
    seenEmittedEvents,
    warnings,
  );
}

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

function analyzeIpcSourceFile(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
): AnalyzedIpcModule | null {
  const defineCall = findCallTo(sourceFile, "defineIpcModule");
  if (!defineCall || defineCall.arguments.length < 2) return null;

  const prefixArg = defineCall.arguments[0];
  const prefix = ts.isStringLiteral(prefixArg) ? prefixArg.text : "";
  const channelsArg = defineCall.arguments[1];
  const channelsType = checker.getTypeAtLocation(channelsArg);

  const warnings = collectSpreadWarnings(channelsArg);
  const channels = extractChannels(checker, channelsType, channelsArg);
  const emittedEvents: EmittedEventInfo[] = [];
  const seenEmittedEvents = new Set<string>();

  collectHelpersEmittedEvents(
    checker,
    sourceFile,
    emittedEvents,
    seenEmittedEvents,
    warnings,
  );
  collectExportedDefineIpcEvents(
    checker,
    sourceFile,
    emittedEvents,
    seenEmittedEvents,
    warnings,
  );

  const fileName = toPosixPath(resolve(sourceFile.fileName));
  return {
    name: basename(fileName, ".ipc.ts"),
    prefix,
    channels,
    emittedEvents,
    warnings,
    fileName,
  };
}

export function extractModules(
  program: ts.Program,
  ipcDir: string,
): AnalyzedIpcModule[] {
  const checker = program.getTypeChecker();
  const matchedFiles = collectMatchedIpcFiles(ipcDir);
  const modules: AnalyzedIpcModule[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    const fileName = toPosixPath(resolve(sourceFile.fileName));
    if (!isAnalyzableIpcFile(fileName, matchedFiles)) continue;

    const module = analyzeIpcSourceFile(checker, sourceFile);
    if (module) modules.push(module);
  }

  return modules.sort((left, right) => left.name.localeCompare(right.name));
}
