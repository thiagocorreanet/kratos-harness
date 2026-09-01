# Shadow Gate Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let initialization persist per-gate `shadow` selections and expose their effective findings through typed `handoff` and `doctor` output without changing gate decisions or existing defaults.

**Architecture:** Keep `policyMode` as the inherited `standard -> warn` / `strict -> enforce` default and carry the existing partial `gateModes` map through initialization. Project the evaluator-owned ordered failures into versioned handoff and doctor payloads. Prove old-runtime refusal by running the production classifier against a frozen predecessor compatibility window.

**Tech Stack:** Node.js 24, TypeScript 6, JSON Schema 2020-12, Vitest 4, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-09-01-shadow-gate-selection-design.md`

## Global Constraints

- Do not add `shadow` to global `policyMode`; `standard` remains `warn` and `strict` remains `enforce`.
- Do not change a gate condition, reason code, priority, or aggregation rule.
- `gateModes` remains a closed partial map over the eight published gate IDs with values `shadow | warn | enforce`.
- Omission means `{}` for a new project and preserves the current map during re-initialization; explicit `{}` clears it.
- Unknown gates or modes fail before mutation; invalid configuration retains fail-closed all-enforce behavior.
- Predecessor schemas and fixtures remain byte-immutable; no new dependency is allowed.
- Human and JSON diagnostics copy the same evaluator-owned failure trace.

---

### Task 1: Publish the host payload contracts

**Files:**

- Create: `schemas/host/init-answers.v1.5.schema.json`
- Create: `schemas/host/phase-handoff.v1.4.schema.json`
- Create: `schemas/host/doctor-report.v1.schema.json`
- Create: `fixtures/contracts/v1.5/init-answers.json`
- Create: `fixtures/contracts/v1.4/phase-handoff.json`
- Create: `fixtures/contracts/v1/doctor-report.json`
- Modify: `packages/contracts/catalogs/contract-families.v1.json`
- Modify: `packages/contracts/src/compatibility.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/generated/contracts.ts` via generation
- Modify: `scripts/generate-contract-types.mjs`
- Modify: `packages/runtime/src/infra/schema/catalog.ts`
- Modify: `packages/runtime/src/domain/schema/contracts.ts`
- Test: `tests/contract-schemas.test.ts`, `tests/contract-manifest.test.ts`, `tests/contract-type-generation.test.ts`, `tests/schema-registry-types.test.ts`, `tests/schema-registry-fixtures.test.ts`

**Interfaces:**

- Produces `InitAnswersV1_5`, `PhaseHandoffV1_4`, `DoctorReportV1`, and `CurrentPhaseHandoff = PhaseHandoffV1_4`.
- Adds exact current entries: `host.init-answers: "1.5.0"`, `host.phase-handoff: "1.4.0"`, and `host.doctor-report: "1.0.0"`.
- Both diagnostic contracts expose `gateFailures: { gateId, reasonCode, mode, priority, evidenceRefs, detail }[]`.

- [ ] **Step 1: Write failing contract tests**

Assert exact versions and validate this positive init document:

```ts
expect(CONTRACT_VERSIONS["host.init-answers"]).toBe("1.5.0");
expect(CONTRACT_VERSIONS["host.phase-handoff"]).toBe("1.4.0");
expect(CONTRACT_VERSIONS["host.doctor-report"]).toBe("1.0.0");

