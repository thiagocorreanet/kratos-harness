import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: [
        "packages/runtime/src/cli.ts",
        "packages/runtime/src/handshake.ts",
        "packages/runtime/src/domain/**",
        "packages/runtime/src/composition/**",
        "packages/runtime/src/infra/schema/**",
      ],
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
