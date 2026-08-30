# Issue #144 token-consumption measurement evidence

Date: 2026-08-30
Issue: #144 (`SDD-07a`)
Runtime/test HEAD before this documentation update:
`2dae8ae86e0bee9145469f65bb3f515d4466f749`
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
| A measured overrun latches the existing stop-loss gate. | `tests/phase-measurement-runtime.test.ts` — `closes an over-budget measured phase and latches stop-loss in the same lifecycle`; `tests/workflow-hook-runtime.test.ts` — `trips a run budget and keeps the latch on an identical retry`. | The focused acceptance command passed. The direct integration starts an assignment-bound phase under a 100-token objective budget, closes its 125-token session, and asserts the interrupted measurement, numeric run usage, runtime assignment, exhausted epoch, and `stopLoss.exhausted: true` together. The hook retry test separately proves latch stability. |
| Claude Code and Codex relay equivalent phase lifecycle observations. | `tests/phase-agent-relay-distribution.test.ts` — `starts the exact lifecycle before launch and records afterward`, `returns the runtime start refusal without launch or record`, `refuses missing trusted session identity before start or launch`, and `emits byte-equivalent lifecycle artifacts and equivalent operation envelopes`. | The focused acceptance command passed. Both built packages produce byte-equivalent normalized lifecycle artifacts and equivalent host-operation envelopes, and neither launches after an invalid or refused start. |
| Malformed raw data or a transactional failure cannot partially replace the raw log or committed report. | `tests/phase-metrics-rollup.test.ts` — `preserves prior raw and rollup bytes when the raw log is malformed`, `preserves raw and rollup bytes when a running record event stream is corrupt`, and `publishes neither recovered raw data nor a rollup after a stale precondition`. | The focused acceptance command passed. Invalid input and corrupt reconciliation preserve both prior files, while a stale precondition publishes neither half of the recovery/report transaction. |
| Focused verification and the complete repository gate pass. | Exact commands and complete summaries appear under [Fresh command evidence](#fresh-command-evidence). | Focused acceptance passed 7 files and 77 tests, exit 0. The successful complete retry passed 196 files and 4,884 tests in both ordinary and coverage runs, then passed every remaining gate, exit 0. |

## Required documentation and audit evidence

| Required item | Evidence |
| --- | --- |
| Raw ignored state versus deliberately refreshed committed state | `tests/init-skeleton.test.ts` — `writes the state ignore rules byte for byte` and `classifies every path written by initialization as deliberately committed or ignored` prove that `.brain/03-memory/task_log.jsonl` is ignored and `.brain/03-memory/task_metrics.md` is tracked. `tests/init-command.test.ts` — `creates measurement artifacts once and preserves their bytes while refreshing managed instructions` proves re-init preserves non-canonical raw/report bytes while updating the managed instruction section. Its parameterized `rejects concurrent raw log creation without publishing partial initialization` and `rejects concurrent rollup creation without publishing partial initialization` cases prove missing-file preconditions, exact concurrent-byte preservation, `runtime.revision_conflict`, and no partial init writes. `tests/phase-metrics-rollup.test.ts` proves that only refresh replaces the tracked report. |
| Six phases and exact statistics policy | `tests/phase-metrics-rollup.test.ts` — `renders all six phases in canonical order with deterministic absence markers` pins `prd`, `spec`, `plan`, `code`, `review`, and `acceptance` plus token/duration min, p50, p95, and max. The same file pins nearest rank and the minimum of five completed phase samples. |
| Interrupted exclusion and deterministic recovery | The named lifecycle and report tests in the acceptance matrix prove that interrupted records remain counted but do not enter distributions, and that session end, next start, and explicit refresh close stale running records. `docs/user/migration-and-recovery.md` publishes the operator procedure. |
| Runtime-authoritative role, model, and effort | The named assignment tests in the acceptance matrix prove runtime resolution and forged-prose exclusion. `docs/user/hosts.md` documents that the host relays lifecycle and nullable observed provenance but owns no selection or counter policy. |
| Numeric usage, stop-loss, and explicit budget authority | `tests/phase-measurement-runtime.test.ts` — `closes an over-budget measured phase and latches stop-loss in the same lifecycle` directly ties a 125-token measured closure to the explicit 100-token objective allocation and existing stop-loss facts. The named numeric-reporting and diagnostics tests prove numeric used values. `packages/runtime/src/domain/cli/diagnostics.ts` constructs the refresh write set from only the raw log and tracked report; calibration has no effect that writes objective state. |
| Host-neutral compatibility | The built-package parity test named above exercises Claude Code and Codex with the same lifecycle values and ordering. `docs/user/hosts.md` documents the common `host.phase-lifecycle@1.0.0` ingress and start-before-launch refusal. |
| State and migration impact | `state.phase-measurement@1.0.0`, `host.phase-lifecycle@1.0.0`, reason-catalog revision 1.10, and manifest revision 1.5 are additive. Existing projects require no state rewrite: the empty ignored log is valid and records are created lazily. The tracked report remains operator-refreshed state. |
| Security impact | The schemas restrict records to bounded identifiers, timestamps, counters, assignment metadata, and nullable observed identity. Prompts, transcripts, agent prose, credentials, and raw host payloads do not enter the ledger. Hooks remain local, model-free, and network-free. Malformed data, assignment conflicts, corrupt recovery events, and stale preconditions fail closed. |
| Generated contracts and predecessor bytes | `npx --yes npm@11.16.0 run contracts:check` verified 41 schemas, 14 legacy profiles, and current generated types. The predecessor-byte audit compared every schema and reason catalog that existed at `71c03c5` and returned no diff, exit 0. |
| Placeholder and diff hygiene | The merge-base-scoped hygiene commands under [Feature-range hygiene](#feature-range-hygiene) inspect every added, copied, modified, or renamed feature file at its current path without scanning unrelated repository files. The scan found no unresolved placeholder marker, and feature-range `git diff --check` produced no output. Public documentation is English and the spelling/English gates passed. |

## Fresh command evidence

All commands ran on Linux x64 with Node.js `v24.19.0` and npm `11.16.0`.

### Focused acceptance

```bash
npx --yes npm@11.16.0 test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-runtime.test.ts tests/diagnostics.test.ts
```

```text
Test Files  7 passed (7)
Tests       77 passed (77)
Duration    15.16s
Exit code   0
```

### Complete repository gate

```bash
npx --yes npm@11.16.0 run verify
```

```text
Format       passed
Spelling     217 Markdown files, 0 issues
English      passed
Lint         passed
Typecheck    passed
Tests        196 files, 4,884 tests passed
Coverage     196 files, 4,884 tests passed
Statements   93.15% (8,095/8,690)
Branches     88.48% (6,269/7,085)
Functions    95.64% (1,428/1,493)
Lines        93.94% (7,412/7,890)
Mutation     3/3 (100.00%)
Gaps         10/10 found, 0 false gaps
Performance  1,208,617/1,500,000 runtime bytes; 181,547/250,000 schema bytes
Oracle       12 surfaces, 4 PRD anchors, 3 binaries verified
Parity       discovery verified; 0/400 implemented parity cases
Results      76 reasons, exits 0-5, 6 examples verified
Contracts    41 schemas, 14 legacy profiles, generated types current
Differential 2/2 public self-test scenarios equal
Build        Codex and Claude Code artifacts produced
Packages     Codex and Claude Code verification passed
Benchmark    help p95 178.358415 ms; version p95 151.835013 ms;
             handshake p95 182.479467 ms; bundle 1,576,764 bytes
Exit code    0
```

The package test suites intentionally print child-process refusal traces for
tampered artifacts. Both aggregate Vitest runs passed, and the later canonical
package verification passed for Codex and Claude Code.

An earlier exact attempt under simultaneous CPU-heavy worktree suites exited 1
after the fixed five-second timeout in
`tests/contract-type-generation.test.ts` →
`verifies committed declarations without rewriting them`: 195/196 files and
4,883/4,884 tests passed. The whole file immediately passed 13/13 in isolation,
exit 0. The unchanged exact `run verify` retry above then passed both complete
suites and all downstream gates. No timeout or product code was changed.

### State and contract audits

```bash
npx --yes npm@11.16.0 test -- --run tests/init-command.test.ts tests/init-skeleton.test.ts && npx --yes npm@11.16.0 run contracts:check
```

```text
Test Files  2 passed (2)
Tests       53 passed (53)
Duration    4.24s
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

### Feature-range hygiene

The baseline is explicit and verified as the feature merge base. The loop uses
NUL-delimited paths, scans all added/copied/modified/renamed feature files at
their current paths, and succeeds only when none contains an unresolved
placeholder marker.

```bash
issue_144_base=$(git merge-base 71c03c5 HEAD)
test "$issue_144_base" = 71c03c5f587da1c5d7b841e8667f05ce7aea0602
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
Merge base   71c03c5f587da1c5d7b841e8667f05ce7aea0602
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
usage authority for reporting and stop-loss.

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

The closed fixtures for both new contracts and generated TypeScript declarations
are current. PRD/spec workflow meaning is unchanged except that an accepted
host-driven phase completion now requires its validated measurement start. Go-v3
parity remains `0 / 400`; this additive TypeScript feature makes no parity claim.

## State, migration, security, and rollback

Raw keyed measurements remain local and ignored at
`.brain/03-memory/task_log.jsonl`. The tracked
`.brain/03-memory/task_metrics.md` changes only through explicit
`metrics refresh`. Existing projects need no state rewrite or migration; an
empty raw log is valid and records are created lazily. Re-init preserves exact
existing bytes for both files while still refreshing ordinary managed
instructions. First creation uses a missing-file precondition, so concurrent
creation returns `runtime.revision_conflict`, preserves the concurrent bytes,
and publishes no partial initialization state.

Lifecycle samples, workflow events, usage, gates, and measurement updates share
existing managed-transaction and byte-precondition boundaries. No event schema
or historical event is rewritten. Git behavior is unchanged: the raw log stays
ignored and the report stays reviewable tracked state. No new lock scope,
background worker, network call, package dependency, external service, host
permission, secret, credential, or supply-chain source is introduced.

Measurement stores bounded identifiers, timestamps, counters, and assignment
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

## Deterministic test evidence

- Acceptance evidence record:
  `docs/verification/issue-144-token-consumption-evidence.md`
- Focused verification: `npx --yes npm@11.16.0 test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-runtime.test.ts tests/diagnostics.test.ts` — PASS, 7 files and 77 tests, exit 0.
- Full repository verification: `npx --yes npm@11.16.0 run verify` — PASS on the unchanged exact retry, 196 files and 4,884 tests in both ordinary and coverage runs; coverage 93.15% statements, 88.48% branches, 95.64% functions, and 93.94% lines; every downstream gate passed, exit 0.
- Re-init/state verification: `npx --yes npm@11.16.0 test -- --run tests/init-command.test.ts tests/init-skeleton.test.ts && npx --yes npm@11.16.0 run contracts:check` — PASS, 2 files and 53 tests; 41 schemas, 14 legacy profiles, generated types current, exit 0.
- Diff and placeholder hygiene: the merge-base-scoped, NUL-safe commands in the evidence record checked every non-deleted feature path — PASS, no output, exit 0.
- Remote CI: not observed; no green-CI claim is made

Criterion evidence:

1. Physical keyed deduplication: domain and runtime retry/upsert tests.
2. Numeric budgets/evidence: measured-usage runtime and diagnostic tests.
3. Five-sample nearest-rank p95: literal statistic and four/five-sample tests.
4. Explicit-refresh-only report: refresh and non-refresh byte tests.
5. Interruption/recovery: session-end, next-start, and refresh recovery tests.
6. Runtime-owned assignment: forged-prose and assignment-conflict tests.
7. Measured stop-loss: direct over-budget phase closure and retry-latch tests.
8. Host parity: built Claude Code/Codex lifecycle/envelope equivalence tests.
9. Transactional safety: malformed/corrupt/stale-precondition preservation tests.
10. Complete verification: focused and full commands above, both exit 0.

The evidence record maps each item to its exact test file and test name.

```text
npx --yes npm@11.16.0 test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-runtime.test.ts tests/diagnostics.test.ts
7 files and 77 tests passed; exit 0

npx --yes npm@11.16.0 run verify
196 files and 4,884 tests passed in ordinary and coverage runs; all gates passed; exit 0
```

The first exact full-gate attempt under simultaneous CPU-heavy worktree suites
hit the known fixed five-second timeout in one contract-generation test. That
file passed 13/13 immediately in isolation, and the unchanged exact full retry
reported above passed. Remote CI was not observed.

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
- [ ] Every commit contains the contributor's valid `Signed-off-by` DCO trailer. Prior implementation commits in the feature range lack the trailer; history must be corrected before submission.
- [x] Legacy/third-party provenance and publication authority are reviewable.
- [x] No unresolved placeholder, secret, private data, or confidential detail remains.

Evidence pointer: every acceptance criterion, exact named test,
compatibility/state/security impact, command, and fresh result is mapped in
`docs/verification/issue-144-token-consumption-evidence.md`.
```
