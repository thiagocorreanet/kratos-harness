# Stable Acceptance Criterion Identifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every task-document acceptance criterion a stable, frozen, evidence-bound identifier that the gate and event history can report individually.

**Architecture:** A pure task-document parser produces closed criterion observations from bytes read by composition. Plan completion and acceptance recording persist immutable criterion snapshots and per-criterion verdicts as ordinary versioned state artifacts referenced by unchanged `EventV1` records. The runtime alone reconciles verified verdicts into Markdown checkbox state; gates consume the structured observation rather than a feature-wide boolean.

**Tech Stack:** TypeScript ES modules, JSON Schema 2020-12, Ajv, Vitest, deterministic fake runtime ports, Markdown documents, append-only event storage.

**Spec:** `docs/specs/2026-08-27-stable-acceptance-criterion-identifiers-spec.md`

## Global Constraints

- Keep source, tests, fixtures, errors, documentation, commits, and PR text in English.
- Preserve `state.event@1.0.0`, `host.agent-output@1.0.0`, approval binding, snapshot shape, and state/host contract identity `1.0.0` byte-for-byte.
- Publish `^AC-\d+\.\d+\.E?\d+$` and `maxLength: 128` from one canonical schema dependency.
- Use no new dependency and no I/O in domain policy.
- Keep `02-tasks.md` as the only declaration and current checkbox-state surface.
- Follow RED → GREEN → REFACTOR for each task and commit each independently reviewable result.

---

### Task 1: Canonical identifier and persisted contracts

**Files:**
- Create: `schemas/contracts/acceptance-criterion-id.v1.schema.json`
- Create: `schemas/state/acceptance-criteria-snapshot.v1.schema.json`
- Create: `schemas/state/acceptance-verdict.v1.schema.json`
- Modify: `packages/contracts/catalogs/contract-families.v1.json`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/runtime/src/infra/schema/catalog.ts`
- Test: `tests/acceptance-criterion-contracts.test.ts`
- Test: `tests/contract-schemas.test.ts`

**Interfaces:**
- Produces: `ACCEPTANCE_CRITERION_ID_PATTERN`, `ACCEPTANCE_CRITERION_ID_MAX_LENGTH`, `isAcceptanceCriterionId(value: unknown): value is string`.
- Produces: generated `AcceptanceCriteriaSnapshotV1` and `AcceptanceVerdictV1` declarations.
- Preserves: all pre-existing schema bytes and contract family identities.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(ACCEPTANCE_CRITERION_ID_PATTERN).toBe(
  "^AC-\\d+\\.\\d+\\.E?\\d+$",
);
expect(isAcceptanceCriterionId("AC-01.2.E3")).toBe(true);
expect(isAcceptanceCriterionId("AC-1.2.EE3")).toBe(false);
expect(isAcceptanceCriterionId(`AC-${"1".repeat(129)}.2.3`)).toBe(false);
expect(registry.validate({
  id: "state.acceptance-verdict",
  version: "1.0.0",
  value: validVerdict,
  structuralReasonCode: "runtime.state_corrupt",
}).kind).toBe("valid");
```

- [ ] **Step 2: Run RED**

Run: `npm test -- --run tests/acceptance-criterion-contracts.test.ts tests/contract-schemas.test.ts`

Expected: FAIL because the exports, schemas, and registry identities do not exist.

- [ ] **Step 3: Add the canonical schema and generated matcher**

Define the schema dependency with the exact pattern and length. Export constants
and a matcher whose implementation constructs its regular expression from the
same imported schema fields:

```ts
export const ACCEPTANCE_CRITERION_ID_PATTERN = criterionIdSchema.pattern;
export const ACCEPTANCE_CRITERION_ID_MAX_LENGTH = criterionIdSchema.maxLength;
const acceptanceCriterionId = new RegExp(
  ACCEPTANCE_CRITERION_ID_PATTERN,
  "u",
);
export function isAcceptanceCriterionId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= ACCEPTANCE_CRITERION_ID_MAX_LENGTH &&
    acceptanceCriterionId.test(value);
}
```

Register the two persisted payload schemas, add the criterion schema to embedded
dependencies, extend schema registry contract types, and regenerate types with
`npm run contracts:generate`.

- [ ] **Step 4: Run GREEN and contract drift checks**

Run: `npm test -- --run tests/acceptance-criterion-contracts.test.ts tests/contract-schemas.test.ts tests/schema-catalog.test.ts tests/schema-registry-types.test.ts && npm run contracts:check`

