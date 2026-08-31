# Task 2 report: event-sourced attempt reducer

Date: 2026-08-30

## Outcome

Implemented the pure workflow-v2 event/reducer boundary for the repair-loop
stop-loss. A workflow-v2 start event freezes the resolved acceptance-attempt
ceiling and objective token ceiling. Acceptance decisions persist ordered
per-criterion attempt facts and digest-bound repair-stop references. Replay now
derives attempt counters, active stops, and selective resolutions from a mixed
workflow-v1/v2 event stream without rewriting historical event schemas.

## Implementation

- Added `state.event@1.2.0` with closed optional `runLimits`,
  `acceptanceDecision`, and `repairResolution` metadata.
- Added the immutable `state.repair-loop-stop@1.0.0` artifact contract. Full
  diagnoses remain in this artifact; events carry only the classification,
  attempt, artifact reference, and digest.
- Registered both schemas in the manifest, generated contract types, embedded
  schema catalog, compatibility surface, and typed schema registry.
- Added a pure repair-loop decision that:
  - validates positive safe-integer ceilings and prior attempts;
  - increments every failed criterion in document order;
  - requires one classified diagnosis for every criterion tripping the ceiling;
  - refuses missing, duplicate, invalid, or unexpected fault records; and
  - reports all simultaneous stops in document order.
- Added immutable repair-stop and acceptance-event metadata builders.
- Introduced `workflow-v2` alongside the readable `workflow-v1` reducer.
  Workflow-v2 freezes both limits on start, preserves attempts on pass/resume,
  returns below-ceiling rejection to code, blocks on stop-loss, and derives
  selective code resolution from events. Specification resolution remains
  recorded against the blocked source run with a required `nextRunId`; creating
  the new run is deliberately left to Task 3 composition.
- Extended safe draft snapshotting, semantic validation, sealing, event-chain
  verification, and event-store preparation for additive event v1.2 data while
  retaining v1.1 sealing/replay support.
- Updated current event producers (workflow, locks, and composition) to v1.2.
  Generic registered policies remain readable; workflow-v2-only metadata is
  rejected on other operations and policy versions.

## Files

Primary production files:

- `schemas/state/event.v1.2.schema.json`
- `schemas/state/repair-loop-stop.v1.schema.json`
- `packages/runtime/src/domain/repair-loop/{model,decision,artifact,index}.ts`
- `packages/runtime/src/domain/workflow/{model,decision,reducer,index}.ts`
- `packages/runtime/src/domain/events/{model,redaction,seal,semantics,index}.ts`
- `packages/runtime/src/composition/{events,index,locks}.ts`
- `packages/runtime/src/domain/locks/lifecycle.ts`
- `packages/runtime/src/domain/schema/contracts.ts`
- `packages/runtime/src/infra/schema/catalog.ts`
- `packages/contracts/catalogs/contract-families.v1.json`
- `packages/contracts/src/{compatibility,index}.ts`
- `packages/contracts/src/generated/contracts.ts`
- `packages/runtime/package.json`

Focused tests and fixtures:

- `tests/repair-loop.test.ts`
- `tests/repair-loop-contracts.test.ts`
- `tests/workflow-v2-decision.test.ts`
- `tests/workflow-v2-reducer.test.ts`
- `tests/workflow-v2-replay.test.ts`
- `fixtures/contracts/v1.2/event.json`
- `fixtures/contracts/v1/repair-loop-stop.json`

Existing event, reducer, schema-registry, contract, and configuration fixtures
were updated for the new current versions. The v1.4 configuration fixture and
lint-only cleanups close verification fallout from Task 1; they do not add Task
3 or Task 4 behavior.

## TDD evidence

### RED: pure repair-loop boundary

