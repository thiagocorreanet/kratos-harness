# Issue #144 token-consumption measurement evidence

Date: 2026-08-30
Issue: #144 (`SDD-07a`)
Runtime/test HEAD before this documentation update:
`e40c6b5e1a6f86de38ccc5652ad09761ef7c11fa`
Scope: runtime-owned phase measurements, numeric run usage, explicit metrics
refresh, recovery, and equivalent Claude Code and Codex relays

## Acceptance-criterion evidence matrix

| Acceptance criterion | Exact executable evidence | Observed evidence |
| --- | --- | --- |
| A completed phase produces exactly one physical JSONL record keyed by run and phase; a repeated observation updates or no-ops that line. | `tests/phase-measurement-domain.test.ts` — `replaces the same run and phase instead of appending a duplicate` and `accepts 256 contributors including the launcher and rejects a 257th`; `tests/phase-measurement-runtime.test.ts` — `starts one runtime-resolved record and physically deduplicates its retry`, `samples usage into the same physical record and no-ops a repeated total`, and `completes one keyed record after an agent fact changes the revision`. | The focused acceptance command passed. The tests assert one record for `(runId, phase)`, byte-identical retries, keyed replacement, one completed line after a revision-changing fact, and the closed 256-contributor bound. |
| A measured finished run reports numeric usage in `budgets` and its evidence bundle. | `tests/phase-measurement-runtime.test.ts` — `reports validated measured usage numerically without inventing legacy zero`; `tests/diagnostics.test.ts` — `reports bounded and unbounded budgets honestly`. | The focused acceptance command passed. Measured `totalGrossTokens: 40` renders as `Used: 40` and persists as numeric `bundle.budget.used`; absent or malformed legacy usage stays unknown rather than becoming zero. |
| Calibration requires five completed samples per phase, recommends nearest-rank token p95, and names an undersized sample without guessing. | `tests/phase-metrics-rollup.test.ts` — `uses literal nearest-rank positions over ascending integers`, `excludes interrupted records from distributions and completed sources`, `refuses calibration at four samples and recommends nearest-rank p95 at five`, and `renders all six phases in canonical order with deterministic absence markers`. | The focused acceptance command passed. Four completed samples produce no recommendation and `observed: 4, required: 5`; five recommend the literal nearest-rank p95. The rendered report names `n/5` shortfalls. |
| `.brain/03-memory/task_metrics.md` changes only through `metrics refresh`. | `tests/phase-metrics-rollup.test.ts` — `writes the rollup while returning the six-phase calibration advisory`, `returns refresh success only when all six phases have five completed samples`, and `leaves the committed rollup unchanged for non-refresh diagnostics`. | The focused acceptance command passed. Refresh writes the report; `stats` and `budgets` preserve its prior bytes. |
| `session.end` and later recovery both prevent a phase from remaining permanently `running`. | `tests/phase-measurement-runtime.test.ts` — `interrupts the matching running record on session end`, `recovers an accepted stale running phase before starting the next phase`, `recovers unrelated stale running work as interrupted on the next phase start`, and `recovers another run from its own accepted transition and retains it through refresh`; `tests/phase-metrics-rollup.test.ts` — `recovers every unaccepted running record as interrupted using valid run usage` and `recovers a running record as completed at its canonical accepted transition`. | The focused acceptance command passed. Session closure, next-start recovery, and refresh recovery close stale work as completed or interrupted according to that record's own canonical run events and usage. The cross-run accepted record remains completed through a later refresh and enters the report once. |
| Recorded role, model, and effort come from the runtime-resolved assignment; agent prose cannot change them. | `tests/phase-measurement-runtime.test.ts` — `records the code assignment from runtime resolution, never agent text`, `refuses a same-phase start whose resolved assignment genuinely changed`, and `refuses a phase start bound to a different assignment`. | The focused acceptance command passed. The code record contains the runtime-selected implementer, canonical model, and effort, contains no forged model text, and rejects conflicting assignments. |
| A measured overrun latches the existing stop-loss gate. | `tests/phase-measurement-runtime.test.ts` — `closes an over-budget measured phase and latches stop-loss in the same lifecycle`, `completes from a claimed subagent without a direct launcher hook and retains it through refresh`, `reallocates an out-of-order launcher checkpoint across completed phases`, `selects and claims an active-run phase ahead of a historical non-launcher owner`, and `reallocates only an out-of-order subagent while preserving principal contributions`; `tests/workflow-hook-runtime.test.ts` — `trips a run budget and keeps the latch on an identical retry`. | The focused acceptance command passed. The direct integration starts an assignment-bound phase under a 100-token objective budget, closes its 125-token session, and asserts the interrupted measurement, numeric run usage, runtime assignment, exhausted epoch, and `stopLoss.exhausted: true` together. Checkpoint tests prove atomic contributor claim and chronological reallocation of only the delayed contributor while preserving other contributions and equality with the same run ledger that latches stop-loss. |
| Claude Code and Codex relay equivalent phase lifecycle observations. | `tests/phase-agent-relay-distribution.test.ts` — `starts the exact lifecycle before launch and records afterward`, `returns the runtime start refusal without launch or record`, `refuses missing trusted session identity before start or launch`, and `emits byte-equivalent lifecycle artifacts and equivalent operation envelopes`. | The focused acceptance command passed. Both built packages produce byte-equivalent normalized lifecycle artifacts and equivalent host-operation envelopes, and neither launches after an invalid or refused start. |
| Malformed raw data or a transactional failure cannot partially replace the raw log or committed report. | `tests/phase-measurement-runtime.test.ts` — `refuses a new phase when another running record has corrupt events`, `fails closed when one contributor belongs to multiple phase records`, `fails closed when an unowned sample has multiple eligible running phases`, `fails closed when an accepted sample has no contributor or running phase owner`, `fails closed when prior run usage has no durable contributor owner`, `refuses a 257th contributor before publishing usage, gates, measurements, or telemetry`, `refuses a 257th phase-start contributor without throwing or publishing state`, `fails closed when a later phase checkpoint contradicts chronological cumulative usage`, `fails closed when the cross-run measurement owner has missing usage`, and `fails closed when the cross-run measurement owner has malformed gates`; `tests/phase-measurement-domain.test.ts` — `refuses a checkpoint allocation larger than the phase gross-token total`; `tests/phase-metrics-rollup.test.ts` — `preserves raw and rollup bytes when multiple running phases have no usage residual`, `preserves prior raw and rollup bytes when the raw log is malformed`, `preserves raw and rollup bytes when a running record event stream is corrupt`, and `publishes neither recovered raw data nor a rollup after a stale precondition`. | The focused acceptance command passed. Corrupt recovery, multiple running owners with or without residual usage, ambiguous contributor records, absent ownership, orphaned prior usage, contributor overflow through samples or lifecycle starts, contradictory checkpoint chronology/allocation, and invalid owning-run state all refuse without partial measurement, usage, gate, telemetry, or report writes. Invalid refresh input and stale preconditions preserve both sides of the recovery/report transaction. |
| Focused verification and the complete repository gate pass. | Exact commands and complete summaries appear under [Fresh command evidence](#fresh-command-evidence). | Focused acceptance passed 7 files and 134 tests, exit 0. The complete gate passed 196 files and 4,941 tests in both ordinary and coverage runs, then passed every remaining gate, exit 0. |

## Required documentation and audit evidence

| Required item | Evidence |
| --- | --- |
| Raw ignored state versus deliberately refreshed committed state | `tests/init-skeleton.test.ts` — `writes the state ignore rules byte for byte` and `classifies every path written by initialization as deliberately committed or ignored` prove that `.brain/03-memory/task_log.jsonl` is ignored and `.brain/03-memory/task_metrics.md` is tracked. `tests/init-command.test.ts` — `creates measurement artifacts once and preserves their bytes while refreshing managed instructions` proves re-init preserves non-canonical raw/report bytes while updating the managed instruction section. Its parameterized `rejects concurrent raw log creation without publishing partial initialization` and `rejects concurrent rollup creation without publishing partial initialization` cases prove missing-file preconditions, exact concurrent-byte preservation, `runtime.revision_conflict`, and no partial init writes. `tests/phase-metrics-rollup.test.ts` proves that only refresh replaces the tracked report. |
| Six phases and exact statistics policy | `tests/phase-metrics-rollup.test.ts` — `renders all six phases in canonical order with deterministic absence markers` pins `prd`, `spec`, `plan`, `code`, `review`, and `acceptance` plus token/duration min, p50, p95, and max. The same file pins nearest rank and the minimum of five completed phase samples. |
| Interrupted exclusion and deterministic recovery | The named lifecycle and report tests in the acceptance matrix prove that interrupted records remain counted but do not enter distributions, that each stale record is reconciled from its own feature/run events and usage, and that cross-run accepted recovery survives a later refresh. Corrupt cross-run evidence refuses the next phase without partial writes. `docs/user/migration-and-recovery.md` publishes the operator procedure. |
| Runtime-authoritative role, model, and effort | The named assignment tests in the acceptance matrix prove runtime resolution and forged-prose exclusion. `docs/user/hosts.md` documents that the host relays lifecycle and nullable observed provenance but owns no selection or counter policy. |
| Numeric usage, stop-loss, contributor attribution, and explicit budget authority | `tests/phase-measurement-runtime.test.ts` — `closes an over-budget measured phase and latches stop-loss in the same lifecycle` directly ties a 125-token measured closure to the explicit 100-token objective allocation and existing stop-loss facts. `completes from a claimed subagent without a direct launcher hook and retains it through refresh`, `reallocates an out-of-order launcher checkpoint across completed phases`, `selects and claims an active-run phase ahead of a historical non-launcher owner`, and `reallocates only an out-of-order subagent while preserving principal contributions` prove contributor claim, chronological recomputation, and isolation. The named numeric-reporting and diagnostics tests prove numeric used values. Calibration has no effect that writes objective state. |
| Host-neutral compatibility | The built-package parity test named above exercises Claude Code and Codex with the same lifecycle values and ordering. `docs/user/hosts.md` documents the common `host.phase-lifecycle@1.0.0` ingress and start-before-launch refusal. |
| State and migration impact | `tests/phase-measurement-contracts.test.ts` — `accepts the exact pre-ownership v1 measurement shape` and `accepts a legacy v1 measurement without contributor checkpoints`; `tests/phase-measurement-domain.test.ts` — `normalizes the exact legacy v1 record and renders canonical ownership`; and `tests/phase-metrics-rollup.test.ts` — `canonicalizes a checkpoint-less v1 record without changing its distribution` prove compatibility and lazy normalization. `state.phase-measurement@1.0.0`, `host.phase-lifecycle@1.0.0`, reason-catalog revision 1.10, and manifest revision 1.5 are additive. Existing projects require no standalone state rewrite; the empty ignored log is valid and records are created lazily. |
| Security impact | The schemas restrict records to bounded identifiers, timestamps, counters, at most 256 sorted contributor identifiers and cumulative/time checkpoints, assignment metadata, and nullable observed identity. Prompts, transcripts, agent prose, credentials, and raw host payloads do not enter the ledger. Hooks remain local, model-free, and network-free. Missing, overlapping, or ambiguous contributor ownership, contributor overflow, contradictory checkpoint chronology/allocation, invalid owning-run state, assignment conflicts, corrupt recovery events, and stale preconditions fail closed. Host staging refuses observed symlinks and escapes; malicious same-account ancestor replacement is explicitly outside the portable relay threat model and requires OS-level isolation. |
| Generated contracts and predecessor bytes | `npx --yes npm@11.16.0 run contracts:check` verifies the registered schemas, legacy profiles, and current generated types. The predecessor-byte audit compares every schema and reason catalog that existed at the true feature merge base `f3bd622a82b4ee2ffa1a24bd083d8184d5ae7ced`. |
| Placeholder and diff hygiene | The merge-base-scoped hygiene commands under [Feature-range hygiene](#feature-range-hygiene) inspect every added, copied, modified, or renamed feature file at its current path without scanning unrelated repository files. The scan found no unresolved placeholder marker, and feature-range `git diff --check` produced no output. Public documentation is English and the spelling/English gates passed. |

## Fresh command evidence

All commands ran on Linux x64 with Node.js `v24.19.0` and npm `11.16.0`.

### Focused acceptance

```bash
npm test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-runtime.test.ts tests/diagnostics.test.ts
```

```text
Test Files  7 passed (7)
Tests       134 passed (134)
Duration    15.94s
Exit code   0
```

### Complete repository gate

```bash
npm run verify
```

```text
Format       passed
Spelling     217 Markdown files, 0 issues
English      passed
Lint         passed
Typecheck    passed
Tests        196 files, 4,941 tests passed
Coverage     196 files, 4,941 tests passed
Statements   93.10% (8,409/9,032)
Branches     88.38% (6,537/7,396)
Functions    95.88% (1,491/1,555)
Lines        93.87% (7,712/8,215)
Mutation     3/3 (100.00%)
Gaps         10/10 found, 0 false gaps
Performance  1,240,327/1,500,000 runtime bytes; 182,199/250,000 schema bytes
Oracle       12 surfaces, 4 PRD anchors, 3 binaries verified
Parity       402 keys verified; 0/400 implemented parity cases
Results      76 reasons, exits 0-5, 6 examples verified
Contracts    41 schemas, 14 legacy profiles, generated types current
Differential 2/2 public self-test scenarios equal
Build        Codex and Claude Code artifacts produced
Packages     Codex and Claude Code verification passed
Benchmark    help p95 151.122725 ms; version p95 134.850815 ms;
             handshake p95 167.658595 ms; bundle 1,604,977 bytes
Exit code    0
```

The package test suites intentionally print child-process refusal traces for
tampered artifacts. Both aggregate Vitest runs passed, and the later canonical
package verification passed for Codex and Claude Code.

### State and contract audits

```bash
npx --yes npm@11.16.0 test -- --run tests/init-command.test.ts tests/init-skeleton.test.ts && npx --yes npm@11.16.0 run contracts:check
```

```text
Test Files  2 passed (2)
Tests       53 passed (53)
Duration    2.50s
Contracts   41 schemas; 14 legacy profiles; generated types current
Exit code   0
```

```bash
issue_144_base=$(git merge-base main HEAD)
git ls-tree -r --name-only "$issue_144_base" -- schemas packages/contracts/catalogs | rg '(\.schema\.json$|reason-codes\.v1(\.[1-9])?\.json$)' | sort | xargs git diff --exit-code "$issue_144_base"..HEAD --
```

```text
Output      none; every predecessor schema and reason catalog is byte-identical
Exit code   0
```

### Feature-range hygiene

The baseline is explicit and verified as the feature merge base. The loop uses
NUL-delimited paths, scans all added/copied/modified/renamed feature files at
their current paths, and succeeds only when none contains an unresolved
placeholder marker.

```bash
issue_144_base=$(git merge-base main HEAD)
test "$issue_144_base" = f3bd622a82b4ee2ffa1a24bd083d8184d5ae7ced
git diff --check "$issue_144_base"
placeholder_pattern='TO''DO|T''BD|FIX''ME|X''XX'
placeholder_found=0
while IFS= read -r -d '' feature_file; do
  if rg -n -- "$placeholder_pattern" "$feature_file"; then
    placeholder_found=1
  fi
done < <(git diff --name-only --diff-filter=d "$issue_144_base" -z)
test "$placeholder_found" -eq 0
```

```text
Merge base   f3bd622a82b4ee2ffa1a24bd083d8184d5ae7ced
Diff check   no output
Placeholders no output across every non-deleted feature-range path
Exit code    0
```

## Ready-to-use pull request body

The following text is ready to copy into a pull request description. No pull
request was opened or pushed while preparing this evidence.

```markdown
# Pull request

## Linked issue and work ID

Closes #144

Work ID: `SDD-07a`

Approved sources:

- [objective specification](docs/specs/2026-08-30-token-consumption-measurement-spec.md)
- [approved design](docs/superpowers/specs/2026-08-30-token-consumption-measurement-design.md)
- [implementation plan](docs/superpowers/plans/2026-08-30-token-consumption-measurement.md)

No separate epic or dependency issue applies. The design follows the existing
[project-local state ADR](docs/adr/0003-project-local-brain-state.md) and
[host-adapter boundary ADR](docs/adr/0004-host-adapter-boundary.md); no new ADR was
needed for this additive feature.

## Outcome and design

Kratos previously exposed objective budgets and stop-loss facts while finished
runs could still report unknown usage and no durable per-phase measurement.
This change measures gross tokens and elapsed duration for each workflow phase,
reports numeric run usage through `budgets` and evidence bundles, and publishes
deliberate distributions through `metrics refresh`.

The runtime owns lifecycle, the `(runId, phase)` key, assignment resolution,
token deltas, recovery, statistics, and calibration. Both hosts only normalize
and relay phase start before launch. Raw measurements remain local; the tracked
report is an explicit projection. The existing run-usage ledger remains the one
usage authority for reporting and stop-loss. A previously unowned contributing
host or subagent session is claimed only by the sole eligible running phase.
Per-contributor cumulative/time checkpoints recompute chronological allocation
when observations arrive out of order. Only that contributor moves among
affected phase intervals, so delayed contribution cannot be charged to later
work or disturb another contributor.

Alternatives rejected:

- append-only duplicate phase observations, because retries must preserve one
  physical keyed record;
- host- or agent-declared identity and counters, because policy and assignment
  authority belong to the runtime;
- implicit report refresh from `stats` or `budgets`, because tracked report
  changes must be deliberate;
- automatic objective-budget changes from calibration, because recommendations
  are informative and the explicit objective allocation remains authoritative;
- a mean or interpolated percentile, because the approved policy is integer
  nearest-rank p95 with five completed samples per phase.

Out of scope: redesigning `stats` or `budgets`, mutating the explicit objective
budget, storing prompts/transcripts/agent prose, and assigning host-specific
runtime policy.

## Compatibility and public contracts

Claude Code and Codex now relay the same closed phase-start lifecycle before
launch and refuse launch when runtime start is refused. The
`state.phase-measurement@1.0.0` and `host.phase-lifecycle@1.0.0` contracts,
manifest revision 1.5, and reason-catalog revision 1.10 are additive. Published
predecessor schemas and reason catalogs remain byte-identical, and existing
payload revisions keep their registered identities. New `metrics.*` reasons use
their cataloged exit/status policy; `metrics.calibration_insufficient` is a
successful advisory, while invalid logs and lifecycle conflicts fail closed.

The public command addition is `metrics refresh [--root PATH]`. `stats` and
`budgets` remain read-only. The raw log is a keyed JSONL set, and the tracked
report renders all six phases with completed/interrupted counts, bounded
feature/run provenance, and token/duration min, p50, p95, and max. Public user,
host, state, migration, security, schema, and compatibility documentation is
updated.

Each phase record carries its sorted, unique `contributingSessionIds`, including
the phase launcher, with a closed maximum of 256. Pre-ownership `1.0.0` records
remain readable and gain canonical launcher ownership on their next raw-log
rewrite. The optional-wire `contributorCheckpoints` field stores at most 256
bounded session/cumulative-token/time tuples; checkpoint-less records remain
readable and normalize to an empty list without changing their distribution.
This keeps host and subagent ownership durable without changing the host
lifecycle contract or delegating attribution policy to an adapter.

The closed fixtures for both new contracts and generated TypeScript declarations
are current. PRD/spec workflow meaning is unchanged except that an accepted
host-driven phase completion now requires its validated measurement start. Go-v3
parity remains `0 / 400`; this additive TypeScript feature makes no parity claim.

## State, migration, security, and rollback

Raw keyed measurements remain local and ignored at
`.brain/03-memory/task_log.jsonl`. The tracked
`.brain/03-memory/task_metrics.md` changes only through explicit
`metrics refresh`. Existing projects need no upfront migration; an empty raw log
is valid and records are created lazily. Existing pre-ownership records
normalize when a later managed operation rewrites the raw log, without a
standalone migration; checkpoint-less records likewise gain an empty canonical
list without changing their distribution. Re-init preserves exact existing
bytes for both files while still refreshing ordinary managed instructions.
First creation uses a missing-file precondition, so concurrent creation returns
`runtime.revision_conflict`, preserves the concurrent bytes, and publishes no
partial initialization state.

Lifecycle samples, workflow events, usage, gates, and measurement updates share
existing managed-transaction and byte-precondition boundaries. No event schema
or historical event is rewritten. Git behavior is unchanged: the raw log stays
ignored and the report stays reviewable tracked state. No new lock scope,
background worker, network call, package dependency, external service, host
permission, secret, credential, or supply-chain source is introduced.

Measurement stores bounded identifiers, timestamps, counters, sorted
contributor identifiers and cumulative/time checkpoints, and assignment
metadata only. It stores no prompts, transcripts, agent prose, credentials, or
raw host payloads. Identity comes from runtime resolution; host-observed model
and effort are separate nullable provenance. Hooks call neither a model nor the
network, and invalid lifecycle or state fails closed before phase launch or
report replacement.

Malformed raw input, corrupt recovery events, assignment conflicts, and stale
write preconditions preserve prior state. `session.end`, the next phase start,
or explicit refresh closes stale running measurements. Operational rollback is
to deploy the preceding runtime/host package; retain local raw bytes and any
committed report for audit rather than rewriting history. No schema downgrade or
state rollback command is required because all contracts are additive.

Contributor samples also fail closed when one contributor appears in multiple
phase records, an unowned sample has zero or multiple eligible running phases,
a 257th contributor would be added, checkpoint chronology or allocation
contradicts cumulative usage, prior usage lacks a durable owner, or the owning
run's usage or gate state is missing or malformed. Sequential reuse is
recomputed from observation time and checkpoints; the runtime does not redirect
a delayed contribution to the currently active phase or run.

## Deterministic test evidence

- Acceptance evidence record:
  `docs/verification/issue-144-token-consumption-evidence.md`
- Focused verification: `npm test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-runtime.test.ts tests/diagnostics.test.ts` — PASS, 7 files and 134 tests, exit 0.
- Full repository verification: `npm run verify` — PASS, 196 files and 4,941 tests in both ordinary and coverage runs; coverage 93.10% statements, 88.38% branches, 95.88% functions, and 93.87% lines; every downstream gate passed, exit 0.
- Re-init/state verification: `npx --yes npm@11.16.0 test -- --run tests/init-command.test.ts tests/init-skeleton.test.ts && npx --yes npm@11.16.0 run contracts:check` — PASS, 2 files and 53 tests; 41 schemas, 14 legacy profiles, generated types current, exit 0.
- Diff and placeholder hygiene: the merge-base-scoped, NUL-safe commands in the evidence record checked every non-deleted feature path — PASS, no output, exit 0.
- Remote CI: not observed; no green-CI claim is made

Criterion evidence:

1. Physical keyed deduplication: domain and runtime retry/upsert tests.
2. Numeric budgets/evidence: measured-usage runtime and diagnostic tests.
3. Five-sample nearest-rank p95: literal statistic and four/five-sample tests.
4. Explicit-refresh-only report: refresh and non-refresh byte tests.
5. Interruption/recovery: session-end, next-start, refresh, and cross-run
   accepted/corrupt recovery tests.
6. Runtime-owned assignment: forged-prose and assignment-conflict tests.
7. Measured stop-loss: direct over-budget phase closure, atomic contributor
   claim, out-of-order checkpoint reallocation, and retry-latch tests.
8. Host parity: built Claude Code/Codex lifecycle/envelope equivalence tests.
9. Transactional safety: malformed/corrupt/stale-precondition preservation plus
   missing, ambiguous, orphaned, overflow, and contradictory checkpoint tests.
10. Complete verification: focused and full commands above, both exit 0.

The evidence record maps each item to its exact test file and test name.

```text
npm test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-runtime.test.ts tests/diagnostics.test.ts
7 files and 134 tests passed; exit 0

npm run verify
196 files and 4,941 tests passed in ordinary and coverage runs; all gates passed; exit 0
```

Remote CI was not observed.

## Prompt and model evaluations

Not applicable. Deterministic runtime, contract, transaction, and built-package
tests cover the behavior; no probabilistic evaluation is used as evidence.

## Failure evidence

The feature followed test-first slices:

- Contract/domain RED: the focused domain/contract command failed because the
  measurement module and registered schema did not exist; later semantic REDs
  exposed an incorrect late-final total and accepted duplicate/malformed lines.
- Runtime RED: 1 of 3 files failed with 7 failing and 40 passing tests because
  lifecycle start/upsert/completion/interruption/recovery behavior was absent.
- Report RED: 1 of 3 files failed with 8 failing and 47 passing tests because
  nearest-rank distributions and `metrics refresh` were absent.
- Host relay RED: 2 of 3 files failed with 5 failing and 23 passing tests because
  no start-before-launch lifecycle relay existed.
- Re-init regression RED:
  `npx --yes npm@11.16.0 test -- --run tests/init-command.test.ts -t "creates measurement artifacts once"`
  failed 1 test with 27 skipped because re-init replaced the raw sentinel with
  the empty seed. The same regression now proves exact raw/report preservation
  while managed instructions refresh. Parameterized concurrent-create tests
  additionally prove `runtime.revision_conflict`, sentinel preservation, and no
  partial initialization writes.
- Review recovery RED:
  `npx vitest run tests/phase-metrics-rollup.test.ts tests/phase-measurement-runtime.test.ts --reporter=verbose -t "multiple running phases have no usage residual|257th phase-start contributor"`
  failed both selected tests: refresh incorrectly returned
  `metrics.calibration_insufficient` and changed state for two running owners,
  while lifecycle contributor overflow returned `runtime.internal_failure`.
  The same command now passes both tests with `runtime.state_corrupt` and exact
  raw/rollup preservation.

The full RED/GREEN command history and review-fix evidence are preserved in the
task reports referenced by the feature SDD ledger.

## Provenance

- Sources used: public Kratos issue #144 requirements and the repository-owned
  approved objective spec, design, implementation plan, ADRs, contracts, and
  tests linked above. No private or third-party source was used.
- Contribution method: `original` implementation and documentation derived from
  the approved repository requirements.
- Publication authority and notices: repository-owner approval governs these
  original materials; no adapted or verbatim third-party notice is required.
- No secret, credential, customer/personal data, private infrastructure, or
  confidential business information is included.

## Checklist

- [x] The PR contains one coherent outcome and no unrelated opportunistic refactor.
- [x] The closing issue, work ID, approved design/plan, applicable ADRs, and the absence of separate epic/dependency issues are explicit.
- [x] Public-contract, compatibility, state, migration, security, and rollback impact is explicit.
- [x] Deterministic tests are separate from prompt/model evaluations.
- [x] Focused tests and the complete required verification suite pass.
- [x] Failure evidence from the test-first cycle is included.
- [x] Documentation and migration/recovery guidance are updated.
- [x] All repository text and durable discussion use normative English.
- [x] Every commit contains the contributor's valid `Signed-off-by` DCO trailer.
- [x] Legacy/third-party provenance and publication authority are reviewable.
- [x] No unresolved placeholder, secret, private data, or confidential detail remains.

Evidence pointer: every acceptance criterion, exact named test,
compatibility/state/security impact, command, and fresh result is mapped in
`docs/verification/issue-144-token-consumption-evidence.md`.
```