Expected: PASS with no generated declaration drift.

- [ ] **Step 5: Commit**

```bash
git add schemas packages/contracts packages/runtime/src/infra/schema tests/acceptance-criterion-contracts.test.ts tests/contract-schemas.test.ts
git commit -m "feat: publish acceptance criterion contracts"
```

### Task 2: Task-document hierarchy and pure parser

**Files:**
- Create: `packages/runtime/src/domain/acceptance-criteria/model.ts`
- Create: `packages/runtime/src/domain/acceptance-criteria/parser.ts`
- Create: `packages/runtime/src/domain/acceptance-criteria/index.ts`
- Modify: `packages/runtime/src/domain/feature-documents/model.ts`
- Modify: `fixtures/feature-documents/complete/02-tasks.md`
- Test: `tests/acceptance-criteria-parser.test.ts`
- Test: `tests/feature-documents.test.ts`

**Interfaces:**
- Produces: `inspectTaskDocument(content: string | null): TaskDocumentObservation`.
- Produces: `renderCriterionCheckboxes(content, outcomes): string` without I/O.
- Consumes: `isAcceptanceCriterionId` from `@kratos/contracts`.

- [ ] **Step 1: Write parser property and example tests**

```ts
expect(inspectTaskDocument(validDocument)).toEqual({
  kind: "valid",
  declarations: [
    expect.objectContaining({
      criterionId: "AC-1.2.3",
      workUnit: "1",
      task: "2",
      criterionKind: "main",
      checked: false,
      ordinal: 0,
    }),
  ],
});
expect(inspectTaskDocument(duplicateDocument)).toEqual({
  kind: "duplicate",
  criterionId: "AC-1.2.3",
});
```

Use deterministic generators for valid non-contiguous identifiers and cases
with missing `E` under edge cases, doubled `E`, negative components, leading
zeroes, over-length identifiers, and heading-coordinate disagreement.

- [ ] **Step 2: Run RED**

Run: `npm test -- --run tests/acceptance-criteria-parser.test.ts tests/feature-documents.test.ts`

Expected: FAIL because the parser and hierarchical template do not exist.

- [ ] **Step 3: Implement the state-machine parser**

Implement a line scanner that tracks fenced blocks, work-unit headings, task
headings, and criterion sections. Return closed observations:

```ts
export type TaskDocumentObservation =
  | { readonly kind: "missing" }
  | { readonly kind: "malformed"; readonly line: number }
  | { readonly kind: "duplicate"; readonly criterionId: string }
  | { readonly kind: "valid"; readonly declarations: readonly AcceptanceCriterionDeclaration[] };
```

Cap declarations at 126 so the largest acceptance append preserves the
unchanged `EventV1` limit of 256 artifact references. Compute the normalized
declaration text with `[ ]` regardless of input state so later snapshots
distinguish text changes from checkbox changes. Update the task template and
fixture to the exact approved hierarchy.

- [ ] **Step 4: Implement deterministic checkbox rendering**

```ts
export function renderCriterionCheckboxes(
  content: string,
  outcomes: ReadonlyMap<string, "passed" | "failed" | "not-run">,
): string;
```

Require a valid parse, replace only the single checkbox byte for declared IDs,
preserve all other bytes and the original final newline, then prove idempotency.

- [ ] **Step 5: Run GREEN**

Run: `npm test -- --run tests/acceptance-criteria-parser.test.ts tests/feature-documents.test.ts`

Expected: PASS, including exact template bytes and parser properties.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/domain/acceptance-criteria packages/runtime/src/domain/feature-documents/model.ts fixtures/feature-documents/complete/02-tasks.md tests/acceptance-criteria-parser.test.ts tests/feature-documents.test.ts
git commit -m "feat: parse identified acceptance criteria"
```

### Task 3: Freeze and verdict domain policy

**Files:**
- Create: `packages/runtime/src/domain/acceptance-criteria/policy.ts`
- Modify: `packages/runtime/src/domain/acceptance-criteria/index.ts`
- Test: `tests/acceptance-criteria-policy.test.ts`

**Interfaces:**
- Produces: `compareCriteriaSnapshot(request): CriteriaChangeDecision`.
- Produces: `decideAcceptanceVerdict(request): AcceptanceVerdictDecision`.
- Produces: pure builders for snapshot and verdict payloads; digests remain injected values.

- [ ] **Step 1: Write failing freeze-policy tests**

```ts
expect(compareCriteriaSnapshot({ phase: "code", frozen, current: renumbered }))
  .toEqual({ kind: "refused", reasonCode: "gate.ac_declaration_changed", criterionId: "AC-1.2.3" });
