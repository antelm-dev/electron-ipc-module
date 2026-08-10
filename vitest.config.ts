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
      // than met. Branches sit lowest because ipc-bridge-analyzer.ts and the
      // authorize/validate/eventPrefix matrix in ipc-module.ts have many
      // untaken paths. Raise these as that changes; never lower them.
      thresholds: {
        statements: 87,
        branches: 72,
        functions: 94,
        lines: 90,
      },
    },
  },
});
