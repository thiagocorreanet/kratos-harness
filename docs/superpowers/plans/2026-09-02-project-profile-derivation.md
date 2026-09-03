# Project Profile Derivation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Infer the project profile (commands, paths, conventions) offline and deterministically from repository manifests and directory structure with explicit provenance, user confirmation, and distinct `derived` status.

**Architecture:** Versioned initialization answers (`1.6.0`) and project configuration (`1.5.0`) add a `derived` status carrying provenance evidence. A pure derivation engine extracts commands and paths from declarative manifests (`package.json`, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`) and directory layouts. Stack profile rendering displays provenance, doctor passes on complete derived/resolved profiles, and gates fail closed on unconfirmed derived commands.

**Tech Stack:** TypeScript, JSON Schema 2020-12, Vitest, Node.js ESM runtime.

**Spec:** `docs/superpowers/specs/2026-09-02-project-profile-derivation-design.md`

## Global Constraints

- Derivation reads only declarative manifest sections and directory names.
- Make no network call, consult no clock (`Date.now`), and execute no command from the repository.
- Distinguish strictly between `resolved` (human confirmed), `derived` (inferred with evidence), `not-applicable`, and `unresolved`.
- Keep the same repository yielding the same derived profile deterministically on every run.
- Keep all repository-authored documentation and code in English.
- Write tests first (TDD) and verify failure before writing implementation.
- Preserve published schemas and reason catalogs byte for byte.
- Run narrow tests before `npm run verify`.

---

### Task 1: Versioned profile contracts, schemas, and pure derivation engine

**Files:**

- Create: `schemas/host/init-answers.v1.6.schema.json`
- Create: `schemas/state/project-config.v1.5.schema.json`
- Create: `packages/runtime/src/domain/init/derive.ts`
- Modify: `packages/contracts/catalogs/contract-families.v1.json`
- Modify: `packages/contracts/src/generated/contracts.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/runtime/src/domain/init/profile.ts`
- Modify: `packages/runtime/src/domain/init/index.ts`
- Test: `tests/init-profile-derivation.test.ts`, `tests/contract-schemas.test.ts`, `tests/init-answers.test.ts`

**Interfaces:**

- `ProjectProfileLeaf<T>` extended with `{ status: "derived", value: T, evidence: string }`.
- `deriveProjectProfile(evidence: RepositoryEvidence, manifests: ManifestContents): PartialProjectProfile`.
- `resolveProjectProfile(explicit, persisted, derived)` with precedence: explicit > persisted > derived > unresolved.

- [ ] **Step 1: Write failing tests for derived leaf status, schema validation, and pure derivation engine**
  - Add test cases in `tests/init-profile-derivation.test.ts` for extracting `package.json` scripts (`test`, `lint`, `build`, `run`), `Makefile` targets, `pyproject.toml` tool sections, `Cargo.toml`, `go.mod`, directory paths (`src`, `tests`, `config`), and census languages.
  - Add schema validation tests in `tests/contract-schemas.test.ts` for `init-answers@1.6.0` and `project-config@1.5.0` accepting `derived` status with evidence string.
- [ ] **Step 2: Run tests to verify they fail**
  - Run: `npx vitest run tests/init-profile-derivation.test.ts tests/contract-schemas.test.ts`
  - Expected: FAIL with missing schemas / functions.
- [ ] **Step 3: Implement schemas, manifest registrations, and derivation engine**
  - Create `schemas/host/init-answers.v1.6.schema.json` and `schemas/state/project-config.v1.5.schema.json`.
  - Update `packages/contracts/catalogs/contract-families.v1.json` and run `npm run contracts:generate`.
  - Implement `packages/runtime/src/domain/init/derive.ts` and update `packages/runtime/src/domain/init/profile.ts`.
- [ ] **Step 4: Run tests to verify they pass**
  - Run: `npx vitest run tests/init-profile-derivation.test.ts tests/contract-schemas.test.ts tests/init-answers.test.ts`
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `git add schemas/ packages/ tests/`
  - `git commit -s -m "feat(init): add profile derivation schemas and pure extraction engine (ADP-08)"`

---

### Task 2: Initialization composition, manifest reading, state migration, and stack profile rendering

**Files:**

- Modify: `packages/runtime/src/composition/repository.ts`
- Modify: `packages/runtime/src/composition/init.ts`
- Modify: `packages/runtime/src/domain/init/answers.ts`
- Modify: `packages/runtime/src/domain/init/skeleton.ts`
- Modify: `packages/runtime/src/domain/init/stack-profile.ts`
- Modify: `packages/runtime/src/domain/migration/upgrade.ts`
- Modify: `packages/runtime/src/composition/migration.ts`
- Test: `tests/init-skeleton.test.ts`, `tests/init-command.test.ts`, `tests/init-stack-profile.test.ts`, `tests/config-migration.test.ts`

**Interfaces:**

- Composition safely reads top-level declarative manifest files (`package.json`, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`) present in root entries.
- `renderStackProfile` annotates derived entries with `(derived from <evidence>)`.
- Configuration migration `1.4.0 -> 1.5.0` seamlessly upgrades `.brain/config.json`.
- `skeletonEffects` produces `stateContract: "1.5.0"`.

