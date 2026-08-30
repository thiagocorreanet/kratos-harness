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
| `doctor`, `explain CODE` | Diagnose state and explain recovery | No |
| `handoff` | Derive a phase handoff | No |
| `hook` | Accept one versioned host operation from standard input | Conditional |
| `memory list` | List machine-local failure candidates | No |
| `memory capture PROPOSAL` | Add one validated manual failure candidate | Conditional |
| `memory promote PROPOSAL` | Preview or apply promotion into confirmed memory | Conditional |
| `memory merge PROPOSAL` | Preview or apply a lossless lesson merge | Conditional |
| `memory archive PROPOSAL` | Preview or apply archival of one lesson | Conditional |
| `migrate brain` | Preview or authorize a legacy migration | Conditional |
| `migrate config` | Preview or authorize the `1.0.0` to `1.1.0` configuration replacement | Conditional |
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

`kratos init` consumes `host.init-answers@1.1.0` from standard input or
`--answers PATH`. Explicit host role maps override adapter defaults. Omitted
maps are filled only from the corresponding enabled host catalog, and every
default is disclosed and persisted after canonical resolution. Initialization
fails before writing when roles are incomplete, unresolved, unsupported, or
non-independent.

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

## Curated-memory commands

Candidates are diagnostics, not shared lessons. `memory list` is read-only and
`memory capture PROPOSAL` accepts a closed `host.memory-capture@1.2.0` JSON
file. Its only user field is a 1–2,048-character `observation`; the runtime
records it as tool family `other`, failure class `unknown`, and no exit code.
The same sanitized, conservative identity reducer used by failed-tool hooks
deduplicates local candidates. A capture never writes the ledger, Markdown
projection, or a promotion.

```bash
kratos memory list --root PATH
kratos memory capture --root PATH capture.json
```

Promotion, merge, and archive take exactly one closed
`host.memory-change@1.2.0` proposal file. A promotion names 1–16 candidate
SHA-256 identifiers and supplies `reviewer`, `title`, nonempty `why`, and
nonempty `apply`. A merge names 2–16 confirmed lesson identifiers plus a
reviewer and title; it retains every distinct source `why`, `apply`, and
candidate identifier. An archive names one lesson, reviewer, and obsolescence
reason. The command verb and proposal `operation` must agree.

```bash
kratos memory promote --root PATH promote.json
kratos memory merge --root PATH merge.json
kratos memory archive --root PATH archive.json
```

These three invocations are previews: they make no write and print the
proposal digest, plan digest, plan time, and an exact shell-quoted apply
command. Copy that command after review; its general grammar is:

```bash
kratos memory <promote|merge|archive> --root PATH proposal.json \
  --yes --proposal-digest SHA256 --plan-digest SHA256 --plan-time INSTANT
```

`--yes` alone is refused as `memory.confirmation_stale`. Proposal, candidate,
ledger, projection, or authorization drift also invalidates the reviewed plan.
The managed transaction publishes `curated-memory.json` and `gotchas.md`
together; only after publication does best-effort candidate cleanup occur, so
a failed cleanup retains a candidate safely.

Confirmed memory permits at most 24 active lessons and 48 KiB of rendered
UTF-8 Markdown. The archive retains at most 48 rolling tombstones; prior
tombstones remain in Git history. `memory.curation_required` blocks a change
that would exceed an active-surface limit. `memory list`, capture, and all
preview calls are read-only except that a non-duplicate capture writes its
local candidate.

## Configuration migration commands

Preview a pre-role configuration with answers from a file:

```bash
kratos migrate config --answers model-roles.json --root PATH
```

The preview performs no writes and prints the source, destination, answers,
catalog, and plan digests; confirmed hosts; every canonical assignment and
default; the plan time; six exact write paths; and the complete apply command.
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
