# Language Policy per Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Express project language policy granularly per artifact (conversation, documentation, comments, identifiers, commits), support codebase convention preservation, ensure non-blocking advisory evaluation, and provide dual-channel relay to agents.

**Architecture:** Update state and host contracts to v1.2.0 with a required closed `language` object. The runtime validates completeness, provides deterministic defaults when absent, performs offline convention detection during initialization, upgrades legacy single-field configs cleanly, and relays directives via context files and prompt headers without blocking evaluation.

**Tech Stack:** TypeScript, Node.js, JSON Schema (Draft 2020-12), Vitest, Kratos schema registry.

**Spec:** `docs/superpowers/specs/2026-08-29-language-policy-per-artifact-design.md`

## Global Constraints

- State and host contract versions bump to `1.2.0`.
- The `language` object is closed (`additionalProperties: false`) and requires all 7 properties when present: `conversation`, `documentation`, `comments`, `identifiers`, `commits`, `preserveConventions`, `enforcement`.
- Supported language identifiers are `"en"` and `"pt-BR"`.
- Enforcement levels are `"advisory"` and `"off"`.
- Evaluators never fail an acceptance criterion or block gate completion solely on prose language divergence.
- Normative exceptions (domain terms, proper nouns, acronyms, library names, external interface fields) keep their canonical form.
- Source code, comments, tests, fixtures, prompts, and commits in this repository remain strictly in English (`QAL-09`).

---

### Task 1: Schema Definitions, Reason Codes, and Contract Catalog

**Files:**
- Create: `schemas/state/project-config.v1.2.schema.json`
- Create: `schemas/host/init-answers.v1.2.schema.json`
- Create: `packages/contracts/catalogs/reason-codes.v1.8.json`
- Create: `fixtures/contracts/v1.2/project-config.json`
- Create: `fixtures/contracts/v1.2/init-answers.json`
- Modify: `packages/contracts/catalogs/contract-families.v1.json:1-397`
- Modify: `packages/contracts/src/compatibility.ts:1-60`
- Modify: `packages/contracts/src/generated/contracts.ts:500-600`
- Test: `tests/schema-registry-fixtures.test.ts`
- Test: `tests/contract-compatibility.test.ts`

**Interfaces:**
- Consumes: Existing schema registry and contract compatibility layer.
- Produces: `LanguagePolicyV1`, `ProjectConfigV1_2`, `InitAnswersV1_2` types and `1.2.0` schema definitions.

- [ ] **Step 1: Write the failing test for v1.2.0 schemas and contract compatibility**

In `tests/contract-compatibility.test.ts`, add:
```typescript
it("recognizes stateContract 1.2.0 and hostContract 1.2.0 as current", () => {
  expect(CONTRACT_IDENTITIES.state).toBe("1.2.0");
  expect(CONTRACT_IDENTITIES.host).toBe("1.2.0");
  expect(CONTRACT_VERSIONS["state.project-config"]).toBe("1.2.0");
  expect(CONTRACT_VERSIONS["host.init-answers"]).toBe("1.2.0");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/contract-compatibility.test.ts`
Expected: FAIL due to mismatched contract versions (currently `1.1.0`).

- [ ] **Step 3: Create schemas, fixtures, reason catalog, and update compatibility metadata**

Create `schemas/state/project-config.v1.2.schema.json` with the required closed 7-property `language` object.
Create `schemas/host/init-answers.v1.2.schema.json` with optional `language` object that requires all 7 properties when present.
Copy and update `packages/contracts/catalogs/reason-codes.v1.8.json` from `v1.7.json`, adding:
```json
{
  "code": "policy.language_incomplete",
  "description": "A supplied language policy is incomplete and missing required fields.",
  "status": "blocked",
  "exitCode": 3,
  "evidence": "required",
  "stateChanged": false,
  "retryable": true,
  "recovery": "Provide all 7 required fields for the language policy object or omit it to use defaults."
},
{
  "code": "policy.language_convention_mismatch_advisory",
  "description": "The evaluated artifact language differs from the declared language policy.",
  "status": "advisory",
  "exitCode": 0,
  "evidence": "optional",
  "stateChanged": false,
  "retryable": false,
  "recovery": "Review the artifact language against the declared project language policy."
}
```
Update `packages/contracts/catalogs/contract-families.v1.json` to bump `stateContract.current` to `"1.2.0"`, `hostContract.current` to `"1.2.0"`, and `reasonCatalog` to `"1.8.0"`.
Update `packages/contracts/src/compatibility.ts` and export `ProjectConfigV1_2` / `InitAnswersV1_2` / `LanguagePolicyV1` in `packages/contracts/src/generated/contracts.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/contract-compatibility.test.ts tests/schema-registry-fixtures.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add schemas/ packages/contracts/ fixtures/ tests/
git commit -m "feat(contracts): add v1.2.0 schemas and language policy contracts"
```