- [ ] **Step 1: Write failing tests for stack profile rendering with provenance, init composition derivation, and 1.4->1.5 migration**
  - Test `renderStackProfile` rendering commands and prose leaves with `(derived from <evidence>)`.
  - Test `observeInitialization` deriving commands from repo manifest when answers omit them.
  - Test migration of `state.project-config@1.4.0` to `1.5.0`.
- [ ] **Step 2: Run tests to verify they fail**
  - Run: `npx vitest run tests/init-stack-profile.test.ts tests/init-command.test.ts tests/config-migration.test.ts`
  - Expected: FAIL on missing rendering logic, missing migration, or contract version mismatch.
- [ ] **Step 3: Implement manifest composition, stack-profile rendering, skeleton, and migration**
  - Update `packages/runtime/src/composition/init.ts` and `repository.ts` to read candidate manifests safely.
  - Update `packages/runtime/src/domain/init/stack-profile.ts` to format `derived` leaves with provenance.
  - Update `packages/runtime/src/domain/init/skeleton.ts` and `answers.ts` for contract `1.5.0` / `1.6.0`.
  - Update `packages/runtime/src/domain/migration/upgrade.ts` for 1.4.0 $\rightarrow$ 1.5.0 migration.
- [ ] **Step 4: Run tests to verify they pass**
  - Run: `npx vitest run tests/init-stack-profile.test.ts tests/init-command.test.ts tests/config-migration.test.ts tests/init-skeleton.test.ts`
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `git add packages/ tests/`
  - `git commit -s -m "feat(init): compose manifest observation, render provenance, and migrate config (ADP-08)"`

---

### Task 3: Relay interview, distribution skills, doctor diagnostics, and operator gate invariants

**Files:**

- Modify: `distribution/shared/project-profile-relay.mjs`
- Modify: `distribution/claude-code/skills/kratos/SKILL.md`
- Modify: `distribution/antigravity/skills/kratos/SKILL.md`
- Modify: `distribution/codex/skills/kratos/SKILL.md`
- Modify: `packages/runtime/src/domain/diagnostics/index.ts`
- Modify: `packages/runtime/src/domain/workflow/` or gate check modules where operator decisions are enforced
- Modify: `docs/architecture/project-initialization.md`
- Modify: `docs/compatibility/contract-versioning.md`
- Modify: `docs/user/commands.md`
- Modify: `docs/user/configuration-and-state.md`
- Test: `tests/diagnostics.test.ts`, `tests/doctor-command.test.ts`, `tests/project-profile-relay.test.ts`

**Interfaces:**

- Relay shapes candidate derived values for operator confirmation (`resolved` if confirmed, `derived` if unconfirmed, `unresolved` if blank).
- `deriveStackProfileCheck` reports `pass` when all keys are `resolved`, `derived`, or `not-applicable` and file matches expected bytes.
- Operator decision gates require `resolved` commands before executing actions under operator consent.

- [ ] **Step 1: Write failing tests for doctor pass on derived profile, relay formatting, and unconfirmed gate refusal**
  - Test `deriveStackProfileCheck` passing when profile has `derived` items and no `unresolved` items.
  - Test relay interview functions with derived suggestions.
  - Test gate checks failing on unconfirmed derived commands where human confirmation is mandatory.
- [ ] **Step 2: Run tests to verify they fail**
  - Run: `npx vitest run tests/diagnostics.test.ts tests/doctor-command.test.ts`
  - Expected: FAIL on assertions expecting `doctor` or relay changes.
- [ ] **Step 3: Implement doctor diagnostics, relay utilities, skills updates, and documentation**
  - Update `packages/runtime/src/domain/diagnostics/index.ts`.
  - Update `distribution/shared/project-profile-relay.mjs` and SKILL markdown files.
  - Update documentation files (`project-initialization.md`, `contract-versioning.md`, `commands.md`, `configuration-and-state.md`).
- [ ] **Step 4: Run tests to verify they pass**
  - Run: `npx vitest run tests/diagnostics.test.ts tests/doctor-command.test.ts tests/package-verifier.test.ts`
  - Expected: PASS.
- [ ] **Step 5: Commit**
  - `git add distribution/ packages/ docs/ tests/`
  - `git commit -s -m "feat(distribution): update relay interview, doctor diagnostics, and distribution skills (ADP-08)"`

---

### Task 4: Full verification, AC evidence, and gate checks

**Files:**

- Create: `docs/verification/issue-190-project-profile-derivation-evidence.md`
- Modify: any files needed to fix lint, types, or tests

- [ ] **Step 1: Create verification evidence document mapping AC-1 through AC-8**
  - Document evidence for each acceptance criterion with reproducible test commands and output snippets.
- [ ] **Step 2: Run comprehensive quality and verification suite**
  - Run: `npm run lint`
  - Run: `npm run typecheck`
  - Run: `npm test`
  - Run: `npm run contracts:check`
  - Run: `npm run package:verify`
  - Run: `npm run verify`
- [ ] **Step 3: Commit verification evidence and final cleanups**
  - `git add docs/verification/`
  - `git commit -s -m "docs(verification): add evidence for project profile derivation (ADP-08)"`
