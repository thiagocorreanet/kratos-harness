# Token Consumption Measurement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure gross tokens and duration once per run phase, feed existing budget/stop-loss reporting, and publish deliberate distribution reports.

**Architecture:** A pure phase-measurement domain owns keyed records, lifecycle transitions, recovery, and statistics. Runtime composition binds it to the existing run-usage ledger and managed transactions; shared host relays publish only normalized phase starts. `metrics refresh` is the sole committed-rollup writer.

**Tech Stack:** Node.js 24.18+, TypeScript 6 ESM, JSON Schema 2020-12, Vitest 4, existing EffectPlan/transaction and host-adapter contracts.

**Spec:** `docs/specs/2026-08-30-token-consumption-measurement-spec.md`

## Global Constraints

- Keep runtime semantics host-neutral; Claude Code and Codex differ only in normalization and relay.
- Runtime-resolved assignment metadata is authoritative; agent text is never measurement input.
- Use `(runId, phase)` as the physical JSONL uniqueness key.
- Calibration minimum is exactly 5 completed samples and the recommendation is nearest-rank token p95.
- Interrupted samples are reported but excluded from percentiles and calibration.
- `metrics refresh` is the only writer of `task_metrics.md`; `stats` and `budgets` stay read-only.
- Calibration never mutates the explicit objective budget.
- Preserve predecessor schemas/catalogs byte-for-byte and require no existing-project migration.
- Write source, tests, fixtures, errors, documentation, commits, and PR text in English.
- Follow RED-GREEN-REFACTOR and finish with `npx --yes npm@11.16.0 run verify`.

---

### Task 1: Phase measurement contracts and pure domain

**Files:**
- Create: `schemas/state/phase-measurement.v1.schema.json`
- Create: `packages/runtime/src/domain/measurements/index.ts`
- Create: `tests/phase-measurement-domain.test.ts`
- Create: `tests/phase-measurement-contracts.test.ts`
- Modify: contract catalog, schema registry, generated-type inputs, fixture tests, and additive reason catalog

**Interfaces:**
- Produces: `PhaseMeasurement`, `upsertPhaseMeasurement(records, next)`, `startPhaseMeasurement(input)`, `samplePhaseMeasurement(record, usage, now)`, `completePhaseMeasurement(record, usage, now, observedIdentity)`, `interruptPhaseMeasurement(record, usage, now, reason)`, and `parsePhaseMeasurementLog(text, registry)`.
- A record contains the exact fields approved by the spec; closed-state nullable fields are validated semantically in the domain and structurally in the schema.

- [ ] **Step 1: Write failing domain tests**

```ts
it("replaces the same run and phase instead of appending a duplicate", () => {
  const updated = upsertPhaseMeasurement([running], { ...running, grossTokens: 42 });
  expect(updated).toHaveLength(1);
  expect(updated[0]?.grossTokens).toBe(42);
});

it("refuses a different assignment for an open phase", () => {
  expect(() => upsertPhaseMeasurement([running], changedAssignment)).toThrow(
    "Phase measurement assignment conflicts with the open record",
  );
});
```

- [ ] **Step 2: Run the new tests and confirm failure because the measurement module/contracts do not exist**

Run: `npx --yes npm@11.16.0 test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts`

- [ ] **Step 3: Implement the schema, additive catalog entries, generated type registration, and minimal pure lifecycle/upsert logic**

```ts
export function upsertPhaseMeasurement(
  records: readonly PhaseMeasurement[],
  next: PhaseMeasurement,
): readonly PhaseMeasurement[] {
  // Validate assignment continuity for an open matching key, replace by key,
  // then sort by run ID and RUN_PHASES order without mutating input.
}
```

- [ ] **Step 4: Run focused contract/domain tests, typecheck, and refactor while green**

Run: `npx --yes npm@11.16.0 test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/contract-type-generation.test.ts tests/schema-registry-fixtures.test.ts && npx --yes npm@11.16.0 run typecheck`

- [ ] **Step 5: Commit the independently reviewed contract/domain slice**

```bash
git add schemas packages/contracts packages/runtime/src/domain packages/runtime/src/infra/schema fixtures tests
git commit -m "feat(metrics): define phase measurement ledger"
```