expect(compareCriteriaSnapshot({ phase: "acceptance", frozen, current: appended }))
  .toMatchObject({ kind: "append", appendedIds: ["AC-1.2.4"] });
```

Cover remove, reorder, text digest change, append in code/review, checked append,
external checkbox flips, and exact unchanged input.

- [ ] **Step 2: Run freeze RED**

Run: `npm test -- --run tests/acceptance-criteria-policy.test.ts`

Expected: FAIL because policy functions do not exist.

- [ ] **Step 3: Implement prefix and checkbox policy**

Compare immutable declaration fields in order. Existing entries must be an
exact prefix. Only `acceptance` may add unchecked tail entries. Expected
checkboxes come from the latest valid verdict map, or all unchecked before any
verdict.

- [ ] **Step 4: Add failing verdict tests**

```ts
expect(decideAcceptanceVerdict({ declarations, criteria: missingOne, evidence }))
  .toEqual({ kind: "refused", reasonCode: "gate.ac_verdict_mismatch", criterionId: "AC-1.2.E1" });
expect(decideAcceptanceVerdict({ declarations, criteria: passedWithoutEvidence, evidence: [] }))
  .toEqual({ kind: "refused", reasonCode: "gate.ac_evidence_missing", criterionId: "AC-1.2.3" });
```

- [ ] **Step 5: Implement verdict bijection and evidence binding**

Require every declaration once, reject unknown or repeated IDs, require global
`accepted` iff all outcomes pass, and bind each result to the matching valid
evidence metadata and digest. Return ordered verdict payloads and the exact
checkbox outcome map.

- [ ] **Step 6: Run GREEN and commit**

Run: `npm test -- --run tests/acceptance-criteria-policy.test.ts`

```bash
git add packages/runtime/src/domain/acceptance-criteria tests/acceptance-criteria-policy.test.ts
git commit -m "feat: freeze acceptance criterion declarations"
```

### Task 4: Observe criterion history and freeze plan completion

**Files:**
- Modify: `packages/runtime/src/composition/workflow.ts`
- Modify: `packages/runtime/src/domain/cli/spec.ts`
- Modify: `packages/runtime/src/domain/cli/workflow.ts`
- Test: `tests/workflow-acceptance-criteria.test.ts`

**Interfaces:**
- Produces: a closed `acceptanceCriteria` observation on workflow commands.
- Persists: initial criteria snapshot in the same effect plan as accepted plan completion.
- Consumes: event artifact references to select immutable snapshots in event order.

- [ ] **Step 1: Write failing plan-freeze integration tests**

Advance a fake run through `plan`, complete it with `02-tasks.md` as the
artifact, and assert one validated snapshot plus its path in the transition
event. Assert malformed, duplicate, checked, or missing documents produce no
snapshot and no accepted transition.

- [ ] **Step 2: Run RED**

Run: `npm test -- --run tests/workflow-acceptance-criteria.test.ts`

Expected: FAIL because plan completion does not observe or freeze criteria.

- [ ] **Step 3: Add composition observation**

Read the active task document once through the durable filesystem port. Read
snapshot and verdict artifacts only from validated event references, validate
each through the schema registry, verify run/event/path/digest agreement, and
pass a closed observation to decisions.

- [ ] **Step 4: Add the plan-completion snapshot effect**

Require `--artifact` to identify the active `02-tasks.md`. Build the immutable
snapshot with the command event ID and inject its path into the same event's
artifact references before returning one atomic effect plan.

- [ ] **Step 5: Run GREEN and regression tests**

Run: `npm test -- --run tests/workflow-acceptance-criteria.test.ts tests/workflow-run-lineage.test.ts tests/workflow-state-machine.test.ts tests/runtime-composition.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/composition/workflow.ts packages/runtime/src/domain/cli/spec.ts packages/runtime/src/domain/cli/workflow.ts tests/workflow-acceptance-criteria.test.ts
git commit -m "feat: freeze criteria when the plan completes"
```

### Task 5: Acceptance recording and checkbox authority

**Files:**
- Modify: `packages/runtime/src/domain/agent/coherence.ts`
- Modify: `packages/runtime/src/domain/cli/agent.ts`
- Modify: `packages/runtime/src/domain/workflow/model.ts`
- Modify: `packages/runtime/src/domain/workflow/reducer.ts`
- Test: `tests/acceptance-criterion-recording.test.ts`
- Test: `tests/agent-output-contract.test.ts`

**Interfaces:**
- Extends: semantic agent-output validation with the canonical AC matcher and exact global verdict agreement.
- Adds: a criterion-aware acceptance fact event while retaining `EventV1`.
- Persists: one immutable verdict record per declaration and an appended snapshot when permitted.

- [ ] **Step 1: Write failing output and authority tests**

Cover malformed AC IDs, duplicate IDs with different outcomes, missing and
unknown IDs, invalid evidence, partial rejected verdicts, fully accepted
verdicts, append in acceptance, checkbox reversal, duplicate delivery, and a
code/review-authored checkbox change.

- [ ] **Step 2: Run RED**

Run: `npm test -- --run tests/acceptance-criterion-recording.test.ts tests/agent-output-contract.test.ts`

Expected: FAIL because `agent record` only stores a generic block today.

- [ ] **Step 3: Implement criterion-aware acceptance recording**

For non-acceptance phases retain existing behavior after enforcing frozen
document and checkbox policy. For acceptance, derive the verdict decision,
write immutable records under the event-ID directory, update only checkbox
bytes, optionally write the appended snapshot, write the agent output, and
append one fact event referencing every produced artifact.

- [ ] **Step 4: Prove atomicity and idempotency**

Inject transaction failures at preparation and publication boundaries. Assert
that task bytes, verdicts, snapshots, agent output, event stream, and snapshot
state are either all old or all new. Re-delivery of the same correlation ID
must write nothing.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm test -- --run tests/acceptance-criterion-recording.test.ts tests/agent-output-contract.test.ts tests/agent-output-recording.test.ts tests/transaction-execution.test.ts`

