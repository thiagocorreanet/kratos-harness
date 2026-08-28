# Shared Phase Agent Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install five behaviorally complete phase-agent prompts for Codex and Claude Code from one host-neutral source.

**Architecture:** A pure runtime-domain catalog composes shared and role-specific instructions. Codex initialization and Claude package staging wrap the same canonical bodies in host-native syntax, while conformance tests decode installed artifacts and compare them with the catalog.

**Tech Stack:** TypeScript 6, Node.js 24, Vitest 4, ESM, deterministic package staging.

**Spec:** `docs/specs/2026-08-28-phase-agent-prompts-spec.md`

## Global Constraints

- Keep source, prompts, fixtures, tests, documentation, commits, and PR text in English.
- Preserve every existing contract version, schema byte, reason code, workflow phase, migration guarantee, and CLI interface.
- Prompt bodies contain no host-specific tool names and never decide gates or transitions.
- Each canonical UTF-8 prompt body is at most 12 KiB.
- Use test-first Red-Green-Refactor cycles and run focused tests before `npm run verify`.

---

### Task 1: Publish the canonical phase-agent catalog

**Files:**
- Create: `packages/runtime/src/domain/phase-agents/model.ts`
- Create: `packages/runtime/src/domain/phase-agents/index.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/phase-agent-prompts.test.ts`

**Interfaces:**
- Consumes: `FEATURE_DOCUMENTS` and the `Agent` output discriminator type.
- Produces: `PHASE_AGENT_PROMPTS`, `PhaseAgentDefinition`, `PhaseAgentId`, and `MAX_PHASE_AGENT_PROMPT_BYTES`.

- [ ] **Step 1: Write a failing catalog contract test**

  Import `PHASE_AGENT_PROMPTS` from `@kratos/runtime/domain/phase-agents` and assert the literal role/output map, canonical active-feature paths, 12 KiB UTF-8 ceiling, shared uncertainty behavior, role-specific boundaries, reviewer checklist, implementer authority prohibition, evaluator evidence thresholds, and absence of host-specific tool names.

- [ ] **Step 2: Run the catalog test and confirm the missing module failure**

  Run: `npx vitest run tests/phase-agent-prompts.test.ts`

  Expected: failure because `@kratos/runtime/domain/phase-agents` is not exported.

- [ ] **Step 3: Implement the minimal pure catalog**

  Define the public shape:

  ```ts
  export const MAX_PHASE_AGENT_PROMPT_BYTES = 12 * 1024;

  export type PhaseAgentId =
    | "code-implementer"
    | "implementation-evaluator"
    | "prd-researcher"
    | "spec-planner"
    | "spec-reviewer";

  export interface PhaseAgentDefinition {
    readonly id: PhaseAgentId;
    readonly description: string;
    readonly outputAgents: readonly Agent[];
    readonly instructions: string;
  }
  ```

  Build each `instructions` value from one shared contract section and one role section. Derive the four active-feature document references from `FEATURE_DOCUMENTS`; include compact envelope and discriminator-specific payload guidance without stable reason codes.

- [ ] **Step 4: Run the focused catalog test**

  Run: `npx vitest run tests/phase-agent-prompts.test.ts`

  Expected: all catalog assertions pass.

### Task 2: Render Codex definitions and Claude package agents

**Files:**
- Modify: `packages/runtime/src/domain/init/skeleton.ts`
- Modify: `scripts/build.mjs`
- Test: `tests/phase-agent-prompts.test.ts`
- Test: `tests/init-skeleton.test.ts`
- Test: `tests/runtime-distribution.test.ts`

**Interfaces:**
- Consumes: `PHASE_AGENT_PROMPTS` from Task 1.
- Produces: Codex `developer_instructions` values and Claude Code Markdown agent files with byte-identical decoded bodies.

- [ ] **Step 1: Extend tests with failing host-rendering expectations**

  Assert that every generated Codex TOML includes `developer_instructions`, every built Claude package contains `agents/<id>.md`, and decoding either wrapper yields the literal catalog body. Also assert the existing Claude orchestrator bytes remain unchanged.

- [ ] **Step 2: Run focused rendering tests and confirm missing prompt failures**

  Run: `npx vitest run tests/phase-agent-prompts.test.ts tests/init-skeleton.test.ts tests/runtime-distribution.test.ts`

  Expected: failure because Codex lacks `developer_instructions` and Claude lacks the five phase-agent files.

- [ ] **Step 3: Render Codex TOML from the catalog**

  Replace `CODEX_AGENTS` with `PHASE_AGENT_PROMPTS`. Preserve the managed header, name, description, and state metadata; encode the exact canonical body as valid multiline `developer_instructions` without interpreting its content.

