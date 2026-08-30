# Objective Spec: Token Consumption Measurement

Date: 2026-08-30
Status: APPROVED
Issue: #144 (`SDD-07a`)

## 1. Problem and desired outcome

The runtime already exposes budgets and stop-loss facts but leaves reported
usage unknown and does not persist phase measurements. The finished feature
measures gross tokens and duration per phase, reports numeric run usage,
calibrates informative per-phase recommendations from observed distributions,
and recovers interrupted measurements deterministically.

## 2. Scope boundary

In scope:

- one raw keyed phase record per run and phase;
- host-neutral phase lifecycle tied to runtime-resolved assignments;
- the existing ignored raw log and an explicitly refreshed committed rollup;
- distribution statistics and five-sample p95 calibration;
- numeric budget/evidence usage and the existing measured stop-loss path;
- interruption closure, crash recovery, compatibility, security, and evidence.

Out of scope:

- billing, pricing, or monetary conversion;
- automatic mutation of the explicit objective budget;
- redesigning `stats` or `budgets`;
- persisting prompts, transcripts, or agent-declared execution identity.

## 3. Acceptance criteria

- [ ] A completed phase produces exactly one physical JSONL record keyed by
      run and phase; repeating the observation updates or no-ops that line.
- [ ] A measured finished run reports numeric usage in `budgets` and its
      evidence bundle.
- [ ] Calibration requires five completed samples per phase, recommends the
      nearest-rank token p95, and names an undersized sample without guessing.
- [ ] `task_metrics.md` changes only through `metrics refresh`.
- [ ] `session.end` and later recovery both prevent a phase from remaining
      permanently `running`.
- [ ] Recorded role, model, and effort come from the runtime-resolved
      assignment; agent prose cannot change them.
- [ ] A measured overrun latches the existing stop-loss gate.
- [ ] Claude Code and Codex relay equivalent phase lifecycle observations.
- [ ] Malformed raw data or a transactional failure cannot partially replace
      the raw log or committed rollup.
- [ ] Focused verification and `npm run verify` pass.

## 4. Test matrix and verification commands

- Domain and statistics: `npx --yes npm@11.16.0 test -- --run tests/phase-measurement-domain.test.ts tests/phase-metrics-rollup.test.ts`
- Contracts: `npx --yes npm@11.16.0 test -- --run tests/phase-measurement-contracts.test.ts tests/contract-type-generation.test.ts tests/schema-registry-fixtures.test.ts`
- Runtime lifecycle: `npx --yes npm@11.16.0 test -- --run tests/phase-measurement-runtime.test.ts tests/workflow-hook-runtime.test.ts tests/model-role-workflow.test.ts`
- Host parity: `npx --yes npm@11.16.0 test -- --run tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-distribution.test.ts`
- Diagnostics and gates: `npx --yes npm@11.16.0 test -- --run tests/diagnostics.test.ts tests/cli-composition.test.ts tests/gate-facts.test.ts`
- Full gate: `npx --yes npm@11.16.0 run verify`

## 5. Compatibility and risk

Contracts and reason codes are additive; no existing state is rewritten or
migrated. The deliberate compatibility change is that a host-driven phase
cannot complete without a validated phase-start measurement. Raw measurement
data remains ignored and local. The committed rollup contains bounded
aggregate/provenance metadata only. Measurement and lifecycle hooks remain
offline and model-free.

