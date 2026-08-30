# Google Antigravity (`agy` / Gemini) Host Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Google Antigravity (`agy` CLI) and Gemini models as a first-class host adapter in Kratos with full parity to Claude Code and Codex.

**Architecture:** Implement a relay-only `antigravityAdapter` adhering to the 3-method interface (`describe`, `translate`, `relay`), pre-tool mutation normalization for Antigravity's `write_to_file` and `replace_file_content` mutation tools, default Gemini model routing enforcing canonical judge/implementer independence, workspace surface generation (`GEMINI.md` and `.gemini/settings.json`) in `kratos init`, and distribution packaging with lifecycle hooks.

**Tech Stack:** TypeScript 6, Node.js 24+, Vitest, JSON Schema 2020-12, npm workspaces.

**Spec:** [`docs/superpowers/specs/2026-08-30-antigravity-host-adapter-design.md`](../specs/2026-08-30-antigravity-host-adapter-design.md)

## Global Constraints

- Runtime policy is host-neutral; the adapter only translates and relays, never deciding gate or workflow verdicts.
- Model role resolution enforces strict separation between implementer and judge canonical models.
- Pre-tool mutation normalizers fail closed (`uninspectablePreToolRequest`) on malformed or unrecognized mutation inputs.
- Minimum Node engine requirement: `>=24.18.0 <25`.
- All tests must pass with 100% coverage requirements under `npm run verify`.

---

### Task 1: Contract Schemas and Generated Contract Types

**Files:**

- Modify: `schemas/host/adapter-message.v1.1.schema.json`
- Modify: `schemas/host/phase-handoff.v1.1.schema.json`
- Modify: `schemas/host/init-answers.v1.2.schema.json`
- Modify: `schemas/host/init-answers.v1.3.schema.json`
- Modify: `schemas/state/project-config.v1.2.schema.json`
- Modify: `schemas/state/project-config.v1.3.schema.json`
- Generate: `packages/contracts/src/generated/contracts.ts`
- Test: `tests/contract-schemas.test.ts`

**Interfaces:**

- Produces: Updated JSON schemas accepting `"antigravity"` in `host` and `hosts` enums and `modelRoles` definitions, and updated `@kratos/contracts` TypeScript definitions (`InitAnswersV1_2`, `InitAnswersV1_3`, `ProjectConfigV1_2`, `ProjectConfigV1_3`, `AdapterMessageV1_1`, `PhaseHandoffV1_1`).

- [ ] **Step 1: Update JSON schemas to accept `"antigravity"`**

Update `schemas/host/adapter-message.v1.1.schema.json`, `schemas/host/phase-handoff.v1.1.schema.json`, `schemas/host/init-answers.v1.2.schema.json`, `schemas/host/init-answers.v1.3.schema.json`, `schemas/state/project-config.v1.2.schema.json`, `schemas/state/project-config.v1.3.schema.json` to include `"antigravity"`.

- [ ] **Step 2: Regenerate TypeScript contract types**

Run: `node scripts/generate-contract-types.mjs`
Expected: `packages/contracts/src/generated/contracts.ts` updated with `"antigravity"`.

- [ ] **Step 3: Run contract schema tests**

Run: `npx vitest run tests/contract-schemas.test.ts`
Expected: PASS

- [ ] **Step 4: Commit schema and contract type changes**

```bash
git add schemas/ packages/contracts/src/generated/
git commit -m "feat(contracts): add antigravity host identifier to schemas and generated types"
```

---

### Task 2: Pre-Tool-Use Normalization and Lifecycle Hooks for Antigravity

**Files:**

- Create: `packages/adapters/src/antigravity/pre-tool-use.ts`
- Modify: `packages/adapters/src/hooks.ts`
- Create: `tests/antigravity-pre-tool-relay.test.ts`

**Interfaces:**

- Consumes: `@kratos/contracts` (`PreToolUseV1`, `HookObservationV1`), `packages/adapters/src/pre-tool-use.ts` (`preToolRequest`, `uninspectablePreToolRequest`, `record`, `relayPreToolUse`, `NormalizedPreToolUse`, `GuardExecutor`, `PreToolRelayResult`).
- Produces:
  - `normalizeAntigravityPreToolUse(input: unknown): NormalizedPreToolUse`
  - `relayAntigravityPreToolUse(input: unknown, execute: GuardExecutor): PreToolRelayResult`
  - `normalizeAntigravityHook(kind: HookKind, input: unknown): HookObservationV1 | null`

- [ ] **Step 1: Write failing unit tests for `normalizeAntigravityPreToolUse` and `normalizeAntigravityHook`**

