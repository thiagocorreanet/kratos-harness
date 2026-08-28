# Model Role per Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Kratos resolve a host-specific planner, implementer, or judge model for every workflow phase, enforce canonical implementer/judge independence, and persist runtime-selected and host-observed execution metadata without rewriting historical state.

**Architecture:** Add multi-version state and host contracts, then put the fixed phase map and all role policy in a pure `domain/model-roles` module. Host adapters provide versioned model catalogs and observations as data; workflow composition resolves and digest-binds an assignment before handoff and revalidates it before phase events. Configuration migration updates only `.brain/config.json`, while the event store verifies mixed `1.0.0`/`1.1.0` chains record by record.

**Tech Stack:** TypeScript 6, Node.js 24, JSON Schema 2020-12, Ajv 8, Vitest 4, npm workspaces, append-only canonical JSONL events, SHA-256 digests.

**Spec:** `docs/superpowers/specs/2026-08-28-model-role-per-phase-design.md`

## Global Constraints

- Keep source, tests, fixtures, prompts, errors, documentation, commit messages, and pull-request text in English.
- Preserve every published `1.0.0` schema byte-for-byte; add new schema files instead of editing old ones.
- State `1.1.0` and host `1.1.0` are current; readable historical `1.0.0` payloads remain valid.
- The runtime owns the phase map, independence decision, reason codes, assignment digest, and persisted execution metadata.
- Host surfaces provide only defaults, canonical model resolution, supported effort data, observation, rendering, and relay.
- A bare model assignment resolves exactly like `{ "model": NAME, "effort": "medium" }`.
- Never infer model or effort from conversation text, prompts, agent output, or configured values when host observation is absent.
- Never fall back across roles, aliases, models, or effort levels.
- Do not add model-policy prose to phase prompts.
- Work test-first: observe RED, implement the smallest contract-preserving change, then run the focused suite.
- After focused suites pass, run `npm run verify` and record exact evidence for issue #136.

---

## File structure and responsibilities

### New files

- `schemas/state/project-config.v1.1.schema.json` — current project configuration with host-keyed model roles.
- `schemas/state/event.v1.1.schema.json` — current event with nullable host effort and optional runtime-resolved assignment.
- `schemas/state/migration.v1.1.schema.json` — replacement-aware configuration migration receipt.
- `schemas/host/init-answers.v1.1.schema.json` — initialization answers with optional explicit role assignments.
- `schemas/host/adapter-message.v1.1.schema.json` — adapter envelope carrying the model catalog or phase execution observation.
- `schemas/host/phase-handoff.v1.1.schema.json` — read-only runtime handoff payload containing the resolved assignment and digest.
- `fixtures/contracts/v1.1/{project-config,event,migration,init-answers,adapter-message,phase-handoff}.json` — canonical valid current fixtures.
- `packages/contracts/catalogs/reason-codes.v1.7.json` — additive model-role refusal policy.
- `packages/runtime/src/domain/model-roles/model.ts` — closed role, assignment, catalog, observation, and outcome types.
- `packages/runtime/src/domain/model-roles/resolve.ts` — normalization, fixed phase mapping, canonical resolution, and independence checks.
- `packages/runtime/src/domain/model-roles/digest.ts` — canonical assignment binding.
- `packages/runtime/src/domain/model-roles/index.ts` — public domain exports.
- `packages/runtime/src/ports/model-routing.ts` — read-only adapter catalog port.
- `packages/runtime/src/infra/fake/model-routing.ts` — deterministic test catalog port.
- `tests/model-role-resolution.test.ts` — pure role-resolution and digest tests.
- `tests/model-role-workflow.test.ts` — handoff, event provenance, stale assignment, and mismatch integration tests.
- `tests/config-migration.test.ts` — current-configuration migration and rollback tests.
- `tests/support/model-routing.ts` — canonical Claude/Codex catalog fixtures and role-config builders shared by focused tests.
- `docs/verification/issue-136-model-role-evidence.md` — acceptance evidence and exact commands.

### Existing files changed by responsibility

- Contract registration and generation: `packages/contracts/catalogs/contract-families.v1.json`, `schemas/contracts/contract-manifest.v1.2.schema.json`, `scripts/check-contracts.mjs`, `packages/contracts/src/{compatibility,index}.ts`, `packages/contracts/src/generated/contracts.ts`, `packages/runtime/src/domain/schema/contracts.ts`, `packages/runtime/src/infra/schema/{catalog,registry}.ts`.
- Adapter capability and transport: `packages/adapters/src/index.ts`, `tests/support/{fake-host-adapter,host-adapter-contract}.ts`, `tests/host-adapter-contract.test.ts`.
- Initialization: `packages/runtime/src/domain/init/{answers,skeleton}.ts`, `packages/runtime/src/composition/init.ts`, `tests/{init-answers,init-skeleton,init-command}.test.ts`.
- Handoff and workflow observation: `packages/runtime/src/domain/cli/{diagnostics,spec}.ts`, `packages/runtime/src/composition/workflow.ts`, `packages/runtime/src/ports/index.ts`, `packages/runtime/src/infra/{fake,node}/index.ts`.
- Events and workflow decisions: `packages/runtime/src/domain/events/{model,parse,redaction,seal,verify}.ts`, `packages/runtime/src/domain/workflow/{model,decision}.ts`, `packages/runtime/src/domain/cli/agent.ts`, `packages/runtime/src/composition/events.ts`.
- Configuration migration: `packages/runtime/src/domain/migration/{index,upgrade}.ts`, `packages/runtime/src/domain/cli/{commands,migration,spec}.ts`, `packages/runtime/src/composition/migration.ts`.
- Public documentation: `README.md`, `schemas/README.md`, `docs/architecture/{system-architecture,host-adapter-protocol,event-store,project-initialization,migration-observability}.md`, `docs/compatibility/contract-versioning.md`, `docs/user/{commands,configuration-and-state,migration-and-recovery,security-and-troubleshooting}.md`.

---

### Task 1: Publish multi-version contracts and model-role refusal policy