### Task 2: Runtime lifecycle, raw-log upsert, and recovery

**Files:**
- Modify: `packages/runtime/src/composition/host.ts`
- Modify: `packages/runtime/src/domain/cli/hook.ts`
- Modify: workflow observation/decision composition and CLI observation types
- Create: `tests/phase-measurement-runtime.test.ts`

**Interfaces:**
- Consumes Task 1 lifecycle/upsert functions and `RunUsageV1.totalGrossTokens`.
- Produces a `phase.start` observation path, raw-log precondition observation, completion effects attached to accepted transitions, session-end interruption, and refresh/start recovery.

- [ ] **Step 1: Write failing integration tests for start, sample, completion, physical deduplication, session interruption, crash recovery, and agent-text identity spoofing**

```ts
expect(lines(files[".brain/03-memory/task_log.jsonl"] ?? "")).toHaveLength(1);
expect(record.resolvedAssignment).toEqual({
  host: "codex",
  role: "implementer",
  model: "codex-implementation",
  effort: "high",
});
expect(record.status).toBe("completed");
```

- [ ] **Step 2: Run runtime tests and confirm lifecycle records/effects are missing**

Run: `npx --yes npm@11.16.0 test -- --run tests/phase-measurement-runtime.test.ts tests/workflow-hook-runtime.test.ts tests/model-role-workflow.test.ts`

- [ ] **Step 3: Observe and validate raw-log bytes, current usage, lifecycle binding, and assignment in composition; add atomic write effects with exact file preconditions**

- [ ] **Step 4: Update hook and accepted-transition decisions so samples update counters, accepted transitions close completed records, session end closes interruption, and start/refresh reconcile stale records**

- [ ] **Step 5: Refuse missing starts and assignment conflicts with the new stable reasons; preserve idempotent retries and leave the rollup untouched**

- [ ] **Step 6: Run focused runtime tests and typecheck until green**

Run: `npx --yes npm@11.16.0 test -- --run tests/phase-measurement-runtime.test.ts tests/workflow-hook-runtime.test.ts tests/model-role-workflow.test.ts tests/transaction-fault-campaign.test.ts && npx --yes npm@11.16.0 run typecheck`

- [ ] **Step 7: Commit the runtime lifecycle slice**

```bash
git add packages/runtime tests
git commit -m "feat(metrics): measure phase lifecycle consumption"
```

### Task 3: Distribution rollup, refresh command, and numeric reporting

**Files:**
- Add rollup/statistics functions under `packages/runtime/src/domain/measurements/`
- Add `metrics refresh` command and its composition observation
- Modify: `packages/runtime/src/domain/cli/diagnostics.ts`
- Modify: `packages/runtime/src/composition/workflow.ts`
- Create: `tests/phase-metrics-rollup.test.ts`

**Interfaces:**
- Produces: `nearestRank(values, ratio)`, `derivePhaseDistributions(records, 5)`, and `renderTaskMetrics(report)`.
- Refresh returns `metrics.refresh_ok` when every represented phase has sufficient calibration, otherwise `metrics.calibration_insufficient` while still writing distributions.

- [ ] **Step 1: Write failing tests for literal nearest-rank values, interrupted exclusion, 4/5 refusal, 5/5 p95 recommendation, malformed-log preservation, and non-refresh stability**

```ts
expect(nearestRank([10, 20, 30, 40, 50], 0.95)).toBe(50);
expect(report.phases.code.recommendedTokens).toBeNull();
expect(report.phases.code.calibration).toEqual({ required: 5, observed: 4 });
```

- [ ] **Step 2: Run rollup/diagnostic tests and confirm the new command and functions are absent**

Run: `npx --yes npm@11.16.0 test -- --run tests/phase-metrics-rollup.test.ts tests/diagnostics.test.ts tests/cli-composition.test.ts`

- [ ] **Step 3: Implement deterministic distributions and Markdown with source-log digest, refresh time, fixed phase order, source feature/run IDs, counts, token/duration min-p50-p95-max, and recommendation status**

- [ ] **Step 4: Register `metrics refresh`, validate/reconcile before one managed rollup transaction, and leave prior bytes untouched on invalid input**

