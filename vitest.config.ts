import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        // `build.mjs` rewrites the `ajv/dist/2020.js` import inside
        // `infra/schema/registry.ts` to this offline subset, and only in the
        // built bundle. In process the registry compiles against the real
        // `ajv`, so no in-process test can reach this file: its behaviour is
        // owned by the suites that run the built plugin
        // (`bundle-smoke`, `runtime-preflight`, `schema-registry`,
        // `package-verifier`). Measuring it here can only ever report zero.
        "packages/runtime/src/infra/schema/simple-ajv.ts",
      ],
      include: [
        "packages/runtime/src/cli.ts",
        "packages/runtime/src/handshake.ts",
        "packages/runtime/src/domain/**",
        "packages/runtime/src/composition/**",
        "packages/runtime/src/infra/schema/**",
      ],
      provider: "v8",
      reporter: ["text", "json-summary"],
      // These are a ratchet, not a target. The 100% bar was written for the
      // initial CLI decision surface — `cli.ts` and `handshake.ts`, the first
      // two entries above — and the `domain`, `composition`, and schema globs
      // were added as the runtime grew without the in-process suites keeping
      // pace. 92 of the 121 measured files are at 100%; the shortfall is
      // concentrated in the command surface and its composition wiring, and
      // it is real test debt rather than an artefact of the instrument.
      // Recorded 2026-08-16 at the measured floor so the set cannot regress.
      // Raise each number as the gap closes; never lower one to pass.
      thresholds: {
        branches: 85,
        functions: 90,
        lines: 90,
        statements: 91,
      },
    },
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
  },
});
