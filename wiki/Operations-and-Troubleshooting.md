# Operations and troubleshooting

Start with read-only commands. Preserve the evidence before considering repair,
migration, rollback, or any other mutation.

## Orientation sequence

```bash
kratos status --json
kratos doctor --json
kratos audit --json
```

Then explain the stable reason code from the result:

```bash
kratos explain runtime.recovery_required --json
```

Use the runtime from the installed or locally built plugin package; `kratos`
above is shorthand for its `runtime/kratos.mjs` entry.

## Common outcomes

| Reason / condition | Meaning | Next action |
| --- | --- | --- |
| `trail.uso` | Invocation or state prerequisite is invalid | Check `kratos help` and current status |
| `trail.worktree_dirty` | Start requires a clean worktree | Review Git changes; do not discard them automatically |
| `runtime.revision_conflict` | State changed after observation or preview | Re-run status and re-evaluate the operation |
| `runtime.recovery_required` | An incomplete managed transaction exists | Run doctor/audit and follow the exact recovery evidence |
| `runtime.state_corrupt` | Stored facts are ambiguous or fail integrity | Preserve artifacts; preview a supported repair |
| `runtime.lease_conflict` | Another valid owner controls the resource | Wait, inspect the lease, or use explicit eligible recovery |
| `guard.outside_allow` | A requested write crosses the managed boundary | Correct the target; do not broaden the allowlist casually |
| Gate reason | Required context, approval, evidence, or acceptance is missing | Record the requested facts, then retry with a new observation |

## Read-only operational views

- `status`: active feature, run, phase, revision, and blockers.
- `stats`: derived progress and event statistics.
- `budgets`: active run budget view.
- `doctor`: configuration, event, snapshot, lock, and transaction diagnostics.
- `audit`: replay the active history and compare the materialized snapshot.
- `handoff`: produce a phase-oriented context summary.
- `explain`: map one reason code to recovery guidance.

## Repair

Repair is preview-first and content-bound:

1. Request a repair preview.
2. Inspect the plan, evidence, and plan digest.
3. Authorize that exact digest.
4. Kratos re-observes current state before commit.
5. Any drift becomes a revision conflict rather than a substituted repair.

Never edit `state.json` to bypass replay. The snapshot is derived from events.

## Legacy migration

`migrate brain` discovers and previews legacy sibling Brain state. The caller
must declare the source contract and explicitly authorize the digest-bound plan.
Current divergent content and sensitive paths block migration.

A completed migration produces a receipt. Rollback restores only what the
verified receipt proves the migration created, preserving unrelated project
work.

## Static dashboard and evidence bundles

`dashboard` writes a script-free local view with escaped content and a restrictive
CSP. `evidence bundle` produces a digest-bound local package after classification
and redaction review. Neither is a remote telemetry service.

## When to stop

Stop and preserve the project if:

- doctor and audit disagree;
- a journal contains an unknown phase or fingerprint;
- lock state and lock events disagree;
- a repair preview changes between review and apply;
- a path appears outside the expected project root;
- the result reports an internal failure without a safe recovery path.

References:

- [User troubleshooting guide](../docs/user/security-and-troubleshooting.md)
- [Migration and recovery](../docs/user/migration-and-recovery.md)
- [Command reference](../docs/user/commands.md)

