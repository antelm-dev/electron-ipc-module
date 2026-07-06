import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import ts from "typescript";

import type { EmittedEventInfo } from "./types/bridge.js";

/** Type-to-string flags: never truncate, and keep fully-qualified names. */
export const SERIALIZE_FLAGS =
  ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType;

/** Build a TypeScript program from a tsconfig path, resolving its file list. */
export function createTsProgram(tsconfigPath: string) {
  const abs = resolve(tsconfigPath);
  const configFile = ts.readConfigFile(abs, (filePath) => readFileSync(filePath, "utf-8"));
  const basePath = dirname(abs);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, basePath);
  return ts.createProgram(parsed.fileNames, parsed.options);
}

/** Depth-first search for the first call expression to `fnName(...)`. */
export function findCallTo(node: ts.Node, fnName: string): ts.CallExpression | undefined {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === fnName
  ) {
    return node;
  }

  let found: ts.CallExpression | undefined;
  ts.forEachChild(node, (child) => {
    found ??= findCallTo(child, fnName);
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

/** Return the underlying `fnName(...)` call if `expression` is one, else `undefined`. */
export function getCallToIdentifier(expression: ts.Expression, fnName: string) {
  const unwrapped = unwrapExpression(expression);

  if (
    ts.isCallExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === fnName
  ) {
    return unwrapped;
  }

  return undefined;
}

/** Whether `expression` is a call to `fnName(...)` (after unwrapping). */
export function isCallToIdentifier(expression: ts.Expression, fnName: string) {
  return Boolean(getCallToIdentifier(expression, fnName));
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
