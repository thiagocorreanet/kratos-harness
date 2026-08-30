# Stack Profile Commands and Conventions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a deterministic stack profile that gives phase agents exact project commands, paths, conventions, implementation languages, and the resolved language policy.

**Architecture:** Versioned initialization answers feed a runtime-owned typed project profile persisted in project configuration. The Markdown profile is a deterministic projection, and doctor evaluates readiness from typed state plus rendered-byte drift rather than parsing prose.

**Tech Stack:** TypeScript, JSON Schema 2020-12, Vitest, embedded ESM runtime.

**Spec:** `docs/superpowers/specs/2026-08-29-stack-profile-commands-conventions-design.md`

## Global Constraints

- Keep detection offline and limited to root entry names.
- Never infer commands, paths, or conventions from a detected stack.
- Keep runtime meaning host-neutral; Claude Code and Codex only collect and relay.
- Keep all repository-authored content in English.
- Write tests first and observe the expected failure before production changes.
- Preserve published schemas and reason catalogs byte for byte.
- Run narrow tests before `npm run verify`.

---

### Task 1: Versioned profile contracts and pure resolution

**Files:**

- Create: `schemas/host/init-answers.v1.3.schema.json`
- Create: `schemas/state/project-config.v1.3.schema.json`
- Create: `packages/runtime/src/domain/init/profile.ts`
- Modify: contract catalogs, generated declarations, schema registry, init exports, and contract tests.
- Test: `tests/contract-schemas.test.ts`, `tests/init-answers.test.ts`, and a focused profile test file.

**Interfaces:**

- Produce `ResolvedProjectProfile`, `unresolvedProjectProfile()`, `resolveProjectProfile(explicit, persisted)`, and `unresolvedProjectProfileKeys(profile)`.
- Update resolved initialization answers to carry a complete `projectProfile`.

- [ ] Add failing schema tests for all three leaf states, closed objects, limits, and unsafe paths.
- [ ] Run the focused tests and confirm failure because v1.3 and profile resolution do not exist.
- [ ] Add immutable v1.3 schemas, manifest registrations, generated types, and the minimal pure resolver.
- [ ] Regenerate declarations with the pinned npm version and run focused contract/profile tests.
- [ ] Commit the approved spec, plan, contracts, resolver, generated declarations, and tests.

### Task 2: Initialization merge, rendering, and migration

**Files:**

- Create: `packages/runtime/src/domain/init/stack-profile.ts`
- Modify: `packages/runtime/src/domain/init/skeleton.ts`, initialization composition/observations, configuration compatibility, migration, fixtures, and init tests.
- Test: `tests/init-skeleton.test.ts`, `tests/init-command.test.ts`, and `tests/config-migration.test.ts`.

**Interfaces:**

- Produce `renderStackProfile(stack, projectProfile, languagePolicy)` and use it from `skeletonEffects`.
- Initialization observes a current persisted profile before resolving answers; v1.2 state requires explicit migration.

- [ ] Add failing literal byte assertions for recognized, unrecognized, and multi-stack roots.
- [ ] Add failing tests for fresh unresolved values, fieldwise preservation, override, explicit clearing, and a byte-identical second initialization.
- [ ] Add failing migration and compatibility tests for 1.2 to 1.3 plus `profile.config_migration_required`.
- [ ] Implement rendering, persisted-profile observation/merge, configuration 1.3 output, migration, and reason-catalog evolution.
- [ ] Run the focused init, migration, reason, and compatibility suites and commit the green slice.

### Task 3: Doctor readiness, host relay parity, documentation, and evidence

**Files:**

- Modify: workflow observation and doctor decision modules, both host skill surfaces, public architecture/user/compatibility docs, and verification evidence.
- Test: `tests/diagnostics.test.ts`, doctor command tests, distribution parity tests, and package verification tests.

**Interfaces:**

- Workflow observation supplies stack-profile existence/readability, expected bytes, actual bytes, and unresolved keys.
- Doctor emits one `stack-profile` check with pass/warn/fail and actionable unresolved-key details.

- [ ] Add failing doctor tests for pass, unresolved, missing, drift, not-applicable, unreadable, and invalid-destination cases.
- [ ] Add failing behavior/parity coverage proving both hosts relay identical profile questions and values.
- [ ] Implement the observation and doctor check without parsing Markdown for answers.
- [ ] Update English public documentation and create `docs/verification/issue-142-stack-profile-evidence.md` mapping every criterion to evidence.
- [ ] Run all narrow suites, `npm run contracts:check`, and package verification; commit the green slice.

### Task 4: Full verification and completion evidence

**Files:**

- Modify only files required by failures attributable to this feature.
- Update: `docs/verification/issue-142-stack-profile-evidence.md` with final command outcomes.

- [ ] Run formatting, spelling, English, lint, typecheck, focused tests, and contract checks.
- [ ] Run `npm run verify` with npm 11.16.0 and record the exit result.
- [ ] Audit the diff for inferred commands, host-specific policy, unsafe path handling, unreviewed generated drift, and unresolved implementation placeholders.
- [ ] Commit any evidence-only finalization after all gates pass.