Command:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop.test.ts
```

Relevant output:

```text
FAIL  tests/repair-loop.test.ts
Error: Cannot find package '@kratos/runtime/domain/repair-loop'
Test Files  1 failed (1)
Tests  no tests
```

After the initial decision was implemented, the artifact/metadata behavior was
introduced with another focused RED using the same command:

```text
FAIL  tests/repair-loop.test.ts
TypeError: buildAcceptanceDecisionMetadata is not a function
Tests  1 failed | 5 passed (6)
```

GREEN:

```text
Test Files  1 passed (1)
Tests  6 passed (6)
```

### RED: workflow-v2 reducer and frozen limits

Command:

```text
npx --yes npm@11.16.0 test -- tests/workflow-v2-reducer.test.ts
```

Relevant output:

```text
Test Files  1 failed (1)
Tests  5 failed (5)
expected 'workflow-v1' to be 'workflow-v2'
Error: Unsupported workflow reason
TypeError: reduceWorkflowV1 is not a function
```

GREEN after the reducer implementation:

```text
Test Files  1 passed (1)
Tests  5 passed (5)
```

The selective-resolution case was then added to the next RED/GREEN cycle,
bringing this file to 6 passing tests.

### RED: persisted contracts and mixed replay

Command:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop-contracts.test.ts tests/workflow-v2-replay.test.ts
```

Relevant output:

```text
Test Files  2 failed (2)
Tests  4 failed | 1 passed (5)
Error: Embedded schema catalog is inconsistent
EventIntegrityError: invalid_event
```

The first schema compile exposed a strict-AJV defect and remained RED:

```text
strict mode: missing type "array" for keyword "minItems" at
"https://kratos.dev/schemas/state/event/v1.2#/allOf/0/then/properties/repairStops"
```

After correcting the conditional schema and registering the contracts:

```text
Test Files  2 passed (2)
Tests  5 passed (5)
```

### RED: event-producing decisions and repair resolution

Command:

```text
npx --yes npm@11.16.0 test -- tests/workflow-v2-decision.test.ts tests/workflow-v2-reducer.test.ts
```

Relevant output:

```text
Test Files  2 failed (2)
Tests  3 failed | 5 passed (8)
TypeError: decideRecordAcceptance is not a function
TypeError: decideResolveRepairStop is not a function
Error: Unsupported workflow reason
```

GREEN:

```text
Test Files  2 passed (2)
Tests  8 passed (8)
```

## Verification evidence

Required focused reducer/event/replay command:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop.test.ts tests/repair-loop-contracts.test.ts tests/workflow-v2-decision.test.ts tests/workflow-v2-reducer.test.ts tests/workflow-v2-replay.test.ts tests/workflow-state-machine.test.ts tests/event-reducer.test.ts tests/event-chain.test.ts tests/event-sealing.test.ts
```

```text
Test Files  9 passed (9)
Tests  148 passed (148)
```

Compatibility/property replay regression command:

```text
npx --yes npm@11.16.0 test -- tests/event-chain-properties.test.ts tests/event-chain.test.ts tests/event-reducer-properties.test.ts tests/event-reducer.test.ts
```

```text
Test Files  4 passed (4)
Tests  646 passed (646)
```

Contract/event-store regression command:

```text
npx --yes npm@11.16.0 test -- tests/contract-manifest.test.ts tests/contract-type-generation.test.ts tests/schema-catalog.test.ts tests/schema-registry-fixtures.test.ts tests/schema-registry-types.test.ts tests/event-store-preparation.test.ts
```

```text
Test Files  6 passed (6)
Tests  372 passed (372)
```

Contract generation/check:

```text
npx --yes npm@11.16.0 run contracts:check
contract families v1.0.0: verified (43 schemas; 14 legacy profiles; generated types current)
```

Static gates:

```text
npx --yes npm@11.16.0 run format:check
All matched files use Prettier code style!

npx --yes npm@11.16.0 run lint
exit 0