**Files:**
- Create: `schemas/state/project-config.v1.1.schema.json`
- Create: `schemas/state/event.v1.1.schema.json`
- Create: `schemas/state/migration.v1.1.schema.json`
- Create: `schemas/host/init-answers.v1.1.schema.json`
- Create: `schemas/host/adapter-message.v1.1.schema.json`
- Create: `schemas/host/phase-handoff.v1.1.schema.json`
- Create: `fixtures/contracts/v1.1/project-config.json`
- Create: `fixtures/contracts/v1.1/event.json`
- Create: `fixtures/contracts/v1.1/migration.json`
- Create: `fixtures/contracts/v1.1/init-answers.json`
- Create: `fixtures/contracts/v1.1/adapter-message.json`
- Create: `fixtures/contracts/v1.1/phase-handoff.json`
- Create: `packages/contracts/catalogs/reason-codes.v1.7.json`
- Modify: `packages/contracts/catalogs/contract-families.v1.json`
- Modify: `schemas/contracts/contract-manifest.v1.2.schema.json`
- Modify: `scripts/check-contracts.mjs:77-103`
- Modify: `scripts/generate-contract-types.mjs:199-237`
- Modify: `packages/contracts/src/compatibility.ts:12-105`
- Modify: `packages/contracts/src/index.ts:1-57`
- Modify: `packages/contracts/src/generated/contracts.ts`
- Modify: `packages/runtime/src/domain/schema/contracts.ts:1-71`
- Modify: `packages/runtime/src/infra/schema/catalog.ts:1-330`
- Modify: `packages/runtime/src/infra/schema/registry.ts:45-195`
- Test: `tests/contract-manifest.test.ts`
- Test: `tests/contract-schemas.test.ts`
- Test: `tests/schema-catalog.test.ts`
- Test: `tests/schema-registry-fixtures.test.ts`
- Test: `tests/contract-type-generation.test.ts`
- Test: `tests/contract-reason-catalog.test.ts`
- Test: `tests/contract-compatibility.test.ts`

**Interfaces:**
- Consumes: existing `classifyContractVersion(family, value)` and registry key `${id}\0${version}`.
- Produces: `ProjectConfigV1_1`, `EventV1_1`, `MigrationV1_1`, `InitAnswersV1_1`, `AdapterMessageV1_1`, `PhaseHandoffV1_1`, per-contract current-version constants, and a registry that accepts more than one version for one contract ID.

- [ ] **Step 1: Write failing contract tests for duplicate IDs with distinct versions and the new closed shapes**

```ts
it("registers readable 1.0.0 and current 1.1.0 schemas by id and version", () => {
  expect(
    EMBEDDED_SCHEMA_CATALOG.filter(({ id }) => id === "state.event").map(
      ({ version }) => version,
    ),
  ).toEqual(["1.0.0", "1.1.0"]);
});

it.each([
  ["model-x", { model: "model-x", effort: "medium" }],
])("accepts equivalent model assignment forms", (simple, object) => {
  const validate = (planner: unknown) => registry.validate({
    id: "state.project-config",
    version: "1.1.0",
    structuralReasonCode: "guard.config_corrupt",
    value: {
      ...projectConfigV1_1,
      modelRoles: {
        codex: {
          ...projectConfigV1_1.modelRoles.codex,
          planner,
        },
      },
    },
  });
  expect(validate(simple).kind).toBe("valid");
  expect(validate(object).kind).toBe("valid");
});

it("keeps the published event 1.0.0 schema byte-identical", async () => {
  const bytes = await readFile("schemas/state/event.v1.schema.json");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "83431b3a9c1615460eb6faef640671e8ae300a1c347b929c009570a177e6c80d",
  );
});
```

Add schema-fixture cases proving:

- `modelRoles` is non-empty and admits only `claude` and `codex` keys;
- each host map admits only `planner`, `implementer`, and `judge`;
- assignment objects require exactly `model` and `effort`;
- effort and model use the bounded identifier grammar;
- `EventV1_1.observedIdentity` requires nullable `model` and `effort`;
- `resolvedAssignment` contains exactly `phase`, `role`, `model`, and `effort`;
- `MigrationV1_1` distinguishes `copy` rollback from a digest-bound `replace` rollback with exact backup and destination references;
- `PhaseHandoffV1_1` requires `runId`, `revision`, `assignment`, and a SHA-256 `assignmentDigest`;
- adapter messages close the model catalog and phase observation variants.

Pin the other published schema digests alongside the event assertion:

```text
project-config.v1: 0471230187a6ee726fdd26c68f524c9649730765b9962b3668c0eeccd3580fbf
init-answers.v1: c816614cac9e6c5dd43f4f6f5bbab01dbcfb6e7bf58af4e30c6c311d57411806
adapter-message.v1: 40e9d8e3bc053fe706ff7b92743370bf892522d267eca1f2cbc12e4c808bfecd
```

- [ ] **Step 2: Run the focused contract suite and observe RED**

Run:

```bash
npm test -- tests/contract-manifest.test.ts tests/contract-schemas.test.ts tests/schema-catalog.test.ts tests/schema-registry-fixtures.test.ts tests/contract-type-generation.test.ts tests/contract-reason-catalog.test.ts tests/contract-compatibility.test.ts
```

Expected: FAIL because the `1.1.0` schemas/types and reason catalog do not exist and the manifest/checker currently require schema IDs to be globally unique.

- [ ] **Step 3: Add the versioned schemas, manifest entries, registry support, and reasons**

Use these contract definitions:

```ts
export type ModelRole = "planner" | "implementer" | "judge";
export type ModelAssignmentV1_1 =
  | string
  | { readonly model: string; readonly effort: string };

export type CurrentEvent = EventV1_1;
export type ReadableEvent = EventV1 | EventV1_1;
export type CurrentProjectConfig = ProjectConfigV1_1;
export type ReadableProjectConfig = ProjectConfigV1 | ProjectConfigV1_1;

export const CONTRACT_VERSIONS = {
  "state.project-config": "1.1.0",
  "state.event": "1.1.0",
  "state.migration": "1.1.0",
  "host.init-answers": "1.1.0",
  "host.adapter-message": "1.1.0",
  "host.phase-handoff": "1.1.0",
  "host.agent-output": "1.0.0",
} as const;
```

Change manifest/checker uniqueness from `entry.id` to
`${entry.id}@${entry.version}`. Register both versions under the same domain
contract ID and unique schema `$id` values ending in `/v1` and `/v1.1`.
Use `CONTRACT_VERSIONS[id]`, not the family-highest revision, whenever code
creates or validates one payload. Unchanged payload schemas remain current at
their registered `1.0.0` revision; do not clone them merely because the family
window now also reads `1.1.0`.
Update family policy to:

```json
{
  "reasonCatalog": "1.7.0",
  "stateContract": {
    "current": "1.1.0",
    "readable": ["1.0.0", "1.1.0"],
    "migrationOnly": ["0.9.0", "go-v3@0.6.5"]
  },
  "hostContract": {
    "current": "1.1.0",
    "accepted": ["1.0.0", "1.1.0"]
  }
}
```

Append the eight exact reason codes from the spec to `reason-codes.v1.7.json`.
Use `status: "blocked"`, `exitCode: 3`, `stateChanged: false`, and a non-null
recovery for each. `model.config_migration_required` uses exit code 4 because
it is persisted-state migration, matching the established state compatibility
policy.

Run `npm run contracts:generate` only after every schema is registered so the
generated declarations reflect the canonical schema sources.

- [ ] **Step 4: Run contract generation checks and focused tests**

Run:

```bash
npm run contracts:generate
npm run contracts:check
npm test -- tests/contract-manifest.test.ts tests/contract-schemas.test.ts tests/schema-catalog.test.ts tests/schema-registry-fixtures.test.ts tests/contract-type-generation.test.ts tests/contract-reason-catalog.test.ts tests/contract-compatibility.test.ts
```

Expected: PASS; the output reports both schema versions without duplicate-key failure, and generated declarations are current.

- [ ] **Step 5: Commit the contract foundation**

```bash
git add schemas fixtures/contracts/v1.1 packages/contracts packages/runtime/src/domain/schema packages/runtime/src/infra/schema scripts tests/contract-manifest.test.ts tests/contract-schemas.test.ts tests/schema-catalog.test.ts tests/schema-registry-fixtures.test.ts tests/contract-type-generation.test.ts tests/contract-reason-catalog.test.ts tests/contract-compatibility.test.ts
git commit -m "feat: publish model role contracts"
```

---

### Task 2: Implement pure phase-role resolution and assignment binding

**Files:**
- Create: `packages/runtime/src/domain/model-roles/model.ts`
- Create: `packages/runtime/src/domain/model-roles/resolve.ts`
- Create: `packages/runtime/src/domain/model-roles/digest.ts`
- Create: `packages/runtime/src/domain/model-roles/index.ts`
- Create: `tests/support/model-routing.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/model-role-resolution.test.ts`

**Interfaces:**
- Consumes: `RunPhase`, `ProjectConfigV1_1`, canonical JSON, and a SHA-256 function.
- Produces: `roleForPhase`, `normalizeModelAssignment`, `resolvePhaseAssignment`, `validateHostIndependence`, and `digestPhaseAssignment`.

The shared test support exports these exact builders:

```ts
export function codexCatalog(): HostModelCatalog;
export function claudeCatalog(): HostModelCatalog;
export function roleConfig(
  host: "claude" | "codex",
  roles: Partial<Record<ModelRole, ModelAssignmentV1_1>>,
): ProjectConfigV1_1;
export function equalAliasInput(phase: RunPhase): Parameters<
  typeof resolvePhaseAssignment
>[0];
```

- [ ] **Step 1: Write failing resolution tests**

```ts
it.each([
  ["prd", "planner"],
  ["spec", "planner"],
  ["plan", "planner"],
  ["code", "implementer"],
  ["review", "judge"],
  ["acceptance", "judge"],
] as const)("binds %s to %s", (phase, role) => {
  expect(roleForPhase(phase)).toBe(role);
});

it("normalizes the bare and object forms identically", () => {
  expect(normalizeModelAssignment("model-a")).toEqual(
    normalizeModelAssignment({ model: "model-a", effort: "medium" }),
  );
});

it("rejects aliases whose canonical implementer and judge are equal", () => {
  expect(resolvePhaseAssignment(equalAliasInput("review"))).toMatchObject({
    kind: "refused",
    reasonCode: "model.independence_violation",
  });
});
```

Cover missing host, missing mapped role, unknown alias, ambiguous alias,
unsupported effort, digest determinism, and one-field-at-a-time digest changes.

- [ ] **Step 2: Run the domain test and observe RED**

Run:

```bash
npm test -- tests/model-role-resolution.test.ts
```

Expected: FAIL because `@kratos/runtime/domain/model-roles` is not exported.

- [ ] **Step 3: Implement the closed domain model and pure resolver**

Use these exact public shapes:

```ts
export const MODEL_ROLES = ["planner", "implementer", "judge"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export const PHASE_MODEL_ROLE: Readonly<Record<RunPhase, ModelRole>> = {
  prd: "planner",
  spec: "planner",
  plan: "planner",
  code: "implementer",
  review: "judge",
  acceptance: "judge",
};

export interface HostModelCatalog {
  readonly host: "claude" | "codex";
  readonly defaults: Readonly<Record<ModelRole, NormalizedModelAssignment>>;
  readonly models: readonly {
    readonly canonicalModel: string;
    readonly aliases: readonly string[];
    readonly efforts: readonly string[];
  }[];
}

export interface ResolvedPhaseAssignment {
  readonly phase: RunPhase;
  readonly role: ModelRole;
  readonly model: string;
  readonly effort: string;
}

export type ModelRoleRefusal =
  | "model.role_missing"
  | "model.host_missing"
  | "model.resolution_unavailable"
  | "model.effort_unsupported"
  | "model.independence_violation";

export function resolvePhaseAssignment(input: {
  readonly phase: RunPhase;
  readonly host: "claude" | "codex";
  readonly configuration: ProjectConfigV1_1;
  readonly catalog: HostModelCatalog;
}):
  | { readonly kind: "resolved"; readonly assignment: ResolvedPhaseAssignment }
  | { readonly kind: "refused"; readonly reasonCode: ModelRoleRefusal };

export function digestPhaseAssignment(
  input: {
    readonly configDigest: string;
    readonly runId: string;
    readonly revision: number;
    readonly host: "claude" | "codex";
    readonly assignment: ResolvedPhaseAssignment;
  },
  sha256: (canonical: string) => string,
): string;
```

Sort and deduplicate catalog aliases/efforts before comparison. Refuse a model
name that resolves to zero or more than one catalog entry. Resolve and compare
implementer and judge before returning any phase assignment, including planner
phases, so an invalid configuration never becomes partly usable.

- [ ] **Step 4: Run domain tests, lint, and typecheck**

Run:

```bash
npm test -- tests/model-role-resolution.test.ts
npm run lint
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the pure domain policy**

```bash
git add packages/runtime/src/domain/model-roles packages/runtime/package.json tests/support/model-routing.ts tests/model-role-resolution.test.ts
git commit -m "feat: resolve fixed model roles by phase"
```

---

### Task 3: Add read-only host model catalogs and honest execution observation

**Files:**
- Create: `packages/runtime/src/ports/model-routing.ts`
- Create: `packages/runtime/src/infra/fake/model-routing.ts`
- Modify: `packages/runtime/src/ports/index.ts`
- Modify: `packages/runtime/src/infra/fake/index.ts`
- Modify: `packages/runtime/src/infra/node/index.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Modify: `packages/adapters/src/index.ts:10-145`
- Modify: `tests/support/fake-host-adapter.ts`
- Modify: `tests/support/host-adapter-contract.ts`
- Test: `tests/host-adapter-contract.test.ts`
- Test: `tests/ports-contract.test.ts`

**Interfaces:**
- Consumes: `HostModelCatalog` from Task 2 and `AdapterMessageV1_1` from Task 1.
- Produces: `ModelRouting` runtime port and adapter descriptors/messages that carry catalogs and nullable observed effort without adding mutation authority.

- [ ] **Step 1: Write failing port and adapter conformance tests**

```ts
it("publishes a closed model catalog and nullable observed execution", () => {
  const adapter = codexAdapter({ modelRouting: codexCatalog() });
  expect(adapter.describe()).toMatchObject({
    configurationHost: "codex",
    modelRouting: {
      defaults: expect.objectContaining({
        planner: expect.any(Object),
        implementer: expect.any(Object),
        judge: expect.any(Object),
      }),
    },
    observedIdentity: { model: null, effort: null },
  });
});

it("keeps the adapter method surface relay-only", () => {
  expect(Object.keys(adapter).sort()).toEqual([
    "describe",
    "name",
    "relay",
    "translate",
  ]);
});
```

Add a port contract proving missing catalog returns `null` and no implementation
method can mutate project state.

- [ ] **Step 2: Run focused adapter tests and observe RED**

Run:

```bash
npm test -- tests/host-adapter-contract.test.ts tests/ports-contract.test.ts
```

Expected: FAIL because descriptors have no configuration host, catalog, or observed effort and `RuntimePorts` has no model-routing port.

- [ ] **Step 3: Implement catalog injection without hardcoded model names**

Add this port:

```ts
export interface ModelRouting {
  observe(host: "claude" | "codex"): Promise<HostModelCatalog | null>;
}
```

Make `HostAdapterOptions.modelRouting` required for adapters used in phase
routing:

```ts
export interface HostAdapterOptions {
  readonly modelRouting: HostModelCatalog;
  readonly model?: string | null;
  readonly effort?: string | null;
  readonly adapterVersion?: string;
  readonly capabilities?: readonly string[];
}
```

`claude-code` maps to configuration host `claude`; `codex` maps to `codex`.
Snapshot/freeze the supplied catalog and reject a catalog whose `host` does not
match that mapping. Do not add concrete model names to runtime or adapter
source. The host launcher injects its current catalog; initialization stops if
none is present.

Update the fake runtime helpers with:

```ts
export function fixedModelRouting(
  catalogs: readonly HostModelCatalog[],
): ModelRouting;
```

- [ ] **Step 4: Run adapter/port tests and package checks**

Run:

```bash
npm test -- tests/host-adapter-contract.test.ts tests/ports-contract.test.ts
npm run lint
npm run typecheck
```

Expected: PASS, including assertions that both adapters expose distinct
canonical implementer and judge defaults in their injected test catalogs.

- [ ] **Step 5: Commit the host capability boundary**

```bash
git add packages/adapters packages/runtime/src/ports packages/runtime/src/infra/fake packages/runtime/src/infra/node packages/runtime/src/composition/index.ts tests/support tests/host-adapter-contract.test.ts tests/ports-contract.test.ts
git commit -m "feat: expose host model routing catalogs"
```

---

### Task 4: Initialize explicit independent role assignments

**Files:**
- Modify: `packages/runtime/src/domain/init/answers.ts:1-96`
- Modify: `packages/runtime/src/domain/init/skeleton.ts:1-210`
- Modify: `packages/runtime/src/composition/init.ts:25-112`
- Modify: `packages/runtime/src/domain/cli/spec.ts:115-144`
- Test: `tests/init-answers.test.ts`
- Test: `tests/init-skeleton.test.ts`
- Test: `tests/init-command.test.ts`
- Test: `tests/init-fault-campaign.test.ts`

**Interfaces:**
- Consumes: current init answers, `ModelRouting`, normalization, and independence validation.
- Produces: resolved initialization answers whose `modelRoles` is explicit and a generated `.brain/config.json` at state `1.1.0`.

- [ ] **Step 1: Write failing initialization tests for explicit values and adapter defaults**

```ts
it("discloses and persists adapter-defaulted model roles", async () => {
  const run = subject(answers({ hosts: ["codex"] }), {
    modelRouting: fixedModelRouting([codexCatalog()]),
  });
  expect(await runCommandLine(["--json", "init"], run.ports)).toBe(0);
  expect(
    JSON.parse(run.storage.snapshot().files[".brain/config.json"] ?? "null"),
  ).toMatchObject({
    stateContract: "1.1.0",
    modelRoles: { codex: codexCatalog().defaults },
  });
  expect(run.output.structured_.join("")).toContain("modelRoles.codex");
});

it("writes nothing when defaults are absent or not independent", async () => {
  const run = subject(answers({ hosts: ["codex"] }), {
    modelRouting: fixedModelRouting([]),
  });
  expect(await runCommandLine(["init"], run.ports)).not.toBe(0);
  expect(run.storage.snapshot().files).toEqual({});
});
```

Also prove explicit assignments override defaults, simple/object equivalence,
unsupported effort refusal, and both-host initialization.

- [ ] **Step 2: Run initialization tests and observe RED**

Run:

```bash
npm test -- tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/init-fault-campaign.test.ts
```

Expected: FAIL because answers resolve only language, policy mode, and snapshots and configuration emits state `1.0.0` without `modelRoles`.

- [ ] **Step 3: Resolve catalogs before planning skeleton effects**

Change the resolver interface to:

```ts
export async function resolveInitAnswers(
  document: unknown,
  registry: SchemaRegistry,
  modelRouting: ModelRouting,
): Promise<ResolvedInitAnswers>;
```

Use the answer's enabled host list to request exactly those catalogs. Normalize
explicit or default assignments and store only explicit object forms in
`ResolvedInitAnswers`. Extend `defaulted` with deterministic paths such as
`modelRoles.codex.planner`. `skeletonEffects` remains pure: it receives already
resolved answers and writes them to current configuration; it never calls a
port.