Create `tests/antigravity-pre-tool-relay.test.ts` testing creates (`write_to_file` with `Overwrite: false`/undefined), updates (`write_to_file` with `Overwrite: true` and `replace_file_content`), pass-through for read/search tools (`view_file`, `grep_search`, `find_by_name`, `list_dir`, `run_command`), and fail-closed handling for malformed payloads.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/antigravity-pre-tool-relay.test.ts`
Expected: FAIL (modules not found / not implemented)

- [ ] **Step 3: Implement `normalizeAntigravityPreToolUse` and `relayAntigravityPreToolUse`**

Create `packages/adapters/src/antigravity/pre-tool-use.ts`:

- Validate `TargetFile` (absolute path).
- Map `write_to_file`: `Overwrite === true ? "update" : "create"`.
- Map `replace_file_content`: `"update"`.
- Return `{ kind: "pass" }` for non-mutating tools.
- Return `{ kind: "guard", request: uninspectablePreToolRequest() }` for malformed payloads.

- [ ] **Step 4: Implement `normalizeAntigravityHook` in `packages/adapters/src/hooks.ts`**

Export `normalizeAntigravityHook(kind: HookKind, input: unknown): HookObservationV1 | null`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/antigravity-pre-tool-relay.test.ts`
Expected: PASS

- [ ] **Step 6: Commit pre-tool normalization and hook handlers**

```bash
git add packages/adapters/src/antigravity/ packages/adapters/src/hooks.ts tests/antigravity-pre-tool-relay.test.ts
git commit -m "feat(adapters): implement antigravity pre-tool normalization and hook observation"
```

---

### Task 3: Antigravity Host Adapter and Model Catalog Routing

**Files:**

- Modify: `packages/adapters/src/index.ts`
- Modify: `tests/host-adapter-contract.test.ts`
- Modify: `tests/support/model-routing.ts`
- Modify: `tests/support/pre-tool-relay-cases.ts`

**Interfaces:**

- Consumes: `@kratos/contracts`, `packages/adapters/src/antigravity/pre-tool-use.ts`, `packages/adapters/src/hooks.ts`.
- Produces:
  - `SupportedHost`: `"claude-code" | "codex" | "antigravity"`
  - `DEFAULT_CATALOGS.antigravity`: `HostModelCatalog`
  - `antigravityAdapter(options: HostAdapterOptions): HostAdapter`
  - Re-exports of `normalizeAntigravityPreToolUse`, `relayAntigravityPreToolUse`, `normalizeAntigravityHook`.

- [ ] **Step 1: Write failing conformance tests in `tests/host-adapter-contract.test.ts`**

Add `describeHostAdapterContract("Antigravity", () => antigravityAdapter({ modelRouting: antigravityCatalog() }))`, model catalog separation tests for Gemini models, and `hostInstallManifest("antigravity")`. Add Antigravity tool call cases to `tests/support/pre-tool-relay-cases.ts`.

- [ ] **Step 2: Run test to verify failure**

Run: `npx vitest run tests/host-adapter-contract.test.ts`
Expected: FAIL (`antigravityAdapter` not exported)

- [ ] **Step 3: Implement `DEFAULT_CATALOGS.antigravity` and `antigravityAdapter` in `packages/adapters/src/index.ts`**

Update `packages/adapters/src/index.ts`:

- Add `"antigravity"` to `SupportedHost` and `DEFAULT_CATALOGS`.
- Define default roles (`planner`: `gemini-3.7-pro`/`medium`, `implementer`: `gemini-3.7-pro`/`high`, `judge`: `gemini-2.5-pro`/`high`).
- Update `configurationHostFor` to map `"antigravity"` -> `"antigravity"`.
- Implement `antigravityAdapter`.
- Re-export `normalizeAntigravityPreToolUse`, `relayAntigravityPreToolUse`, `normalizeAntigravityHook`.

- [ ] **Step 4: Run conformance tests to verify they pass**

Run: `npx vitest run tests/host-adapter-contract.test.ts`
Expected: PASS

- [ ] **Step 5: Commit adapter implementation and conformance tests**

```bash
git add packages/adapters/src/index.ts tests/host-adapter-contract.test.ts tests/support/
git commit -m "feat(adapters): implement antigravity host adapter and model catalog"
```

---

### Task 4: Runtime CLI, Workspace Init Surface, and Workflow Resolution

**Files:**

- Modify: `packages/runtime/src/domain/cli/adapters.ts`
- Modify: `packages/runtime/src/domain/init/answers.ts`
- Modify: `packages/runtime/src/domain/cli/init.ts`
- Modify: `packages/runtime/src/domain/init/skeleton.ts`
- Modify: `packages/runtime/src/composition/workflow.ts`
- Modify: `packages/runtime/src/composition/migration.ts`
- Test: `tests/init-command.test.ts`
- Test: `tests/adapters-command.test.ts`
- Test: `tests/workflow-composition.test.ts`

