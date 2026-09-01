# Deterministic Memory Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate reproducible scored memory-curation proposals, require an explicit decision for each proposal, and commit approved changes as one atomic batch.

**Architecture:** Pure domain scorers consume versioned ledger values and already-observed dependency facts. Composition performs confined reads and digest binding; CLI handlers render plans, validate complete approvals, and hand one final ledger/projection plan to the existing transaction manager. Host packages relay the shared runtime only.

**Tech Stack:** TypeScript 6, Node.js 24, JSON Schema 2020-12, Vitest 4, existing managed transaction ports.

**Spec:** `docs/superpowers/specs/2026-09-01-deterministic-memory-curation-design.md`

## Global Constraints

- Source, tests, fixtures, prompts, errors, documentation, commits, and PR text are English.
- No model, network, project-command, locale-dependent ordering, or host-owned decision.
- Preserve predecessor schema/catalog bytes and require explicit migration for durable state.
- Use integer fixed-point arithmetic and the exact policy constants in the spec.
- Every production behavior starts with a failing test and a verified RED run.
- Run focused tests after every task and `corepack npm run verify` before completion.

---

### Task 1: Publish the additive memory contracts

**Files:**

- Create: `schemas/state/failure-candidate.v1.1.schema.json`
- Create: `schemas/state/curated-memory.v1.1.schema.json`
- Create: `schemas/host/memory-change.v1.4.schema.json`
- Create: `schemas/host/memory-curation.v1.4.schema.json`
- Modify: contract manifest/catalog/type registration and schema fixtures
- Test: schema, registry, type-generation, and compatibility suites

**Interfaces:**

- Produces `FailureCandidateV1_1`, `CuratedMemoryV1_1`, `MemoryChangeV1_4`, and `MemoryCurationV1_4`.
- Keeps every predecessor schema importable and byte-stable.

- [ ] Add failing fixture/registry/type tests for the four new contracts and predecessor stability.
- [ ] Run the focused contract suites and verify failure because registrations/schemas are absent.
- [ ] Add closed schemas, valid fixtures, manifest entries, registry imports, and version constants.
- [ ] Generate TypeScript contracts with the repository generator.
- [ ] Run focused contract suites until green and inspect generated diffs.

### Task 2: Implement pure scoring and proposal generation

**Files:**

- Create: `packages/runtime/src/domain/memory/curation.ts`
- Modify: `packages/runtime/src/domain/memory/index.ts`
- Test: `tests/memory-curation-scoring.test.ts`
- Fixture: `fixtures/memory-curation/v1/*`

**Interfaces:**

- Produces `tokenizeMemoryText`, `jaccardScore`, `scoreLessonSimilarity`, `scoreLessonObsolescence`, and `proposeMemoryCuration`.
- Consumes only ledger values, `asOf`, a versioned policy object, and path observations supplied by composition.

- [ ] Write table tests for tokenization, Jaccard, integer rounding, exact stopwords, threshold neighbors, and date landmarks.
- [ ] Run the scoring test and verify RED because the domain module is absent.
- [ ] Implement the minimal tokenizer and fixed-point component scorers.
- [ ] Run scoring tests green, then add RED tests for deterministic ordering, overlap visibility, golden output, and threshold monotonicity.
- [ ] Implement proposal IDs, merge/archive/delete payloads, evidence reporting, and total ordering; rerun focused tests green.

### Task 3: Track observations and support explicit reinforcement

**Files:**

- Modify: hook candidate reducer and memory domain reducer
- Modify: memory observation/composition and CLI command registration
- Test: workflow-hook domain/runtime and curated-memory domain/runtime suites

**Interfaces:**

- Duplicate capture upgrades or updates `FailureCandidateV1_1` atomically.
- `memory reinforce` consumes a `MemoryChangeV1_4` proposal and preserves lesson identity/content while updating observation facts.

- [ ] Add RED tests for duplicate count/date updates, lazy v1 adoption, invalid clock order, and write preconditions.
- [ ] Implement candidate v1/v1.1 normalization and atomic rewrite; run focused hook tests green.
- [ ] Add RED tests for preview/apply reinforcement, same-provenance enforcement, summed count, extrema dates, stale candidate refusal, and cleanup after commit.
- [ ] Implement the reinforcement reducer, observation, command, digest binding, and cleanup plan.
- [ ] Run focused memory and hook suites green.

### Task 4: Implement curate preview, complete approval, and batch apply

**Files:**

- Modify: memory composition, CLI specs/handlers, command/help registration, fake/node transaction observations
- Test: `tests/memory-curation-runtime.test.ts`, CLI command/composition tests, transaction fault tests

**Interfaces:**

- `memory curate --as-of DATE` produces a deterministic plan.
- `memory curate --as-of DATE APPROVAL` previews the complete reviewed batch.
- Apply requires `--yes`, `--plan-digest`, and `--approval-digest` and writes one final ledger/projection pair.

- [ ] Add RED CLI tests for required date, read-only plan output, complete decisions, unknown/duplicate/missing IDs, and overlapping approvals.
- [ ] Implement date parsing, confined dependency observation, plan rendering, approval validation, and stable reason results.
- [ ] Run CLI tests green, then add RED apply tests for stale ledger/projection/approval/path facts and exact argv replay.
- [ ] Implement aggregate reduction and one transaction plan with dependency read guards.
- [ ] Add fault injection proving pre-commit byte preservation and post-commit full-batch recovery; run focused runtime tests green.
- [ ] Add cross-host and built-plugin parity cases; run them green.

### Task 5: Implement adjacent migration and compatibility behavior

**Files:**

- Modify: memory migration domain/composition/CLI and migration schemas
- Test: memory migration domain/runtime tests and contract compatibility suites

**Interfaces:**

- Extends `migrate memory` with an explicit v1-ledger metadata mapping.
- Produces v1.1 counts/date lower bounds, backups, receipts, verification, and rollback without rewriting unrelated history.

- [ ] Add RED migration tests for required per-lesson metadata, derived lower bounds, tombstone preservation, preview/apply drift, backup, and rollback.
- [ ] Implement adjacent classification and reduction using the existing migration transaction conventions.
- [ ] Run migration tests green and verify ordinary scoring refuses v1 while migration/recovery remain available.
- [ ] Run predecessor-byte and full contract suites green.

### Task 6: Publish policy, evidence, and complete verification

**Files:**

- Modify: memory command/state/migration and contract-versioning documentation
- Modify: schema README and compatibility/security documentation as required
- Create: `docs/verification/issue-149-deterministic-memory-curation-evidence.md`

**Interfaces:**

- Documents every public field, formula, threshold, rationale, command, migration, compatibility impact, and security boundary.
- Maps each #149 criterion to executable evidence and exact commands.

- [ ] Add documentation assertions first where repository suites enforce public command/schema text; verify RED.
- [ ] Update English documentation and golden fixtures with no TODO/TBD placeholders.
- [ ] Run the complete focused contract, memory, migration, CLI, transaction, distribution, and parity command.
- [ ] Run `corepack npm run verify` and preserve complete exit-code evidence.
- [ ] Audit `git diff --check`, `git status --short`, generated artifacts, and acceptance-criterion mapping.
- [ ] Prepare English commits and PR text linking #149 and #140 with compatibility, state, security, and exact verification impacts.
