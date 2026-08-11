# Task 4 Report: Event-Store Append Preparation

## Scope

Implemented read-only preparation of one run-scoped event append in
`composition/events`. The preparation derives the two fixed destinations,
captures both pre-read fingerprints, verifies persisted stream and snapshot
binding, seals the next event, replays the extended stream, and returns exactly
two `write_file` effects.

## TDD Evidence

The initial focused test was written before the composition module existed.

```text
npx vitest run tests/event-store-preparation.test.ts
FAIL: "./composition/events" is not exported
```

After the minimal implementation, the first behavior passed. The expanded
security matrix then exposed one defect: stream metadata was initially checked
without the stream limit flag. The failing oversized-metadata test showed that
`readText` was reached. The implementation now rejects a stream larger than
64 MiB before any read.

## Verification Evidence

```text
npx vitest run tests/event-store-preparation.test.ts
18 tests passed

npx vitest run tests/event-store-preparation.test.ts tests/architecture.test.ts tests/package-boundaries.test.ts
78 tests passed

npm run lint
exit 0

npm run typecheck
exit 0
```

## Self-Review

- Paths are restricted to `.brain/runs/<run-id>/events.jsonl` and
  `.brain/runs/<run-id>/state.json`.
- Both paths are inspected before either is read; a partial missing pair,
  non-file entry, or oversized event stream is refused.
- Read bytes are remeasured and hashed against the inspected fingerprint;
  changed content reports `runtime.revision_conflict`.
- Persisted stream, replay, snapshot schema/version, canonical bytes, and
  snapshot-to-replay binding are checked before sealing.
- Schema version failures preserve the two catalog reason codes. Other
  integrity failures are sanitized as `runtime.state_corrupt`; unexpected
  storage failures are sanitized as `runtime.internal_failure`.
- Hostile input accessors and asynchronous draft mutation do not reach storage
  or alter the sealed event. Preparation invokes no mutation capability.

## Concerns

None. Transaction integration and parent-directory creation remain Task 5
responsibilities; this task only returns the two final file effects.
