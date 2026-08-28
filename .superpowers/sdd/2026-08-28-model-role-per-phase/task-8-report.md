# Task 8 Report: Digest-bound configuration migration and rollback

## Status

Completed. `kratos migrate config [--answers PATH] [--yes]` now upgrades only a
validated `ProjectConfigV1`, persists complete canonical phase-role assignments,
and records a digest-bound `MigrationV1_1` replacement receipt. Rollback restores
the exact prior configuration only while the receipt, backup, verification, and
current destination still agree.

## Delivered

- Added the registered `migrate config` command with explicit answers-file/stdin
  handling and mandatory enabled-host confirmation. `.claude`, `.codex`, and
  conversational state never participate in authorization.
- Reused initialization answer validation and model resolution. Explicit role
  maps override adapter defaults; persisted assignments are canonical objects,
  complete for every enabled host, and checked for implementer/judge
  independence.
- Added a no-mutation preview that renders source/destination SHA-256 values,
  confirmed hosts, every normalized assignment and default marker, plan digest,
  and the exact six-file write list.
- Derived deterministic migration IDs and plan digests from canonical source,
  destination, host, assignment, default, and write-list facts. The apply plan
  holds the exact observed source size and digest as a write precondition.
- Applied one managed transaction for `.brain/config.json`, the exact old-byte
  backup, authorization, replacement rollback manifest, v1.1 receipt, and
  verification record.
- Extended rollback observation to validate the exact v1.1 receipt revision,
  manifest, verification, backup bytes/digest, receipt bytes, and destination
  digest. Destination drift reports `runtime.revision_conflict`; corrupted
  receipt or backup fails closed.
- Preserved `MigrationV1` Brain rollback as delete-only. Current configuration,
  invalid/missing answers or catalogs, and equal implementer/judge defaults
  produce no managed effects.

## TDD evidence

### RED

The config/history, preview/apply, receipt/rollback, and CLI contract tests were
written before production changes:

```text
npm test -- tests/config-migration.test.ts tests/migration-observability.test.ts \
  tests/cli-commands.test.ts tests/cli-parsing.test.ts
Test Files 3 failed | 1 passed
Tests 11 failed | 33 passed
```

Failures were the expected missing behavior: `migrate config` was unregistered,
the parser had no answers/authorization flags, and every migration apply,
preview, and replacement rollback assertion failed.

A reason-bound rollback test later reproduced one boundary defect before its
fix: destination drift reached `runtime.state_corrupt`, then the first attempted
conflict result was rejected by the public result contract because it lacked a
cause. The root fix added the stable conflict cause at the observation boundary;
the renderer now publishes `runtime.revision_conflict` unchanged.

### GREEN

```text
required migration/CLI/replay/fault matrix
Test Files 9 passed
Tests 105 passed

all CLI-named suites
Test Files 7 passed
Tests 137 passed

config migration verbose evidence
Test Files 1 passed
Tests 15 passed
```

The verbose run includes explicit passes for no-mutation preview, stale source
refusal, host confirmation, answers-file input, default and explicit role maps,
all zero-effect refusals, current no-op, receipt verification, exact rollback,
destination drift, receipt/backup tampering, and legacy delete-only rollback.

## Byte-preservation evidence

- The legacy config fixture intentionally uses four-space indentation and two
  trailing newlines. The migration test asserts the backup is exactly that
  string, not reserialized content, and rollback restores the same exact bytes.
- The subject contains a non-empty golden v1 event line, matching v1 snapshot,
  PRD, approval, and evidence. Apply compares every pre-existing non-config path
  byte-for-byte; rollback repeats the full original-file comparison.
- Migration records are asserted to contain exactly
  `authorization.json`, `backup/config.json`, `receipt.json`, `rollback.json`,
  and `verification.json` beneath the deterministic migration root.
- The committed golden v1 fixture was not modified:

```text
working SHA-256: 25e6c1823f5c5dd2658a663acf6abbb69e3707348a694482d0796b67bdb619c7
HEAD SHA-256:    25e6c1823f5c5dd2658a663acf6abbb69e3707348a694482d0796b67bdb619c7
```

## Quality gates

```text
npm run typecheck
exit 0

npm run lint
exit 0

npm run format:check
All matched files use Prettier code style!

git diff --check
exit 0
```

The required transaction fault campaign passed inside the 105-test matrix. To
make the requested repository-wide Prettier gate green, this task also applied
the two previously recorded mechanical-only formatting changes in
`tests/model-role-resolution.test.ts` and `tests/support/model-routing.ts`; no
test data or behavior changed there.

## Self-review

- The destination configuration preserves legacy language, policy, snapshots,
  managed paths, and plugin version; migration answers provide only the newly
  required host/role authority.
- Preview has no effect plan. Apply uses the exact preview observation and the
  transaction boundary re-observes the source fingerprint before publication.
- Authorization, receipt conversion, rollback metadata, and verification all
  carry the same source, destination, and plan digests.
- Rollback snapshots only digest-verified backup bytes; apply rechecks the
  backup through a preconditioned no-op and holds the changing receipt and
  destination as durable transaction preconditions.
- Historical event, snapshot, document, approval, and evidence paths are never
  included in the migration plan.
- No subagents were used.
