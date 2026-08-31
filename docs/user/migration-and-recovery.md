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
destination, answer, catalog, and write-set digests. It also renders all ten
profile leaves in stable order; terminal controls are shown visibly and other
terminal-unsafe values use labeled UTF-16 hexadecimal chunks. Bare model names
normalize to effort `medium`. Profile leaves come only from typed answers or
preserved current state; missing new leaves become explicit unresolved state.
For `1.1.0` and `1.2.0` sources, omitted role fields preserve both configured
host maps, while an explicit host role map canonically replaces only that host.
Unknown
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

## Phase-measurement recovery

Phase measurement is additive and requires no project migration. The existing
ignored `.brain/03-memory/task_log.jsonl` begins as a valid empty ledger, and
records appear only when a host starts measured phase work. The tracked
`.brain/03-memory/task_metrics.md` remains unchanged until an operator runs
`kratos metrics refresh`.

Early `state.phase-measurement@1.0.0` records that predate contributor ownership
remain valid. The runtime reads the launcher's `sessionId` as their sole
contributor and writes the canonical sorted contributor field the next time a
managed operation rewrites the raw log. A compatible record without contributor
checkpoints likewise gains an empty checkpoint list on its next rewrite without
changing its distribution; no standalone migration is required.

Reinitialization is not a measurement reset. It preserves both measurement
files byte for byte while still reconciling ordinary managed instructions. If
another process creates either measurement file after init observes it as
missing, the missing-file precondition returns `runtime.revision_conflict` and
the transaction publishes no partial initialization state. Observe the current
project state again and rerun init; do not delete or normalize the concurrent
file merely to make initialization pass.

`session.end` closes the matching open measurement as `interrupted`. If the
process dies before that hook arrives, the next phase start or `metrics refresh`
reconciles every stale `running` record against that record's own feature/run
events and usage. A recorded accepted transition recovers the record as
completed at the transition time; otherwise recovery closes it as interrupted.
A recovered record from another run remains completed through later refreshes
and contributes only to its own phase distribution. No stale running record
survives that boundary. Run refresh between executions because refreshing
during live work deliberately closes the current measurement.

Malformed raw lines, corrupt events needed for reconciliation, assignment
conflicts, and stale write preconditions fail closed. A managed transaction
cannot publish recovered raw bytes without its matching rollup, or publish a
rollup from raw bytes that changed after observation. Preserve both files and
correct the reported local-state problem before retrying refresh. A new phase
also refuses before mutation when any other running record needs recovery from
a corrupt event stream; current run events, usage, and raw measurements remain
unchanged.