- [ ] **Step 4: Run initialization and existing deterministic-plan tests**

Run:

```bash
npm test -- tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/init-fault-campaign.test.ts tests/init-managed-section.test.ts
npm run typecheck
```

Expected: PASS; a second identical initialization remains a no-op.

- [ ] **Step 5: Commit initialization support**

```bash
git add packages/runtime/src/domain/init packages/runtime/src/composition/init.ts packages/runtime/src/domain/cli/spec.ts tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/init-fault-campaign.test.ts
git commit -m "feat: initialize independent model roles"
```

---

### Task 5: Resolve and digest-bind read-only handoffs

**Files:**
- Modify: `packages/runtime/src/domain/project/configuration.ts:1-65`
- Modify: `packages/runtime/src/domain/cli/spec.ts:189-298`
- Modify: `packages/runtime/src/domain/cli/diagnostics.ts:87-117`
- Modify: `packages/runtime/src/composition/cli.ts:146-207`
- Modify: `packages/runtime/src/composition/workflow.ts:95-130`
- Modify: `packages/runtime/src/composition/workflow.ts:356-410`
- Test: `tests/model-role-workflow.test.ts`
- Test: `tests/cli-composition.test.ts`
- Test: `tests/project-configuration.test.ts`

**Interfaces:**
- Consumes: current project config, current workflow phase/revision, active host catalog, and digest functions.
- Produces: a validated `PhaseHandoffV1_1` payload and actionable role/config failures with no effects.

`tests/model-role-workflow.test.ts` defines a local
`workflowSubject(options): WorkflowSubject` builder that seeds a current config,
one active run, a selected host catalog, and captured pre-command bytes. Its
`WorkflowSubject` exposes `ports`, `storage`, `output`, and `before` so every
test can assert both the result and absence of mutation.

- [ ] **Step 1: Write failing handoff tests**

```ts
it("returns the runtime-selected judge assignment and digest", async () => {
  const run = workflowSubject({ phase: "review", host: "codex" });
  expect(await runCommandLine(["--json", "handoff"], run.ports)).toBe(0);
  expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
    assignment: { phase: "review", role: "judge", effort: "high" },
    assignmentDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
  });
  expect(run.storage.snapshot()).toEqual(run.before);
});

it("stops with the mapped role named when it is absent", async () => {
  const run = workflowSubject({ phase: "code", omitRole: "implementer" });
  expect(await runCommandLine(["handoff"], run.ports)).not.toBe(0);
  expect([...run.output.structured_, ...run.output.human_].join(""))
    .toContain("implementer");
});
```

Add cases for old configuration, missing host, equal canonical identities, and
alias resolution. Assert no event, snapshot, or configuration write in every
failure.

- [ ] **Step 2: Run handoff/configuration tests and observe RED**

Run:

```bash
npm test -- tests/model-role-workflow.test.ts tests/cli-composition.test.ts tests/project-configuration.test.ts
```

Expected: FAIL because workflow observation does not load project configuration or model catalogs and handoff returns prose only.

- [ ] **Step 3: Add current-config classification and handoff resolution**

Make configuration classification return:

```ts
export type ConfigurationOutcome =
  | { readonly kind: "valid"; readonly value: ProjectConfigV1_1 }
  | { readonly kind: "migration-required"; readonly reasonCode: "model.config_migration_required" }
  | { readonly kind: "failure"; readonly reasonCode: ConfigurationFailureReason };
```

In workflow composition, read and digest `.brain/config.json`, map the
invocation host to `claude` or `codex`, observe that catalog, and add this exact
field to the workflow observation:

```ts
readonly phaseAssignment:
  | { readonly kind: "resolved"; readonly value: PhaseHandoffV1_1 }
  | { readonly kind: "refused"; readonly reasonCode: ModelRoleReason; readonly subject: string };
```

`handoffCommand` always returns `planOf()`. With `--json`, it emits the validated
current handoff payload; without `--json`, it emits a human rendering derived
from that same payload. Add
`"phase-handoff@1.1.0"` to `JsonContractId`, set it on `handoffCommand`, and
generalize CLI payload preparation so `adapter-message` remains an always-JSON
relay contract while `phase-handoff` validates through `host.phase-handoff`
before selecting JSON or human rendering.

- [ ] **Step 4: Run handoff, configuration, and CLI result tests**

Run:

```bash
npm test -- tests/model-role-workflow.test.ts tests/cli-composition.test.ts tests/project-configuration.test.ts tests/result-contract-rendering.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit digest-bound handoff**

```bash
git add packages/runtime/src/domain/project/configuration.ts packages/runtime/src/domain/cli/diagnostics.ts packages/runtime/src/domain/cli/spec.ts packages/runtime/src/composition/cli.ts packages/runtime/src/composition/workflow.ts tests/model-role-workflow.test.ts tests/cli-composition.test.ts tests/project-configuration.test.ts
git commit -m "feat: bind phase handoffs to model assignments"
```

---

### Task 6: Verify and replay mixed-version event chains

**Files:**
- Modify: `packages/runtime/src/domain/events/model.ts:1-44`
- Modify: `packages/runtime/src/domain/events/parse.ts`
- Modify: `packages/runtime/src/domain/events/redaction.ts:1-156`
- Modify: `packages/runtime/src/domain/events/seal.ts:1-50`
- Modify: `packages/runtime/src/domain/events/verify.ts:1-63`
- Modify: `packages/runtime/src/domain/events/reduce.ts`
- Modify: `packages/runtime/src/composition/events.ts:146-340`
- Modify: `tests/fixtures/events/golden-event-v1.json` only if test imports need type narrowing; do not change its bytes
- Create: `tests/fixtures/events/golden-event-v1.1.json`
- Test: `tests/event-sealing.test.ts`
- Test: `tests/event-chain.test.ts`
- Test: `tests/event-reducer.test.ts`
- Test: `tests/event-store-preparation.test.ts`
- Test: `tests/event-chain-properties.test.ts`

**Interfaces:**
- Consumes: `ReadableEvent`, current `EventV1_1` drafts, exact per-record versions, and existing reducer registries.
- Produces: a continuous verified chain across event revisions without changing old canonical bytes.

The focused tests use these local helpers, all backed by checked-in fixtures
and the existing canonical JSON service:

```ts
function sealedV1Event(): EventV1;
function currentDraft(revision: number): CurrentEventDraft;
function canonical(event: ReadableEvent): string;
function tamper(
  event: EventV1_1,
  field: "resolvedAssignment.model",
): string;
const emptyCursor: EventCursor = { revision: 0, hash: null };
```

`tamper` clones the sealed event, changes only the named field, and serializes
it without resealing so the integrity failure is deterministic.

- [ ] **Step 1: Write failing mixed-chain and metadata-integrity tests**

```ts
it("verifies one hash chain across 1.0.0 and 1.1.0 events", () => {
  const oldEvent = sealedV1Event();
  const currentEvent = sealEvent(currentDraft(2), {
    revision: 1,
    hash: oldEvent.eventHash,
  }, services);
  expect(
    verifyEventStream(`${canonical(oldEvent)}\n${canonical(currentEvent)}\n`, services)
      .cursor.revision,
  ).toBe(2);
});