```bash
git add packages/runtime/src/domain/agent packages/runtime/src/domain/cli/agent.ts packages/runtime/src/domain/workflow tests/acceptance-criterion-recording.test.ts tests/agent-output-contract.test.ts
git commit -m "feat: record evidence-bound criterion verdicts"
```

### Task 6: Per-criterion gate and final completion

**Files:**
- Modify: `packages/runtime/src/domain/gates/model.ts`
- Modify: `packages/runtime/src/domain/gates/evaluate.ts`
- Modify: `packages/runtime/src/domain/acceptance/index.ts`
- Modify: `packages/runtime/src/composition/workflow.ts`
- Test: `tests/gates-approvals-evidence.test.ts`
- Test: `tests/acceptance.test.ts`
- Test: `tests/gate-facts.test.ts`

**Interfaces:**
- Replaces: `GateContext.finalAcceptance` with `acceptanceCriteria`.
- Adds: `GateDecision.criteria`, ordered by document ordinal.
- Preserves: final human approval and existing done lineage requirements.

- [ ] **Step 1: Write failing partial-gate tests**

```ts
expect(decision.criteria).toEqual([
  expect.objectContaining({ criterionId: "AC-1.2.1", state: "passed" }),
  expect.objectContaining({ criterionId: "AC-1.2.E1", state: "failed" }),
]);
expect(decision.failures).toContainEqual(
  expect.objectContaining({ reasonCode: "gate.ac_incomplete" }),
);
```

Also assert unchecked-with-passed-verdict, checked-with-missing-evidence,
unreported criteria, all-passed criteria, and the existing missing final human
approval behavior.

- [ ] **Step 2: Run RED**

Run: `npm test -- --run tests/gates-approvals-evidence.test.ts tests/acceptance.test.ts tests/gate-facts.test.ts`

- [ ] **Step 3: Implement structured gate evaluation**

Build immutable criterion gate states before failure ordering. Add one
`gate.ac_incomplete` failure whose detail names the first incomplete ID; retain
the full list on `GateDecision.criteria`. Evaluate the existing final approval
from validated approvals rather than a supplied boolean.

- [ ] **Step 4: Wire `done` to criterion readiness**

Require every criterion state to be passed, checked, and evidence-valid before
`decideDone` can accept. Keep approval, all-steps, gate, evidence, and lineage
checks unchanged.

- [ ] **Step 5: Run GREEN and commit**

Run: `npm test -- --run tests/gates-approvals-evidence.test.ts tests/acceptance.test.ts tests/gate-facts.test.ts tests/workflow-run-lineage.test.ts`

