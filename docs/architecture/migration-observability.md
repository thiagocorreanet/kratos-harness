# Migration and observability

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

`kratos migrate config` is the explicit `1.0.0` to `1.1.0` configuration
replacement. The legacy configuration does not record enabled hosts, so an
answers document must confirm them; `.claude`, `.codex`, and conversational
context are observations only and never grant authority. Role maps use the
same resolution as initialization: explicit assignments override adapter
defaults, and every persisted planner, implementer, and judge assignment is
canonical, complete, and independent. Preview prints the source and
destination digests, confirmed hosts, all assignments (including which values
were defaulted), and the exact write list without mutating the project.

Apply authorizes the displayed plan digest and holds the exact source file
fingerprint as a managed-transaction precondition. The transaction replaces
only `.brain/config.json` and writes an exact prior-byte backup, authorization,
replacement rollback manifest, `MigrationV1_1` receipt, and verification record
under one deterministic migration ID. Existing events, snapshots, documents,
approvals, and evidence are not rewritten. A current configuration is a no-op;
source drift is a revision conflict rather than permission to make a new plan.

Replacement rollback validates the v1.1 receipt, verification record, exact
backup digest, current destination digest, and their recorded references. It
then restores the original bytes and marks the receipt rolled back in one
transaction. Destination drift is a revision conflict and leaves both files
unchanged. The older `MigrationV1` Brain-copy receipt retains its delete-only
rollback behavior.

Replay audits compare canonical persisted and replayed snapshots and report
field-level divergence. Repair is a previewable digest-bound write plan. Apply
requires the exact plan digest, re-observes it immediately before commit,
preserves the original snapshot and authorization as evidence, and holds the
fresh preview as a transaction precondition. An unreadable history is blocked
rather than reconstructed from guesses.

Evidence bundles contain sanitized event metadata and evidence contracts. The
local dashboard is static HTML with escaped dynamic values, no scripts, and no
network dependencies.
