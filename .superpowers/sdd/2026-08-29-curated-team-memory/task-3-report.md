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