expect(registry.validate({
  id: "host.init-answers",
  version: "1.5.0",
  value: {
    contractVersion: "1.5.0",
    hostContract: "1.4.0",
    hosts: ["codex"],
    gateModes: { "gaps-closed": "shadow" },
  },
  structuralReasonCode: "trail.output_invalido",
}).kind).toBe("valid");
```

Add negative cases for an unknown gate, mode `silent`, a handoff failure without `mode`, and a doctor failure with an extra property.

- [ ] **Step 2: Confirm RED**

Run:

```bash
npm test -- tests/contract-schemas.test.ts tests/contract-manifest.test.ts tests/contract-type-generation.test.ts tests/schema-registry-types.test.ts tests/schema-registry-fixtures.test.ts
```

Expected: FAIL because the schemas, types, and registry entries are absent.

- [ ] **Step 3: Implement the schemas and registrations**

Derive init `1.5.0` from `1.4.0`, keep `hostContract: 1.4.0`, and add optional `gateModes` with the exact project-config gate keys and values. Derive handoff `1.4.0` from `1.3.0`, set both version constants to `1.4.0`, require `gateFailures`, and use:

```json
"gateFailures": {
  "$ref": "https://kratos.dev/schemas/state/event/v1.3#/$defs/gateFailures"
}
```

Create a closed doctor report with required `contractVersion: 1.0.0`, `hostContract: 1.4.0`, `health`, `checks`, and the same `gateFailures` reference. Each check is closed and contains `name`, `status`, nullable `evidenceRef`, and optional bounded unique `details`. Register all schemas in the manifest, embedded registry, `ContractValues`, public type exports, readable unions, and current aliases. Generalize `schemaForTypeGeneration` so `phaseHandoffTypeSchema` applies to every phase-handoff revision that carries the phase-dependent memory conditional, including `1.4.0`. Commit one valid canonical fixture beside each new schema revision.

- [ ] **Step 4: Generate and confirm GREEN**

```bash
npm run contracts:generate
npm test -- tests/contract-schemas.test.ts tests/contract-manifest.test.ts tests/contract-type-generation.test.ts tests/schema-registry-types.test.ts tests/schema-registry-fixtures.test.ts
npm run contracts:check
npm run typecheck
```

Expected: PASS; generated declarations contain all three new types.

- [ ] **Step 5: Commit**

```bash
git add schemas/host fixtures/contracts packages/contracts packages/runtime/src/infra/schema/catalog.ts packages/runtime/src/domain/schema/contracts.ts scripts/generate-contract-types.mjs tests/contract-schemas.test.ts tests/contract-manifest.test.ts tests/contract-type-generation.test.ts tests/schema-registry-types.test.ts tests/schema-registry-fixtures.test.ts
git commit -m "feat(contracts): publish shadow policy diagnostics"
```

---

### Task 2: Accept and preserve gate modes during initialization

**Files:**

- Modify: `packages/runtime/src/domain/init/answers.ts`
- Modify: `packages/runtime/src/domain/init/skeleton.ts`
- Modify: `packages/runtime/src/composition/init.ts`
- Test: `tests/init-answers.test.ts`, `tests/init-skeleton.test.ts`, `tests/init-command.test.ts`

**Interfaces:**

- Consumes `InitAnswersV1_5["gateModes"]` and `ProjectConfigV1_4["gateModes"]`.
- Produces `ResolvedAnswers.gateModes` and `PersistedInitSettings.gateModes?`.
- Skeleton writes `gateModes: answers.gateModes` without expanding inheritance.

- [ ] **Step 1: Write failing resolution tests**

Add a `answersV1_5()` helper and these cases:

```ts
const selected = await resolveInitAnswers(
  answersV1_5({ gateModes: { "gaps-closed": "shadow" } }), registry, routing,
);
expect(selected).toMatchObject({
  kind: "resolved",
  answers: { gateModes: { "gaps-closed": "shadow" } },
});

