# Task 5 Runtime Fix Report

Date: 2026-08-30
Status: COMPLETE

## Scope delivered

- Changed initialization planning so `.brain/03-memory/task_log.jsonl` and
  `.brain/03-memory/task_metrics.md` are create-once destinations: init writes
  their deterministic seed only when absent and omits writes when either file
  already exists.
- Added a missing-file precondition to first creation, preventing init from
  overwriting a measurement artifact created after observation.
- Preserved the existing managed-instruction policy: re-init still replaces
  the generated section while retaining project-owned bytes outside the
  markers.
- Added direct lifecycle evidence that one over-budget runtime-measured phase
  atomically persists numeric phase usage, numeric run usage, the
  runtime-resolved assignment, and a latched exhausted stop-loss gate.
- No measurement or workflow production change was needed; the new lifecycle
  integration passed against the existing linkage on its first run.

## Root cause

Initialization already observed each destination, but the decision treated
every non-instruction file as replaceable generated content. A re-init plan
therefore carried the empty raw-log seed and initial rollup bytes into the
transaction, which normalized them as updates whenever measured content was
present.

The fix uses the existing destination observation in the init decision. An
observed file at either create-once destination is classified as preserved and
excluded from the effect plan; an absent destination receives the normal seed
write with a `missing` precondition. No host-specific filesystem logic was
added.

## RED evidence

Command:

```text
npx --yes npm@11.16.0 test -- --run tests/init-command.test.ts -t "creates measurement artifacts once"
```

Observed result before the production change:

```text
Test Files  1 failed (1)
Tests       1 failed | 27 skipped (28)
AssertionError: expected '' to be '{"measured":"raw bytes"}\r\n'
```

The command completed successfully but re-init replaced the sentinel raw-log
bytes with the skeleton's empty seed. The same regression also asserts exact
rollup preservation and that a stale managed instruction section is refreshed
without changing its project-owned prefix.

## Direct lifecycle evidence

Command run before any measurement/workflow production change:

```text
npx --yes npm@11.16.0 test -- --run tests/phase-measurement-runtime.test.ts -t "closes an over-budget measured phase"
```

Observed result:

```text
Test Files  1 passed (1)
Tests       1 passed | 13 skipped (14)
```

The test starts a phase from the runtime handoff assignment, records a
125-token session end against an explicit 100-token objective budget, and
asserts one durable interrupted measurement with numeric final/gross usage,
numeric run usage with `exhaustedAt`, and `stopLoss.exhausted: true`.

## GREEN evidence

Focused init regression:

```text
npx --yes npm@11.16.0 test -- --run tests/init-command.test.ts -t "creates measurement artifacts once"
```

Observed result:

```text
Test Files  1 passed (1)
Tests       1 passed | 27 skipped (28)
```

Covering init, measurement, and workflow suites:

```text
npx --yes npm@11.16.0 test -- --run tests/init-command.test.ts tests/init-managed-section.test.ts tests/init-skeleton.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/workflow-hook-runtime.test.ts tests/workflow-hook-domain.test.ts
```

Observed result:

```text
Test Files  7 passed (7)
Tests       102 passed (102)
```

Additional gates:

```text
npx --yes npm@11.16.0 run typecheck
> tsc6 --noEmit
exit 0

npx --yes npm@11.16.0 run lint
> eslint . --max-warnings 0
exit 0

npx --yes npm@11.16.0 run format:check
All matched files use Prettier code style!
exit 0

git diff --check
exit 0
```

## Concerns

- None. Host relay behavior remains outside this fix.
