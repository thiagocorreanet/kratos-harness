# Summary

## One-sentence statement

Replace placeholder documents with deterministic templates a pure gate can check.

## Hard requirements

- Preserve host neutrality and initialization idempotence.
- Keep gate evaluation free of filesystem reads.

## File allowlist

- `packages/runtime/src/domain/feature-documents/**`
- `packages/runtime/src/domain/gates/**`
- `tests/**`
- `fixtures/**`
- `packages/contracts/**`
- `docs/**`

## File denylist

- `packages/runtime/src/domain/approvals/**`
- `packages/runtime/src/infra/digests.ts`
- `distribution/**`

## Definition of done

- Narrow tests and the complete verification suite pass.
- Every issue acceptance criterion has recorded evidence.
