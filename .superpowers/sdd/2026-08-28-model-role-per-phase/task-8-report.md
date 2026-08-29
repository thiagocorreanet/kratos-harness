# Task 8 Report: Digest-bound configuration migration and rollback

## Status

Completed. `kratos migrate config [--answers PATH]` previews a validated
`ProjectConfigV1`; apply additionally requires `--yes --plan-digest SHA256
--plan-time INSTANT`. It persists complete canonical phase-role assignments and
records a digest-bound `MigrationV1_1` replacement receipt. Rollback restores
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
- Derived deterministic migration IDs and exact write-set plan digests from
  source, destination, answer bytes, host catalogs, assignments, defaults,
  timestamp, and six final path/content pairs. The apply plan holds the exact
  observed source size and digest as a write precondition.
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
  carry the same source, destination, and internal lineage digests; the
  caller-carried outer digest binds their exact final bytes.
- Rollback snapshots only digest-verified backup bytes; apply rechecks the
  backup through a preconditioned no-op and holds the changing receipt and
  destination as durable transaction preconditions.
- Historical event, snapshot, document, approval, and evidence paths are never
  included in the migration plan.
- No subagents were used.

## Review round 1 fixes

The first review identified that `--yes` could authorize a freshly recomputed
plan instead of carrying authority from preview. The CLI now requires all three
apply inputs: `--yes`, `--plan-digest <sha256>`, and the preview's
`--plan-time <instant>`. Preview prints that complete apply command. The apply
invocation re-reads the exact config and answer bytes, re-observes enabled-host
catalogs, rebuilds every final artifact byte at the supplied instant, and
compares the caller-carried write-set digest. Source, answer formatting,
catalog, attempt-lineage, timestamp, or artifact-byte drift returns
`runtime.revision_conflict`; `--yes` alone returns usage failure with zero
effects.

The externally authorized plan digest is SHA-256 over the deterministic
ordered list of six `{ path, content-sha256 }` pairs plus migration ID and plan
instant. Each final write is materialized during observation, so the handler
cannot recreate timestamped receipt bytes differently. Preview publishes all
six content digests. A separate stable lineage digest is embedded in the
self-referential `MigrationV1_1` records; the caller-carried plan digest remains
the exact-byte authorization digest, avoiding an impossible self-hash while
still binding every byte written.

Rollback now obtains receipt, rollback manifest, verification, backup, and
destination through inspect/read/inspect stable snapshots. The exact bytes and
fingerprints used to authorize restoration are carried as apply
preconditions. Controlled swaps both during a stable read and between
validation and precondition checking refuse without restoring or rewriting any
record.

Rollback IDs are checked before migration paths are constructed. The bounded
canonical grammar rejects dot traversal, slash, backslash, percent-encoded and
Unicode alternate separators, trailing punctuation, and values longer than 128
characters. Legacy canonical Brain migration IDs remain accepted.

A rolled-back configuration migration can be retried. The next deterministic
ID is `<base>-attempt-N`, derived from a contiguous, schema-valid chain of exact
rolled-back receipts whose source and destination digests match. Prior receipt
bytes become apply preconditions, and a full migrate/rollback/retry test proves
that the first attempt's audit directory remains byte-for-byte unchanged.

### Review RED

The review tests were written before the fixes. The focused run failed on the
missing authorization flags/timestamp/write digests, `--yes` applying by
itself, rollback IDs reaching storage, and absent retry/swap protections:

```text
npm test -- tests/config-migration.test.ts tests/cli-parsing.test.ts
Test Files 2 failed
Tests 28 failed | 17 passed
```

### Review GREEN and byte evidence

```text
focused config migration
Test Files 1 passed
Tests 41 passed

Task 8 migration/CLI/replay/fault matrix
Test Files 8 passed
Tests 127 passed

transaction fault and recovery matrix
Test Files 5 passed
Tests 97 passed

all CLI-named suites
Test Files 7 passed
Tests 137 passed

npm run typecheck
exit 0

npm run lint
exit 0

npm run format:check
All matched files use Prettier code style!

git diff --check
exit 0
```

The focused suite hashes each of the six literal planned contents and
reconstructs the exact outer plan digest, including the stable timestamp. It
also binds semantically identical but byte-different answers, and catalog-only
changes that leave resolved assignments unchanged. Historical golden event,
snapshot, PRD, approval, and evidence bytes remain outside all six writes. The
golden v1 event fixture still matches `HEAD` exactly:

```text
working SHA-256: 25e6c1823f5c5dd2658a663acf6abbb69e3707348a694482d0796b67bdb619c7
HEAD SHA-256:    25e6c1823f5c5dd2658a663acf6abbb69e3707348a694482d0796b67bdb619c7
```

## Review round 2 fixes

Migration IDs now use a portable component grammar before any migration path
is constructed. Colon (including drive-relative and ADS spellings) is refused.
The basename before an extension is compared case-insensitively against `CON`,
`PRN`, `AUX`, `NUL`, `COM1`-`COM9`, and `LPT1`-`LPT9`. Dotted, underscored,
hyphenated, and `@`-qualified legacy IDs remain accepted when they are not
reserved devices.

Retry lineage no longer trusts a receipt by itself. Authorization now persists
the normalized hosts, role map, and default list needed to reconstruct the
internal lineage digest. For every prior attempt, observation obtains stable
bytes for authorization, backup, receipt, rollback manifest, and verification;
validates exact `1.1.0` record shapes and refs under that attempt root;
recalculates the lineage digest; reconstructs the planned, authorized,
completed, and rolled-back receipt through the domain lifecycle; and verifies
the exact legacy backup plus current source/destination relationships. Every
one of the five prior files becomes an apply precondition.

Attempt suffixes must be contiguous and canonical. Exactly 10,000 existing
attempts now refuse before any receipt is read, so the implementation cannot
emit `attempt-10001`.

### Review round 2 RED

```text
npm test -- tests/config-migration.test.ts
Test Files 1 failed
Tests 24 failed | 46 passed
```

The failures were the 12 newly rejected portable-ID cases, forged/tampered/
missing/cross-root bundle cases, four previously unguarded companion mutations,
and the cap boundary inspecting attempt one instead of refusing immediately.

### Review round 2 GREEN

```text
focused config migration
Test Files 1 passed
Tests 76 passed

Task 8 migration/CLI/replay/fault matrix
Test Files 8 passed
Tests 162 passed

transaction fault and recovery matrix
Test Files 5 passed
Tests 97 passed

all CLI-named suites
Test Files 7 passed
Tests 137 passed

npm run typecheck
exit 0

npm run lint
exit 0

npm run format:check
All matched files use Prettier code style!

git diff --check
exit 0
```

The focused matrix includes case/extension variants for every Windows device
family, legitimate dotted legacy IDs, schema-valid forged receipts, each
tampered or missing companion, escaping and cross-attempt refs, skipped
attempts, all five mutations both after preview and after direct observation,
the exact cap boundary, and the valid rollback/retry cycle with first-attempt
bytes preserved.
