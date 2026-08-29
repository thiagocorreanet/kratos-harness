# Task 2 — Unified Candidate Capture Report

## Outcome

Implemented a single, pure candidate-capture decision for hook failures and
manual `memory capture <proposal.json>`. Candidate identity now uses
conservative normalization while persisted v1 records remain unchanged and are
scanned for in-memory normalized matches. Added read-only `memory list`.

## RED evidence

1. `npm test -- tests/workflow-hook-domain.test.ts`

   Result: **11 failures / 5 passes**. Every new volatile-boundary case failed
   with `TypeError: candidateNormalizationKey is not a function`, proving the
   requested identity API was absent.

2. `npm test -- tests/workflow-hook-runtime.test.ts`

   Result: **1 failure / 3 passes**. The new manual-capture test received exit
   code `2` instead of `0`, proving that `memory capture` was unregistered.

3. `npm test -- tests/workflow-hook-domain.test.ts`

   Result: **1 failure / 17 passes** after the first implementation. The
   substantive `limit 10:20:30` versus `limit 10:21:31` test deduplicated,
   exposing that the initial location matcher was too broad.

## GREEN evidence

- `npm test -- tests/workflow-hook-domain.test.ts tests/workflow-hook-runtime.test.ts tests/cli-commands.test.ts`
  - **3 files passed, 36 tests passed**.
- Fresh post-commit: `npm test -- tests/workflow-hook-domain.test.ts tests/workflow-hook-runtime.test.ts tests/cli-commands.test.ts tests/workflow-hook-distribution.test.ts tests/workflow-hooks-contracts.test.ts tests/schema-registry-fixtures.test.ts tests/cli-help.test.ts tests/memory-capture-distribution.test.ts`
  - **8 files passed, 312 tests passed**. Both independently built host packages
    execute manual capture with `PATH` empty and leave exactly one local
    candidate; no project command is available.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm run build` — passed; packages for both hosts were produced.
- `git diff --check` — passed.

## Changed files

- `packages/runtime/src/domain/hooks/index.ts`: normalized identity and shared
  capture decision.
- `packages/runtime/src/composition/memory.ts`: candidate-inbox/proposal
  observation and schema validation.
- `packages/runtime/src/composition/host.ts`, `packages/runtime/src/domain/cli/hook.ts`:
  hook capture now uses the shared decision and v1 inbox scan.
- `packages/runtime/src/domain/cli/memory.ts`, registry/spec/composition wiring:
  read-only list and manual capture commands.
- Focused domain, runtime, command, and packaged-distribution tests.

## Self-review

- Sanitization remains before persistence on both paths and preserves the
  existing 2 KiB diagnostic bound.
- Normalization removes only ANSI/control noise, whitespace variation, ISO-Z
  timestamps, UUIDs, temporary-path nonce suffixes, and source-file
  line/column locations. It keeps case, ordinary numbers, relative paths,
  commands, and test names significant.
- Neither command plans promotion or curated-ledger writes. `memory list`
  plans no effects.
- Capture code reads only the proposal/candidate inbox and uses injected
  digests/filesystem ports; it calls no model routing, Git, network, socket,
  or project-command boundary.

## Risks / non-Task-2 baseline issue

The complete `tests/runtime-distribution.test.ts` suite currently has two
pre-existing failures: the parameterized `binds the %s manifest to its runtime
and host` assertion at line 73 fails once for `codex` and once for
`claude-code`, because it expects `reasonCatalog: "1.8.0"`. The build emits
`"1.9.0"`, as required by `contract-families.v1.json`. This mismatch already
existed at base `ede0c31e67de15aaf90cc0c738cce17ccc4bc4be`: that commit has the
same line-73 expected `"1.8.0"`, while its catalogue already declares
`"1.9.0"`. It is outside Task 2 scope. The focused new packaged-capture test
passes. A concurrent worktree also uses the fixed
`/tmp/kratos-plugin-vitest-build` test output, which can race the legacy
runtime-distribution suite; the new test deliberately uses a unique temporary
build directory.

## Fix Round 1

### Scope

Hardened capture without expanding normalization beyond the approved volatile
categories. ANSI escapes are removed before controls; diagnostics are limited
to 2,048 UTF-8 bytes at Unicode-scalar boundaries; timestamps now include
offset forms; canonical UUIDs include v7/general forms; and temporary suffixes
include exactly six mixed-alphanumeric characters. Case, ordinary numbers,
relative paths, commands, test names, and letter-only temporary suffixes remain
significant.

### RED evidence

1. `npm test -- tests/workflow-hook-domain.test.ts`

   Result: **7 failures / 19 passes**. The failures covered offset timestamps,
   v7 UUIDs, six-character mixed temporary suffixes, sanitize-then-capture ANSI
   identity, both byte-limit cases, and matching a legacy v1 candidate whose ID
   predates normalized identity.

2. `npm test -- tests/workflow-hook-runtime.test.ts`

   Result: **1 failure / 5 passes**. An automatic hook candidate persisted 1,024
   emoji as 4,096 UTF-8 bytes rather than the 2,048-byte limit.

### GREEN evidence

- `npm test -- tests/workflow-hook-domain.test.ts tests/workflow-hook-runtime.test.ts tests/cli-commands.test.ts tests/workflow-hook-distribution.test.ts tests/workflow-hooks-contracts.test.ts tests/schema-registry-fixtures.test.ts tests/cli-help.test.ts tests/memory-capture-distribution.test.ts`
  - **8 files passed, 323 tests passed**.
- `npm run typecheck` — passed.
- `npm run lint` — passed.
- `npm run format:check` — passed.
- `npm run build` — passed; both host packages were produced.
- `git diff --check` — passed.

### Regression coverage

- The hook runtime now exercises an ANSI-coloured failure followed by its plain
  equivalent and leaves one candidate.
- Domain and runtime tests prove byte-bounded accented/emoji diagnostics for
  automatic and manual capture, without splitting Unicode scalars.
- Tests cover offset timestamps, v7 UUIDs, mixed temporary suffixes, and their
  conservative preservation boundaries.
- A persisted, schema-valid legacy v1 inbox record with a different candidate
  ID is matched in memory; invalid manual proposals are rejected; and capture
  and list still leave curated memory unpromoted.
