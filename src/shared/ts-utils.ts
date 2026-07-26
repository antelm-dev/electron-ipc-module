import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import ts from "typescript";

import type { EmittedEventInfo } from "./types/bridge.js";

/** Type-to-string flags: never truncate, and keep fully-qualified names. */
export const SERIALIZE_FLAGS =
  ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType;

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
  getNewLine: () => ts.sys.newLine,
};

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]) {
  return ts.formatDiagnostics(diagnostics, formatHost).trimEnd();
}

function assertNoDiagnostics(diagnostics: readonly ts.Diagnostic[]) {
  const errors = diagnostics.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length === 0) return;
  throw new Error(
    `TypeScript failed with ${errors.length} error(s):\n${formatDiagnostics(errors)}`,
  );
}

/** Build a TypeScript program from a tsconfig path, resolving its file list. */
export function createTsProgram(tsconfigPath: string) {
  const abs = resolve(tsconfigPath).replace(/\\/g, "/");
  const configFile = ts.readConfigFile(abs, (filePath) => readFileSync(filePath, "utf-8"));
  if (configFile.error) {
    assertNoDiagnostics([configFile.error]);
  }

  const basePath = dirname(abs);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, basePath, undefined, abs);
  assertNoDiagnostics(parsed.errors);

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    projectReferences: parsed.projectReferences,
    configFileParsingDiagnostics: parsed.errors,
  });

  assertNoDiagnostics([
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getOptionsDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program
      .getSemanticDiagnostics()
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error),
  ]);

  return program;
}

/** Canonical runtime file that declares `defineIpcModule` / helpers / events. */
function isIpcModuleRuntimeFile(fileName: string): boolean {
  return /(?:^|[/\\])runtime[/\\]ipc-module\.(?:d\.)?[cm]?ts$/.test(fileName);
}

/** Follow import aliases to the underlying value symbol. */
export function resolveValueSymbol(checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(node);
  if (!symbol) return undefined;
  if (symbol.flags & ts.SymbolFlags.Alias) {
    return checker.getAliasedSymbol(symbol);
  }
  return symbol;
}

/**
 * Whether `symbol` is the package export `exportName` from
 * `runtime/ipc-module` (not a same-named local or third-party binding).
 */
export function isIpcModuleExportSymbol(
  symbol: ts.Symbol | undefined,
  exportName: string,
): boolean {
  if (!symbol || symbol.getName() !== exportName) return false;
  return (symbol.getDeclarations() ?? []).some((declaration) =>
    isIpcModuleRuntimeFile(declaration.getSourceFile().fileName),
  );
}

/** Callee name node for `fn(...)` or `ns.fn(...)`. */
function getCalleeNameNode(expression: ts.Expression): ts.MemberName | undefined {
  if (ts.isIdentifier(expression) || ts.isPrivateIdentifier(expression)) {
    return expression;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name;
  }
  return undefined;
}

/** Whether a call expression targets the package export `exportName`. */
export function isCallToExport(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  exportName: string,
): boolean {
  const nameNode = getCalleeNameNode(call.expression);
  if (!nameNode) return false;
  return isIpcModuleExportSymbol(resolveValueSymbol(checker, nameNode), exportName);
}

/** Depth-first search for the first call to the package export `exportName`. */
export function findCallTo(
  checker: ts.TypeChecker,
  node: ts.Node,
  exportName: string,
): ts.CallExpression | undefined {
  if (ts.isCallExpression(node) && isCallToExport(checker, node, exportName)) {
    return node;
  }

  let found: ts.CallExpression | undefined;
  ts.forEachChild(node, (child) => {
    found ??= findCallTo(checker, child, exportName);
  });
  return found;
}

/** Strip `as`, `satisfies`, angle-bracket assertions, and parentheses. */
export function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;

  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

