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

### Curated-memory adoption

Existing free-form `.brain/03-memory/gotchas.md` is never interpreted as
Markdown lessons. `kratos migrate memory mapping.json` accepts a closed
`host.memory-migration@1.2.0` mapping with the source SHA-256, reviewer, lesson
title/why/apply values, and one-based source ranges. Every non-blank,
non-template legacy line must occur in exactly one ordered range; overlaps,
gaps, out-of-bounds ranges, and changed source bytes are refused.

The first invocation is read-only and prints proposal, source, plan, and time
digests plus canonical JSON `Apply argv`. That array is shell-neutral authority;
the adjacent POSIX and PowerShell commands are derived displays, and the legacy
`Apply command` field remains a POSIX compatibility rendering. Apply requires
`--yes` and those exact three caller-carried values. It atomically writes the structured ledger and
rendered projection, preserves the original `gotchas.md` bytes beneath
`.brain/migrations/<id>/backup/`, and writes authorization, receipt, rollback,
and verification records. `kratos migrate rollback ID` restores those exact
legacy bytes and removes the migrated ledger after validating the receipt and
current projection.

The exact preview and apply grammar is:

```bash
kratos migrate memory --root PATH mapping.json
kratos migrate memory --root PATH mapping.json \
  --yes --proposal-digest SHA256 --plan-digest SHA256 --plan-time INSTANT
kratos migrate rollback MIGRATION_ID --root PATH
```

The preview prints the source SHA-256 as well as the proposal, plan, and time
values. The mapping's `sourceDigest` must name those exact legacy bytes.
`--yes` without all three preview values, changed source or mapping bytes, an
overlap, a gap, or an out-of-bounds range refuses instead of creating a new
plan. Rollback verifies the receipt, backup digest, current ledger, and
current projection before restoring the original Gotchas bytes. A refusal
preserves the known-good copy and its recovery records.

Fresh structured memory is already adopted. A missing ledger paired with the
exact stock empty Gotchas template is safely adoptable; any other free-form
Gotchas document blocks memory use with `memory.migration_required` until an
explicit lossless mapping is reviewed and applied.

## Replay and repair

`kratos audit` replays the event log and identifies the earliest known
divergence. `kratos repair` without `--apply` produces a closed-catalog repair
plan. Application requires an authorization bound to the exact plan digest;
changed preconditions invalidate it. Corrupted originals are preserved.

Rollback validates the receipt, backup digest, current target, and unchanged
files. It refuses rather than deleting the only known-good copy.