npx --yes npm@11.16.0 run typecheck
exit 0
```

Full suite after inventory updates:

```text
npx --yes npm@11.16.0 test
Test Files  197 passed (197)
Tests  4851 passed (4851)
Duration  582.66s
```

## Self-review

- Scope: no command surface, host adapter, prompt, gate composition, or atomic
  persistence orchestration was added.
- Compatibility: no pre-existing event or artifact schema file was modified;
  event v1.0/v1.1 remain readable and workflow-v1 retains empty repair state.
- Determinism: attempts and simultaneous stops follow criterion/event order;
  replay does not consult mutable configuration.
- Security: draft snapshotting rejects accessors, proxies, unexpected keys,
  sparse/oversized arrays, and non-plain nested values before schema validation.
- Privacy: diagnoses are absent from events and live in bounded immutable stop
  artifacts; event records contain only digest-bound references.
- Resolution: code resolution resets only the selected attempt and cannot
  release remaining active stops. Specification resolution records the target
  run but keeps the source run blocked, ready for Task 3's atomic new-run
  composition.
- Old bytes: historical schemas and golden event bytes were not rewritten.

## Concerns / follow-up boundary

- Task 3 must atomically persist the verdict, stop artifacts, event, and any
  specification-restart ticket/new run. This task intentionally supplies only
  the pure decision/event/reducer facts.
- Token exhaustion gating and public reason composition remain independent Task
  3 concerns; this reducer freezes the objective token ceiling but does not
  implement that gate.

---

## Correction round 1/5 — reviewer findings

This section appends to, and does not replace, the original Task 2 evidence.

### Scope ruling

The review exposed a real scope conflict: Task 2 had introduced concrete
`decideRecordAcceptance` and `decideResolveRepairStop` producers even though
atomic acceptance composition belongs to Task 3 and repair resolution/restart
belongs to Task 4. This correction removes those producers, their public
exports/transitions, the premature resolution reducer branch, and the focused
producer test file.

Task 2 now owns the strict passive boundary:

- the pure `decideRepairLoop` calculation and artifact/metadata builders;
- closed event v1.2 contracts and cross-field semantic validation;
- stateful replay validation against the run-frozen ceiling; and
- propagation of the already-observed project/objective limits into the
  existing run-start event.

Task 3 must call the pure decision and atomically compose the canonical
acceptance event/artifacts. Task 4 must introduce the repair resolution command
and reducer transition. Until then, no concrete Task 2 API can persist either
operation.

### Findings addressed

1. Acceptance replay is now statefully canonical. For every decision event,
   the reducer requires the acceptance phase, no active stop, a frozen positive
   ceiling, unique AC identifiers, and `attempt = prior + 1`. `repair` is
   permitted only below the ceiling. `stopped` requires exactly the tripping
   ACs, in attempt order, with the same attempt number and an artifact ref
   present in the event.
2. The real workflow start now receives the configuration-resolved
   `acceptanceAttemptCeiling` and objective `tokenBudget` from the workflow
   observation. Resumes ignore mutable current values; replay still reads only
   the original event.
3. Active workflow-v1 runs are explicitly refused by current start, continue,
   and fact-record decisions, and the v2 reducer refuses any non-start event
   before limits exist. Historical workflow-v1-only streams remain readable.
4. Task 3/4 producers and the Task 4 resolution reducer branch were removed.
5. The pure domain refuses unknown criterion outcomes and fault
   classifications at runtime.
6. Event semantics reject duplicate attempt/stop criterion IDs, mismatched
   stop attempts, out-of-order stop IDs, missing artifact refs, passed outcomes
   carrying attempts, and repair outcomes without attempts.

### Correction RED evidence

Initial correction matrix:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop.test.ts tests/workflow-v2-reducer.test.ts tests/workflow-v2-replay.test.ts tests/workflow-state-machine.test.ts tests/workflow-run-lineage.test.ts

Test Files  5 failed (5)
Tests  14 failed | 40 passed (54)
```

Relevant failures proved each reported defect:

```text
expected { kind: 'passed' } to deeply equal { kind: 'refused', reason: 'invalid-criterion' }
expected { kind: 'stopped' } to deeply equal { kind: 'refused', reason: 'invalid-fault' }
expected runLimits { acceptanceAttemptCeiling: 5, tokenCeiling: 4096 }
received runLimits { acceptanceAttemptCeiling: 3, tokenCeiling: null }
expected function to throw an error, but it didn't
```

Additional stateless semantic RED:

```text
npx --yes npm@11.16.0 test -- tests/workflow-v2-replay.test.ts

Test Files  1 failed (1)
Tests  2 failed | 7 passed (9)
```

The two failures were `passed` with a failed attempt and `repair` without a
failed attempt; both incorrectly sealed before the semantic fix.

Legacy fact-producer RED:

```text
npx --yes npm@11.16.0 test -- tests/workflow-state-machine.test.ts

Test Files  1 failed (1)
Tests  1 failed | 16 passed (17)
```

The failure showed `decideRecordFact` emitting a workflow-v2 event for a
workflow-v1 state with no frozen limits.

### Correction GREEN evidence

First focused GREEN:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop.test.ts tests/workflow-v2-reducer.test.ts tests/workflow-v2-replay.test.ts tests/workflow-state-machine.test.ts tests/workflow-run-lineage.test.ts

Test Files  5 passed (5)
Tests  54 passed (54)
```

Final focused regression:

```text
npx --yes npm@11.16.0 test -- tests/repair-loop.test.ts tests/repair-loop-contracts.test.ts tests/workflow-v2-reducer.test.ts tests/workflow-v2-replay.test.ts tests/workflow-state-machine.test.ts tests/workflow-run-lineage.test.ts tests/event-sealing.test.ts tests/event-chain.test.ts tests/event-reducer.test.ts tests/model-role-workflow.test.ts tests/cli-narrate.test.ts

Test Files  11 passed (11)
Tests  216 passed (216)
```

Static and contract gates:

```text
npx --yes npm@11.16.0 run format:check
All matched files use Prettier code style!

npx --yes npm@11.16.0 run lint
exit 0

npx --yes npm@11.16.0 run typecheck
exit 0

npx --yes npm@11.16.0 run contracts:check
contract families v1.0.0: verified (43 schemas; 14 legacy profiles; generated types current)
```

Full suite after the correction:

```text
npx --yes npm@11.16.0 test

Test Files  196 passed (196)
Tests  4862 passed (4862)
Duration  333.26s
```

### Correction files

- Runtime boundary: `packages/runtime/src/domain/repair-loop/{model,decision}.ts`
- Event/replay boundary: `packages/runtime/src/domain/events/semantics.ts` and
  `packages/runtime/src/domain/workflow/{decision,index,model,reducer}.ts`
- Start-limit propagation: `packages/runtime/src/composition/workflow.ts` and
  `packages/runtime/src/domain/cli/{spec,workflow}.ts`
- Regression coverage: `tests/{repair-loop,workflow-run-lineage,workflow-state-machine,workflow-v2-reducer,workflow-v2-replay}.test.ts`
- Fixture alignment: `tests/cli-narrate.test.ts`
- Removed as out of scope: `tests/workflow-v2-decision.test.ts`

### Correction self-review

- Stateful constraints that require prior attempts and the frozen ceiling are
  reducer-enforced; stateless cross-field inconsistencies are rejected during
  sealing. No producer was retained merely to duplicate Task 3 composition.
- Existing workflow-v1-only streams remain readable. A workflow-v2 continuation
  of a legacy run is rejected before it can invent missing frozen limits.
- The workflow start reads current limits only when no run exists. Once started,
  event replay remains the sole source for both ceilings.
- No prompt, gate, adapter, persistence transaction, resolution/restart command,
  or public command surface was introduced in this correction.

---

## Correction round 2/5 — remaining Important findings

This section appends to the prior implementation and correction evidence.

### Implementation and scope

- Removed the premature Task 4 `repairResolution` property and definition from
  `state.event@1.2.0`, regenerated the current contract type, and removed its
  draft-snapshot, freezing, and semantic-policy support. Consequently both the
  metadata and `sdd.repair.resolve:*` operation are rejected until Task 4 adds
  their contract, reducer, and atomic composition together.
- Replaced the workflow observation's unconditional numeric attempt ceiling
  with a discriminated `resolved`/`refused` observation. Only a validated
  configuration supplies a number; `classifyConfiguration` remains the sole
  place where an omitted valid field resolves to 3.
- Made `startCommand` return the original configuration refusal, with no event
  plan, for missing, corrupt, migration-required, invalid-version, or
  unsupported-version configuration observations.
- Preserved the accepted Task 2 reducer/semantic invariants and did not add any
  Task 3 producer or Task 4 resolution behavior.

### Files

- `schemas/state/event.v1.2.schema.json`
- `packages/contracts/src/generated/contracts.ts`
- `packages/runtime/src/composition/{events,workflow}.ts`
- `packages/runtime/src/domain/cli/{spec,workflow}.ts`
- `packages/runtime/src/domain/events/{redaction,semantics}.ts`
- `tests/{cli-narrate,workflow-run-lineage,workflow-v2-replay}.test.ts`
- Full-suite fixture alignment:
  `tests/{cli-composition,model-role-workflow}.test.ts`

### RED evidence

Premature Task 4 event sealing:

```text
npx --yes npm@11.16.0 test -- tests/workflow-v2-replay.test.ts