const preserved = await resolveInitAnswers(answersV1_5(), registry, routing, {
  gateModes: { "spec-approved": "enforce" },
});
expect(preserved).toMatchObject({
  kind: "resolved",
  answers: { gateModes: { "spec-approved": "enforce" } },
});
```

Also prove: new omission becomes `{}` and is disclosed in `defaulted`; explicit `{}` clears a persisted map; generated config contains only the partial map; re-init omission does not erase the current map.

- [ ] **Step 2: Confirm RED**

```bash
npm test -- tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts
```

Expected: FAIL because answer resolution rejects `1.5.0` and skeleton generation hard-codes `{}`.

- [ ] **Step 3: Implement resolution precedence**

Base `ResolvedAnswers` on `Required<InitAnswersV1_5>`. Accept input revisions `1.3.0`, `1.4.0`, and `1.5.0`, returning current answer identity `1.5.0` / host identity `1.4.0`. Add:

```ts
function resolvedGateModes(
  supplied: InitAnswersV1_3 | InitAnswersV1_4 | InitAnswersV1_5,
  persisted: PersistedInitSettings | undefined,
): NonNullable<InitAnswersV1_5["gateModes"]> {
  if ("gateModes" in supplied && supplied.gateModes !== undefined) {
    return structuredClone(supplied.gateModes);
  }
  return structuredClone(persisted?.gateModes ?? {});
}
```

Only disclose `gateModes` as defaulted when it was omitted and no current config exists. Extend `observePersistedProfile` to return validated `gateModes`, pass it to answer resolution, and change skeleton generation to `gateModes: structuredClone(answers.gateModes)`.

- [ ] **Step 4: Confirm GREEN**

```bash
npm test -- tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/project-configuration.test.ts
npm run typecheck
```

Expected: PASS with unchanged standard and strict defaults.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/init/answers.ts packages/runtime/src/domain/init/skeleton.ts packages/runtime/src/composition/init.ts tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts
git commit -m "feat(init): persist per-gate policy modes"
```

---

### Task 3: Report effective findings through handoff

**Files:**

- Modify: `packages/runtime/src/composition/workflow.ts`, `packages/runtime/src/composition/cli.ts`
- Modify: `packages/runtime/src/domain/cli/spec.ts`, `packages/runtime/src/domain/cli/diagnostics.ts`
- Test: `tests/gate-facts.test.ts`, `tests/cli-narrate.test.ts`, `tests/cli-composition.test.ts`

**Interfaces:**

- Consumes `GateDecision.failures` in evaluator order.
- Produces `CurrentPhaseHandoff.gateFailures` and `JsonContractId` member `phase-handoff@1.4.0`.
- Human form: `Gate finding: <gateId> <mode> <reasonCode>`.

- [ ] **Step 1: Write failing shadow handoff tests**

For a `gaps-closed: shadow` finding, assert:

```ts
expect(human).toContain("Gate outcome: pass");
expect(human).toContain("Gate finding: gaps-closed shadow gate.gaps_abertos");
expect(json.gateFailures).toEqual([
  expect.objectContaining({
    gateId: "gaps-closed",
    reasonCode: "gate.gaps_abertos",
    mode: "shadow",
  }),
]);
```

Keep `blockers` compatibility assertions and add the empty `gateFailures: []` case.

- [ ] **Step 2: Confirm RED**

```bash
npm test -- tests/gate-facts.test.ts tests/cli-narrate.test.ts tests/cli-composition.test.ts
```

Expected: FAIL because handoff omits the trace and dispatcher recognizes only `1.3.0`.

- [ ] **Step 3: Implement trace projection and rendering**

Add to `CurrentPhaseHandoff` construction:

```ts
gateFailures: input.gateDecision.failures.map((failure) => ({
  ...failure,
  evidenceRefs: [...failure.evidenceRefs],
})),
```

Change handoff's command contract and CLI branch to `phase-handoff@1.4.0`. Extend the renderer's typed input and append one line per failure:

```ts
...payload.gateFailures.map(
  ({ gateId, mode, reasonCode }) =>
    `Gate finding: ${gateId} ${mode} ${reasonCode}`,
),
```

Do not filter shadow failures or derive mode from the aggregate outcome.

- [ ] **Step 4: Confirm GREEN**

```bash
npm test -- tests/gate-facts.test.ts tests/cli-narrate.test.ts tests/cli-composition.test.ts tests/repair-loop-host-integration.test.ts tests/repair-loop-acceptance-recording.test.ts
npm run typecheck
```

