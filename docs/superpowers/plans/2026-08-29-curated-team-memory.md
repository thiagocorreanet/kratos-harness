# Curated Team Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn automatic and manual failures into explicitly promoted, bounded, committed team lessons consumed by code and review phases.

**Architecture:** Candidate JSON stays in a local ignored inbox. A versioned committed ledger is the runtime authority and deterministically renders `gotchas.md`; digest-bound runtime commands own promotion and curation. Current code/review handoff and output variants bind the exact projection digest.

**Tech Stack:** TypeScript 6, Node.js 24, JSON Schema 2020-12, Vitest, managed filesystem transactions, generated plugin distributions.

**Spec:** `docs/specs/2026-08-29-curated-team-memory-spec.md`

## Global Constraints

- Runtime policy and reason codes are host-neutral; Claude Code and Codex only render and relay.
- Capture performs no model call, network access, socket operation, or project command.
- Candidate diagnostics remain sanitized and bounded to 2 KiB.
- Confirmed memory is limited to 24 active lessons, 48 archive tombstones, and 48 KiB rendered UTF-8.
- Manual capture always enters the candidate inbox; no path promotes automatically.
- Merge preserves every source `why`, `apply`, and candidate provenance item by exact set union.
- Every production behavior is implemented test-first; focused tests precede `npm run verify`.
- Preserve predecessor schemas and reason catalogues byte-for-byte.

---

### Task 1: Publish memory contracts and initialization state

**Files:**
- Create: `schemas/state/curated-memory.v1.schema.json`
- Create: `schemas/host/memory-capture.v1.2.schema.json`
- Create: `schemas/host/memory-change.v1.2.schema.json`
- Create: `schemas/host/memory-migration.v1.2.schema.json`
- Modify: contract catalogue, generated declarations, reason catalogue, schema registry, initialization skeleton
- Test: contract, schema fixture, initialization, and state-ignore suites

**Interfaces:**
- Produces `state.curated-memory@1.0.0` with `revision`, `projectionDigest`, `updatedAt`, `confirmed`, and `archive`.
- Produces proposal unions whose operations are `promote`, `merge`, and `archive`.
- Produces stable reason codes named in the objective spec and design.

- [ ] Write failing contract tests and literal fixtures for all three proposal shapes and the empty curated ledger.
- [ ] Run the focused contract tests and confirm they fail because the contract identifiers are absent.
- [ ] Add the closed schemas, catalogue registrations, generated declarations, and additive reason catalogue entries.
- [ ] Write failing initialization tests expecting the empty ledger, deterministic two-section `gotchas.md`, and `03-memory/candidates/` ignore rule.
- [ ] Run the initialization tests and confirm the old skeleton fails the new expectations.
- [ ] Implement the initialization effects and update every generated-path classification.
- [ ] Run contract and initialization suites, then commit with `feat(memory): publish curated memory contracts`.

### Task 2: Unify automatic and manual candidate capture

**Files:**
- Modify: `packages/runtime/src/domain/hooks/index.ts`
- Create: focused memory-capture domain module if separation keeps each file single-purpose
- Modify: hook observation/composition and CLI command registry
- Test: hook domain/runtime plus new manual-capture tests

**Interfaces:**
- Produces `candidateNormalizationKey(observation, digest): string`.
- Produces a pure capture decision shared by `tool.failed` and `memory capture <proposal.json>`.
- Existing candidate records remain readable and participate in in-memory matching.

- [ ] Write failing table tests proving ANSI, whitespace, ISO timestamp, UUID, temporary nonce, and line/column variants deduplicate while case, substantive numbers, relative paths, commands, and test names remain distinct.
- [ ] Run the domain tests and confirm near-identical cases currently create different IDs.
- [ ] Implement conservative normalization and normalized candidate identity without weakening existing sanitization.
- [ ] Write failing runtime tests proving repeated hook delivery and manual capture produce one file and no promotion.
- [ ] Run those tests and confirm the manual command is absent and near matches create extra files.
- [ ] Implement `memory list` and `memory capture`, scanning v1 candidates for normalized matches before planning a write.
- [ ] Add executable distribution checks showing both capture paths import no model/network client and execute no project command.
- [ ] Run focused capture, hook, CLI, and distribution tests, then commit with `feat(memory): unify candidate capture`.

### Task 3: Implement curated ledger, rendering, promotion, merge, and archive

**Files:**
- Create: focused modules under `packages/runtime/src/domain/memory/`
- Modify: CLI command definitions and observation types
- Test: new memory domain and command suites

**Interfaces:**
- Produces pure `renderCuratedMemory(ledger): string` and `projectionDigest` validation.
- Produces pure preview reducers for promote, merge, and archive.
- Promotion consumes one or more candidate IDs; merge consumes two or more confirmed lesson IDs.

