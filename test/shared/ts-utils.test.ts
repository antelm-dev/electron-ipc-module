import { describe, it, expect } from "vitest";

import { makeRelativeImports } from "../../src/shared/ts-utils.js";

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
