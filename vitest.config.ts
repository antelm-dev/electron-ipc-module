import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    // The analyzer and CLI tests build a real TypeScript program, which is
    // seconds of work before coverage instrumentation and past the 5s default
    // after it. These are compiler-bound, not hang-prone.
    testTimeout: 20_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The CLI's entry-point guard runs only when the file is the process
      // entry, which is never true under vitest. Everything it guards is
      // covered through runCli directly.
      exclude: ["src/cli.ts"],
      reporter: ["text-summary", "lcov"],
      // A ratchet at the measured floor, not an aspiration: this exists to stop
      // coverage falling, and a threshold nobody can meet gets deleted rather
      // than met. Branches sit lowest because of ipc-bridge-analyzer.ts, now
      // the weakest file by some way. Raise these as that changes; never lower
      // them.
      thresholds: {
        statements: 90,
        branches: 78,
        functions: 96,
        lines: 93,
        // A project-wide floor cannot protect any one file: a regression in
        // the runtime hides inside an average that the analyzer's 55% branch
        // coverage already drags down. The guard matrix here is the
        // security-relevant path, so it holds its own floor, set well below
        // today's ~96% so ordinary edits do not trip it.
        "src/runtime/ipc-module.ts": {
          branches: 90,
          lines: 95,
        },
      },
    },
  },
});