Expected: PASS for all modes and current handoff consumers.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/composition/workflow.ts packages/runtime/src/composition/cli.ts packages/runtime/src/domain/cli/spec.ts packages/runtime/src/domain/cli/diagnostics.ts tests/gate-facts.test.ts tests/cli-narrate.test.ts tests/cli-composition.test.ts tests/repair-loop-host-integration.test.ts tests/repair-loop-acceptance-recording.test.ts
git commit -m "feat(handoff): expose effective gate modes"
```

---

### Task 4: Publish structured doctor findings

**Files:**

- Modify: `packages/runtime/src/domain/cli/diagnostics.ts`, `packages/runtime/src/domain/cli/spec.ts`
- Modify: `packages/runtime/src/composition/cli.ts`
- Test: `tests/doctor-command.test.ts`, `tests/cli-composition.test.ts`

**Interfaces:**

- Produces `DoctorReportV1` payload with current health/checks and copied `gateFailures`.
- Adds `JsonContractId` member `doctor-report@1.0.0`.
- Human gate detail: `<gateId>: <mode> <reasonCode>`.

- [ ] **Step 1: Write failing doctor tests**

Add a shadow gap to the doctor subject and assert:

```ts
expect(human.rendered).toContain("gates: warn");
expect(human.rendered).toContain("gaps-closed: shadow gate.gaps_abertos");
expect(json).toMatchObject({
  contractVersion: "1.0.0",
  hostContract: "1.4.0",
  health: "degraded",
  gateFailures: [expect.objectContaining({
    gateId: "gaps-closed",
    reasonCode: "gate.gaps_abertos",
    mode: "shadow",
  })],
});
```

Add an empty-failure regression and preserve corrupt-state universal-result assertions.

- [ ] **Step 2: Confirm RED**

```bash
npm test -- tests/doctor-command.test.ts tests/cli-composition.test.ts
```

Expected: FAIL because doctor success currently publishes `result@1.0.0` and omits effective modes.

- [ ] **Step 3: Build and validate the doctor payload**

Set doctor's JSON contract to `doctor-report@1.0.0`. Populate the gates check with:

```ts
details: observation.gateDecision.failures.map(
  ({ gateId, mode, reasonCode }) => `${gateId}: ${mode} ${reasonCode}`,
),
```

Return this non-corrupt payload:

```ts
payload: {
  contractVersion: CONTRACT_VERSIONS["host.doctor-report"],
  hostContract: CONTRACT_IDENTITIES.host,
  health: report.health,
  checks: report.checks,
  gateFailures: observation.gateDecision.failures.map((failure) => ({
    ...failure,
    evidenceRefs: [...failure.evidenceRefs],
  })),
},
```

Add `prepareDoctorReportPayload()` beside handoff preparation. It uses `declaredContractVersion(payload, "contractVersion", "1.0.0")`, validates `host.doctor-report`, validates public text, and returns canonical JSON plus typed value. Under `--json`, publish canonical payload; otherwise keep current doctor human rendering with the added details. Non-zero paths still publish universal results.

- [ ] **Step 4: Confirm GREEN**

```bash
npm test -- tests/doctor-command.test.ts tests/cli-composition.test.ts tests/contract-schemas.test.ts
npm run typecheck
```

Expected: PASS; diagnostic visibility does not change gate enforcement.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/cli/diagnostics.ts packages/runtime/src/domain/cli/spec.ts packages/runtime/src/composition/cli.ts tests/doctor-command.test.ts tests/cli-composition.test.ts
git commit -m "feat(doctor): report effective gate findings"
```

---

### Task 5: Prove the lifecycle and predecessor refusal

**Files:**

