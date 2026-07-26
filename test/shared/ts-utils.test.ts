import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { createTsProgram, makeRelativeImports } from "../../src/shared/ts-utils.js";

function writeTempProject(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "ipc-ts-utils-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    mkdirSync(join(absolutePath, ".."), { recursive: true });
    writeFileSync(absolutePath, contents, "utf-8");
  }
  return root;
}

describe("createTsProgram", () => {
  it("builds a program from a valid tsconfig", () => {
    const root = writeTempProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
        include: ["src/**/*.ts"],
      }),
      "src/index.ts": "export const value = 1;\n",
    });

    const program = createTsProgram(join(root, "tsconfig.json"));
    expect(program.getSourceFiles().some((file) => file.fileName.endsWith("index.ts"))).toBe(true);
  });

  it("fails on invalid tsconfig JSON", () => {
    const root = writeTempProject({
      "tsconfig.json": "{ invalid json",
    });

    expect(() => createTsProgram(join(root, "tsconfig.json"))).toThrow(/TypeScript failed/);
  });

  it("fails on syntactic diagnostics", () => {
    const root = writeTempProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
        include: ["src/**/*.ts"],
      }),
      "src/broken.ts": "export const value = ;\n",
    });

    expect(() => createTsProgram(join(root, "tsconfig.json"))).toThrow(/TypeScript failed/);
  });

  it("fails on semantic diagnostics", () => {
    const root = writeTempProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, skipLibCheck: true },
        include: ["src/**/*.ts"],
      }),
      "src/broken.ts": "export const value: string = 1;\n",
    });

    expect(() => createTsProgram(join(root, "tsconfig.json"))).toThrow(/TypeScript failed/);
  });
});

describe("makeRelativeImports", () => {
  it("rewrites absolute paths relative to outFile", () => {
    const outFile = "C:/project/src/generated/bridge.ts";
    const code = 'type X = import("C:/project/src/runtime/ipc-module.ts").Foo;';

    expect(makeRelativeImports(code, outFile)).toBe(
      'type X = import("../runtime/ipc-module.ts").Foo;',
    );
  });

  it("appends .js to extensionless absolute imports", () => {
    const outFile = "C:/project/src/generated/bridge.ts";
    const code = 'type X = import("C:/project/src/runtime/ipc-module").Foo;';

    expect(makeRelativeImports(code, outFile)).toBe(
      'type X = import("../runtime/ipc-module.js").Foo;',
    );
  });

  it("shortens node_modules imports to package names", () => {
    const outFile = "C:/project/src/generated/bridge.ts";
    const code = 'type X = import("C:/project/node_modules/electron/electron.d.ts").IpcRenderer;';

    expect(makeRelativeImports(code, outFile)).toBe('type X = import("electron").IpcRenderer;');
  });

  it("shortens scoped node_modules imports", () => {
    const outFile = "C:/project/dist/generated/bridge.ts";
    const code = 'type X = import("C:/project/node_modules/@scope/pkg/index.d.ts").Thing;';

    expect(makeRelativeImports(code, outFile)).toBe('type X = import("@scope/pkg").Thing;');
  });

  it("leaves non-absolute import paths unchanged", () => {
    const code = 'type X = import("./local-module").Local;';

    expect(makeRelativeImports(code, "C:/project/out/bridge.ts")).toBe(code);
  });
});
