# Task 1 Report: Configuration and Token-Ceiling Contracts

## Status

Implemented Task 1's configuration and objective contracts. Workflow event and
reducer freezing remain deliberately out of scope for Task 2.

## Implementation

- Added immutable additive `1.4.0` project-config and init-answers schemas.
  `acceptanceAttemptCeiling` is an optional positive integer; init answers also
  accept `null` to clear the override.
- Advanced the contract manifest, embedded schema catalog, generated
  declarations, compatibility windows, and schema type unions to `1.4.0`.
- Initialization now sets a supplied ceiling, clears on `null`, and preserves
  an existing value when omitted. Newly generated configuration remains
  optional when no override is set.
- Project configuration classification requires migration for `1.3.0` and
  resolves an omitted current configuration ceiling to the executable default
  of `3` without changing persisted bytes.
- Added the `objective --token-ceiling <positive-integer>` contract and stores
  it as `objective.budget.tokens`; no default token budget is written.
- Added the explicit `1.3.0 -> 1.4.0` migration, preserving source backup
  bytes and historical event/snapshot bytes.

## Files

- New schemas: `schemas/host/init-answers.v1.4.schema.json`,
  `schemas/state/project-config.v1.4.schema.json`.
- Contract manifest/catalog/generated declarations and compatibility/type
  exports under `packages/contracts` and `packages/runtime/src/infra/schema`.
- Initialization, configuration, objective, migration, and dependent typed
  configuration consumers under `packages/runtime/src`.
- Focused behavior, contract-manifest, schema-catalog/type, initialization, and
  migration tests under `tests/`.

## TDD Evidence

### RED

```bash
npx --yes npm@11.16.0 run test -- tests/init-answers.test.ts tests/project-configuration.test.ts tests/objective-command.test.ts tests/config-migration.test.ts
```

Exit `1`, with the four expected missing-behavior failures:

- `init-answers`: expected resolved set/clear/preserve ceiling, received invalid.
- `project-configuration`: expected a valid `1.4.0` project schema, received invalid.
- `objective-command`: `--token-ceiling` was unrecognized and returned exit `2`.
- `config-migration`: `1.3.0` was reported as already current, so no migration authorization existed.

### GREEN

```bash
npx --yes npm@11.16.0 run contracts:generate
npx --yes npm@11.16.0 run typecheck
npx --yes npm@11.16.0 run test -- tests/init-answers.test.ts tests/project-configuration.test.ts tests/objective-command.test.ts tests/config-migration.test.ts tests/contract-compatibility.test.ts tests/contract-manifest.test.ts tests/schema-catalog.test.ts tests/contract-schemas.test.ts tests/schema-registry-types.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts
npx --yes npm@11.16.0 run contracts:check
npx --yes npm@11.16.0 run format:check
git diff --check
```

Outputs:

- `typecheck`: exit `0`.
- Focused Vitest: `11 passed`, `257 passed` assertions.
- `contracts:check`: `contract families v1.0.0: verified (41 schemas; 14 legacy profiles; generated types current)`.
- `format:check`: `All matched files use Prettier code style!`.
- `git diff --check`: exit `0`.

## Self-review

- Predecessor `1.3.0` schemas were not modified; the new revision is additive.
- The migration test asserts exact backup preservation plus unchanged historical
  event and snapshot bytes.
- The ceiling is defaulted in resolved runtime configuration only; it is not
  silently serialized into an unset project config.
- Token budgets are validated positive integers and remain optional until the
  objective command declares one.
- No workflow event/reducer stop-loss behavior was added.

## Concern

The run-frozen consumption of `objective.budget.tokens` is intentionally
deferred to Task 2, as required by this task boundary.

## Fix round 1: safe integer ceilings

Both new `1.4.0` schemas now reject ceiling values beyond JavaScript's exact
integer range. This prevents a parsed JSON value from being silently rounded
before it becomes the resolved or later frozen ceiling.

### RED

```bash
npx --yes npm@11.16.0 run test -- tests/init-answers.test.ts tests/project-configuration.test.ts
```

Exit `1`: the two new unsafe-integer assertions expected `{ kind: "invalid" }`
but received valid/resolved results. Vitest reported `2 failed`, `39 passed`.

### Implementation

- Added `maximum: 9007199254740991` to
  `schemas/host/init-answers.v1.4.schema.json` and
  `schemas/state/project-config.v1.4.schema.json`.
- Added focused init-answer and project-configuration rejection tests using
  `Number.MAX_SAFE_INTEGER + 1`.
- Regenerated contract declarations so their schema hashes match the amended
  contracts.

### GREEN

```bash
npx --yes npm@11.16.0 exec -- prettier --write --log-level warn schemas/host/init-answers.v1.4.schema.json schemas/state/project-config.v1.4.schema.json tests/init-answers.test.ts tests/project-configuration.test.ts
npx --yes npm@11.16.0 run contracts:generate
npx --yes npm@11.16.0 run test -- tests/init-answers.test.ts tests/project-configuration.test.ts
npx --yes npm@11.16.0 run contracts:check
npx --yes npm@11.16.0 run typecheck
npx --yes npm@11.16.0 run format:check
git diff --check
```

Outputs:

- Focused Vitest: `2 passed`, `41 passed` assertions.
- `contracts:check`: `contract families v1.0.0: verified (41 schemas; 14 legacy profiles; generated types current)`.
- `typecheck`, `format:check`, and `git diff --check`: exit `0`.
