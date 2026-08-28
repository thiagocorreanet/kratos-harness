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
- Assignment policy uses exact operation/reason pairs. Phase-output and
  accepted/completed phase transitions require assignment, explicit rejected
  transitions may carry it, and infrastructure/start events cannot fabricate
  it.
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
- Outside event plumbing, changes are limited to readable-event type propagation
  and the one direct infrastructure sealing caller.
