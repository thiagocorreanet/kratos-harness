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

Replay audits compare canonical persisted and replayed snapshots and report
field-level divergence. Repair is a previewable digest-bound write plan. Apply
requires the exact plan digest, re-observes it immediately before commit,
preserves the original snapshot and authorization as evidence, and holds the
fresh preview as a transaction precondition. An unreadable history is blocked
rather than reconstructed from guesses.

Evidence bundles contain sanitized event metadata and evidence contracts. The
local dashboard is static HTML with escaped dynamic values, no scripts, and no
network dependencies.