- [ ] Write failing golden tests for empty, confirmed, and archived Markdown ordering and exact bytes.
- [ ] Run them and confirm the renderer is absent.
- [ ] Implement ledger validation, stable lesson IDs, rendering, and drift classification.
- [ ] Write failing promotion tests covering read-only preview, required title/reviewer/`why`/`apply`, stale authorization, size limits, atomic publication, and post-commit candidate deletion.
- [ ] Run them and confirm the command surface or reducers are absent.
- [ ] Implement digest-bound preview/apply using plan digest, plan time, proposal digest, candidate fingerprints, and ledger/projection preconditions.
- [ ] Write failing merge/archive tests proving exact union preservation, replacement tombstones, obsolescence reason, 48-entry rolling archive, and 24/48-KiB limits.
- [ ] Implement merge and archive minimally, preserving all source arrays and deterministic ordering.
- [ ] Add transaction fault cases proving no partial pair and no candidate deletion before commit.
- [ ] Run focused domain, command, and transaction suites, then commit with `feat(memory): curate confirmed lessons`.

### Task 4: Add lossless legacy memory migration

**Files:**
- Modify: migration domain/composition and CLI registry
- Add: memory migration fixtures and focused tests
- Modify: migration and recovery documentation

**Interfaces:**
- `migrate memory <mapping.json>` accepts `sourceDigest`, `reviewer`, and lessons with exact one-based source-line ranges.
- Every non-template, non-blank legacy line must be covered exactly once.
- Existing migration receipt and rollback surfaces preserve original bytes.

- [ ] Write failing tests for fresh structured state, missing ledger with stock template, custom legacy content, overlapping ranges, uncovered lines, changed source digest, preview no-write, apply, and rollback.
- [ ] Run them and confirm no memory migration operation exists.
- [ ] Implement classification without heuristic Markdown entry parsing.
- [ ] Implement digest-bound preview/apply, exact coverage validation, original-byte backup, receipt, and rollback.
- [ ] Add tests proving ordinary memory commands and code/review handoffs return `memory.migration_required` until adoption.
- [ ] Run migration, initialization, recovery, and compatibility suites, then commit with `feat(memory): migrate legacy gotchas losslessly`.

### Task 5: Bind curated memory into code and review phases

**Files:**
- Create: `schemas/host/phase-handoff.v1.2.schema.json`
- Create: `schemas/host/agent-output.v1.2.schema.json`
- Modify: workflow observation/handoff, agent recording, phase prompts, relay/distribution fixtures
- Test: model-role workflow, agent output, prompt, and host parity suites

**Interfaces:**
- Handoff and output v1.2 add `memory: null | { ref, sha256, lessonIds }`.
- Code and review require the object; PRD, spec, plan, and acceptance require null.
- `agent record` compares the acknowledgement with the current validated projection and the assignment handoff.

- [ ] Write failing schema and workflow tests for memory-null phase rules and code/review memory observations.
- [ ] Run them and confirm current v1.1/v1.0 contracts lack the field.
- [ ] Add explicit v1.2 variants while preserving predecessor files and version selection.
- [ ] Write failing handoff tests for empty and populated memory, migration-required state, projection drift, and stale projection after handoff.
- [ ] Implement runtime observation and digest binding before handoff publication.
- [ ] Write failing agent-record tests for missing, mismatched, matching, and stale acknowledgement.
- [ ] Implement fail-closed acknowledgement checks and stable phase-context result.
- [ ] Update canonical implementer/evaluator instructions and executable relay fixtures so both hosts deliver equivalent values.
- [ ] Run phase, agent, prompt, build, package, and parity suites, then commit with `feat(memory): bind lessons to implementation phases`.

### Task 6: Complete public documentation and acceptance evidence

**Files:**
- Modify: user command/state/host documentation and architecture compatibility notes
- Create: `docs/verification/issue-140-curated-team-memory-evidence.md`
- Test: documentation, contract immutability, parity inventory, and full verification suites

**Interfaces:**
- Documents exact commands, limits, Git classification, migration, compatibility, security, recovery, and host parity.
- Evidence maps every issue #140 criterion to an exact test or artifact.

- [x] Update public documentation with the final implemented grammar and recovery commands.
- [x] Write the acceptance evidence matrix, including exact focused verification commands and the baseline shared-temp race observation.
- [x] Run formatting, spelling, English, lint, typecheck, focused memory tests, and contract checks; repair only failures caused by this branch.
- [x] Run `npm run verify` with npm 11.16.0 and capture exit status and test counts.
- [x] Audit `git diff --check`, `git diff --stat`, reason/schema predecessor bytes, issue checkboxes, and placeholder absence.
- [x] Commit with `docs(memory): publish curated memory evidence`.
