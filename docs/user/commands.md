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
| `memory list` | List machine-local failure candidates | No |
| `memory capture PROPOSAL` | Add one validated manual failure candidate | Conditional |
| `memory curate --as-of DATE [APPROVAL]` | Score proposals or apply one completely reviewed batch | Conditional |
| `memory promote PROPOSAL` | Preview or apply promotion into confirmed memory | Conditional |
| `memory reinforce PROPOSAL` | Preview or apply repeated observations to one lesson | Conditional |
| `memory merge PROPOSAL` | Preview or apply a lossless lesson merge | Conditional |
| `memory archive PROPOSAL` | Preview or apply archival of one lesson | Conditional |
| `migrate brain` | Preview or authorize a legacy migration | Conditional |
| `migrate config` | Preview or authorize replacement of pre-`1.4.0` configuration with current state | Conditional |
| `migrate memory MAPPING` | Preview or losslessly adopt legacy Gotchas | Conditional |
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
current `1.4.0` project configuration state during reinitialization; explicit
unresolved leaves clear it. Initialization never infers these values from stack
markers and never executes a configured command.

`kratos init` creates the raw phase log and tracked phase report only when each
path is absent. Reinitialization preserves the exact existing bytes of both
measurement artifacts while it can still refresh managed instruction sections.
If either measurement path appears after observation but before the managed
transaction commits, initialization returns `runtime.revision_conflict` and
publishes none of its other planned writes.

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

Usage attribution follows the session that produced each newly observed token
delta. The first accepted sample from an unowned host or subagent session is
claimed atomically by the sole eligible running phase and stored in that
record's sorted contributor list, which accepts at most 256 identifiers.
For each contributor, the record also keeps its latest cumulative-token and
observation-time checkpoint. Repeated or regressing totals add no tokens. If a
completed phase's contributing session reports a delayed final increase after
the next phase has started, the runtime recomputes that contributor's
chronological allocation across the affected phases. The increase raises only
the phase interval where it occurred and does not disturb other contributors,
while the sum of phase consumption remains aligned with run-wide numeric usage
and stop-loss facts.

Contributor ownership remains durable if another phase or run becomes active:
a later sample still updates only the owning phase and run's measurement,
usage, and stop-loss state. If a session identifier is reused by sequential
phases, the observation time and stored checkpoints select and, when necessary,
reallocate only that contributor among phase intervals. The runtime refuses the
sample without mutation when one contributor appears in overlapping phase
records, checkpoint chronology or allocation contradicts cumulative usage, an
unowned sample has zero or multiple eligible running phases, a 257th contributor
would be added, prior usage lacks a durable owner, or the owning run's usage or
gate state is missing or malformed.

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

## Curated-memory commands

Candidates are diagnostics, not shared lessons. `memory list` is read-only and
`memory capture PROPOSAL` accepts a closed `host.memory-capture@1.2.0` JSON
file. Its only user field is a 1–2,048-character `observation`; the runtime
records it as tool family `other`, failure class `unknown`, and no exit code.
The same sanitized, conservative identity reducer used by failed-tool hooks
deduplicates local candidates. A capture never writes the ledger, Markdown
projection, or a promotion.

Volatile normalization is platform-aware. It recognizes supported POSIX temp
roots and Windows `AppData\Local\Temp` or `Windows\Temp` roots, their native
separators, and source-file line/column suffixes. Drive letter, path spelling,
case, and substantive numbers remain part of identity outside those exact
volatile positions.

```bash
kratos memory list --root PATH
kratos memory capture --root PATH capture.json
```

Promotion, merge, and archive take exactly one closed
`host.memory-change@1.2.0` proposal file. Current metadata-aware promotion and
reinforcement use `host.memory-change@1.4.0`. A promotion names 1–16 candidate
SHA-256 identifiers and supplies `reviewer`, `title`, nonempty `why`, and
nonempty `apply`. A merge names 2–16 confirmed lesson identifiers plus a
reviewer and title; it retains every distinct source `why`, `apply`, and
candidate identifier. An archive names one lesson, reviewer, and obsolescence
reason. The command verb and proposal `operation` must agree.

```bash
kratos memory promote --root PATH promote.json
kratos memory reinforce --root PATH reinforce.json
kratos memory merge --root PATH merge.json
kratos memory archive --root PATH archive.json
```

These three invocations are previews: they make no write and print the
proposal digest, plan digest, plan time, and `Apply argv`, a JSON string array
that is the shell-neutral apply authority. POSIX and PowerShell commands are
derived displays; the legacy `Apply command` line remains the POSIX rendering
for compatibility. Use the argv array directly when a launcher accepts an
executable plus arguments. Its general grammar is:

```bash
kratos memory <promote|reinforce|merge|archive> --root PATH proposal.json \
  --yes --proposal-digest SHA256 --plan-digest SHA256 --plan-time INSTANT
```

`--yes` alone is refused as `memory.confirmation_stale`. Proposal, candidate,
ledger, projection, or authorization drift also invalidates the reviewed plan.
An identity already active or retained in the archive, or an invalid merge
replacement link, is `memory.curation_required`; no ledger bytes change.
The managed transaction publishes `curated-memory.json` and `gotchas.md`
together while asserting every promoted candidate fingerprint at execution.
Only after durable authority publication does a separate fingerprinted managed
delete attempt candidate cleanup. A changed or failed cleanup retains the
candidate safely.

Confirmed memory permits at most 24 active lessons and 48 KiB of rendered
UTF-8 Markdown. The archive retains at most 48 rolling tombstones; prior
tombstones remain in Git history. `memory.curation_required` blocks a change
that would exceed an active-surface limit. `memory list`, capture, and all
preview calls are read-only except that a non-duplicate capture writes its
local candidate.

`memory curate --as-of YYYY-MM-DD` is a read-only deterministic scorer. Policy
`memory-curation/1.0.0` uses integer scores from 0 to 10,000:

```text
similarity = floor((25*text + 45*fix + 15*technology + 15*failureKind) / 100)
obsolescence = floor((50*age + 20*rarity + 30*dependencyAbsent) / 100)
```

Both thresholds are 7,500 for similarity and 7,000 for obsolescence. Text and
fix are Jaccard set comparisons after Unicode NFKC, lowercase, letter/number
token extraction, duplicate removal, and the exact stopword list `a an and are
as at be been by for from has have in into is it of on or that the this to was
were when with`. The fix weight is largest because the reusable action is the
lesson's core. Age has half the obsolescence weight so dependency churn alone
cannot archive recent knowledge; dependency absence is strong but insufficient,
and rarity separates one-off noise from repeated history.

Proposals at or above their threshold are ordered by descending score, then
merge, archive, delete, then binary lexical lesson identifiers. Every proposal
prints its component scores and token evidence. An
`host.memory-curation@1.4.0` approval must approve or reject every proposal
exactly once. Approved sources may not overlap. Preview the approval, then run
the emitted argv with `--yes`, `--plan-digest`, `--approval-digest`, and
`--plan-time`; the ledger and projection publish as one transaction. Count-one
obsolete lessons are deleted only after approval. Repeated lessons are archived
with reviewer, reason, date, score, and components. A merge unions both lessons'
causes, fixes, and provenance and sums their observation counts.

## Configuration migration commands

Preview a pre-`1.4.0` configuration with current answers from a file:

```bash
kratos migrate config --answers model-roles.json --root PATH
```

Sources through `1.2.0` use the answers document to supply missing authority.
A `1.3.0` source already contains that authority, so its adjacent upgrade to
current `1.4.0` state may omit `--answers` and adds only `gateModes: {}` plus
the current configuration/state version constants.

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