- Modify: `packages/contracts/src/compatibility.ts`
- Create: `fixtures/contracts/v1.3/compatibility-window.json`
- Modify: `tests/contract-compatibility.test.ts`, `tests/gate-policy-modes.test.ts`, `tests/workflow-state-machine.test.ts`, `tests/gate-facts.test.ts`

**Interfaces:**

- Produces internal `classifyContractVersionAgainst(family, value, window): ContractClassification`; do not re-export it from the package barrel.
- Proves the same finding persists in all modes, only enforce stops, and a predecessor returns `contract.state_version_unsupported` for state `1.4.0`.

- [ ] **Step 1: Add the failing three-mode table**

Extend the existing `withGateModes`, `recordProposal`, `recordEvidence`, and `completePhase` flow in `gate-facts.test.ts`. Drive one open-gap finding through composition:

```ts
it.each([
  ["shadow", "pass", "active"],
  ["warn", "warn", "active"],
  ["enforce", "block", "blocked"],
] as const)("records %s as %s", async (mode, outcome, status) => {
  const configured = withGateModes(await startedRun("strict"), {
    "gaps-closed": mode,
  });
  const withGap = await recordProposal(configured, `gap-${mode}`);
  const handoffJson = next(withGap);
  expect(await runCommandLine(["--json", "handoff"], handoffJson.ports)).toBe(0);
  expect(JSON.parse(handoffJson.output.structured_.join(""))).toMatchObject({
    gateOutcome: outcome,
    gateFailures: [expect.objectContaining({ gateId: "gaps-closed", mode })],
  });
  const written = await recordEvidence(
    next(withGap, { [PRD]: "# PRD\n\nRefunds within thirty days.\n" }),
    PRD,
    `evidence-${mode}`,
  );
  expect(await completePhase(written, PRD, `complete-${mode}`)).toBe(0);
  expect(stateOf(written).status).toBe(status);
});
```

In every row also assert the last persisted event's failure mode and run `doctor` against `next(withGap)` to assert the same effective mode. The continued state is `active` at the next phase for shadow and warn; enforce remains `blocked` in the PRD phase.

- [ ] **Step 2: Add the failing predecessor test**

Freeze the predecessor's state readable window through `1.3.0`, then assert:

```ts
const classified = classifyContractVersionAgainst(
  "state", shadowConfig.stateContract, predecessorWindow,
);
expect(classified).toEqual({
  family: "state",
  classification: "unsupported",
  reasonCode: "contract.state_version_unsupported",
  selectedVersion: null,
});
expect(contractFailureResult(classified)).toMatchObject({
  status: "blocked", exitCode: 4, stateChanged: false,
});
```

Use a valid project-config `1.4.0` fixture containing `gateModes: { "gaps-closed": "shadow" }`.

- [ ] **Step 3: Confirm RED**

```bash
npm test -- tests/gate-policy-modes.test.ts tests/workflow-state-machine.test.ts tests/gate-facts.test.ts tests/contract-compatibility.test.ts
```

Expected: FAIL because the classifier cannot receive the frozen predecessor window.

- [ ] **Step 4: Extract the compatibility seam**

Define in `compatibility.ts`:

```ts
export interface CompatibilityWindow {
  readonly pluginVersion: string;
  readonly stateContract: {
    readonly readable: readonly string[];
    readonly migrationOnly: readonly string[];
  };
  readonly hostContract: { readonly accepted: readonly string[] };
}
```

Move existing classification into `classifyContractVersionAgainst`; make public `classifyContractVersion` call it with the imported manifest. Keep the new function out of `packages/contracts/src/index.ts`. Preserve order: migration-only, invalid, readable/current, unsupported.

- [ ] **Step 5: Confirm GREEN**

```bash
npm test -- tests/gate-policy-modes.test.ts tests/workflow-state-machine.test.ts tests/gate-facts.test.ts tests/contract-compatibility.test.ts
npm run typecheck
```