---

### Task 2: Initialization Answers Resolution and Defaulting

**Files:**
- Modify: `packages/runtime/src/domain/init/answers.ts:1-197`
- Test: `tests/init-answers.test.ts`

**Interfaces:**
- Consumes: `InitAnswersV1_2`, `LanguagePolicyV1` from `@kratos/contracts`.
- Produces: `resolveInitAnswers` resolving absent `language` to default policy and rejecting incomplete `language` objects.

- [ ] **Step 1: Write failing tests for language policy resolution and refusal of incomplete objects**

In `tests/init-answers.test.ts`, add:
```typescript
it("defaults absent language policy to complete English defaults", async () => {
  const resolved = await resolveInitAnswers(
    answers({ hosts: ["codex"] }),
    registry,
    fixedModelRouting([codexCatalog()]),
  );
  expect(resolved.kind).toBe("resolved");
  if (resolved.kind !== "resolved") return;
  expect(resolved.answers.language).toEqual({
    conversation: "en",
    documentation: "en",
    comments: "en",
    identifiers: "en",
    commits: "en",
    preserveConventions: true,
    enforcement: "advisory",
  });
  expect(resolved.defaulted).toContain("language");
});

it("rejects an incomplete language policy object with a diagnostic naming the missing field", async () => {
  const resolved = await resolveInitAnswers(
    answers({
      hosts: ["codex"],
      language: {
        conversation: "pt-BR",
        documentation: "pt-BR",
        // missing comments, identifiers, commits, preserveConventions, enforcement
      },
    }),
    registry,
    fixedModelRouting([codexCatalog()]),
  );
  expect(resolved.kind).toBe("invalid");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/init-answers.test.ts`
Expected: FAIL due to string-based language assumptions in `answers.ts`.

- [ ] **Step 3: Update `answers.ts` to support `LanguagePolicyV1` and full default resolution**

Update `DEFAULT_LANGUAGE_POLICY` in `packages/runtime/src/domain/init/answers.ts`:
```typescript
export const DEFAULT_LANGUAGE_POLICY: LanguagePolicyV1 = {
  conversation: "en",
  documentation: "en",
  comments: "en",
  identifiers: "en",
  commits: "en",
  preserveConventions: true,
  enforcement: "advisory",
};
```
Update `resolveInitAnswers` to construct `answers.language` using `supplied.language ?? DEFAULT_LANGUAGE_POLICY`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/init-answers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/init/answers.ts tests/init-answers.test.ts
git commit -m "feat(init): resolve per-artifact language policy and defaults in init answers"
```

---

### Task 3: Convention Detection and Skeleton Effects

**Files:**
- Create: `packages/runtime/src/domain/init/detect.ts`
- Modify: `packages/runtime/src/domain/init/index.ts`
- Modify: `packages/runtime/src/domain/init/skeleton.ts:1-372`
- Test: `tests/init-convention-detection.test.ts`
- Test: `tests/skeleton.test.ts`

**Interfaces:**
- Consumes: `RepositoryEvidence` from `domain/init/stack.ts`, `ResolvedAnswers` from `domain/init/answers.ts`.
- Produces: `detectLanguageConventions` and updated `skeletonEffects` emitting `.brain/config.json` v1.2.0, `CLAUDE.md`, `AGENTS.md`, and `.codex/config.toml`.

- [ ] **Step 1: Write failing test for convention detection and skeleton content**

Create `tests/init-convention-detection.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { detectLanguageConventions } from "@kratos/runtime/domain/init";