**Interfaces:**

- Consumes: `@kratos/adapters`, `@kratos/contracts`.
- Produces:
  - `kratos adapters antigravity` returning versioned manifest.
  - `kratos init --host antigravity` generating `GEMINI.md` and `.gemini/settings.json`.
  - Workflow orchestrator resolving launcher host `"antigravity"`.

- [ ] **Step 1: Write failing tests for `init --host antigravity` and `adapters antigravity`**

Add test cases in `tests/adapters-command.test.ts` and `tests/init-command.test.ts`.

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/adapters-command.test.ts tests/init-command.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `packages/runtime` domains and composition**

- In `packages/runtime/src/domain/cli/adapters.ts`: add `"antigravity"` to `SupportedHost` and `HOSTS`.
- In `packages/runtime/src/domain/init/answers.ts`: add `"antigravity"` to `HOSTS` and `type Host`.
- In `packages/runtime/src/domain/init/skeleton.ts`: add `"antigravity"` to `HOST_SURFACES` generating `GEMINI.md` and `.gemini/settings.json`.
- In `packages/runtime/src/domain/cli/init.ts`: support subject host `"antigravity"` in model refusals.
- In `packages/runtime/src/composition/workflow.ts`: resolve `launcherHost === "antigravity"` to `{ kind: "resolved", host: "antigravity" }`.
- In `packages/runtime/src/composition/migration.ts`: include `"antigravity"`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/adapters-command.test.ts tests/init-command.test.ts tests/workflow-composition.test.ts`
Expected: PASS

- [ ] **Step 5: Commit runtime and CLI integration**

```bash
git add packages/runtime/src/ tests/
git commit -m "feat(runtime): add antigravity host initialization, adapters command, and workflow resolution"
```

---

### Task 5: Distribution Assets, Build, Packaging, and Installation Tooling

**Files:**

- Modify: `distribution/shared/hooks.v1.json`
- Create: `distribution/antigravity/skills/kratos/SKILL.md`
- Create: `distribution/antigravity/skills/kratos/scripts/phase-agent-relay.mjs`
- Create: `distribution/antigravity/hooks/hooks.json`
- Modify: `scripts/build.mjs`
- Modify: `scripts/render-hooks.mjs`
- Modify: `scripts/install-plugin.mjs`
- Test: `tests/bundle-smoke.test.ts`

**Interfaces:**

- Produces:
  - Antigravity distribution bundle at build output `/antigravity/` with `runtime/manifest.json`.
  - Skill and hook relay scripts for Antigravity agent lifecycle.

- [ ] **Step 1: Update `distribution/shared/hooks.v1.json` with Antigravity matchers**

Add `"antigravity": "write_to_file|replace_file_content"` for `tool.before` and `".*"` for other hooks.

- [ ] **Step 2: Create `distribution/antigravity/skills/kratos/SKILL.md` and `phase-agent-relay.mjs`**

Implement the skill markdown bridge and the phase agent relay script for `antigravity`.

- [ ] **Step 3: Update `scripts/render-hooks.mjs` and generate `distribution/antigravity/hooks/hooks.json`**

Run: `node scripts/render-hooks.mjs`
Expected: `distribution/antigravity/hooks/hooks.json` generated.

- [ ] **Step 4: Update `scripts/build.mjs` and `scripts/install-plugin.mjs`**

- In `scripts/build.mjs`: add `"antigravity"` to the artifact hosts array.
- In `scripts/install-plugin.mjs`: allow `--host antigravity`.

- [ ] **Step 5: Run build and bundle smoke tests**

Run: `node scripts/build.mjs && npx vitest run tests/bundle-smoke.test.ts`
Expected: PASS

- [ ] **Step 6: Commit distribution assets and build tooling**

```bash
git add distribution/ scripts/ tests/bundle-smoke.test.ts
git commit -m "feat(distribution): add antigravity bundle, skill definition, hook configuration, and build packaging"
```

---

### Task 6: Full Verification and Quality Gate

**Files:**

- Test: all test suites and quality gates

- [ ] **Step 1: Run typecheck across all workspaces**

Run: `npm run typecheck`
Expected: 0 errors

- [ ] **Step 2: Run linter and formatting checks**

Run: `npm run lint && npm run format:check`
Expected: 0 warnings, 0 errors

- [ ] **Step 3: Run comprehensive verification suite**

Run: `npm run verify`
Expected: All checks pass (format, spellcheck, english, lint, typecheck, test with coverage, mutation check, gap calibration, oracle, parity, contracts, differential, build, package verify, benchmark).

- [ ] **Step 4: Commit any remaining polish adjustments**

```bash
git commit --allow-empty -m "chore: complete verification for Google Antigravity host adapter"
```