it("covers resolved and observed execution in the current event hash", () => {
  const event = sealEvent(currentDraft(1), emptyCursor, services);
  expect(() => verifyEventStream(tamper(event, "resolvedAssignment.model"), services))
    .toThrow("Event stream integrity validation failed");
});
```

Add property cases that randomly alternate readable versions while preserving
revision order and cases rejecting a `resolvedAssignment` on an infrastructure
event.

- [ ] **Step 2: Run event tests and observe RED**

Run:

```bash
npm test -- tests/event-sealing.test.ts tests/event-chain.test.ts tests/event-reducer.test.ts tests/event-store-preparation.test.ts tests/event-chain-properties.test.ts
```

Expected: FAIL because event parsing and draft redaction assume one exact key
set and one generated `EventV1` type.

- [ ] **Step 3: Dispatch parsing by each event's exact state revision**

Introduce:

```ts
export type ReadableEvent = EventV1 | EventV1_1;
export type CurrentEventDraft = Omit<EventV1_1, "previousHash" | "eventHash">;

export function parseEventLine(
  line: string,
  registry: SchemaRegistry,
): ReadableEvent;
```

Read `stateContract` structurally from each inert JSON line, then validate
`state.event` at that exact version. `sealEvent` accepts only
`CurrentEventDraft` and always emits `EventV1_1`. `unsignedEvent` and replay
accept the readable union. Keep the old golden fixture and its canonical hash
unchanged. Require current event drafts to carry observed effort, and admit
`resolvedAssignment` only for phase-scoped operation/reason combinations.

- [ ] **Step 4: Run event-store unit and fault suites**

Run:

```bash
npm test -- tests/event-sealing.test.ts tests/event-chain.test.ts tests/event-reducer.test.ts tests/event-store-preparation.test.ts tests/event-chain-properties.test.ts tests/event-store-transaction.test.ts tests/event-store-corruption.test.ts tests/event-store-fault-campaign.test.ts tests/node-event-store.test.ts
npm run typecheck
```

Expected: PASS, including unchanged v1 golden hashes and successful mixed replay.

- [ ] **Step 5: Commit mixed event support**

```bash
git add packages/runtime/src/domain/events packages/runtime/src/composition/events.ts tests/fixtures/events tests/event-sealing.test.ts tests/event-chain.test.ts tests/event-reducer.test.ts tests/event-store-preparation.test.ts tests/event-chain-properties.test.ts tests/event-store-transaction.test.ts tests/event-store-corruption.test.ts tests/event-store-fault-campaign.test.ts tests/node-event-store.test.ts
git commit -m "feat: verify mixed model role event history"
```

---

### Task 7: Persist runtime-selected phase execution and reject stale or mismatched results

**Files:**
- Modify: `packages/runtime/src/domain/workflow/model.ts:1-145`
- Modify: `packages/runtime/src/domain/workflow/decision.ts:1-300`
- Modify: `packages/runtime/src/domain/cli/agent.ts:28-63`
- Modify: `packages/runtime/src/domain/cli/agent.ts:73-440`
- Modify: `packages/runtime/src/domain/cli/workflow.ts`
- Modify: `packages/runtime/src/domain/cli/spec.ts:189-298`
- Modify: `packages/runtime/src/composition/workflow.ts:356-410`
- Modify: `packages/adapters/src/index.ts`
- Test: `tests/model-role-workflow.test.ts`
- Test: `tests/workflow-state-machine.test.ts`
- Test: `tests/agent-output-contract.test.ts`
- Test: `tests/cli-composition.test.ts`

**Interfaces:**
- Consumes: `PhaseHandoffV1_1`, adapter-supplied digest and nullable observed execution, and `CurrentEventDraft`.
- Produces: phase record/transition events whose assignment is constructed by the runtime, plus fail-closed stale/mismatch outcomes.

For host-driven `agent record`, the adapter writes one `AdapterMessageV1_1`
request to standard input. That envelope binds the agent-output `ref` and
`sha256` and carries `phaseExecution: { assignmentDigest, model, effort }`.
Direct CLI use supplies no adapter envelope and therefore records null observed
model/effort regardless of `--model`; existing flags remain user-declared
diagnostic metadata only.

The workflow test file adds these local helpers with stable signatures:

```ts
function agentReplyWithExtraClaims(claims: Record<string, string>): string;
async function recordAgent(
  subject: WorkflowSubject,
  execution: Partial<PhaseExecutionObservation>,
): Promise<OperationResultV1>;
function lastEvent(subject: WorkflowSubject): EventV1_1;
```

- [ ] **Step 1: Write failing trust-boundary and mismatch tests**

```ts
it("writes assignment metadata from runtime resolution, not agent output", async () => {
  const reply = agentReplyWithExtraClaims({
    role: "implementer",
    model: "forged-model",
    effort: "low",
  });
  const run = workflowSubject({ phase: "review", reply, host: "codex" });
  await recordAgent(run, {
    assignmentDigest: run.handoff.assignmentDigest,
    observedModel: null,
    observedEffort: null,
  });
  expect(lastEvent(run)).toMatchObject({
    resolvedAssignment: run.handoff.assignment,
    observedIdentity: { host: "codex", model: null, effort: null },
  });
  expect(JSON.stringify(lastEvent(run))).not.toContain("forged-model");
});

