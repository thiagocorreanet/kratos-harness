# Task 4 Report: Recoverable Work Lease Service

## RED

- Added shared memory/Node lifecycle contract coverage and composition service
  coverage before adding the final port or `createLocks()`.
- Ran `npx vitest run tests/locks-contract.test.ts tests/lock-service.test.ts
  tests/ports-contract.test.ts`.
- Confirmed RED: the new suites failed because `createLocks` was absent from
  composition (after resolving the intentionally new test imports, the direct
  failure was `TypeError: createLocks is not a function`).

## GREEN

- Added the final `Locks` port with inspection, acquire, renew, release, and
  takeover outcomes.
- Composed one durable service across fake and Node durable filesystems.
- Snapshot lifecycle requests before I/O, obtain durable admission/scope claims,
  publish an event plus lease with one managed transaction, and release only
  the matching claim.
- Preserve durable fencing tokens through renew/release and advance them only
  for acquisition/takeover. Expiry remains conflict-only until explicit
  takeover.
- Replaced obsolete two-method adapter contract coverage with lifecycle parity
  coverage.

## Verification

- `npm run format:check` — PASS
- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npx vitest run tests/lock-model.test.ts tests/lock-lifecycle.test.ts
  tests/lock-claims.test.ts tests/locks-contract.test.ts tests/lock-service.test.ts
  tests/ports-contract.test.ts tests/runtime-composition.test.ts` — PASS
  (7 files, 643 tests)

## Coverage

- The scoped lifecycle matrix is green. A targeted coverage invocation is not
  a valid repository coverage gate because the project enforces global 100%
  thresholds across all runtime files. The complete coverage runner did not
  emit a final summary in this execution environment, so a final full-gate
  coverage confirmation remains required before release.

## Files

- `packages/runtime/src/ports/locks.ts`
- `packages/runtime/src/ports/index.ts`
- `packages/runtime/src/composition/locks.ts`
- `packages/runtime/src/composition/index.ts`
- `packages/runtime/src/infra/fake/index.ts`
- `packages/runtime/src/infra/node/index.ts`
- `tests/support/lock-contract.ts`
- `tests/locks-contract.test.ts`
- `tests/lock-service.test.ts`
- `tests/ports-contract.test.ts`
- `tests/support/port-contracts.ts`

## Commits

- `feat: implement recoverable work leases`

## Concerns

- No contract, schema, version, or dependency changes were made.
- Do not start Task 5 from this worktree: protected caller-mutation guard
  persistence and per-publication fencing remain Task 5 responsibilities.

## Follow-up Corrections

- `release()` now returns the exact already-published release observation when
  passed that release's exact guard, without creating a claim or appending an
  event. A stale or otherwise non-exact guard still conflicts.
- Every lifecycle request is structurally validated and snapshotted before
  durable I/O. The service tests prove invalid renew, release, and takeover
  requests make zero durable calls.
- Run-family admission now orders verified decoded run resources canonically,
  rather than trusting storage directory enumeration order.
- The required seven-suite lifecycle matrix passes with 653 tests. Its scoped
  `composition/locks.ts` coverage gate is 100% for statements, branches,
  functions, and lines.
