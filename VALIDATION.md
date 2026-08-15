# Kratos reconstruction validation

Validation date: 2026-08-15

## Passed

- `git diff --check`;
- parsing of all 57 JSON files under the workflow, distribution, fixture,
  package, quality, and schema roots;
- TypeScript syntax transformation for all 302 source and test files;
- JavaScript module syntax checks for all 27 repository `.mjs` files;
- parsing of all nine GitHub Actions workflow files;
- relative import resolution for every TypeScript source import;
- dependency-direction analysis of the inherited module graph with zero
  violations; the four new extension implementations are dependency-free pure
  domain modules behind one export-only index;
- English-only source enforcement;
- source and schema performance budgets (`768864 / 1500000` runtime bytes and
  `59338 / 250000` schema bytes);
- gate mutation sentinels: `3 / 3 (100.00%)`;
- model-evaluation calibration: all three known-good/bad samples classified as
  expected;
- frozen Go v3 public oracle manifest verification;
- compatibility inventory validation: 402 discovered keys and 400 matrix rows.
- dependency-free temporary builds for the Codex and Claude Code plugins;
- official host manifest layouts and plugin-relative skill bridges;
- black-box package verification for install, idempotent reinstall, handshake,
  project initialization, objective, start, and status on both hosts;
- explicit rejection of motor code, internal engine skills, dependency trees,
  TypeScript, and source maps in initialized projects;
- runtime benchmarks within budget: help `114.86 ms`, version `99.42 ms`,
  handshake `123.81 ms`, and runtime package `782817` bytes;
- confirmation that the Kratos source tree contains no generated `dist`
  directory.

The inherited compatibility matrix still reports `0 / 400 (0.00%)`. That is
the source snapshot's current differential evidence level and must not be
misrepresented as feature completion.

The matrix contains 378 `not_started` and 22 `in_progress` rows. The public
repository carries descriptions and hashes, not the private implementation or
executable oracle needed to finish those behaviors. The current GitHub
connection cannot read `betaup-sistemas/mestre-yoda` or
`betaup-sistemas/mestre-yoda-dist` at the frozen revisions.

## Environment-blocked checks

The exact `npm ci` step could not access the package registry in the execution
environment, and the required dependencies were not present in its local npm
cache. Ajv-backed checks were attempted and stopped with
`ERR_MODULE_NOT_FOUND: ajv`. Therefore these dependency-backed commands were
not completed here:

- ESLint and TypeScript semantic type checking;
- Vitest unit, property, integration, and coverage suites;
- Ajv-backed contract generation and result-contract checks;
- Prettier and cspell checks.

Run the complete verification sequence in an environment with package-registry
access before merging or distributing the reconstruction:

```bash
npm ci
npm run verify
```

No production-readiness or parity claim is made until that sequence, real host
and platform E2E, protected-release evidence, and the public-pilot gates pass.