- [ ] **Step 5: Observe validated `usage.json` in workflow composition and pass `totalGrossTokens` to `deriveBudget` and evidence bundles without changing the explicit allocation**

- [ ] **Step 6: Run focused tests, CLI contract tests, and typecheck until green**

Run: `npx --yes npm@11.16.0 test -- --run tests/phase-metrics-rollup.test.ts tests/diagnostics.test.ts tests/cli-composition.test.ts tests/cli-contracts.test.ts tests/evidence-bundle.test.ts && npx --yes npm@11.16.0 run typecheck`

- [ ] **Step 7: Commit refresh/reporting behavior**

```bash
git add packages/runtime tests
git commit -m "feat(metrics): refresh phase distributions"
```

### Task 4: Equivalent Claude Code and Codex phase-start relays

**Files:**
- Modify: `packages/adapters/src/hooks.ts`
- Modify: `packages/adapters/src/index.ts`
- Modify shared phase relay/runtime assets under `distribution/shared/`
- Modify host wrapper assets and host contract schemas/fixtures
- Modify: `tests/phase-agent-relay-distribution.test.ts`

**Interfaces:**
- Consumes the Task 2 `phase.start` ingress and current `PhaseHandoffV1_1`.
- Produces byte-equivalent normalized phase-start observations from both hosts before `launcher.launch` and refuses launch if session identity is unavailable or runtime start is refused.

- [ ] **Step 1: Add failing shared adapter and built-package tests proving start-before-launch ordering, exact session/correlation/digest relay, refusal before launch, and equivalent host messages**

- [ ] **Step 2: Run host tests and confirm no phase-start lifecycle is emitted**

Run: `npx --yes npm@11.16.0 test -- --run tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-adapters.test.ts tests/workflow-hook-distribution.test.ts`

- [ ] **Step 3: Extend the normalized hook successor contract with `phase.start`, render both hosts from shared assets, and invoke runtime start before the existing exact-selection launcher**

- [ ] **Step 4: Preserve host relay-only authority: no phase mapping, assignment selection, counter calculation, or recovery logic enters adapters/distribution**

- [ ] **Step 5: Build packages and run host parity/package tests until green**

Run: `npx --yes npm@11.16.0 test -- --run tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-adapters.test.ts tests/workflow-hook-distribution.test.ts tests/runtime-distribution.test.ts tests/package-verifier.test.ts && npx --yes npm@11.16.0 run build`

- [ ] **Step 6: Commit host parity behavior**

```bash
git add schemas/host packages/adapters distribution scripts tests
git commit -m "feat(metrics): relay phase measurement starts"
```

### Task 5: Public documentation, acceptance evidence, and full verification

**Files:**
- Modify user command/configuration/host documentation and compatibility notes
- Create: `docs/verification/issue-144-token-consumption-evidence.md`
- Modify PR template only if a reusable required evidence field is absent

**Interfaces:**
- Documents raw-versus-curated state, lifecycle failure recovery, exact percentile/minimum policy, explicit-budget authority, compatibility, and security.

- [ ] **Step 1: Update public English documentation with executable command examples and recovery behavior; remove all placeholder language**

- [ ] **Step 2: Run focused acceptance suites and record their exact command output/exit status in the evidence document**

Run: `npx --yes npm@11.16.0 test -- --run tests/phase-measurement-domain.test.ts tests/phase-measurement-contracts.test.ts tests/phase-measurement-runtime.test.ts tests/phase-metrics-rollup.test.ts tests/phase-agent-relay-distribution.test.ts tests/workflow-hook-runtime.test.ts tests/diagnostics.test.ts`

- [ ] **Step 3: Run complete verification with the pinned npm version and record the full gate summary**

Run: `npx --yes npm@11.16.0 run verify`

- [ ] **Step 4: Audit acceptance criteria, public contract generation, predecessor bytes, Git diff, and absence of unresolved placeholder markers in authored feature files**

- [ ] **Step 5: Commit documentation and evidence**

```bash
git add docs README.md .github/pull_request_template.md
git commit -m "docs(metrics): document measured token budgets"
```

- [ ] **Step 6: Prepare PR text linking #144, stating host compatibility, state/migration impact, security impact, exact verification commands, and evidence for every acceptance criterion**