it.each([
  ["stale digest", { assignmentDigest: "0".repeat(64) }, "model.assignment_stale"],
  ["wrong observed model", { observedModel: "other" }, "model.execution_mismatch"],
  ["wrong observed effort", { observedEffort: "low" }, "model.execution_mismatch"],
])("blocks %s without an append", async (_label, execution, reasonCode) => {
  const run = workflowSubject({ phase: "code" });
  expect(await recordAgent(run, execution)).toMatchObject({ reasonCode });
  expect(run.eventsAfter).toBe(run.eventsBefore);
});
```

Add a direct-CLI case proving `--model` remains `user-declared` and therefore
does not become host-observed execution metadata.

- [ ] **Step 2: Run workflow tests and observe RED**

Run:

```bash
npm test -- tests/model-role-workflow.test.ts tests/workflow-state-machine.test.ts tests/agent-output-contract.test.ts tests/cli-composition.test.ts
```

Expected: FAIL because requests/events carry only `{ host, model }` and do not
accept or revalidate an assignment digest.

- [ ] **Step 3: Revalidate assignment before every phase-result append**

Extend phase execution input with:

```ts
export interface PhaseExecutionObservation {
  readonly assignmentDigest: string;
  readonly model: string | null;
  readonly effort: string | null;
  readonly provenance: "host-reported" | "unknown";
}
```

Composition recomputes the handoff from current config/run/catalog. Return
`model.assignment_stale` before parsing agent claims when the digest differs.
When provenance is `host-reported`, compare each non-null observed field with
the resolved assignment; otherwise normalize both observed fields to `null`.

Pass `resolvedAssignment` and the sanitized observed identity into
`decideRecordFact` and phase-completing `decideContinueWorkflow` calls. Construct
those event fields inside workflow decision functions. Never add them to
`AgentOutputV1_1` or read unknown keys from agent JSON.

In `observeWorkflow`, read standard input only for phase-result commands. Parse
and validate `AdapterMessageV1_1`, require its operation and digest-pinned
payload to match the command and positional agent-output file, and set
provenance to `host-reported`. Empty standard input takes the direct-CLI path;
malformed or mismatched non-empty input refuses before reading agent content.

- [ ] **Step 4: Run workflow, event, and CLI suites**

Run:

```bash
npm test -- tests/model-role-workflow.test.ts tests/workflow-state-machine.test.ts tests/agent-output-contract.test.ts tests/cli-composition.test.ts tests/event-sealing.test.ts tests/event-store-transaction.test.ts
npm run typecheck
```

Expected: PASS; negative cases leave event bytes and replayed snapshot unchanged.

- [ ] **Step 5: Commit audited phase execution**

```bash
git add packages/runtime/src/domain/workflow packages/runtime/src/domain/cli/agent.ts packages/runtime/src/domain/cli/workflow.ts packages/runtime/src/domain/cli/spec.ts packages/runtime/src/composition/workflow.ts packages/adapters/src/index.ts tests/model-role-workflow.test.ts tests/workflow-state-machine.test.ts tests/agent-output-contract.test.ts tests/cli-composition.test.ts
git commit -m "feat: audit resolved phase model execution"
```

---

### Task 8: Add digest-bound current configuration migration and rollback

**Files:**
- Modify: `packages/runtime/src/domain/migration/upgrade.ts:1-48`
- Modify: `packages/runtime/src/domain/migration/index.ts`
- Modify: `packages/runtime/src/domain/cli/migration.ts:21-270`
- Modify: `packages/runtime/src/domain/cli/commands.ts:100-134`
- Modify: `packages/runtime/src/domain/cli/spec.ts:299-321`
- Modify: `packages/runtime/src/composition/migration.ts:28-165`
- Modify: `docs/architecture/migration-observability.md`
- Test: `tests/config-migration.test.ts`
- Test: `tests/migration-observability.test.ts`
- Test: `tests/cli-commands.test.ts`
- Test: `tests/cli-parsing.test.ts`

**Interfaces:**
- Consumes: exact `ProjectConfigV1` source bytes, v1.1 migration answers, host catalogs, SHA-256, managed transactions, and readable migration receipts.
- Produces: `kratos migrate config [--answers PATH] [--yes]`, a digest-bound `MigrationV1_1` plan/receipt, and rollback of the one replaced configuration file.

`tests/config-migration.test.ts` defines `legacyProjectWithHistory()` to return a
subject containing the pinned `ProjectConfigV1` fixture, a non-empty golden v1
event stream, a matching snapshot, model catalogs, captured output, and mutable
transaction storage. `previewConfigMigration`, `applyConfigMigration`, and
`mutateConfigAfterPreview` operate only on that subject and return parsed
operation results.

- [ ] **Step 1: Write failing migration tests with non-empty run history**

```ts
it("migrates only config and preserves every historical byte", async () => {
  const run = legacyProjectWithHistory();
  const before = run.storage.snapshot().files;
  expect(await runCommandLine(["migrate", "config", "--yes"], run.ports)).toBe(0);
  const after = run.storage.snapshot().files;
  expect(JSON.parse(after[".brain/config.json"] ?? "null")).toMatchObject({
    stateContract: "1.1.0",
    modelRoles: expect.any(Object),
  });
  for (const [path, content] of Object.entries(before)) {
    if (path !== ".brain/config.json") expect(after[path]).toBe(content);
  }
});

