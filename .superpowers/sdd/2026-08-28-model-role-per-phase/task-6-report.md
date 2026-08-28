# Task 6 Report: Verify and replay mixed-version event chains

## Status

Completed. Event streams now validate each record at its exact declared state
contract, verify one continuous hash chain across event 1.0 and 1.1, and replay
both revisions through the existing reducer policies. New seals emit only 1.1.

## Delivered

- Added runtime `ReadableEvent` and `CurrentEventDraft` surfaces. JSON Lines are
  parsed inertly before `stateContract` selects the exact schema revision; no
  family maximum participates in dispatch.
- Current draft snapshotting copies nullable observed effort and all resolved
  assignment fields before hashing. Sealing rejects legacy drafts and emits a
  validated `EventV1_1`.
- Assignment policy uses exact operation/reason/event-type/effect tuples.
  Phase-output and accepted/completed phase transitions require assignment;
  rejected, recovery, infrastructure, start, gap, and gate facts forbid it.
- Verification, opaque verified streams, reducers, event-store append, workflow
  observation, diagnostics, and evidence views accept readable mixed history
  without treating audit metadata as transition authority.
- Lease lifecycle events, the direct infrastructure caller of sealing, now emit
  1.1 with `effort: null` and no resolved assignment.
- Added a committed 1.1 golden vector, deterministic alternating-version
  properties, hostile per-line revision cases, per-field metadata corruption,
  mixed reducer replay, and an append test proving the old line is retained
  byte-for-byte.

## TDD evidence

### RED

The first focused run added the mixed-chain and metadata-integrity cases before
production changes:

```text
npm test -- tests/event-chain.test.ts -t "one hash chain|covers resolved"
Test Files 1 failed
Tests 2 failed | 23 skipped
Both failures: EventIntegrityError from snapshotEventDraft
```

This was the expected break: legacy draft redaction rejected the 1.1 observed
effort and resolved assignment before sealing.

### GREEN

After the minimal event-layer implementation, the focused cases passed, then
the final required and impacted suites passed:

```text
npm test -- tests/event-sealing.test.ts tests/event-chain.test.ts \
  tests/event-reducer.test.ts tests/event-store-preparation.test.ts \
  tests/event-chain-properties.test.ts tests/event-store-transaction.test.ts \
  tests/event-store-corruption.test.ts tests/event-store-fault-campaign.test.ts \
  tests/node-event-store.test.ts tests/lock-lifecycle.test.ts \
  tests/lock-model.test.ts tests/lock-service.test.ts \
  tests/locks-contract.test.ts tests/transaction-lease-guard.test.ts
Test Files 14 passed
Tests 858 passed
```

The generated corruption suite contributes 594 deterministic cases, including
random version alternation and individual corruption of observed effort plus
all four resolved assignment scalars.

## Legacy fixture evidence

The committed v1 fixture was not modified:

```text
working tree SHA-256: 25e6c1823f5c5dd2658a663acf6abbb69e3707348a694482d0796b67bdb619c7
HEAD fixture SHA-256: 25e6c1823f5c5dd2658a663acf6abbb69e3707348a694482d0796b67bdb619c7
canonical event hash: c6f58e1d3427cfee3331856b509b0bbbc67b5d4d8cc3549ed026029fb47826b1
```

The mixed append test additionally asserts that the exact legacy canonical
line remains the prefix of the newly prepared stream.

## Quality gates

```text
npm run typecheck
exit 0

npm run lint
exit 0

Prettier check for every changed file and the new fixture
All matched files use Prettier code style!

git diff --check
exit 0
```

The repository-wide `npm run format:check` was also attempted; its only
findings were two pre-existing, untouched files (`tests/model-role-resolution.test.ts`
and `tests/support/model-routing.ts`). They were left unchanged to keep this
task scoped. All Task 6 files pass Prettier.

## Self-review

- Exact version dispatch is recorded by a registry-spy test as `1.0.0`, then
  `1.1.0`, for adjacent records.
- Old events are never resealed, migrated, or canonicalized into new bytes.
- Every new metadata scalar participates in the stored hash and tampering is
  rejected before replay.
- Reducers still branch only on their existing workflow facts; metadata is
  available as immutable audit history but grants no transition authority.
- Outside event plumbing, changes are limited to readable-event type
  propagation and the minimum workflow/CLI producer plumbing required to pass
  already-observed assignments into current event drafts.

## Review fix round 1/5

### RED

The review findings were reproduced before their implementation fixes:

```text
workflow producer cases: 5 failed
- start/gaps/gates drafts were rejected by snapshotEventDraft
- accepted and agent-output facts could not carry the resolved assignment
- missing required assignments did not fail closed

forged workflow semantics: 2 failed
- eventType and effect mutations sealed successfully

hostile inherited stateContract getter: 1 failed
- getterCalls was 1 instead of 0

reducer type fixture:
- typecheck reported an unused @ts-expect-error because the bivariance hack
  still admitted an EventV1-only callback

forged lock/recovery semantics: 2 failed
- eventType and effect mutations sealed successfully
```

### Fix

- Start, resume, rejection, gaps, gates, and lock infrastructure now emit 1.1
  observed identity with nullable effort and no assignment.
- Accepted/completed transitions and `agent.record` receive only the assignment
  already resolved in the Task 5 command observation. If it is unavailable,
  the decision refuses before constructing an append effect; no assignment is
  inferred or fabricated.
- One shared fact table binds workflow and lock operation families to their
  exact reason, event type, effect, and assignment requirement before hashing.
  Workflow and lock producers consume the same constants as the validator.
- Reducer callbacks now accept `ReadableEvent` invariantly, and built-in
  reducers use common fields without narrowing to the legacy revision.
- Exact contract dispatch reads only an own data-property descriptor from the
  inert JSON object. It never invokes inherited or accessor properties.
- Actual workflow, agent, gaps, and gates command fixtures now use the current
  initialization contract and observed launcher host, so they exercise
  snapshot, seal, append, verify, and replay end to end.

### GREEN

```text
focused review tests:
Test Files 5 passed
Tests 177 passed

workflow/agent/gaps/gates command suites:
Test Files 3 passed
Tests 43 passed

required event, workflow, CLI, and lock matrix:
Test Files 24 passed
Tests 1661 passed

npm run lint
exit 0

npm run typecheck
exit 0

Task 6 changed/new files: Prettier clean
git diff --check
exit 0
```

The repository-wide Prettier check still reports only the same two untouched
pre-existing files: `tests/model-role-resolution.test.ts` and
`tests/support/model-routing.ts`.

### Legacy fixture recheck

```text
working tree SHA-256: 25e6c1823f5c5dd2658a663acf6abbb69e3707348a694482d0796b67bdb619c7
HEAD fixture SHA-256: 25e6c1823f5c5dd2658a663acf6abbb69e3707348a694482d0796b67bdb619c7
canonical event hash: c6f58e1d3427cfee3331856b509b0bbbc67b5d4d8cc3549ed026029fb47826b1
```

## Review fix round 2/5

### RED

An independently-authored literal matrix exercised the sealing boundary rather
than importing the production policy table. The first run reproduced five
operation-family bypasses:

```text
npm test -- tests/event-sealing.test.ts -t "literal semantic matrix"
Test Files 1 failed
Tests 5 failed | 6 passed | 59 skipped

unexpectedly sealed:
- sdd.continue:* with an unknown reason and fallback tuple
- sdd.agent.record:* with an unknown reason and fallback tuple
- sdd.gaps.record:* with an unknown reason and fallback tuple
- malformed lock.acquire:* with an unknown reason and fallback tuple
- unreserved infrastructure with transition/artifact instead of the fallback
```

The same table also proved that swapped known reasons/effects were already
rejected, that the intended unreserved `operation/state` fallback succeeds
without assignment, and that assignment on the fallback is rejected.
An additional fallback case was then observed RED (1 failed) when an
unreserved operation borrowed `run.started`; it now fails closed so fallback
records cannot acquire workflow reducer meaning.

### Fix

- Semantic dispatch now classifies the reserved namespace from the operation
  first. Every `sdd.*` operation must parse as one exact start, continue,
  agent, gap, or gate operation; every `lock.*` operation must parse as one
  exact lifecycle operation.
- The selected operation family has a closed list of complete reason,
  event-type, effect, and assignment tuples. Exactly one tuple must match.
  Unknown reasons, malformed operations, borrowed reasons, and multi-field
  swaps all fail before canonical hashing.
- Unreserved operations have one explicit fallback: event type `operation`,
  effect `state`, no resolved assignment, and no reserved workflow reason.
- Generic event-store test fixtures now identify themselves as
  `runtime.test:*` infrastructure operations instead of impersonating
  undefined `sdd.step-*` transitions.

### GREEN

```text
literal semantic matrix:
Test Files 1 passed
Tests 12 passed | 59 skipped

event sealing/chain/reducer/store suites:
Test Files 10 passed
Tests 873 passed

actual workflow/agent/gap/gate/lock producers plus composition:
Test Files 16 passed
Tests 892 passed

final consolidated event and producer gate:
Test Files 26 passed
Tests 1766 passed

npm run lint
exit 0

npm run typecheck
exit 0

all round 2 changed files: Prettier clean
git diff --check
exit 0
```

The repository-wide Prettier check continues to name only the two untouched
pre-existing files recorded in round 1.
