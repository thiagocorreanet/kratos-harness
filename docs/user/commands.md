# Command reference

All commands accept `--json` for the stable result envelope. Project commands
also accept `--root PATH` where shown by `kratos help`.

| Command | Purpose | Mutates state |
| --- | --- | --- |
| `help`, `version`, `handshake` | Usage and contract orientation | No |
| `adapters` | Report supported host package manifests | No |
| `init` | Create or reconcile managed project surfaces | Yes |
| `objective TEXT` | Record or replace the active objective | Yes |
| `start` | Start or idempotently resume a run | Yes |
| `continue` | Resume, reject, or complete one phase | Conditional |
| `approve GATE` | Record digest-bound approval or rejection | Yes |
| `evidence record ID REF` | Register classified, digest-bound evidence | Yes |
| `agent record REF` | Extract, validate, and record one agent reply | Yes |
| `gaps record REF` | Receive proposed gaps and derive the gate facts | Yes |
| `gaps resolve ID` | Record the owner's verdict on one gap | Yes |
| `gaps waive ID` | Record proceeding over a gap nobody answered | Yes |
| `gates record` | Trip stop-loss or record partition facts; it cannot clear a latch | Yes |
| `unlock stop-loss --run ID` | Confirm `UNLOCK ID` on standard input and start a new budget epoch | Conditional |
| `done` | Request accepted final completion | Conditional |
| `status`, `stats`, `budgets` | Derive active-run views | No |
| `metrics refresh` | Refresh the tracked phase-distribution rollup from validated local measurements | Yes |
| `doctor`, `explain CODE` | Diagnose state and explain recovery | No |
| `handoff` | Derive a phase handoff | No |
| `hook` | Accept one versioned host operation from standard input | Conditional |
| `migrate brain` | Preview or authorize a legacy migration | Conditional |
| `migrate config` | Preview or authorize replacement of pre-`1.3.0` configuration with current state | Conditional |
| `migrate rollback ID` | Restore files from a verified migration receipt | Yes |
| `audit` | Replay and compare materialized state | No |
| `repair` | Preview or explicitly authorize a safe repair | Conditional |
| `evidence bundle` | Write a privacy-reviewed evidence bundle | Yes |
| `dashboard` | Write a script-free local dashboard | Yes |

Unknown commands, missing flags, invalid transitions, stale revisions, and
failed gates return a stable nonzero exit code and a recovery description.
Never automate by scraping human output; use `--json`.

## Model-role command behavior

`kratos init` consumes `host.init-answers@1.3.0` from standard input or
`--answers PATH`. Explicit host role maps override adapter defaults. Omitted
maps are filled only from the corresponding enabled host catalog, and every
default is disclosed and persisted after canonical resolution. Initialization
fails before writing when roles are incomplete, unresolved, unsupported, or
non-independent.

The same answers document may carry a partial typed `projectProfile` for the
project's exact root commands; source, test, and configuration paths; directory
and naming conventions; and implementation languages. Every leaf is explicitly
resolved, not applicable with a reason, or unresolved. Omitted leaves preserve
current `1.3.0` state during reinitialization; explicit unresolved leaves clear
it. Initialization never infers these values from stack markers and never
executes a configured command.

`kratos doctor` is also read-only. Its `stack-profile` check passes only when
the deterministic rendered bytes match and no typed leaf is unresolved. It
warns with actionable key names for unresolved answers, a missing document, or
byte drift, and fails for invalid authoritative configuration or an unreadable
or non-file destination. Not-applicable leaves count as complete. Recovery is
to change typed initialization answers and rerun `kratos init`, not edit the
generated Markdown.

`kratos handoff [--json]` is read-only. It maps the current phase to the fixed
runtime role, resolves the canonical model and effort, and returns both that
assignment and `assignmentDigest`. The digest binds the exact configuration
digest, run ID, revision, phase, host, role, model, and effort. Request a new
handoff after `model.assignment_stale`; no prior digest is silently refreshed.

For host-driven `kratos agent record REF`, the adapter request carries the
handoff digest plus nullable host-observed model and effort, bound to the exact
referenced output bytes. A known mismatch returns
`model.execution_mismatch`. With no host execution report, direct CLI recording
persists `model: null` and `effort: null`; `--model` remains diagnostic input and
does not manufacture an observation.

## Phase measurements, budgets, and reports

The runtime measures gross tokens and elapsed duration once for each of the six
canonical phases, in order: `prd`, `spec`, `plan`, `code`, `review`, and
`acceptance`. A completed phase has one physical record keyed by run and phase.
Retries update that record or leave its bytes unchanged; they do not append a
second copy.

`kratos budgets --json` and `kratos evidence bundle --json` report numeric
`used` values after the run has a validated usage sample. That number comes from
the run-wide `totalGrossTokens` ledger that also drives the existing stop-loss
gate. It does not come from adding recommendations, and neither measurement nor
calibration can create, raise, or replace the explicit token allocation supplied
with the objective.

Refresh the committed distribution report explicitly:

```bash
kratos metrics refresh --root PATH --json
```

The command validates the local raw log and writes
`.brain/03-memory/task_metrics.md`. It renders completed and interrupted counts,
completed feature/run sources, and token and duration `min`, `p50`, `p95`, and
`max` for every canonical phase. Percentiles use nearest rank over ascending
integer samples: the selected zero-based position is
`ceil(ratio * sample count) - 1`. A recommendation is the token p95 and requires
at least five completed samples for that phase. With fewer than five, refresh
still writes the available distribution, returns the successful advisory
`metrics.calibration_insufficient`, and identifies the exact `n/5` shortfall.
Interrupted records remain visible in their count but are excluded from sample
statistics and recommendations.

Only `metrics refresh` writes the tracked rollup. `stats` and `budgets` remain
read-only and do not refresh it implicitly. Run refresh between executions: it
is also a recovery boundary and closes stale `running` entries before rendering
the report.

## Configuration migration commands

Preview a pre-`1.3.0` configuration with current answers from a file:

```bash
kratos migrate config --answers model-roles.json --root PATH
```

The preview performs no writes and prints the source, destination, answers,
catalog, and plan digests; confirmed hosts; every canonical assignment and
default; resolved project-profile answers; the plan time; six exact write
paths; and the complete apply command.
Apply requires the exact caller-carried values:

```bash
kratos migrate config --answers model-roles.json --root PATH \
  --yes --plan-digest SHA256 --plan-time INSTANT
```

`--yes` alone is insufficient. Source, answer bytes, catalog facts, timestamp,
or output-byte drift returns a revision conflict rather than silently making a
different plan. `kratos migrate rollback ID --root PATH` restores the exact
backed-up configuration only while the current destination and complete audit
bundle still match the receipt.
