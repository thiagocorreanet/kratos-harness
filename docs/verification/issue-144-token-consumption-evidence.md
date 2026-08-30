# Issue #144 token-consumption measurement evidence

Date: 2026-08-30
Issue: #144 (`SDD-07a`)
Implementation HEAD verified: `466ca8d5416f57775f7b6885d9f3597e5956500d`
Scope: runtime-owned phase measurements, numeric run usage, explicit metrics
refresh, recovery, and equivalent Claude Code and Codex relays

## Acceptance-criterion evidence matrix

| Acceptance criterion | Exact executable evidence | Observed evidence |
| --- | --- | --- |
| A completed phase produces exactly one physical JSONL record keyed by run and phase; a repeated observation updates or no-ops that line. | `tests/phase-measurement-domain.test.ts` — `replaces the same run and phase instead of appending a duplicate`; `tests/phase-measurement-runtime.test.ts` — `starts one runtime-resolved record and physically deduplicates its retry`, `samples usage into the same physical record and no-ops a repeated total`, and `completes one keyed record after an agent fact changes the revision`. | The focused acceptance command passed. The tests assert one record for `(runId, phase)`, byte-identical retries, keyed replacement, and one completed line after a revision-changing fact. |
| A measured finished run reports numeric usage in `budgets` and its evidence bundle. | `tests/phase-measurement-runtime.test.ts` — `reports validated measured usage numerically without inventing legacy zero`; `tests/diagnostics.test.ts` — `reports bounded and unbounded budgets honestly`. | The focused acceptance command passed. Measured `totalGrossTokens: 40` renders as `Used: 40` and persists as numeric `bundle.budget.used`; absent or malformed legacy usage stays unknown rather than becoming zero. |
| Calibration requires five completed samples per phase, recommends nearest-rank token p95, and names an undersized sample without guessing. | `tests/phase-metrics-rollup.test.ts` — `uses literal nearest-rank positions over ascending integers`, `excludes interrupted records from distributions and completed sources`, `refuses calibration at four samples and recommends nearest-rank p95 at five`, and `renders all six phases in canonical order with deterministic absence markers`. | The focused acceptance command passed. Four completed samples produce no recommendation and `observed: 4, required: 5`; five recommend the literal nearest-rank p95. The rendered report names `n/5` shortfalls. |
| `.brain/03-memory/task_metrics.md` changes only through `metrics refresh`. | `tests/phase-metrics-rollup.test.ts` — `writes the rollup while returning the six-phase calibration advisory`, `returns refresh success only when all six phases have five completed samples`, and `leaves the committed rollup unchanged for non-refresh diagnostics`. | The focused acceptance command passed. Refresh writes the report; `stats` and `budgets` preserve its prior bytes. |
| `session.end` and later recovery both prevent a phase from remaining permanently `running`. | `tests/phase-measurement-runtime.test.ts` — `interrupts the matching running record on session end`, `recovers an accepted stale running phase before starting the next phase`, and `recovers unrelated stale running work as interrupted on the next phase start`; `tests/phase-metrics-rollup.test.ts` — `recovers every unaccepted running record as interrupted using valid run usage` and `recovers a running record as completed at its canonical accepted transition`. | The focused acceptance command passed. Session closure, next-start recovery, and refresh recovery all close stale work as completed or interrupted according to canonical events. |
| Recorded role, model, and effort come from the runtime-resolved assignment; agent prose cannot change them. | `tests/phase-measurement-runtime.test.ts` — `records the code assignment from runtime resolution, never agent text`, `refuses a same-phase start whose resolved assignment genuinely changed`, and `refuses a phase start bound to a different assignment`. | The focused acceptance command passed. The code record contains the runtime-selected implementer, canonical model, and effort, contains no forged model text, and rejects conflicting assignments. |
| A measured overrun latches the existing stop-loss gate. | `tests/workflow-hook-runtime.test.ts` — `trips a run budget and keeps the latch on an identical retry`; `tests/phase-measurement-runtime.test.ts` — `samples usage into the same physical record and no-ops a repeated total`. | The focused acceptance command passed. The same numeric run ledger updates phase usage and changes stop-loss facts to exhausted; an identical retry preserves the latch and counters. |
| Claude Code and Codex relay equivalent phase lifecycle observations. | `tests/phase-agent-relay-distribution.test.ts` — `starts the exact lifecycle before launch and records afterward`, `returns the runtime start refusal without launch or record`, `refuses missing trusted session identity before start or launch`, and `emits byte-equivalent lifecycle artifacts and equivalent operation envelopes`. | The focused acceptance command passed. Both built packages produce byte-equivalent normalized lifecycle artifacts and equivalent host-operation envelopes, and neither launches after an invalid or refused start. |
| Malformed raw data or a transactional failure cannot partially replace the raw log or committed report. | `tests/phase-metrics-rollup.test.ts` — `preserves prior raw and rollup bytes when the raw log is malformed`, `preserves raw and rollup bytes when a running record event stream is corrupt`, and `publishes neither recovered raw data nor a rollup after a stale precondition`. | The focused acceptance command passed. Invalid input and corrupt reconciliation preserve both prior files, while a stale precondition publishes neither half of the recovery/report transaction. |
| Focused verification and the complete repository gate pass. | Exact commands and complete summaries appear under [Fresh command evidence](#fresh-command-evidence). | Focused: 7 files and 76 tests, exit 0. Full gate: 196 files and 4,880 tests in both ordinary and coverage runs; every remaining gate passed; exit 0. |

## Required documentation and audit evidence

| Required item | Evidence |
| --- | --- |
| Raw ignored state versus deliberately refreshed committed state | `tests/init-skeleton.test.ts` — `writes the state ignore rules byte for byte` and `classifies every path written by initialization as deliberately committed or ignored` prove that `.brain/03-memory/task_log.jsonl` is ignored and `.brain/03-memory/task_metrics.md` is tracked. `tests/phase-metrics-rollup.test.ts` proves that only refresh replaces the tracked report. Public behavior is documented in `README.md`, `docs/user/commands.md`, and `docs/user/configuration-and-state.md`. |
| Six phases and exact statistics policy | `tests/phase-metrics-rollup.test.ts` — `renders all six phases in canonical order with deterministic absence markers` pins `prd`, `spec`, `plan`, `code`, `review`, and `acceptance` plus token/duration min, p50, p95, and max. The same file pins nearest rank and the minimum of five completed phase samples. |
| Interrupted exclusion and deterministic recovery | The named lifecycle and report tests in the acceptance matrix prove that interrupted records remain counted but do not enter distributions, and that session end, next start, and explicit refresh close stale running records. `docs/user/migration-and-recovery.md` publishes the operator procedure. |
| Runtime-authoritative role, model, and effort | The named assignment tests in the acceptance matrix prove runtime resolution and forged-prose exclusion. `docs/user/hosts.md` documents that the host relays lifecycle and nullable observed provenance but owns no selection or counter policy. |
| Numeric usage, stop-loss, and explicit budget authority | The named runtime and diagnostics tests prove numeric used values and the shared stop-loss ledger. `packages/runtime/src/domain/cli/diagnostics.ts` constructs the refresh write set from only the raw log and tracked report; calibration has no effect that writes objective state. `docs/user/commands.md` states that measurement and recommendations never create, raise, or replace the explicit objective allocation. |
| Host-neutral compatibility | The built-package parity test named above exercises Claude Code and Codex with the same lifecycle values and ordering. `docs/user/hosts.md` documents the common `host.phase-lifecycle@1.0.0` ingress and start-before-launch refusal. |
| State and migration impact | `state.phase-measurement@1.0.0`, `host.phase-lifecycle@1.0.0`, reason-catalog revision 1.10, and manifest revision 1.5 are additive. Existing projects require no state rewrite: the empty ignored log is valid and records are created lazily. The tracked report remains operator-refreshed state. |
| Security impact | The schemas restrict records to bounded identifiers, timestamps, counters, assignment metadata, and nullable observed identity. Prompts, transcripts, agent prose, credentials, and raw host payloads do not enter the ledger. Hooks remain local, model-free, and network-free. Malformed data, assignment conflicts, corrupt recovery events, and stale preconditions fail closed. |
| Generated contracts and predecessor bytes | `npx --yes npm@11.16.0 run contracts:check` verified 41 schemas, 14 legacy profiles, and current generated types. The predecessor-byte audit compared every schema and reason catalog that existed at `71c03c5` and returned no diff, exit 0. |
| Placeholder and diff hygiene | The feature-file placeholder scan found no `TODO`, `TBD`, `FIXME`, or `XXX` match (ripgrep exit 1 means no matches). `git diff --check` produced no output, exit 0. Public documentation is English and the full spellcheck/English gates passed. |

## Fresh command evidence

All commands ran on Linux x64 with Node.js `v24.19.0` and npm `11.16.0`.

### Focused acceptance

```bash
npx --yes npm@11.16.0 test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-runtime.test.ts tests/diagnostics.test.ts
```

```text
Test Files  7 passed (7)
Tests       76 passed (76)
Duration    7.89s
Exit code   0
```

### Complete repository gate

```bash
npx --yes npm@11.16.0 run verify
```

```text
Format       passed
Spelling     216 Markdown files, 0 issues
English      passed
Lint         passed
Typecheck    passed
Tests        196 files, 4,880 tests passed
Coverage     196 files, 4,880 tests passed
Statements   93.14% (8,090/8,685)
Branches     88.45% (6,262/7,079)
Functions    95.64% (1,428/1,493)
Lines        93.93% (7,407/7,885)
Mutation     3/3 (100.00%)
Gaps         10/10 found, 0 false gaps
Performance  1,208,198/1,500,000 runtime bytes; 181,547/250,000 schema bytes
Oracle       12 surfaces, 4 PRD anchors, 3 binaries verified
Parity       discovery verified; 0/400 implemented parity cases
Results      76 reasons, exits 0-5, 6 examples verified
Contracts    41 schemas, 14 legacy profiles, generated types current
Differential 2/2 public self-test scenarios equal
Build        Codex and Claude Code artifacts produced
Packages     Codex and Claude Code verification passed
Benchmark    help p95 113.062723 ms; version p95 97.74317 ms;
             handshake p95 102.456386 ms; bundle 1,576,258 bytes
Exit code    0
```

The package test suites intentionally print child-process refusal traces for
tampered artifacts. Both aggregate Vitest runs passed, and the later canonical
package verification passed for Codex and Claude Code.

### State and contract audits

```bash
npx --yes npm@11.16.0 test -- --run tests/init-skeleton.test.ts && npx --yes npm@11.16.0 run contracts:check
```

```text
Test Files  1 passed (1)
Tests       23 passed (23)
Contracts   41 schemas; 14 legacy profiles; generated types current
Exit code   0
```

```bash
git ls-tree -r --name-only 71c03c5 -- schemas packages/contracts/catalogs | rg '(\.schema\.json$|reason-codes\.v1(\.[1-9])?\.json$)' | sort | xargs git diff --exit-code 71c03c5..HEAD --
```

```text
Output      none; every predecessor schema and reason catalog is byte-identical
Exit code   0
```

```bash
git diff --check
```

```text
Output      none
Exit code   0
```

```bash
rg -n 'TODO|TBD|FIXME|XXX' README.md docs/user docs/specs/2026-08-30-token-consumption-measurement-spec.md docs/superpowers/specs/2026-08-30-token-consumption-measurement-design.md docs/superpowers/plans/2026-08-30-token-consumption-measurement.md packages/runtime/src/domain/measurements packages/runtime/src/composition/measurements.ts tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/phase-agent-relay-distribution.test.ts
```

```text
Output      none
Exit code   1 (ripgrep's no-match status)
```

## Ready-to-use pull request body

The following text is ready to copy into a pull request description. No pull
request was opened or pushed while preparing this evidence.

```markdown
Closes #144

Work ID: `SDD-07a`

### Outcome and design

Measure gross tokens and duration once per workflow phase, report numeric run
usage through the existing budget and evidence surfaces, and publish deliberate
phase distributions only through `metrics refresh`. Runtime-resolved assignment
metadata and the run-usage ledger remain authoritative.

### Compatibility and public contracts

Claude Code and Codex now relay the same closed phase-start lifecycle before
launch and refuse launch when runtime start is refused. The new
`state.phase-measurement@1.0.0` and `host.phase-lifecycle@1.0.0` contracts,
manifest revision 1.5, and reason-catalog revision 1.10 are additive. Published
predecessor schemas and reason catalogs remain byte-identical.

### State, migration, and rollback impact

Raw keyed measurements remain local and ignored at
`.brain/03-memory/task_log.jsonl`. The tracked
`.brain/03-memory/task_metrics.md` changes only through explicit
`metrics refresh`. Existing projects need no state rewrite or migration; an
empty raw log is valid and records are created lazily. Malformed input, corrupt
recovery events, assignment conflicts, or stale transactional preconditions
preserve the prior raw/report state. Rollback is removal of the additive runtime
and host behavior while retaining any local raw data or previously committed
report for review.

### Security impact

Measurement stores bounded identifiers, timestamps, counters, and assignment
metadata only. It stores no prompts, transcripts, agent prose, credentials, or
raw host payloads. Identity comes from runtime resolution; host-observed model
and effort are separate nullable provenance. Hooks call neither a model nor the
network, and invalid lifecycle or state fails closed before phase launch or
report replacement.

### Deterministic verification

- Acceptance evidence record:
  `docs/verification/issue-144-token-consumption-evidence.md`
- Focused verification: `npx --yes npm@11.16.0 test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-runtime.test.ts tests/diagnostics.test.ts` — PASS, 7 files and 76 tests, exit 0
- Full repository verification: `npx --yes npm@11.16.0 run verify` — PASS, 196 files and 4,880 tests in both ordinary and coverage runs; all remaining gates passed, exit 0
- State/contract audit: `npx --yes npm@11.16.0 test -- --run tests/init-skeleton.test.ts && npx --yes npm@11.16.0 run contracts:check` — PASS, 23 tests; 41 schemas, 14 legacy profiles, generated types current, exit 0
- Diff hygiene: `git diff --check` — PASS, no output, exit 0
- Remote CI: not observed; no green-CI claim is made

### Prompt and model evaluations

Not applicable. Deterministic runtime, contract, transaction, and built-package
tests cover the behavior.

### Evidence pointer

Every acceptance criterion, exact named test, compatibility/state/security
impact, command, and fresh result is mapped in
`docs/verification/issue-144-token-consumption-evidence.md`.
```
