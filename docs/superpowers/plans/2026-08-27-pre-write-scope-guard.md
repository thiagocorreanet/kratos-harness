# Pre-Write Feature Scope Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refuse structured file mutations outside declared feature and project policy before either supported host reaches the filesystem.

**Architecture:** Versioned schemas describe feature scope, project write blocks, and normalized pre-tool requests. A pure domain matcher and decision engine consume canonical target observations assembled by composition. Claude Code and Codex hooks normalize and relay only; both invoke the same runtime command and publish the same operation result.

**Tech Stack:** TypeScript ES modules, JSON Schema 2020-12, Ajv, minimatch already present in the dependency graph, Vitest, Node filesystem ports, Markdown feature documents, shell hook launchers.

**Spec:** `docs/specs/2026-08-27-pre-write-scope-guard-spec.md`

## Global Constraints

- Keep source, tests, fixtures, prompts, errors, documentation, commits, and PR text in English.
- Preserve deterministic behavior, stable reason codes, schema immutability, and migration guarantees.
- Put every decision in shared runtime code; host surfaces only normalize, render, and relay.
- Deny precedes allow. An empty allowlist is unrestricted. `.brain/**` bypasses allow membership but not a valid explicit deny.
- Missing feature scope preserves current feature behavior; immutable and project write blocks still apply.
- Refuse before mutation and return `host.operation-result@1.0.0` with no claimed state change.
- Follow RED -> GREEN -> REFACTOR for every implementation task and commit each reviewed slice with `git commit -s`.

---

### Task 1: Publish scope, guardrails, and pre-tool contracts

**Files:**

- Create: `schemas/state/feature-scope.v1.schema.json`
- Create: `schemas/host/pre-tool-use.v1.schema.json`
- Create or modify: the schema for `.brain/guardrails.json`
- Modify: `packages/contracts/catalogs/contract-families.v1.json`
- Modify: `packages/runtime/src/domain/schema/contracts.ts`
- Modify: `packages/runtime/src/infra/schema/catalog.ts`
- Modify: `packages/runtime/src/domain/init/skeleton.ts`
- Modify: reason catalog source, schema, and generated declarations
- Test: contract, schema-registry, reason-catalog, and initialization suites

**Interfaces:** Publish `state.feature-scope@1.0.0`, `host.pre-tool-use@1.0.0`, a backwards-compatible versioned guardrails payload, and stable `guard.path_escape` / `guard.target_uninspectable` refusal policies.

- [ ] Write failing tests for valid/invalid scope globs, normalized mutation requests, old/new guardrails files, immutable reason prefix, and generated type registration.
- [ ] Run the focused tests and capture expected RED output.
- [ ] Add schemas, registry entries, types, optional project write-block configuration, and reason policies without changing old schema bytes.
- [ ] Regenerate contracts and make focused tests plus `npm run contracts:check` pass.
- [ ] Commit with sign-off.

### Task 2: Implement reviewer translation and pure glob policy

**Files:**

- Create: `packages/runtime/src/domain/write-guard/scope-document.ts`
- Create: `packages/runtime/src/domain/write-guard/glob-policy.ts`
- Create: `packages/runtime/src/domain/write-guard/decision.ts`
- Create: `packages/runtime/src/domain/write-guard/index.ts`
- Modify: reviewer prompt/feature-document model and completed fixtures
- Test: matcher and reviewer-scope agreement suites

**Interfaces:** Parse and render code-formatted allow/deny bullets in `03-summa.md`; construct `FeatureScopeV1`; evaluate ordered gitignore-style lists; return a pure allow/refuse decision with the stable rule code and target.

- [ ] Write table-driven failing tests for `*`, `?`, `**`, character classes, nested paths, ordered `!` negation, empty allow, deny-over-allow, global defaults, `.brain/**`, and reviewer drift.
- [ ] Run focused RED tests.
- [ ] Implement the single prose parser/renderer, normalized glob matcher, immutable defaults, and precedence decision.
- [ ] Make focused suites pass and refactor without widening behavior.
- [ ] Commit with sign-off.

### Task 3: Add canonical target inspection and runtime guard operations

**Files:**

- Create: `packages/runtime/src/application/write-guard/`
- Modify: `packages/runtime/src/ports/filesystem.ts`
- Modify: `packages/runtime/src/infra/node/index.ts`
- Modify: CLI command specification, parser, composition, and public entrypoint
- Test: path-safety, scope-record, and guard-write integration suites

**Interfaces:** `kratos scope record` translates the active feature's reviewer document into `scope.json`; `kratos guard write` validates `host.pre-tool-use@1.0.0`, extracts every target, canonicalizes existing and nearest-existing ancestors, evaluates policy, and emits `host.operation-result@1.0.0` without mutating tool targets.

- [ ] Write failing tests for outside-root paths, existing and dangling symlinks, missing ancestors, create/update/delete/move targets, deterministic multi-target refusal, corrupt policy repair, and zero filesystem mutation.
- [ ] Run focused RED tests.
- [ ] Extend the filesystem port with read-only canonical inspection and implement application/composition operations atomically.
- [ ] Make focused integration tests pass, including scope record/agreement failures.
- [ ] Commit with sign-off.

### Task 4: Install identical Claude Code and Codex pre-tool relays

**Files:**

- Modify: `packages/adapters/src/claude-code/`
- Modify: `packages/adapters/src/codex/`
- Modify: `distribution/claude-code/`
- Modify: `distribution/codex/`
- Modify: plugin manifests/settings and distribution checksums as required
- Test: both adapter conformance suites, plugin smoke tests, and distribution parity

**Interfaces:** Each host synchronously maps its native structured mutation payload to the shared request, invokes `kratos guard write`, allows on success, and renders the host-native deny response from the same blocked result. Unsupported/uninspectable mutation shapes fail closed; unrelated tools pass through unchanged.

- [ ] Write the same failing conformance cases against both adapters: denied path, outside allow, allow, deny-over-allow, state/spec allow bypass, move targets, and malformed target.
- [ ] Run both suites to prove RED.
- [ ] Add thin host relays and install them in both distributions without embedding policy in prompts or scripts.
- [ ] Make conformance, plugin smoke, checksum, and parity tests pass.
- [ ] Commit with sign-off.

### Task 5: Document behavior and assemble acceptance evidence

**Files:**

- Modify: public contracts/architecture/configuration documentation
- Modify: reviewer contract documentation where translation is described
- Create: `docs/evidence/sdd-14-pre-write-scope-guard.md`
- Create: a PR body/evidence artifact in the repository's established location if one exists

**Interfaces:** Document glob dialect, precedence, defaults, opt-out behavior, repair behavior, host-neutral boundary, compatibility/state/security impacts, and exact verification commands.

- [ ] Write documentation assertions or fixture tests first where repository conventions support them.
- [ ] Update public documentation and ensure no prompt claims decision authority.
- [ ] Map every issue acceptance criterion to a concrete test/file and exact command; include `Closes #133`, compatibility, state, and security impact in prepared PR text.
- [ ] Run focused documentation/fixture tests and commit with sign-off.

### Task 6: Whole-branch verification and independent review

- [ ] Run all focused suites from Tasks 1-5 from a clean working tree.
- [ ] Run `npm run verify` and retain untruncated exit/result evidence.
- [ ] Run an independent whole-branch spec and code-quality review; fix every blocking finding with focused tests.
- [ ] Re-run affected focused suites and `npm run verify` after the final fix.
- [ ] Confirm no unfinished placeholder, uncommitted file, schema drift, checksum drift, or host parity difference remains.