it("previews without mutation and refuses changed source on apply", async () => {
  const run = legacyProjectWithHistory();
  const preview = await previewConfigMigration(run);
  mutateConfigAfterPreview(run);
  expect(await applyConfigMigration(run, preview.planDigest)).toMatchObject({
    reasonCode: "runtime.revision_conflict",
  });
});
```

Cover explicit host confirmation, adapter-default disclosure, invalid/equal
defaults, idempotent current config, verified receipt, exact backup restore,
and rollback refusal after destination drift.

- [ ] **Step 2: Run migration/CLI tests and observe RED**

Run:

```bash
npm test -- tests/config-migration.test.ts tests/migration-observability.test.ts tests/cli-commands.test.ts tests/cli-parsing.test.ts
```

Expected: FAIL because only `migrate brain` and `migrate rollback` exist.

- [ ] **Step 3: Implement a configuration-specific migration operation**

Add this operation to `CommandObservation`:

```ts
{
  readonly kind: "config";
  readonly migrationId: string;
  readonly now: string;
  readonly source: { readonly content: string; readonly sha256: string };
  readonly destination: ProjectConfigV1_1;
  readonly destinationDigest: string;
  readonly planDigest: string;
  readonly expected: WriteFilePrecondition;
}
```

Preview renders source/destination digests, confirmed hosts, every explicit
normalized role assignment, and the exact write list. `--yes` writes:

- `.brain/config.json` with the current configuration;
- `.brain/migrations/<id>/backup/config.json` with exact prior bytes;
- digest-bound authorization, rollback manifest, receipt, and verification
  records under `.brain/migrations/<id>/`.

Use one managed transaction with the observed config fingerprint as a
precondition. Extend rollback to restore a recorded replacement when the
current destination digest still matches the receipt; retain the existing
delete-only behavior for legacy Brain copy migrations.

- [ ] **Step 4: Run migration, transaction, and replay tests**

Run:

```bash
npm test -- tests/config-migration.test.ts tests/migration-observability.test.ts tests/migration-plan.test.ts tests/cli-commands.test.ts tests/cli-parsing.test.ts tests/event-chain.test.ts tests/event-reducer.test.ts tests/transaction-fault-campaign.test.ts
npm run typecheck
```

Expected: PASS; event/snapshot fixtures retain exact bytes through migration
and rollback restores the original configuration.

- [ ] **Step 5: Commit configuration migration**

```bash
git add packages/runtime/src/domain/migration packages/runtime/src/domain/cli/migration.ts packages/runtime/src/domain/cli/commands.ts packages/runtime/src/domain/cli/spec.ts packages/runtime/src/composition/migration.ts docs/architecture/migration-observability.md tests/config-migration.test.ts tests/migration-observability.test.ts tests/cli-commands.test.ts tests/cli-parsing.test.ts
git commit -m "feat: migrate project model role configuration"
```

---

### Task 9: Publish compatibility documentation and acceptance evidence

**Files:**
- Modify: `README.md`
- Modify: `schemas/README.md`
- Modify: `docs/architecture/system-architecture.md`
- Modify: `docs/architecture/host-adapter-protocol.md`
- Modify: `docs/architecture/event-store.md`
- Modify: `docs/architecture/project-initialization.md`
- Modify: `docs/architecture/migration-observability.md`
- Modify: `docs/compatibility/contract-versioning.md`
- Modify: `docs/user/commands.md`
- Modify: `docs/user/configuration-and-state.md`
- Modify: `docs/user/migration-and-recovery.md`
- Modify: `docs/user/security-and-troubleshooting.md`
- Create: `docs/verification/issue-136-model-role-evidence.md`
- Test: `tests/contract-documentation.test.ts`
- Test: `tests/github-contribution-contract.test.ts`
- Test: `tests/architecture.test.ts`

**Interfaces:**
- Consumes: final public schemas, commands, reason codes, tests, and verification output.
- Produces: accurate public behavior and a criterion-by-criterion evidence record suitable for the issue and pull request.

- [ ] **Step 1: Write failing documentation contract assertions**

```ts
it("documents role mapping, strict independence, honest observation, and migration", async () => {
  const configuration = await read("docs/user/configuration-and-state.md");
  const hosts = await read("docs/architecture/host-adapter-protocol.md");
  const migration = await read("docs/user/migration-and-recovery.md");
  expect(configuration).toContain("`planner`, `implementer`, and `judge`");
  expect(configuration).toContain("`review` and `acceptance`");
  expect(hosts).toContain("observed model and effort remain `null`");
  expect(migration).toContain("`kratos migrate config`");
});
```

Add an architecture assertion that prompts do not own the independence decision
and a contribution assertion requiring compatibility, state, security, exact
commands, and evidence in the eventual PR text.

- [ ] **Step 2: Run documentation checks and observe RED**

Run:

```bash
npm test -- tests/contract-documentation.test.ts tests/github-contribution-contract.test.ts tests/architecture.test.ts
```

Expected: FAIL because public documentation does not describe model roles or
the configuration migration.

- [ ] **Step 3: Update public docs and create the evidence matrix**

Use this evidence table shape and record every row with real test names and
captured commands from the completed implementation:

```markdown
| Acceptance criterion | Evidence | Command | Result |
| --- | --- | --- | --- |
| Missing phase role stops and names the role | `tests/model-role-workflow.test.ts` — `stops with the mapped role named when it is absent` | `npm test -- tests/model-role-workflow.test.ts` | PASS |
| Judge cannot resolve to implementer model | `tests/model-role-resolution.test.ts` — `rejects aliases whose canonical implementer and judge are equal` | `npm test -- tests/model-role-resolution.test.ts` | PASS |
| Bare and object forms resolve identically | `tests/model-role-resolution.test.ts` — `normalizes the bare and object forms identically` | `npm test -- tests/model-role-resolution.test.ts` | PASS |
| Events carry runtime-selected and host-observed metadata | `tests/model-role-workflow.test.ts` — `writes assignment metadata from runtime resolution, not agent output` | `npm test -- tests/model-role-workflow.test.ts` | PASS |
| Prior config migrates without state loss | `tests/config-migration.test.ts` — `migrates only config and preserves every historical byte` | `npm test -- tests/config-migration.test.ts` | PASS |
```

Also record the approved strict-refusal clarification: the contradictory
one-time warning was removed by owner decision and replaced with
`model.independence_violation`.

- [ ] **Step 4: Run focused verification, then the complete repository gate**

Run:

```bash
npm test -- tests/model-role-resolution.test.ts tests/model-role-workflow.test.ts tests/config-migration.test.ts tests/contract-manifest.test.ts tests/contract-schemas.test.ts tests/host-adapter-contract.test.ts tests/init-command.test.ts tests/event-chain.test.ts tests/contract-documentation.test.ts
npm run verify
git diff --check
```

Expected: every command exits 0. Copy the exact command output summaries into
`docs/verification/issue-136-model-role-evidence.md`; do not claim CI green
until the remote CI run is observed.

- [ ] **Step 5: Commit documentation and evidence**

```bash
git add README.md schemas/README.md docs/architecture docs/compatibility/contract-versioning.md docs/user docs/verification/issue-136-model-role-evidence.md tests/contract-documentation.test.ts tests/github-contribution-contract.test.ts tests/architecture.test.ts
git commit -m "docs: publish model role guarantees"
```

---

## Final review and pull-request handoff

- [ ] Confirm `git status --short` contains only intentional files.
- [ ] Confirm `git log --oneline` shows one focused commit per task.
- [ ] Re-run `npm run verify` from the final commit.
- [ ] Compare every section of the approved spec with Tasks 1–9 and the evidence matrix.
- [ ] Scan source, tests, fixtures, docs, commits, and PR text for non-English content and unfinished markers.
- [ ] Prepare a pull request that links #136, names the approved removal of the contradictory warning criterion, states compatibility/state/security impact, lists exact verification commands, and links `docs/verification/issue-136-model-role-evidence.md`.
