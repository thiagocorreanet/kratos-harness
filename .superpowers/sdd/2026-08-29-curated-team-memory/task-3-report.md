# Task 3 report: curated team memory

## RED / GREEN evidence

- RED: `npm test -- tests/curated-memory-domain.test.ts` — failed because
  `@kratos/runtime/domain/memory` was not exported. This established the new
  renderer/reducer domain boundary before production implementation.
- GREEN: `npm test -- tests/curated-memory-domain.test.ts` — 4 tests passed.
- GREEN: `npm test -- tests/curated-memory-domain.test.ts tests/curated-memory-runtime.test.ts tests/cli-commands.test.ts` — 3 files and 20 tests passed.
- GREEN: `npm run typecheck` — exited 0.
- GREEN: `npm run lint` — exited 0.
- GREEN: `npm run format:check` — exited 0 before the final focused rerun.
- Audit: `git diff --check` — exited 0.

## Changed files

- Added pure curated-memory rendering, projection validation, bounded promote,
  merge, and archive reducers in `packages/runtime/src/domain/memory/`.
- Added digest/time/proposal-bound `memory promote`, `memory merge`, and
  `memory archive` command definitions plus composition-time persisted-state
  validation and projection-drift refusal.
- Added focused golden renderer/reducer and managed transaction fault tests;
  updated the command registry expectation.

## Self-review

- The runtime owns rendering, state validation, deterministic IDs, limits, and
  proposal application; hosts only invoke the same CLI surface.
- Promotion is preview-only unless `--yes` carries matching proposal digest,
  plan digest, and plan time. Candidate deletion is part of the managed
  transaction after ledger/projection publication is prepared.
- Schema validation retains `runtime.state_corrupt` for malformed persisted
  ledger data; mismatched Markdown returns `memory.projection_drift`.

## Risks / follow-up

- Task 4 migration and Task 5 phase acknowledgement remain intentionally out
  of this task's scope.
- The existing transaction boundary reports an injected publication failure as
  its sanitized internal failure result (exit 2); the fault test verifies the
  stronger required invariant: neither projection artifact nor candidate is
  partially published or deleted.

## Fix Round 1

- Apply now uses the caller-carried `--plan-time` as the deterministic reducer
  instant while independently re-observing current persisted bytes. This keeps
  a reviewed preview applicable across a changing wall clock.
- Persisted ledger reads now reject semantic corruption: derived lesson IDs,
  duplicate active/archive identities, and dangling replacement links are
  fail-closed as `runtime.state_corrupt`.
- Merge unions are checked against the schema's 8/8/256 limits before a ledger
  is produced; an oversized union is `memory.curation_required`.
- Promotion candidates are no longer delete effects in the authority
  transaction. Their observed file fingerprints are included in authorization;
  after a successful ledger/projection commit, cleanup rechecks the exact
  fingerprint and removes best-effort only. A failed or raced cleanup retains
  the candidate safely.
- Memory refusal results now include stable public causes and required artifact
  evidence. Ordering is UTF-8-byte lexical, avoiding locale-dependent output.
- Preview apply commands preserve `--root` and use deterministic POSIX quoting
  for caller-controlled paths.

### Fix Round 1 verification

- `npm run typecheck` — passed.
- RED: `npm test -- tests/curated-memory-domain.test.ts` — merge overflow
  test failed because the initial fixture accidentally duplicated meanings;
  the corrected distinct-source fixture then established the real 9-item
  union boundary.
- GREEN: `npm test -- tests/curated-memory-domain.test.ts tests/curated-memory-runtime.test.ts tests/cli-commands.test.ts` — 3 files, 24 tests passed.
- GREEN: `npm run typecheck` and `npm run lint` — passed.
- Added runtime regression coverage for changing-clock preview/apply, proposal,
  ledger, projection, and candidate drift, durable publication failure,
  post-commit cleanup failure retention, and archive preview/apply. The focused
  suite now has 28 tests across 3 files.
- Added real merge preview/apply proof with exact source tombstones and
  replacement, archive rolling-window proof, and byte-exact POSIX quoting/
  root reconstruction. Focused coverage is now 31 tests across 3 files.
- Boundary completion: a generated valid 23-lesson ledger is promoted exactly
  at 49,152 rendered UTF-8 bytes and is accepted; the one-byte larger variant
  is refused as `memory.curation_required`. A `replace_file` occurrence-2
  failpoint proves recovery after the first canonical swap: recovery restores a
  ledger/projection-valid pair and retains the unconsumed candidate.
- GREEN: `npm test -- tests/curated-memory-domain.test.ts tests/curated-memory-runtime.test.ts` — 18 tests passed.

## Fix Round 2

- `memory.projection_drift` now supplies a stable nonempty public cause and
  both required artifact references. Its runtime JSON regression asserts the
  exact reason, cause, and evidence count.
- Semantic curation links now resolve replacement identities in either active
  or retained archived state. Chained `A+B→R`, `R+S→T`, and archival validation
  are covered without allowing duplicate identities or dangling links.
- Apply-command rendering now emits canonical POSIX single-quote escapes
  (`'a'\''b'`) and preserves `--root`; apostrophe, whitespace, dollar, and
  semicolon values are asserted as exact safe output.
- GREEN: focused domain/runtime/CLI/schema/transaction command passed 5 files,
  151 tests; typecheck and lint passed.
- Public reason contract matrix: `tests/curated-memory-reasons.test.ts` drives
  all five curated-memory reason codes through `resultFor`, `validateResult`,
  and rendered JSON. It asserts exact reason/status/exit/retry policy,
  required versus optional evidence, nonempty cause, and refusal to collapse to
  `runtime.internal_failure` (5 tests passed).