```bash
git add packages/runtime/src/domain/gates packages/runtime/src/domain/acceptance packages/runtime/src/composition/workflow.ts tests/gates-approvals-evidence.test.ts tests/acceptance.test.ts tests/gate-facts.test.ts
git commit -m "feat: report partial acceptance by criterion"
```

### Task 7: Reason catalog, legacy bootstrap, replay, and public evidence

**Files:**
- Create: `packages/contracts/catalogs/reason-codes.v1.5.json`
- Modify: `packages/contracts/src/compatibility.ts`
- Modify: `packages/contracts/src/reasons.ts`
- Modify: `scripts/lib/result-contract.mjs`
- Modify: `packages/runtime/src/composition/workflow.ts`
- Modify: `docs/architecture/gates-approvals-evidence.md`
- Modify: `docs/architecture/project-initialization.md`
- Modify: `docs/architecture/agent-output-contract.md`
- Modify: `docs/compatibility/contract-versioning.md`
- Create: `docs/verification/issue-132-stable-acceptance-criteria-evidence.md`
- Test: `tests/contract-reason-catalog.test.ts`
- Test: `tests/acceptance-criterion-compatibility.test.ts`

**Interfaces:**
- Publishes: reason catalog `1.5.0` as an append-only extension of `1.4.0`.
- Adds: verified bootstrap from exact plan lineage only.
- Proves: event replay preserves AC-bearing artifact references byte-for-byte.

- [ ] **Step 1: Write failing reason, bootstrap, and replay tests**

Assert the `1.4` catalog digest and prefix remain unchanged, the eleven new
codes have blocked/3/required/no-change/retryable policy, exact lineage digest
bootstraps, drift refuses, and replay returns every verdict artifact reference
unchanged.

- [ ] **Step 2: Run RED**

Run: `npm test -- --run tests/contract-reason-catalog.test.ts tests/acceptance-criterion-compatibility.test.ts tests/event-reducer.test.ts`

- [ ] **Step 3: Publish reasons and verified bootstrap**

Append English descriptions and recoveries, point every current catalog
consumer at `1.5`, and implement bootstrap only when plan lineage names the
active task document and its stored digest equals current bytes. Include the
bootstrap snapshot in the authorized command transaction.

- [ ] **Step 4: Update public documentation and evidence**

Document grammar, hierarchy, lifecycle, gate state, artifact paths, legacy
behavior, compatibility, and security. Fill the issue evidence table with the
exact test names and command outputs; do not add placeholders.

- [ ] **Step 5: Run focused verification**

Run:

```bash
npm test -- --run \
  tests/acceptance-criterion-contracts.test.ts \
  tests/acceptance-criteria-parser.test.ts \
  tests/acceptance-criteria-policy.test.ts \
  tests/workflow-acceptance-criteria.test.ts \
  tests/acceptance-criterion-recording.test.ts \
  tests/acceptance-criterion-compatibility.test.ts \
  tests/gates-approvals-evidence.test.ts \
  tests/acceptance.test.ts \
  tests/contract-reason-catalog.test.ts \
  --reporter=verbose
```

Expected: every named suite passes with zero failures.

- [ ] **Step 6: Run the repository gate**

Run: `npm run verify`

Expected: formatting, spelling, English-only, lint, types, tests, coverage,
mutation, compatibility, build, packaging, and benchmarks all exit zero.

- [ ] **Step 7: Complete evidence and commit**

Replace the evidence document's command-result sections with the observed
counts and exit codes, then run `git diff --check` and commit:

```bash
git add packages/contracts packages/runtime scripts docs tests fixtures schemas
git commit -m "docs: prove stable acceptance criterion behavior"
```

### Task 8: Final audit and PR handoff

**Files:**
- Verify only; update the issue evidence document if observed counts changed.

**Interfaces:**
- Produces: a clean, reviewable branch and PR body closing issue #132.

- [ ] **Step 1: Audit the complete diff**

Run: `git diff origin/main...HEAD --check && git status --short && git diff --stat origin/main...HEAD`

Expected: no whitespace errors, no unexplained files, and only issue-scoped
changes.

- [ ] **Step 2: Re-run final verification if evidence changed**

Run: `npm run verify`

Expected: exit code 0 after the final tracked bytes.

- [ ] **Step 3: Prepare the PR body**

Include `Closes #132`, a concise behavior summary, compatibility impact
(additive schemas and reason catalog; frozen schemas unchanged), state impact
(immutable criterion records and verified legacy bootstrap), security impact
(no new authority or raw event content), exact commands, and one evidence row
per acceptance criterion.
