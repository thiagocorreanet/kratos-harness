# Summary

## One-sentence statement

Replace placeholder documents with deterministic templates a pure gate can check.

## Hard requirements

- Preserve host neutrality and initialization idempotence.
- Keep gate evaluation free of filesystem reads.

## File allowlist

- Runtime feature-document and gate modules.
- Tests, fixtures, contracts, and related documentation.

## File denylist

- Approval and digest contracts.
- Host-specific prompts.

## Definition of done

- Narrow tests and the complete verification suite pass.
- Every issue acceptance criterion has recorded evidence.