Expected: PASS with stable reason and no state change.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/compatibility.ts fixtures/contracts/v1.3/compatibility-window.json tests/contract-compatibility.test.ts tests/gate-policy-modes.test.ts tests/workflow-state-machine.test.ts tests/gate-facts.test.ts
git commit -m "test(gates): prove selectable shadow rollout"
```

---

### Task 6: Document rollout and capture evidence

**Files:**

- Modify: `docs/user/configuration-and-state.md`, `docs/user/commands.md`
- Modify: `docs/architecture/project-initialization.md`, `docs/architecture/gates-approvals-evidence.md`
- Modify: `docs/compatibility/contract-versioning.md`, `schemas/README.md`, `fixtures/README.md`
- Create: `docs/verification/issue-12a-shadow-gate-selection-evidence.md`
- Test: `tests/contract-documentation.test.ts`, `tests/schema-registry-fixtures.test.ts`

**Interfaces:**

- Documents init input, diagnostic output, exact old-runtime refusal, and `shadow -> measure -> warn -> enforce`.
- Produces reproducible acceptance evidence with commands, exits, and test counts.

- [ ] **Step 1: Add failing documentation assertions**

```ts
expect(configuration).toContain("shadow -> measure -> warn -> enforce");
expect(projectInitialization).toContain('"gaps-closed": "shadow"');
expect(guide).toContain("contract.state_version_unsupported");
expect(schemaIndex).toContain("host.doctor-report@1.0.0");
```

Add registry validation for each new fixture and retain predecessor byte checks.

- [ ] **Step 2: Confirm RED**

```bash
npm test -- tests/contract-documentation.test.ts tests/schema-registry-fixtures.test.ts
```

Expected: FAIL because examples, revisions, and fixtures are missing.

- [ ] **Step 3: Update docs and fixtures**

Document this input:

```json
{
  "contractVersion": "1.5.0",
  "hostContract": "1.4.0",
  "hosts": ["codex"],
  "gateModes": { "gaps-closed": "shadow" }
}
```

Explain preservation on re-init, effective-mode reporting, the four rollout stages, and predecessor refusal. Document the canonical fixtures created with the contracts and update the schema and fixture indexes.

- [ ] **Step 4: Run focused quality gates**

```bash
npm test -- tests/contract-documentation.test.ts tests/schema-registry-fixtures.test.ts
npm run contracts:check
npm run format:check
npm run spellcheck
npm run english:check
```

Expected: PASS.

- [ ] **Step 5: Run full verification**

```bash
npm run verify
```

Expected: exit 0 across formatting, spelling, English, lint, types, tests, coverage, mutation, calibration, performance, oracle, parity, result contract, contracts, differential, prompt ceilings, build, packaging, and benchmark.

- [ ] **Step 6: Write evidence from actual output**

Use these exact sections:

```markdown
# SDD-12a Shadow Gate Selection Evidence

## Acceptance criteria
## Three-mode lifecycle
## Initialization and reporting
## Predecessor compatibility
## Verification commands
## Contract, state, security, and host-parity impact
```

Record only commands run, exit codes, test counts, and the verified commit. Map each criterion to a named test. State that project state remains `1.4.0`, no gate decision changed, no dependency was added, and predecessor refusal is `contract.state_version_unsupported`.

- [ ] **Step 7: Recheck evidence and audit**

```bash
npm run format:check
npm run spellcheck
npm run english:check
git diff --check
git status --short
git diff --stat
```

Expected: PASS and only intended files listed.

- [ ] **Step 8: Commit docs and evidence**

```bash
git add docs schemas/README.md fixtures tests/contract-documentation.test.ts tests/schema-registry-fixtures.test.ts
git commit -m "docs: explain shadow gate rollout"
```

- [ ] **Step 9: Completion audit**

```bash
git status --short
git log --oneline --decorate -8
```

Expected: clean tree and the contract, init, handoff, doctor, acceptance, and docs commits. Do not claim completion unless `npm run verify` and every evidence mapping pass on the final tree.
