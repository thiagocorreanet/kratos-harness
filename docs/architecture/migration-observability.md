# Migration and observability

## Legacy and incremental migration

Legacy discovery and migration planning are read-only. A ready plan enumerates
every copy, skip, conflict, and unsupported entry and includes a digest and
required byte count. Project-owned divergent state blocks rather than being
overwritten.

Execution uses a versioned receipt with the source contract, plan digest,
authorization reference, backup digest, conversions, verification evidence,
and rollback reference. Authorization must match the planned digest. Completion
requires verification references. Rollback requires the exact recorded backup
digest. Incremental contract upgrades follow one unambiguous declared chain;
versions are never guessed or skipped.

## Project-configuration replacement

`kratos migrate config` explicitly replaces a `1.0.0`, `1.1.0`, `1.2.0`, or
`1.3.0` project configuration with current `1.4.0` state. The declared chain adds
canonical model roles, granular language policy, the typed project profile, and
the optional acceptance attempt ceiling without skipping an intermediate
revision. A `1.3.0 -> 1.4.0` migration preserves old bytes and does not write
the runtime default of `3`. A `1.0.0` configuration does not
record enabled hosts, so an answers document must confirm them; `.claude`,
`.codex`, and conversational context are observations only and never grant
authority. Role maps use the same resolution as initialization: explicit
assignments override adapter defaults, and every persisted planner,
implementer, and judge assignment is canonical, complete, and independent.
For `1.1.0` and `1.2.0` sources, omitted role fields preserve both persisted
host maps; only an explicit host role map replaces that host after canonical
resolution, and confirmed hosts are derived from the final merged map.
Profile answers fill only caller-supplied leaves; omitted new leaves become
explicit unresolved state. Preview prints the source and destination digests,
confirmed hosts, all assignments and profile values, a stable plan instant,
and the exact six-file write list with one SHA-256 per final content byte
sequence, without mutating the project. Control-bearing profile values are
visibly encoded, and values rejected by the public terminal-text policy use a
chunked UTF-16 hexadecimal representation. It also prints the complete apply
command.

Apply requires `--yes`, the caller-carried `--plan-digest`, and the preview's
`--plan-time`; `--yes` alone grants no authority. Re-observation rebuilds all
six bytes from the exact source, answers, model catalogs, and plan instant. The
external digest commits to each ordered path and content digest, while the
receipt's stable lineage digest is embedded in the self-referential audit
records. Answer authority is byte-bound (including formatting), and every
enabled host's canonical catalog is digest-bound even when a catalog edit would
resolve to the same assignments. Any mismatch is a revision conflict, rather
than permission to make a new plan. The transaction holds the exact source
fingerprint, replaces only `.brain/config.json`, and writes an exact prior-byte
backup, authorization, replacement rollback manifest, `MigrationV1_1` receipt,
and verification record under one deterministic migration attempt ID. Existing
events, snapshots, documents, approvals, and evidence are not rewritten. A
current configuration is a no-op.

This boundary is security-sensitive: ordinary operations return
`profile.config_migration_required` while a pre-`1.4.0` configuration is
active; prompts, host files, and conversation cannot confirm enabled hosts or
profile values; and implementer/judge canonical equality is a strict refusal
rather than a warning. Applied role assignments are complete canonical
objects, so later adapter-default changes cannot alter project policy silently.

## Replacement rollback and retry lineage

Replacement rollback validates the v1.1 receipt, verification record, exact
backup digest, current destination digest, and their recorded references. It
then restores the original bytes and marks the receipt rolled back in one
transaction. Destination drift is a revision conflict and leaves both files
unchanged. Receipt, rollback manifest, verification, backup, and destination
are each read as a stable byte snapshot and the same fingerprints become apply
preconditions, closing the validation/apply swap boundary. The older
`MigrationV1` Brain-copy receipt retains its delete-only rollback behavior.

After a successful replacement rollback, the same source and answers derive
the next `-attempt-N` migration ID only from a validated chain of prior
rolled-back audit bundles. Each prior authorization, receipt, rollback
manifest, verification record, and exact backup must have version `1.1.0`,
canonical refs under its own attempt root, lineage/content digests that can be
recomputed, and consistent source/destination relationships. All five exact
files are also apply preconditions. Attempts are contiguous and capped; the
cap is a refusal, never an extra suffix. A retry therefore preserves every
prior audit file instead of overwriting the first attempt.

Migration IDs are portable single path components. Validation happens before
path construction and rejects separators, colon/drive/ADS syntax, traversal,
overlong values, and case-insensitive Windows device base names (including
extension variants). Non-device dotted legacy IDs remain readable.

## Replay, repair, and evidence views

Replay audits compare canonical persisted and replayed snapshots and report
field-level divergence. Repair is a previewable digest-bound write plan. Apply
requires the exact plan digest, re-observes it immediately before commit,
preserves the original snapshot and authorization as evidence, and holds the
fresh preview as a transaction precondition. An unreadable history is blocked
rather than reconstructed from guesses.

Evidence bundles contain sanitized event metadata and evidence contracts. The
local dashboard is static HTML with escaped dynamic values, no scripts, and no
network dependencies.