describe("convention detection", () => {
  it("detects dominant conventions from existing repository files when preserveConventions is true", () => {
    const convention = detectLanguageConventions({
      rootEntries: ["README.md", "src", "package.json"],
      sampleContent: [{ path: "README.md", content: "# Visão Geral do Projeto\nEste projeto..." }],
    });
    expect(convention.documentation).toBe("pt-BR");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/init-convention-detection.test.ts`
Expected: FAIL ("detectLanguageConventions is not defined").

- [ ] **Step 3: Implement `detect.ts` and update `skeleton.ts`**

Implement pure, offline convention detection in `packages/runtime/src/domain/init/detect.ts`.
Update `packages/runtime/src/domain/init/skeleton.ts`:
- Emit `.brain/config.json` with `contractVersion: "1.2.0"`, `stateContract: "1.2.0"`, `hostContract: "1.2.0"`, and full `language` object.
- Render detailed language directives into `CLAUDE.md` and `AGENTS.md` (e.g. Conversation, Documentation, Comments, Identifiers, Commits).
- Render `[language]` section into `.codex/config.toml`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/init-convention-detection.test.ts tests/skeleton.test.ts tests/init-command.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/init/ tests/
git commit -m "feat(init): add convention detection and render language policy skeleton"
```

---

### Task 4: Project Configuration Classification and Loading

**Files:**
- Modify: `packages/runtime/src/domain/project/configuration.ts:1-81`
- Test: `tests/project-configuration-layers.test.ts`
- Test: `tests/configuration-classification.test.ts`

**Interfaces:**
- Consumes: `ProjectConfigV1_2` from `@kratos/contracts`.
- Produces: `classifyConfiguration` recognizing state version `"1.2.0"` as valid and requiring migration for `"1.0.0"` and `"1.1.0"`.

- [ ] **Step 1: Write failing test for configuration classification**

In `tests/configuration-classification.test.ts`, add:
```typescript
it("classifies stateContract 1.1.0 as migration-required and 1.2.0 as valid", () => {
  const outcome11 = classifyConfiguration(
    { kind: "file", text: JSON.stringify({ stateContract: "1.1.0" }) },
    () => ({ kind: "valid", value: {} as any }),
  );
  expect(outcome11.kind).toBe("migration-required");

  const outcome12 = classifyConfiguration(
    { kind: "file", text: JSON.stringify({ stateContract: "1.2.0" }) },
    () => ({ kind: "valid", value: {} as any }),
  );
  expect(outcome12.kind).toBe("valid");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/configuration-classification.test.ts`
Expected: FAIL because `1.1.0` is currently treated as valid instead of migration-required.

- [ ] **Step 3: Update `configuration.ts` for stateContract `1.2.0`**

In `packages/runtime/src/domain/project/configuration.ts`, require migration if `stateContract === "1.0.0" || stateContract === "1.1.0"`, and validate `ProjectConfigV1_2` when `stateContract === "1.2.0"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/configuration-classification.test.ts tests/project-configuration-layers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/project/configuration.ts tests/
git commit -m "feat(project): classify config v1.2.0 as valid and v1.0/v1.1 as migration-required"
```

---

### Task 5: Configuration Migration from Legacy Formats

**Files:**
- Modify: `packages/runtime/src/domain/migration/upgrade.ts:1-77`
- Modify: `packages/runtime/src/composition/migration.ts:1-1339`
- Test: `tests/config-migration.test.ts`

**Interfaces:**
- Consumes: `ProjectConfigV1`, `ProjectConfigV1_1`.
- Produces: `upgradeProjectConfiguration` producing `ProjectConfigV1_2` with migrated `LanguagePolicyV1`.

- [ ] **Step 1: Write failing tests for single-field language migration**

In `tests/config-migration.test.ts`, add:
```typescript
it("migrates legacy pt-BR language config into granular language policy", async () => {
  const legacy: ProjectConfigV1_1 = {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    pluginVersion: "0.0.0-development",
    hostContract: "1.1.0",
    language: "pt-BR",
    policyMode: "standard",
    managedState: { directory: ".brain", eventLog: "events.jsonl", snapshots: true },
    modelRoles: { codex: codexCatalog().defaults },
  };
  const upgraded = upgradeProjectConfigurationV1_2(legacy);
  expect(upgraded.contractVersion).toBe("1.2.0");
  expect(upgraded.stateContract).toBe("1.2.0");
  expect(upgraded.language).toEqual({
    conversation: "pt-BR",
    documentation: "pt-BR",
    comments: "en",
    identifiers: "en",
    commits: "en",
    preserveConventions: true,
    enforcement: "advisory",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config-migration.test.ts`
Expected: FAIL ("upgradeProjectConfigurationV1_2 is not defined").

- [ ] **Step 3: Implement upgrade logic and wire into `observeMigration`**

Update `packages/runtime/src/domain/migration/upgrade.ts` to add step from `1.1.0` to `1.2.0` migrating `language` from string to `LanguagePolicyV1`.
Update `packages/runtime/src/composition/migration.ts` to handle `stateContract: "1.2.0"` migrations and rollbacks cleanly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/migration/ packages/runtime/src/composition/migration.ts tests/config-migration.test.ts
git commit -m "feat(migration): upgrade legacy single-field language configs to v1.2.0 policy"
```

---

### Task 6: Phase Agent Prompts and Dual-Channel Relay

**Files:**
- Modify: `packages/runtime/src/domain/phase-agents/model.ts:1-250`
- Modify: `packages/runtime/src/domain/phase-agents/index.ts`
- Test: `tests/phase-agent-prompts.test.ts`

**Interfaces:**
- Consumes: `LanguagePolicyV1`.
- Produces: `PHASE_AGENT_PROMPTS` including normative language rules and exception boundaries.

- [ ] **Step 1: Write failing test verifying language policy rules and exceptions in prompts**

In `tests/phase-agent-prompts.test.ts`, add:
```typescript
it("contains language policy rules and normative exceptions in shared instructions", () => {
  for (const { instructions } of PHASE_AGENT_PROMPTS) {
    expect(instructions).toContain("## Language policy");
    expect(instructions).toContain("Domain terms, proper nouns, acronyms, library names");
    expect(instructions).toContain("external interface fields keep their canonical form");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/phase-agent-prompts.test.ts`
Expected: FAIL due to missing language policy section in prompt template.

- [ ] **Step 3: Update `packages/runtime/src/domain/phase-agents/model.ts`**

Add the language policy section and normative exception definitions to `sharedInstructions` in `packages/runtime/src/domain/phase-agents/model.ts`. Ensure byte size stays well below `MAX_PHASE_AGENT_PROMPT_BYTES` (12 KB).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/phase-agent-prompts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/phase-agents/model.ts tests/phase-agent-prompts.test.ts
git commit -m "feat(prompts): relay language policy and normative exceptions in phase agent prompts"
```

---

### Task 7: Gate Evaluation and Non-Blocking Advisory Reporting

**Files:**
- Modify: `packages/runtime/src/domain/gates/evaluate.ts:1-160`
- Modify: `packages/runtime/src/domain/acceptance/index.ts:1-164`
- Test: `tests/gate-evaluator.test.ts`
- Test: `tests/acceptance.test.ts`

**Interfaces:**
- Consumes: Language observation metadata, `LanguagePolicyV1`.
- Produces: Advisory diagnostics without blocking criteria or gates.

- [ ] **Step 1: Write failing test ensuring language mismatch never fails acceptance criteria**

In `tests/gate-evaluator.test.ts`, add:
```typescript
it("reports language mismatch as advisory without failing gate or criteria", () => {
  const decision = evaluateGates(contextWithLanguageMismatch);
  expect(decision.failures.some(f => f.gateId === "acceptance-criteria")).toBe(false);
  expect(decision.advisories?.some(a => a.reasonCode === "policy.language_convention_mismatch_advisory")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/gate-evaluator.test.ts`
Expected: FAIL.

- [ ] **Step 3: Update gate evaluation to emit advisory diagnostics without gate failure**

Update `packages/runtime/src/domain/gates/evaluate.ts` and `packages/runtime/src/domain/acceptance/index.ts` to record advisory language diagnostics without creating blocking gate failures.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/gate-evaluator.test.ts tests/acceptance.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/gates/ packages/runtime/src/domain/acceptance/ tests/
git commit -m "feat(gates): report language divergence as advisory without blocking criteria"
```

---

### Task 8: End-to-End Verification and Full Suite Pass

**Files:**
- Modify: Documentation and changelog / architecture records if applicable.
- Test: Full repository test suite.

- [ ] **Step 1: Run full verification suite**

Run: `npm run verify`
Expected: All TypeScript checks, schema validation, linting, and tests PASS (100% green).

- [ ] **Step 2: Commit any final test adjustments**

```bash
git commit -m "chore: complete verification for language policy per artifact (FND-08)"
```