Test Files  1 failed (1)
Tests  1 failed | 9 passed (10)
AssertionError: expected function to throw an error, but it didn't
```

Fail-open project configuration observation:

```text
npx --yes npm@11.16.0 test -- tests/workflow-run-lineage.test.ts

Test Files  1 failed (1)
Tests  3 failed | 14 passed (17)
AssertionError: expected +0 not to be +0
```

The three failures were configuration `missing`, `corrupt`, and
`migration-required`; all incorrectly started a run with exit code 0.

### GREEN evidence

Contract/event boundary after removing Task 4 metadata:

```text
npx --yes npm@11.16.0 test -- tests/workflow-v2-replay.test.ts tests/event-sealing.test.ts

Test Files  2 passed (2)
Tests  86 passed (86)
```

Fail-closed start behavior, including the positive omitted-field default:

```text
npx --yes npm@11.16.0 test -- tests/workflow-run-lineage.test.ts

Test Files  1 passed (1)
Tests  17 passed (17)
```

Final focused matrix:

```text
npx --yes npm@11.16.0 test -- tests/workflow-v2-replay.test.ts tests/workflow-v2-reducer.test.ts tests/workflow-run-lineage.test.ts tests/event-sealing.test.ts tests/event-chain.test.ts tests/repair-loop-contracts.test.ts tests/contract-schemas.test.ts tests/schema-registry-fixtures.test.ts tests/cli-narrate.test.ts tests/project-configuration.test.ts

Test Files  10 passed (10)
Tests  484 passed (484)
Duration  10.06s
```

Static and contract gates:

```text
npx --yes npm@11.16.0 run format:check
All matched files use Prettier code style!

npx --yes npm@11.16.0 run lint
exit 0

npx --yes npm@11.16.0 run typecheck
exit 0

npx --yes npm@11.16.0 run contracts:check
contract families v1.0.0: verified (43 schemas; 14 legacy profiles; generated types current)
```

Full suite after correction round 2:

```text
npx --yes npm@11.16.0 test

Test Files  196 passed (196)
Tests  4867 passed (4867)
Duration  465.51s
```

The first full-suite run exposed three expectation/fixture regressions:

```text
npx --yes npm@11.16.0 test

Test Files  2 failed | 194 passed (196)
Tests  3 failed | 4864 passed (4867)
Duration  312.67s
```

They reproduced in isolation:

```text
npx --yes npm@11.16.0 test -- tests/cli-composition.test.ts tests/model-role-workflow.test.ts

Test Files  2 failed (2)
Tests  3 failed | 67 passed (70)
```

The two composition assertions expected the old `trail.uso` result from a
runtime with no configuration, while the corrected fail-closed boundary now
reports `guard.config_missing`. The model-role fixture installed legacy bytes
before creating its run, so the corrected start gate stopped setup itself.
Expectations were aligned with the required reason, and the legacy handoff
fixture now starts from valid bytes and installs legacy bytes only after the
run exists. No production behavior was relaxed.

```text
npx --yes npm@11.16.0 test -- tests/cli-composition.test.ts tests/model-role-workflow.test.ts

Test Files  2 passed (2)
Tests  70 passed (70)
```

### Self-review

- Contract consistency: no current generated type or runtime branch accepts
  `repairResolution`; the only remaining spellings are the negative sealing
  fixture that proves rejection.
- Fail-closed behavior: no refusal is converted to a numeric ceiling. The
  start command emits no event for each negative configuration class tested.
- Default provenance: the positive integration test verifies the persisted
  valid configuration truly omits the field before the start event freezes 3.
- Compatibility: historical event schemas were untouched; this correction
  changes only the Task 2-introduced current v1.2 schema before Task 4 exists.
