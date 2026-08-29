# Migration, upgrades, and recovery

## Legacy migration

`kratos migrate brain` first discovers a supported sibling Brain layout and
produces a deterministic, no-write plan. The plan lists every copy, transform,
skip, and conflict with source and destination digests. Ambiguous, unsafe,
symlinked, corrupted, or unsupported input blocks before mutation.

Applying a migration requires `--yes`, creates a manifested backup, uses a
managed transaction, verifies the resulting contracts and digests, and writes
a receipt. The legacy sibling remains intact; cleanup is always manual.

## Contract upgrades

State upgrades use an ordered, declared migrator chain. Preflight rejects a
missing hop, cycle, unsupported downgrade, or state newer than the installed
runtime. The active contract changes only after a verified commit.

### Project-configuration replacement

A `state.project-config@1.0.0`, `1.1.0`, or `1.2.0` project returns
`profile.config_migration_required` until it is explicitly upgraded.
`kratos migrate config [--answers PATH]` previews its replacement with
`state.project-config@1.3.0`. The `1.0.0` configuration does not record enabled
hosts, so the answers must confirm them; `.claude`, `.codex`, prompts,
conversation, and agent output are observations, not migration authority.

The preview is read-only. It renders every resolved `planner`, `implementer`,
and `judge` assignment, including adapter-default markers, along with source,
destination, answer, catalog, and write-set digests. Bare model names normalize
to effort `medium`. Profile leaves come only from typed answers or preserved
current state; missing new leaves become explicit unresolved state. Unknown
aliases, unsupported efforts, missing roles, and canonical
implementer/judge equality fail closed with no fallback and no write.

Apply uses the complete command printed by preview and requires `--yes`,
`--plan-digest SHA256`, and `--plan-time INSTANT`. It binds exact answer bytes
and current adapter catalogs as well as the source configuration. Any drift
returns `runtime.revision_conflict`; the runtime does not recompute and apply an
unreviewed replacement.

One managed transaction replaces only `.brain/config.json` and creates the
authorization, exact old-byte backup, rollback manifest, v1.1 receipt, and
verification record beneath `.brain/migrations/<migration-id>/`. Event streams,
snapshots, feature documents, approvals, evidence, and agent output retain their
exact bytes. Historical `state.event@1.0.0` records remain in the same hash
chain as later `state.event@1.1.0` records; migration never retrofits model
metadata into old history.

`kratos migrate rollback ID` validates the current destination, receipt,
verification, rollback manifest, and backup digest before restoring the exact
original configuration bytes. Drift or corruption refuses without changing
either file. A later retry receives a new contiguous attempt ID and preserves
the earlier audit bundle; it never overwrites prior recovery evidence.

## Replay and repair

`kratos audit` replays the event log and identifies the earliest known
divergence. `kratos repair` without `--apply` produces a closed-catalog repair
plan. Application requires an authorization bound to the exact plan digest;
changed preconditions invalidate it. Corrupted originals are preserved.

Rollback validates the receipt, backup digest, current target, and unchanged
files. It refuses rather than deleting the only known-good copy.