- [ ] **Step 4: Render Claude Markdown during package staging**

  After compiling the runtime tree, import the compiled pure phase-agent module and write one `agents/<id>.md` per catalog entry. Front matter contains only name and description; the body is the unchanged canonical instructions plus one trailing newline.

- [ ] **Step 5: Run the focused rendering tests**

  Run: `npx vitest run tests/phase-agent-prompts.test.ts tests/init-skeleton.test.ts tests/runtime-distribution.test.ts`

  Expected: catalog and decoded installed bodies agree for all five roles.

### Task 3: Convert agent-output fixtures into complete replies

**Files:**
- Replace: `fixtures/agent-output/v1/valid/*.json` with `fixtures/agent-output/v1/valid/*.md`
- Replace: `fixtures/agent-output/v1/invalid/*.json` with `fixtures/agent-output/v1/invalid/*.md`
- Modify: `tests/agent-output-contract.test.ts`
- Modify: `fixtures/README.md`

**Interfaces:**
- Consumes: existing machine-block delimiters and `host.agent-output@1.0.0` validation.
- Produces: six valid and six schema-invalid complete Markdown reply fixtures.

- [ ] **Step 1: Change the contract test to require complete reply fixtures**

  Load `.md` files, run `extractAgentBlock`, and validate the extracted value. Require exactly the six runtime discriminators in both directories and preserve the separate absent, malformed, decoy, invalid, and trailing extractor cases.

- [ ] **Step 2: Run the output test and confirm JSON fixtures cannot satisfy it**

  Run: `npx vitest run tests/agent-output-contract.test.ts`

  Expected: failure because the valid and invalid directories do not yet contain Markdown replies.

- [ ] **Step 3: Replace each payload fixture with a complete reply**

  Give every fixture concise human prose followed by exactly one final machine block. Valid artifacts use the canonical document paths: PRD writes `00-prd.md`, spec writes `01-design.md` and `02-tasks.md`, plan writes `03-summa.md`, code reports only changed source/test files, and review/acceptance remain read-only. Invalid fixtures retain one deliberate schema violation each.

- [ ] **Step 4: Run output extraction and validation tests**

  Run: `npx vitest run tests/agent-output-contract.test.ts tests/agent-output-recording.test.ts`

  Expected: all complete replies extract; valid blocks pass; invalid blocks fail with diagnostics.

### Task 4: Prove policy isolation, packaging, and public behavior

**Files:**
- Modify: `tests/phase-agent-prompts.test.ts`
- Modify: `scripts/verify-package.mjs`
- Modify: `docs/architecture/project-initialization.md`
- Modify: `docs/architecture/agent-output-contract.md`
- Modify: `docs/user/hosts.md`
- Create: `docs/verification/issue-134-phase-agent-prompts-evidence.md`

**Interfaces:**
- Consumes: the built Claude package, initialized Codex project, reason catalog, and prompt catalog.
- Produces: release-blocking conformance checks and acceptance-criterion evidence.

- [ ] **Step 1: Write failing release-boundary assertions**

  Require package verification to find all five Claude agents and all five initialized Codex definitions. In the prompt contract test, compare every body against every published reason-code string and reject unresolved placeholders and host-specific tool names.

- [ ] **Step 2: Run package-focused checks and confirm the new assertions fail**

  Run: `npx vitest run tests/phase-agent-prompts.test.ts tests/runtime-distribution.test.ts && npm run build && npm run package:verify`

  Expected: failure until package verification and staged assets cover both hosts.

- [ ] **Step 3: Implement release checks and documentation**

  Extend clean-room verification to inspect the installed host assets and initialized project. Document the shared catalog, role mapping, uncertainty rule, evaluator thresholds, machine-block ownership, compatibility, state, and security impact. Map each issue acceptance criterion to a named test or installed artifact in the evidence document.

- [ ] **Step 4: Run focused verification**

  Run: `npx vitest run tests/phase-agent-prompts.test.ts tests/init-skeleton.test.ts tests/agent-output-contract.test.ts tests/agent-output-recording.test.ts tests/runtime-distribution.test.ts tests/package-boundaries.test.ts`

  Expected: all focused suites pass.

- [ ] **Step 5: Run complete verification**

  Run: `npm run verify`

  Expected: every quality, contract, differential, build, packaging, and benchmark check exits zero.

- [ ] **Step 6: Audit the final diff and prepare the PR evidence**

  Run: `git diff --check && git status --short && git diff --stat`

  Confirm the diff contains only issue-scoped English source, prompts, fixtures, tests, and documentation. Prepare PR text linking #134 and stating compatibility, state, security, exact verification commands, and evidence for each acceptance criterion.