/** Return the underlying package-export call if `expression` is one, else `undefined`. */
export function getCallToExport(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  exportName: string,
) {
  const unwrapped = unwrapExpression(expression);
  if (ts.isCallExpression(unwrapped) && isCallToExport(checker, unwrapped, exportName)) {
    return unwrapped;
  }
  return undefined;
}

/** Whether `expression` is a call to the package export `exportName` (after unwrapping). */
export function isCallToExportExpression(
  checker: ts.TypeChecker,
  expression: ts.Expression,
  exportName: string,
) {
  return Boolean(getCallToExport(checker, expression, exportName));
}

/**
 * Unwrap the value type of a `Promise<T>` (including `T | Promise<T>` unions)
 * down to `T`. Non-promise types are returned unchanged.
 */
export function unwrapAwaitedType(checker: ts.TypeChecker, type: ts.Type): ts.Type {
  if (type.isUnion()) {
    const promiseMember = type.types.find(
      (candidate) => candidate.getSymbol()?.getName() === "Promise",
    );

    if (promiseMember) {
      const typeArguments = checker.getTypeArguments(promiseMember as ts.TypeReference);
      return typeArguments.length > 0 ? typeArguments[0] : type;
    }
  }

  if (type.getSymbol()?.getName() === "Promise") {
    const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
    return typeArguments.length > 0 ? typeArguments[0] : type;
  }

  return type;
}

/** Serialize a type to its string form using {@link SERIALIZE_FLAGS}. */
export function serializeType(checker: ts.TypeChecker, type: ts.Type) {
  return checker.typeToString(type, undefined, SERIALIZE_FLAGS);
}

/** Drop a leading `readonly` and collapse the empty tuple `[]` to `null`. */
export function normalizeTupleType(typeStr: string) {
  const normalized = typeStr.replace(/^readonly\s+/, "");
  return normalized === "[]" ? null : normalized;
}

/**
 * Read the properties of the event-map type at `location` and append each new
 * one to `emittedEvents`. Duplicate event names are skipped with a warning.
 */
export function collectEmittedEvents(
  checker: ts.TypeChecker,
  location: ts.Node,
  emittedEvents: EmittedEventInfo[],
  seenEmittedEvents: Set<string>,
  warnings: string[],
) {
  const eventMapType = checker.getTypeAtLocation(location);

  for (const symbol of eventMapType.getProperties()) {
    const eventName = symbol.getName();
    const eventType = checker.getTypeOfSymbolAtLocation(symbol, location);
    const argsType = normalizeTupleType(serializeType(checker, eventType));

    if (seenEmittedEvents.has(eventName)) {
      warnings.push(`Duplicate emitted event "${eventName}" - using first declaration`);
      continue;
    }

    seenEmittedEvents.add(eventName);
    emittedEvents.push({ key: eventName, argsType });
  }
}

/**
 * Rewrite the absolute `import("…")` paths TypeScript bakes into serialized
 * types so the generated bridge is portable: `node_modules` paths become bare
 * package specifiers, and local absolute paths become `.js` relative imports
 * from the output file's directory.
 */
export function makeRelativeImports(code: string, outFilePath: string) {
  const outDir = dirname(resolve(outFilePath));
  return code.replace(/import\("([^"]+)"/g, (match, importPath: string) => {
    const nodeModulesMatch = importPath.match(/node_modules[/\\](@[^/\\]+[/\\][^/\\]+|[^/\\]+)/);

    if (nodeModulesMatch) {
      return `import("${nodeModulesMatch[1].replace(/\\/g, "/")}"`;
    }

    if (!importPath.match(/^[A-Z]:|^\//i)) {
      return match;
    }

    let relativeImport = relative(outDir, importPath).replace(/\\/g, "/");
    if (!relativeImport.startsWith(".")) {
      relativeImport = `./${relativeImport}`;
    }
    if (!relativeImport.endsWith(".js") && !relativeImport.endsWith(".ts")) {
      relativeImport += ".js";
    }

    return `import("${relativeImport}"`;
  });
}
