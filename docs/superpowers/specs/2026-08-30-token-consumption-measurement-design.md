# Token Consumption Measurement Design

Date: 2026-08-30
Status: APPROVED
Issue: #144 (`SDD-07a`)
Approval source: the user's approved brainstorming design

## 1. Outcome

Kratos measures gross token consumption and duration for every completed
workflow phase. The same run-usage ledger drives phase measurement, budget
reporting, evidence bundles, and the stop-loss gate, so the system has one
spending authority instead of competing counters.

Raw measurements remain machine-local in `.brain/03-memory/task_log.jsonl`.
The committed `.brain/03-memory/task_metrics.md` changes only through the
explicit `metrics refresh` operation.

## 2. Authority and host neutrality

The runtime owns phase identity, lifecycle, assignment resolution,
deduplication, token deltas, duration, recovery, statistics, calibration, and
reason codes. Claude Code and Codex only normalize and relay lifecycle and
usage observations.

A phase start is bound to the runtime-produced `assignmentDigest`. The runtime
re-resolves the current assignment and records its host, role, canonical
model, and effort. Agent prose cannot provide or override those values.
Host-observed model and effort remain separate nullable provenance.

## 3. Raw phase ledger

Each JSONL line validates as `state.phase-measurement@1.0.0`. Its unique key is
`(runId, phase)`, and it records:

- feature, run, phase, session, and correlation identity;
- `running`, `completed`, or `interrupted` status;
- start, end, update, duration, and closed reason;
- starting, final, and consumed gross-token counts;
- the assignment digest and runtime-resolved host, role, model, and effort;
- nullable model and effort observed by the host.

The JSONL file is a canonical keyed set, not an append-only event stream. An
upsert validates every existing line, replaces the matching key, sorts by run
and workflow phase, and rewrites the file atomically with a byte precondition.
An identical observation is a byte-identical no-op. A different assignment
for an already-open key is refused rather than mixing two execution identities
inside one measurement.

Consumption is the non-negative delta of `RunUsageV1.totalGrossTokens` from
phase start to the latest accepted sample. This attributes every host and
subagent session contributing to the active run while the phase is open. The
runtime clock measures duration from accepted phase start to accepted phase
completion or interruption.

## 4. Lifecycle and recovery

The shared phase relay obtains a handoff, publishes a normalized `phase.start`
observation containing the session ID, correlation ID, assignment digest, and
occurrence time, and only then launches the selected phase agent. Both hosts
produce the same observation contract.

Usage samples update `usage.json`, stop-loss facts, and the open phase record in
one managed transaction. Validated `agent record` input may attach nullable
host-observed identity but does not close the phase. An accepted workflow
transition, including final `done`, closes it as `completed`. A later final
sample may raise its consumed-token count without changing its completion
time. `session.end` closes a still-running measurement as `interrupted`.

If a process dies without `session.end`, the next `phase.start` or
`metrics refresh` reconciles open entries against canonical workflow events.
An accepted transition closes the entry as recovered completion; otherwise it
is recovered as interrupted. No running entry survives a recovery boundary.

A phase-completion operation without a matching measurement start is refused
with a stable reason. Under a configured budget, an absent or malformed usage
sample retains the existing fail-closed measurement-fault behavior.

## 5. Rollup and calibration

`metrics refresh [--root <path>]` is a mutating operation dedicated to the
committed rollup. Existing `stats` and `budgets` commands remain read-only.
Refresh validates and reconciles the raw log, then renders phases in canonical
workflow order with:

- completed and interrupted counts;
- feature/run provenance for included samples;
- minimum, p50, p95, and maximum for consumed tokens and duration;
- a recommended phase budget when calibration is allowed.

There is no mean. Percentiles use nearest rank over ascending integers:
`ceil(ratio * sampleCount) - 1`. Calibration requires five completed samples
for the phase and recommends its token p95. Interrupted records remain visible
but do not count toward the minimum or any percentile.

With fewer than five completed samples, refresh still publishes the available
distribution, marks calibration as unavailable with `n/5`, and returns the
stable insufficient-sample advisory. Calibration is informative only: it never
creates or changes the explicit objective budget. A malformed raw line fails
closed and preserves the previous rollup byte for byte.

## 6. Reporting and stop-loss

Workflow observation reads validated `usage.json`. `budgets` and evidence
bundles use `totalGrossTokens` for `used`, so a measured finished run reports a
number. The existing explicit objective budget remains run-global and the
existing usage reducer continues to latch `gates.stopLoss`; phase metrics
observe that ledger rather than enforcing a second limit.

## 7. Compatibility and security

New payload contracts and reason codes are additive. Published predecessor
schemas and catalogs remain byte-identical. Existing projects need no
migration: the initialized empty log is valid, the path is already ignored,
and records are created lazily. The curated rollup remains tracked.

Only bounded identifiers, timestamps, counters, and assignment metadata enter
the measurement log. Prompts, transcripts, model prose, credentials, and raw
host payloads do not. Hooks continue to call neither a model nor the network.

## 8. Verification

Evidence must prove physical deduplication, deterministic distribution,
undersized calibration refusal, explicit-refresh-only rollup mutation,
interrupted-session closure and crash recovery, runtime-owned assignment
metadata, equivalent host lifecycle messages, numeric finished-run usage,
transactional failure safety, and a measured stop-loss overrun.

