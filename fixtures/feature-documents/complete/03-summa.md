# Summa: Centralize feature documents

> Written by spec-reviewer (plan phase) — the Judge's contract. Compressed reference the evaluator enforces.

## In one sentence

Replace placeholder documents with deterministic templates a pure gate can check.

## Hard requirements (the Judge enforces these)

- Preserve host neutrality and initialization idempotence.
- Keep gate evaluation free of filesystem reads.

## Files that should change

- `packages/runtime/src/domain/feature-documents/**`
- `packages/runtime/src/domain/gates/**`
- `tests/**`
- `fixtures/**`
- `packages/contracts/**`
- `docs/**`

## Files that must NOT change

- `packages/runtime/src/domain/approvals/**`
- `packages/runtime/src/infra/digests.ts`
- `distribution/**`

> Exception: checkbox status flips (`[ ]` → `[x]`) in 02-tasks.md are exempt.
> Any other edit to spec content after approval is an automatic FAIL.

## Done means

- Narrow tests and the complete verification suite pass.
- Every issue acceptance criterion has recorded evidence.
