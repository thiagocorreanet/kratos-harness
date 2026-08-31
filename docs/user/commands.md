# Command reference

All commands accept `--json` for the stable result envelope. Project commands
also accept `--root PATH` where shown by `kratos help`.

| Command | Purpose | Mutates state |
| --- | --- | --- |
| `help`, `version`, `handshake` | Usage and contract orientation | No |
| `adapters` | Report supported host package manifests | No |
| `init` | Create or reconcile managed project surfaces | Yes |
| `objective TEXT [--token-ceiling N]` | Record or replace the active objective and optionally declare a run token ceiling | Yes |
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
| `migrate config` | Preview or authorize replacement of pre-`1.4.0` configuration with current state | Conditional |
| `migrate config` | Preview or authorize replacement of pre-`1.3.0` configuration with current state | Conditional |
| `migrate memory MAPPING` | Preview or losslessly adopt legacy Gotchas | Conditional |
| `migrate rollback ID` | Restore files from a verified migration receipt | Yes |
| `audit` | Replay and compare materialized state | No |
| `repair` | Preview or explicitly authorize a safe repair | Conditional |
| `repair resolve AC-ID --run ID --resolved-by ID --observation TEXT` | Resolve one recorded repeated-rejection stop | Conditional |
| `evidence bundle` | Write a privacy-reviewed evidence bundle | Yes |
| `dashboard` | Write a script-free local dashboard | Yes |

Unknown commands, missing flags, invalid transitions, stale revisions, and
failed gates return a stable nonzero exit code and a recovery description.
Never automate by scraping human output; use `--json`.

## Model-role command behavior

`kratos init` consumes `host.init-answers@1.4.0` from standard input or
`--answers PATH`. Explicit host role maps override adapter defaults. Omitted
maps are filled only from the corresponding enabled host catalog, and every
default is disclosed and persisted after canonical resolution. Initialization
fails before writing when roles are incomplete, unresolved, unsupported, or
non-independent.

The same answers document may carry a partial typed `projectProfile` for the
project's exact root commands; source, test, and configuration paths; directory
and naming conventions; and implementation languages. Every leaf is explicitly
resolved, not applicable with a reason, or unresolved. Omitted leaves preserve
current `1.4.0` state during reinitialization; explicit unresolved leaves clear
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

The current handoff also reports the run-frozen acceptance attempt ceiling,
attempt counts in task-document order, `faultsRequiredFor` for the next verdict,
and bounded active `faults`. Hosts relay this context unchanged; they do not
calculate repair-loop transitions.

## Run limits and repeated-rejection recovery

`acceptanceAttemptCeiling` is an optional positive safe integer in
`state.project-config@1.4.0`. When it is absent, the runtime resolves it to
`3`; it is never unbounded. During initialization,
`host.init-answers@1.4.0` sets the value with a positive integer, clears an
existing override with `null`, and preserves the existing value when the field
is omitted. The resolved value is frozen in the run's `workflow-v2` start
event, so changing project configuration later cannot change an existing run.

`kratos objective TEXT --token-ceiling N` declares the optional positive token
ceiling at `objective.budget.tokens`. That value is also frozen when a run
starts. Token measurement is owned by the existing hook and usage pipeline; it
is not performed by the objective command.

For every rejected acceptance criterion, the runtime records the next attempt
in task-document order. Below the frozen acceptance ceiling, the same run
returns to `code` for repair. At the ceiling, it records a stop with a required
`code` or `specification` classification and diagnosis. An accepted verdict,
plain `start`, plain `continue`, and repeated commands never reset attempts.

Plain resume cannot release an active repeated-rejection stop. Use the explicit
host-neutral recovery command, addressed to the blocked source run:

```bash
kratos repair resolve AC-1.2.3 --run run-17 \
  --resolved-by reviewer-42 \
  --observation "The failing implementation was corrected and independently checked."
```

The human identity and observation are required; observations are bounded to
2,048 non-control characters and must contain a non-whitespace character. A
`code` classification rejects `--next-run`, resets only that criterion, and
returns the same run to `code` only after all active repair stops have been
resolved. Repeating the same correlation is a no-op only when the original
criterion, classification, target run, human input, and recovery artifact
bindings match exactly; a divergent retry is a revision conflict.

A `specification` classification requires a fresh run identifier:

```bash
kratos repair resolve AC-1.2.3 --run run-17 \
  --resolved-by owner-7 \
  --observation "The acceptance criterion must be replaced after specification review." \
  --next-run run-18
```

Resolve every active `code` stop before a `specification` stop. A spec-first
request is refused without changing the source run. The successful command
records the resolution against `run-17`, preserves its history and blocked
state, creates `run-18` at `spec`, freezes new run limits, and requires a new
specification approval. The restart ticket retires every affected source AC
identifier; a corrected plan must use new identifiers. Repeating the exact same
resolution correlation after the active-run pointer changes is still a no-op.

Repeated rejection and token exhaustion are independent. The gate can report
`blocked.stop_loss_rejections` and `blocked.stop_loss_budget` together (and can
also retain `blocked.stop_loss_flag`); resolving a repair stop does not unlock a
token stop, and `unlock stop-loss` does not reset rejection attempts.

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
proposal digest, plan digest, plan time, and `Apply argv`, a JSON string array
that is the shell-neutral apply authority. POSIX and PowerShell commands are
derived displays; the legacy `Apply command` line remains the POSIX rendering
for compatibility. Use the argv array directly when a launcher accepts an
executable plus arguments. Its general grammar is:

```bash
kratos memory <promote|merge|archive> --root PATH proposal.json \
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

## Configuration migration commands

Preview a pre-`1.4.0` configuration with current answers from a file:

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
