# Repair Loop Stop-Loss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop repeated acceptance repair loops per AC identifier, classify the fault, and preserve deterministic recovery and replay.

**Architecture:** Add versioned configuration, host-output, event, and stop-artifact contracts. A `workflow-v2` reducer owns attempt counts and repair stops; CLI composition atomically records verdicts and explicit resolution while both host adapters relay the same contracts.

**Tech Stack:** TypeScript 6, Node.js 24, npm 11.16.0, JSON Schema 2020-12, Ajv, Vitest, existing event-store and managed-transaction services.

**Spec:** `docs/specs/2026-08-30-repair-loop-stop-loss-spec.md`

## Global Constraints

- Keep source, tests, fixtures, prompts, errors, documentation, commits, and pull request text in English.
- Runtime, schemas, reason codes, and reducers own shared meaning; hosts only relay and render.
- Runtime decisions may not be replaced by prompt instructions.
- Preserve deterministic replay, predecessor bytes, stable reasons, and explicit migration.
- Apply TDD for every behavior change and run focused tests before the full verification gate.
- Use npm 11.16.0 for every npm command.

---

### Task 1: Configuration and token-ceiling contracts

**Files:** project/host schemas and manifest, configuration/objective domain, migration and their focused tests.

**Interfaces:** Produces `acceptanceAttemptCeiling?: number`, default 3, init set/clear/preserve semantics, `objective --token-ceiling`, and a run-frozen token ceiling consumed by later tasks.

- [ ] Write failing schema, configuration, objective, and migration tests for the new setting, default, CLI behavior, and predecessor preservation.
- [ ] Run the focused tests and record the expected RED failures.
- [ ] Add the minimal schema/catalog/type/configuration/objective/migration behavior.
- [ ] Generate checked contract declarations and run the focused tests plus `contracts:check` GREEN.
- [ ] Commit the task with its tests.

### Task 2: Event-sourced attempt reducer

**Files:** event schemas/semantics, workflow model/decision/reducer, repair-loop domain module, and focused reducer/replay tests.

**Interfaces:** Produces `workflow-v2`, ordered per-criterion attempts, active repair stops, acceptance decision metadata, and immutable repair-stop records.

- [ ] Write failing reducer and replay tests for attempts below/on ceiling, simultaneous trips, missing faults, pass/resume invariants, and mixed v1/v2 history.
- [ ] Run the focused tests and record the expected RED failures.
- [ ] Implement minimal closed event metadata, pure repair-loop decisions, reducer transitions, and artifact builders.
- [ ] Run reducer, event, replay, and contract checks GREEN.
- [ ] Commit the task with its tests.

### Task 3: Acceptance recording, gates, and handoff

**Files:** agent-output/handoff contracts, acceptance recording composition, gate context/evaluator, shared phase prompts, adapters, and integration/parity tests.

**Interfaces:** Consumes Task 2 decisions; produces atomic accepted/repair/stop recording, `faults[]`, handoff attempt context, and distinct stop-loss reasons for both hosts.

- [ ] Write failing integration and parity tests for verdict recording, diagnostic refusal, repair routing, simultaneous stops, and token/rejection reason distinction.
- [ ] Run the focused tests and record the expected RED failures.
- [ ] Implement minimal atomic effects, semantic fault validation, gate aggregation, handoff data, prompt relay, and adapter parity.
- [ ] Run acceptance, gate, host, result, and contract checks GREEN.
- [ ] Commit the task with its tests.

### Task 4: Explicit repair resolution and specification restart

**Files:** repair CLI/domain/composition, workflow start semantics, command registry/help, restart/resolution schemas, and end-to-end tests.

**Interfaces:** Produces `repair resolve`, selective code reset, idempotent spec restart tickets, and `run.started_from_spec`.

- [ ] Write failing command tests for identity/note validation, code reset, multiple active stops, plain-resume refusal, specification restart, idempotency, and AC-ID non-reuse.
- [ ] Run the focused tests and record the expected RED failures.
- [ ] Implement the minimal command, events, ticket, active-run handoff, and start-at-spec policy.
- [ ] Run command, workflow, transaction, and replay tests GREEN.
- [ ] Commit the task with its tests.

### Task 5: Documentation, evidence, and repository verification

**Files:** architecture/user/compatibility documentation, issue evidence, fixtures, and any contract inventories required by checks.

**Interfaces:** Produces public configuration/recovery guidance, acceptance-criterion evidence mapping, and PR-ready compatibility/state/security notes.

- [ ] Update executable fixtures and English documentation for every public interface and recovery path.
- [ ] Add `docs/verification/issue-141-repair-loop-stop-loss-evidence.md` mapping each acceptance criterion to tests and commands.
- [ ] Run focused tests, `contracts:check`, `result:check`, and documentation checks.
- [ ] Run `npm run verify` and record its complete result in the evidence file.
- [ ] Audit the diff for placeholders, unrelated changes, generated drift, and acceptance-criterion coverage; commit the task.
