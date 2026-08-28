# Workflow Hooks Design

Date: 2026-08-28
Status: APPROVED
Approval source: GitHub issue #135 and the approved brainstorming design

## 1. Outcome

Claude Code and Codex ship the same logical workflow hooks. Native events are
normalized before they cross the runtime boundary, projects without Kratos
state are unaffected, and the runtime receives the session facts needed to
enforce stop-loss, pre-write scope, failure capture, and session finalization.

## 2. Host boundary

One declarative catalogue defines four logical observations:

- `tool.before` for structured pre-write enforcement;
- `tool.failed` for a failed tool and its latest token sample;
- `session.sample` for monotonic cumulative token usage;
- `session.end` for the final sample, telemetry publication, and cache cleanup.

The build renders both native hook manifests from this catalogue. Claude Code
and Codex adapters translate native payloads into the same versioned
observation bytes. Each observation is staged in the project-local transient
cache and then named only by project-relative reference and SHA-256 digest in
the existing `host.operation-message@1.0.0` hook envelope. Raw host events do
not reach runtime policy.

Every hook process exits zero. When shared runtime discovery finds no `.brain`,
the hook returns empty success without reading a transcript, staging an
artifact, or spawning the CLI. A present but unusable marker is not absence:
pre-write handling fails closed, while observational hooks retain local
recovery material and do not block the host action.

## 3. Contracts and state

The closed catalogue gains four additive v1 contracts:

- `host.hook-observation` for the normalized observation union;
- `state.run-usage` for run-global totals, per-session cursors, budget epochs,
  and latched stop-loss evidence;
- `state.failure-candidate` for immutable digest-addressed candidate records;
- `state.session-telemetry` for one finalized record per session.

Run usage is stored beneath the active run. Failure candidates live at
`.brain/03-memory/candidates/<fingerprint>.json`; finalized telemetry lives
under `.brain/03-memory/telemetry/`; open delivery and telemetry state exists
only under `.brain/03-memory/.cache/hooks/<session>/`.

Gross usage counts all processed input, including cache reads and cache writes,
plus output, counting reasoning exactly once. Adapters normalize disjoint host
usage fields into one monotonic cumulative count. A sample contributes only the
increase from the last accepted count for that session. Duplicate,
out-of-order, or regressing values never subtract usage.

All host and subagent sessions with distinct identifiers contribute to one
active-run total. At `epochUsed >= allocation`, the runtime latches
`stopLoss.exhausted`. If a configured budget cannot be measured reliably, the
runtime latches `stopLoss.tripped` with a stable measurement-failure result.
Retries and ordinary gate recording cannot clear either latch.

`unlock stop-loss --run <id>` is the only clearing authority. It preserves the
legacy run-bound interactive confirmation contract, records the recovery,
retains the historical total, starts a new budget epoch at the current total,
and clears both flags. `gates record --stop-loss clear` is refused and directs
the caller to the recovery operation.

## 4. Failure candidates and telemetry

A candidate carries canonical tool family, failure class, nullable exit code,
first observation time, and at most 2 KiB of sanitized UTF-8 diagnostic text.
Sanitization normalizes line endings, removes control characters, replaces the
project root and other absolute paths, and redacts deterministic credential
patterns. Raw tool payloads and raw output never enter canonical state or the
event log.

The candidate fingerprint hashes the canonical diagnostic tuple and excludes
time and session identity. Repeating an identical failure therefore observes
the same immutable candidate and creates no second entry. Near-duplicate
merging and promotion remain owned by issue #140.

Session telemetry is accumulated in a transient cache record. `session.end`
publishes it exactly once and deletes the cache only after the transaction
commits. An interruption retains the cache for an idempotent retry.

## 5. Security and failure policy

Only the runtime mutates canonical state. Safe staging uses exclusive creation,
bounded I/O, root containment, and symlink checks. A hook may invoke only the
packaged runtime with a fixed argument vector, timeout, and output limit. Hooks
do not import a model or network SDK, open sockets, or execute project-provided
commands.

Pre-write timeout, malformed output, or runtime failure denies the mutation.
Sampling, failure capture, and session-finalization failures preserve the host
action, emit only stable bounded diagnostics, and leave recovery material.

## 6. Compatibility

The host operation and gate contracts remain at v1. Existing projects require
no migration: all new records are created lazily, and a missing record means no
observation has yet been recorded. Existing stop-loss and write-guard reason
codes retain their meanings. Statistics/reporting remains issue #31, and
candidate promotion/curation remains issue #140.

## 7. Verification

Evidence must cover the four logical observations across both hosts with and
without state; threshold, overrun, retry, restart, concurrent-session,
measurement-fault, and unlock behavior; candidate sanitization and exact
deduplication; interrupted session finalization; no model/network calls; and
equivalent normalized messages for Claude Code and Codex. Focused tests run
before the complete `npm run verify` release gate.
