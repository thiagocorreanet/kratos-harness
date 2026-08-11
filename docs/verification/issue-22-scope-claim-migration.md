# Issue 22 scope-claim migration evidence

## Implemented layout

Project and run claims are now built in a unique sibling candidate directory,
with one `.claim-<expiryEpoch>-<sha256>/claim.json` generation. The fully
synced candidate is published only through `renameDirectoryExclusive()` to the
fixed `claim/` parent. The fixed parent is therefore never intentionally
published empty.

Inspection permits exactly one canonical generation, validates its record,
resource, canonical bytes, expiry epoch, and digest, and validates candidate
and quarantine layouts without mutating them. Expired candidates are
quarantined and removed only after the expiry-plus-skew boundary.

Scope release derives the exact generation from the observed canonical record.
It removes that generation before it ever attempts the fixed parent, so a
delayed old release cannot delete a replacement generation.

## Verification on 2026-08-11

- `npm run typecheck` passed.
- Targeted scope schedules passed: five tests covering closed publication,
  project/run expired candidate recovery, quarantined-candidate resumption, and
  byte-exact replacement survival during a delayed old release.
- `npx vitest run tests/lock-claims.test.ts` remains red: 24 failures of 269.
  They are the pre-migration static `claim/claim.json` fault hooks and fixtures
  (plus four pre-existing admission-candidate cleanup failures). They need to
  be rewritten against generation record paths and candidate/rename boundaries.
