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

## Replay and repair

`kratos audit` replays the event log and identifies the earliest known
divergence. `kratos repair` without `--apply` produces a closed-catalog repair
plan. Application requires an authorization bound to the exact plan digest;
changed preconditions invalidate it. Corrupted originals are preserved.

Rollback validates the receipt, backup digest, current target, and unchanged
files. It refuses rather than deleting the only known-good copy.
