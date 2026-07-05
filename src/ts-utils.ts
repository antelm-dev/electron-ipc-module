import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import ts from "typescript";

import type { EmittedEventInfo } from "./types.js";

export const SERIALIZE_FLAGS =
  ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType;

export function createTsProgram(tsconfigPath: string) {
  const abs = resolve(tsconfigPath);
  const configFile = ts.readConfigFile(abs, (filePath) =>
    readFileSync(filePath, "utf-8"),
  );
  const basePath = dirname(abs);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    basePath,
  );
  return ts.createProgram(parsed.fileNames, parsed.options);
}

export function findCallTo(
  node: ts.Node,
  fnName: string,
): ts.CallExpression | undefined {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === fnName
  ) {
    return node;
  }

  let found: ts.CallExpression | undefined;
  ts.forEachChild(node, (child) => {
    if (!found) {
      found = findCallTo(child, fnName);
    }
  });
  return found;
}

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

export function isCallToIdentifier(expression: ts.Expression, fnName: string) {
  return Boolean(getCallToIdentifier(expression, fnName));
}

export function unwrapAwaitedType(checker: ts.TypeChecker, type: ts.Type): ts.Type {
  if (type.isUnion()) {
    const promiseMember = type.types.find((candidate) => {
      const symbol = candidate.getSymbol();
      return symbol && symbol.getName() === "Promise";
    });

    if (promiseMember) {
      const typeArguments = checker.getTypeArguments(
        promiseMember as ts.TypeReference,
      );
      return typeArguments.length > 0 ? typeArguments[0] : type;
    }
  }

  const symbol = type.getSymbol();
  if (symbol && symbol.getName() === "Promise") {
    const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
    return typeArguments.length > 0 ? typeArguments[0] : type;
  }

  return type;
}

export function serializeType(checker: ts.TypeChecker, type: ts.Type) {
  return checker.typeToString(type, undefined, SERIALIZE_FLAGS);
}

export function normalizeTupleType(typeStr: string) {
  const normalized = typeStr.replace(/^readonly\s+/, "");
  return normalized === "[]" ? null : normalized;
}

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
      warnings.push(
        `Duplicate emitted event "${eventName}" - using first declaration`,
      );
      continue;
    }

    seenEmittedEvents.add(eventName);
    emittedEvents.push({ key: eventName, argsType });
  }
}

export function makeRelativeImports(code: string, outFilePath: string) {
  const outDir = dirname(resolve(outFilePath));
  return code.replace(/import\("([^"]+)"/g, (match, importPath: string) => {
    const nodeModulesMatch = importPath.match(
      /node_modules[/\\](@[^/\\]+[/\\][^/\\]+|[^/\\]+)/,
    );

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
