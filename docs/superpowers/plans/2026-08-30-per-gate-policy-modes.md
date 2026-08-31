# Per-Gate Policy Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every gate an independently resolved shadow, warn, or enforce mode while preserving legacy project behavior and recording the effective mode of every failure in the authoritative event stream.

**Architecture:** A pure policy resolver expands `policyMode` plus partial overrides into a total gate-mode table. The pure evaluator annotates each failure and a separate pure aggregator orders mixed outcomes; composition supplies facts and policy, while workflow events persist the resulting trace. Project configuration advances to 1.4.0 and events to 1.2.0 without rewriting prior schemas or event bytes.

**Tech Stack:** TypeScript 6 ESM, Node.js 24, Vitest 4, JSON Schema 2020-12, Ajv, generated schema declarations, canonical JSON, append-only SHA-256 event chains.

**Spec:** `docs/superpowers/specs/2026-08-30-per-gate-policy-modes-design.md`

## Global Constraints

- Keep source, tests, fixtures, prompts, errors, documentation, commits, and pull-request text in English.
- Keep `policyMode: "standard" | "strict"` as the project default: standard resolves to warn and strict resolves to enforce.
- Preserve `shadow`, `warn`, and `enforce`: shadow passes while recording, warn reports and continues, enforce blocks.
- Do not add or remove gates, alter a gate condition, or change any existing reason code.
- Keep the runtime authoritative and host neutral; Codex and Claude Code only relay or render decisions.
- Do not add filesystem, Git, clock, process, network, or host capabilities to the gate evaluator or policy resolver.
- Preserve old schemas and fixtures byte-for-byte. Configuration migration changes only current configuration and never rewrites event history.
- Use no new runtime or test dependency.
- Run the narrow RED and GREEN commands in each task, then run `npm run verify` only after all tasks are complete.

---

## File structure and ownership

- `packages/runtime/src/domain/gates/policy.ts`: default/override resolution, mode-to-outcome mapping, canonical comparison, and aggregation.
- `packages/runtime/src/domain/gates/model.ts`: closed gate IDs, mode-table types, failure shape, and decision shape.
- `packages/runtime/src/domain/gates/evaluate.ts`: unchanged gate predicates wired to the resolved mode table.
- `schemas/state/project-config.v1.4.schema.json`: current persisted project policy contract.
- `schemas/state/event.v1.2.schema.json`: current event contract with bounded gate-failure traces.
- `packages/runtime/src/domain/migration/upgrade.ts`: adjacent pure 1.3.0 to 1.4.0 configuration upgrade.
- `packages/runtime/src/domain/events/{model,redaction,semantics}.ts`: current event types, safe snapshotting, and semantic validation.
- `packages/runtime/src/domain/workflow/{model,decision}.ts`: propagation of gate decisions into accepted and rejected events.
- `packages/runtime/src/composition/workflow.ts`: configuration observation, policy resolution, approval-mode selection, and evaluator wiring.
- `tests/gate-policy-modes.test.ts`: focused table and property tests for the new policy core.
- `tests/event-gate-failures.test.ts`: focused event schema, snapshot, semantic, and mixed-stream tests.

---

### Task 1: Pure per-gate policy resolution and aggregation

**Files:**

- Create: `packages/runtime/src/domain/gates/policy.ts`
- Create: `tests/gate-policy-modes.test.ts`
- Modify: `packages/runtime/src/domain/gates/model.ts`
- Modify: `packages/runtime/src/domain/gates/evaluate.ts`
- Modify: `packages/runtime/src/domain/gates/index.ts`
- Modify: `tests/gates-approvals-evidence.test.ts`

**Interfaces:**

- Produces: `ProjectPolicyMode`, `GateModes`, `GateOutcome`, `GateAggregation`.
- Produces: `resolveGateModes(policyMode, overrides): GateModes`.
- Produces: `outcomeForMode(mode): GateOutcome`.
- Produces: `compareGateFailures(left, right): number` and `aggregateGateFailures(failures): GateAggregation`.
- Produces: `GATE_PRIORITIES` and `GATE_REASON_CODES` as the shared semantic catalogue for evaluation and event validation.
- Produces: `GateContext.gateModes`, `GateFailure.mode`, and `GateDecision.gateModes`.
- Removes: `GateContext.mode` and `GateDecision.mode`.

- [ ] **Step 1: Write the policy-resolution and nine-combination RED tests**

Create `tests/gate-policy-modes.test.ts` with helpers that build two real-shaped failures and the complete three-by-three table:

```ts
import {
  GATE_IDS,
  aggregateGateFailures,
  resolveGateModes,
  type GateFailure,
  type GateId,
  type GateMode,
} from "@kratos/runtime/domain/gates";
import { describe, expect, it } from "vitest";

const MODES = ["shadow", "warn", "enforce"] as const;
const OUTCOME = { shadow: "pass", warn: "warn", enforce: "block" } as const;

function failed(gateId: GateId, priority: number, mode: GateMode): GateFailure {
  return {
    gateId,
    reasonCode:
      gateId === "spec-approved" ? "gate.aprovacao_spec" : "gate.gaps_abertos",
    priority,
    mode,
    evidenceRefs: [`.brain/${gateId}`],
    detail: null,
  };
}

describe("per-gate policy modes", () => {
  it("resolves a total immutable table from the project default and overrides", () => {
    const overrides = { "gaps-closed": "shadow" } as const;
    const resolved = resolveGateModes("strict", overrides);
    expect(Object.keys(resolved)).toEqual(GATE_IDS);
    expect(resolved["spec-approved"]).toBe("enforce");
    expect(resolved["gaps-closed"]).toBe("shadow");
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(overrides).toEqual({ "gaps-closed": "shadow" });
  });

  it.each(MODES.flatMap((left) => MODES.map((right) => [left, right] as const)))(
    "aggregates %s and %s by the most severe outcome",
    (left, right) => {
      const decision = aggregateGateFailures([
        failed("spec-approved", 40, left),
        failed("gaps-closed", 50, right),
      ]);
      const expected = [OUTCOME[left], OUTCOME[right]].includes("block")
        ? "block"
        : [OUTCOME[left], OUTCOME[right]].includes("warn")
          ? "warn"
          : "pass";
      expect(decision.outcome).toBe(expected);
    },
  );
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `npx vitest run tests/gate-policy-modes.test.ts tests/gates-approvals-evidence.test.ts`

Expected: FAIL because the new module exports and per-failure `mode` do not exist and the old evaluator still accepts one global mode.

- [ ] **Step 3: Define the closed types and policy functions**

In `model.ts`, add these public types and fields:

```ts
export type ProjectPolicyMode = "standard" | "strict";
export type GateOutcome = "pass" | "warn" | "block";
export type GateModes = Readonly<Record<GateId, GateMode>>;
export type GateFailureReason =
  | "blocked.context_unreadable"
  | "blocked.stop_loss_budget"
  | "blocked.stop_loss_flag"
  | "gate.aceitacao_final"
  | "gate.ac_incomplete"
  | "gate.aprovacao_spec"
  | "gate.gaps_abertos"
  | "gate.particionamento"
  | "gate.prd_ausente"
  | "gate.prd_section_missing"
  | "gate.prd_untouched";

export interface GateFailure {
  readonly gateId: GateId;
  readonly reasonCode: GateFailureReason;
  readonly priority: number;
  readonly mode: GateMode;
  readonly evidenceRefs: readonly string[];
  readonly detail: string | null;
}

export interface GateContext {
  readonly gateModes: GateModes;
  // retain every existing fact field unchanged
}

export interface GateDecision {
  readonly outcome: GateOutcome;
  readonly primary: GateFailure | null;
  readonly failures: readonly GateFailure[];
  readonly gateModes: GateModes;
  readonly advisories?: readonly GateAdvisory[];
  readonly criteria: readonly AcceptanceCriterionGateState[];
}
```

Publish the exact gate/reason pairing beside `GATE_PRIORITIES` so evaluation
and event validation cannot drift:

```ts
export const GATE_REASON_CODES = {
  "context-readable": ["blocked.context_unreadable"],
  "stop-loss": ["blocked.stop_loss_budget", "blocked.stop_loss_flag"],
  "prd-present": [
    "gate.prd_ausente",
    "gate.prd_section_missing",
    "gate.prd_untouched",
  ],
  "spec-approved": ["gate.aprovacao_spec"],
  "gaps-closed": ["gate.gaps_abertos"],
  "partition-approved": ["gate.particionamento"],
  "acceptance-criteria": ["gate.ac_incomplete"],
  "final-acceptance": ["gate.aceitacao_final"],
} as const satisfies Readonly<Record<GateId, readonly GateFailureReason[]>>;
```

In `policy.ts`, implement the exact resolution and ordering boundary:

```ts
const SEVERITY: Readonly<Record<GateOutcome, number>> = {
  block: 0,
  warn: 1,
  pass: 2,
};

export function outcomeForMode(mode: GateMode): GateOutcome {
  return mode === "enforce" ? "block" : mode === "warn" ? "warn" : "pass";
}

export function resolveGateModes(
  policyMode: ProjectPolicyMode,
  overrides: Readonly<Partial<Record<GateId, GateMode>>>,
): GateModes {
  const inherited = policyMode === "strict" ? "enforce" : "warn";
  return Object.freeze(
    Object.fromEntries(GATE_IDS.map((id) => [id, overrides[id] ?? inherited])),
  ) as GateModes;
}

export function compareGateFailures(left: GateFailure, right: GateFailure): number {
  return (
    SEVERITY[outcomeForMode(left.mode)] - SEVERITY[outcomeForMode(right.mode)] ||
    left.priority - right.priority ||
    left.gateId.localeCompare(right.gateId, "en-US")
  );
}

export function aggregateGateFailures(
  input: readonly GateFailure[],
): GateAggregation {
  const failures = Object.freeze(
    [...input].sort(compareGateFailures).map((failure) => Object.freeze({ ...failure })),
  );
  return Object.freeze({
    outcome: failures[0] === undefined ? "pass" : outcomeForMode(failures[0].mode),
    primary: failures[0] ?? null,
    failures,
  });
}
```

- [ ] **Step 4: Wire the unchanged gate predicates to the effective mode**

Move the priority table to an exported immutable `GATE_PRIORITIES` constant and change the failure builder to select the gate's mode:

```ts
function failure(
  gateId: GateId,
  reasonCode: GateFailure["reasonCode"],
  context: GateContext,
  evidenceRefs: readonly string[],
  detail: string | null = null,
): GateFailure {
  return {
    gateId,
    reasonCode,
    priority: GATE_PRIORITIES[gateId],
    mode: context.gateModes[gateId],
    evidenceRefs,
    detail,
  };
}
```

Replace only each builder call's arguments; do not change any predicate. Finish `evaluateGates` with:

```ts
const aggregate = aggregateGateFailures(failures);
return {
  ...aggregate,
  gateModes: context.gateModes,
  advisories: immutableAdvisories,
  criteria,
};
```

Export the new types/functions from `domain/gates/index.ts` and update the existing uniform-mode tests to call `resolveGateModes`.

- [ ] **Step 5: Add primary, tie-break, and permutation properties**

Append tests that assert a priority-10 shadow failure loses primary to a priority-80 enforce failure, equal-outcome failures retain priority order, and generated permutations produce the same canonical JSON:

```ts
for (let seed = 1; seed <= 100; seed += 1) {
  const failures = [
    failed("spec-approved", 40, MODES[seed % 3] ?? "shadow"),
    failed("gaps-closed", 50, MODES[(seed + 1) % 3] ?? "warn"),
    failed("final-acceptance", 80, MODES[(seed + 2) % 3] ?? "enforce"),
  ];
  const expected = JSON.stringify(aggregateGateFailures(failures));
  for (const permutation of permutations(failures)) {
    expect(JSON.stringify(aggregateGateFailures(permutation)), `seed=${seed}`).toBe(
      expected,
    );
  }
}
```

Define a local recursive `permutations<T>` helper in the test. Do not use random `Array.sort`.

- [ ] **Step 6: Run GREEN and the domain architecture check**

Run: `npx vitest run tests/gate-policy-modes.test.ts tests/gates-approvals-evidence.test.ts tests/architecture.test.ts`

Expected: PASS; 9 mode-pair rows execute, mixed primary selection passes, and the architecture test still proves the gate domain imports no capabilities.

- [ ] **Step 7: Commit the pure policy slice**

```bash
git add packages/runtime/src/domain/gates tests/gate-policy-modes.test.ts tests/gates-approvals-evidence.test.ts
git commit -m "feat(gates): resolve policy mode per gate"
```

---

### Task 2: Publish project configuration 1.4.0

**Files:**

- Create: `schemas/state/project-config.v1.4.schema.json`
- Create: `fixtures/contracts/v1.4/project-config.json`
- Modify: `packages/contracts/catalogs/contract-families.v1.json`
- Modify: `packages/contracts/src/compatibility.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/generated/contracts.ts` through generation
- Modify: `packages/runtime/src/domain/schema/contracts.ts`
- Modify: `packages/runtime/src/infra/schema/catalog.ts`
- Modify: `tests/contract-compatibility.test.ts`
- Modify: `tests/contract-schemas.test.ts`
- Modify: `tests/contract-type-generation.test.ts`
- Modify: `tests/schema-catalog.test.ts`
- Modify: `tests/schema-registry-fixtures.test.ts`
- Modify: `tests/schema-registry-types.test.ts`

**Interfaces:**

- Produces: `ProjectConfigV1_4` and `ProjectConfigV1_4Contract.GateModes`.
- Changes: `CurrentProjectConfig = ProjectConfigV1_4`.
- Changes: current state identity to 1.4.0 and current `state.project-config` payload to 1.4.0.
- Keeps: host identity and `host.init-answers` at 1.3.0.

- [ ] **Step 1: Write schema and catalogue RED assertions**

Add tests requiring state 1.4.0, project-config 1.4.0, event still 1.1.0 at this task boundary, and a closed override map:

```ts
expect(CONTRACT_IDENTITIES.state).toBe("1.4.0");
expect(CONTRACT_IDENTITIES.host).toBe("1.3.0");
expect(CONTRACT_VERSIONS["state.project-config"]).toBe("1.4.0");

expect(validate({ ...project, gateModes: { "gaps-closed": "shadow" } })).toBe(true);
expect(validate({ ...project, gateModes: { unknown: "shadow" } })).toBe(false);
expect(validate({ ...project, gateModes: { "gaps-closed": "observe" } })).toBe(false);
expect(validate({ ...project, gateModes: undefined })).toBe(false);
```

- [ ] **Step 2: Run the contract RED suite**

Run: `npx vitest run tests/contract-compatibility.test.ts tests/contract-schemas.test.ts tests/schema-catalog.test.ts tests/schema-registry-types.test.ts tests/contract-type-generation.test.ts`

Expected: FAIL because 1.4.0 is not registered and `ProjectConfigV1_4` is absent.

- [ ] **Step 3: Add the closed 1.4.0 schema and fixture**

Copy the authored structure of v1.3 into a new schema without editing v1.3. Change only project/state contract constants, add `gateModes` to `required`, and add this definition/property:

```json
"gateModes": { "$ref": "#/$defs/gateModes" }
```

```json
"gateMode": { "enum": ["shadow", "warn", "enforce"] },
"gateModes": {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "context-readable": { "$ref": "#/$defs/gateMode" },
    "stop-loss": { "$ref": "#/$defs/gateMode" },
    "prd-present": { "$ref": "#/$defs/gateMode" },
    "spec-approved": { "$ref": "#/$defs/gateMode" },
    "gaps-closed": { "$ref": "#/$defs/gateMode" },
    "partition-approved": { "$ref": "#/$defs/gateMode" },
    "acceptance-criteria": { "$ref": "#/$defs/gateMode" },
    "final-acceptance": { "$ref": "#/$defs/gateMode" }
  }
}
```

The v1.4 fixture must contain `gateModes: {}` and retain `hostContract: "1.3.0"`.

- [ ] **Step 4: Register and generate the contract**

Update the manifest's current/readable state versions and add the sorted schema entry. Update `CONTRACT_VERSIONS`, embedded schema imports/catalogue, contract unions, and current aliases. Then run:

Run: `npm run contracts:generate`

Expected: PASS and generated declarations contain `ProjectConfigV1_4` with the eight optional override properties and no index signature.

- [ ] **Step 5: Run contract GREEN checks**

Run: `npx vitest run tests/contract-compatibility.test.ts tests/contract-schemas.test.ts tests/contract-manifest.test.ts tests/schema-catalog.test.ts tests/schema-registry-fixtures.test.ts tests/schema-registry-types.test.ts tests/contract-type-generation.test.ts`

Expected: PASS with the updated schema count and generated-type assertions.

- [ ] **Step 6: Commit the project contract slice**

```bash
git add schemas/state/project-config.v1.4.schema.json fixtures/contracts/v1.4/project-config.json packages/contracts packages/runtime/src/domain/schema/contracts.ts packages/runtime/src/infra/schema/catalog.ts tests/contract-compatibility.test.ts tests/contract-schemas.test.ts tests/contract-manifest.test.ts tests/schema-catalog.test.ts tests/schema-registry-fixtures.test.ts tests/schema-registry-types.test.ts tests/contract-type-generation.test.ts
git commit -m "feat(contracts): publish per-gate project policy"
```

---

### Task 3: Migrate legacy configuration and initialize overrides

**Files:**

- Modify: `packages/runtime/src/domain/project/configuration.ts`
- Modify: `packages/runtime/src/domain/project/resolution.ts`
- Modify: `packages/runtime/src/domain/migration/upgrade.ts`
- Modify: `packages/runtime/src/domain/migration/index.ts`
- Modify: `packages/runtime/src/composition/migration.ts`
- Modify: `packages/runtime/src/domain/init/skeleton.ts`
- Modify: `packages/runtime/src/composition/workflow.ts` only for current config typing
- Modify: `tests/project-configuration.test.ts`
- Modify: `tests/config-migration.test.ts`
- Modify: `tests/init-skeleton.test.ts`
- Modify: `tests/project-types.test.ts`
- Modify: `tests/project-discovery-composition.test.ts`

**Interfaces:**

- Produces: `upgradeProjectConfigurationV1_4(source: ProjectConfigV1_3): ProjectConfigV1_4`.
- Changes: ordinary configuration classification treats 1.3.0 as migration-required and 1.4.0 as current.
- Produces: new-project configuration with `gateModes: {}`.

- [ ] **Step 1: Add migration and byte-preservation RED tests**

Add a direct pure upgrade test and an authorized migration test:

```ts
const upgraded = upgradeProjectConfigurationV1_4(legacyV1_3);
expect(upgraded).toEqual({
  ...legacyV1_3,
  contractVersion: "1.4.0",
  stateContract: "1.4.0",
  gateModes: {},
});
expect(upgraded.hostContract).toBe("1.3.0");
```

For the composition migration, snapshot every file before execution, assert the new config contains `gateModes: {}`, and assert every path except `.brain/config.json` retains identical bytes.

Also prove canonical decision compatibility by evaluating equal facts with the
legacy-derived and migrated policy tables:

```ts
const legacyModes = resolveGateModes(legacyV1_3.policyMode, {});
const migratedModes = resolveGateModes(upgraded.policyMode, upgraded.gateModes);
expect(canonicalizeJson(evaluateGates({ ...facts, gateModes: migratedModes }))).toBe(
  canonicalizeJson(evaluateGates({ ...facts, gateModes: legacyModes })),
);
```

- [ ] **Step 2: Run migration RED tests**

Run: `npx vitest run tests/project-configuration.test.ts tests/config-migration.test.ts tests/init-skeleton.test.ts tests/project-types.test.ts tests/project-discovery-composition.test.ts`

Expected: FAIL because 1.3.0 is still current, no adjacent upgrade exists, and initialization emits v1.3.0.

- [ ] **Step 3: Implement the adjacent pure upgrade**

Add and export:

```ts
export function upgradeProjectConfigurationV1_4(
  source: ProjectConfigV1_3,
): ProjectConfigV1_4 {
  return {
    ...source,
    contractVersion: "1.4.0",
    stateContract: "1.4.0",
    hostContract: "1.3.0",
    language: { ...source.language },
    managedState: { ...source.managedState },
    gateModes: {},
    projectProfile: structuredClone(source.projectProfile),
  };
}
```

Update earlier migration branches to finish with this new adjacent function.

- [ ] **Step 4: Extend explicit configuration migration**

Change `observeConfig` so 1.4.0 is current and 1.0.0 through 1.3.0 are accepted only as migration sources. Add a dedicated 1.3.0 branch:

```ts
const legacy = source.value as ProjectConfigV1_3;
hosts = configuredHosts(legacy.modelRoles);
answersAuthority = { ref: "config", sha256: entry.sha256 };
defaulted = [];
destination = upgradeProjectConfigurationV1_4(legacy);
```

Do not request migration answers for 1.3.0. Keep the existing preview, digest authorization, backup, transaction, receipt, and rollback flow unchanged.

- [ ] **Step 5: Emit current configuration from initialization**

Change the skeleton's config type and constants to 1.4.0, retain host 1.3.0, and add:

```ts
gateModes: {},
```

Update current-config test fixtures and type assertions; do not edit predecessor fixture files.

- [ ] **Step 6: Run migration GREEN tests**

Run: `npx vitest run tests/project-configuration.test.ts tests/config-migration.test.ts tests/init-skeleton.test.ts tests/project-types.test.ts tests/project-discovery-composition.test.ts`

Expected: PASS; 1.3.0 requires migration, the authorized migration writes only config plus its existing audit transaction artifacts, and new initialization writes 1.4.0 with an empty override map.

- [ ] **Step 7: Commit migration and initialization**

```bash
git add packages/runtime/src/domain/project packages/runtime/src/domain/migration packages/runtime/src/composition/migration.ts packages/runtime/src/domain/init/skeleton.ts packages/runtime/src/composition/workflow.ts tests/project-configuration.test.ts tests/config-migration.test.ts tests/init-skeleton.test.ts tests/project-types.test.ts tests/project-discovery-composition.test.ts
git commit -m "feat(migration): add per-gate policy defaults"
```

---

### Task 4: Publish and enforce event gate-failure traces

**Files:**

- Create: `schemas/state/event.v1.2.schema.json`
- Create: `fixtures/contracts/v1.2/event.json`
- Create: `tests/event-gate-failures.test.ts`
- Modify: `packages/contracts/catalogs/contract-families.v1.json`
- Modify: `packages/contracts/src/compatibility.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/generated/contracts.ts` through generation
- Modify: `packages/runtime/src/domain/schema/contracts.ts`
- Modify: `packages/runtime/src/infra/schema/catalog.ts`
- Modify: `packages/runtime/src/domain/events/model.ts`
- Modify: `packages/runtime/src/domain/events/redaction.ts`
- Modify: `packages/runtime/src/domain/events/semantics.ts`
- Modify: `packages/runtime/src/domain/locks/lifecycle.ts`
- Modify: `tests/event-chain-properties.test.ts`
- Modify: `tests/event-chain.test.ts`
- Modify: `tests/event-reducer-boundary.test.ts`
- Modify: `tests/event-reducer-properties.test.ts`
- Modify: `tests/event-reducer.test.ts`
- Modify: `tests/event-sealing.test.ts`
- Modify: `tests/event-store-corruption.test.ts`
- Modify: `tests/event-store-fault-campaign.test.ts`
- Modify: `tests/event-store-preparation.test.ts`
- Modify: `tests/event-store-transaction.test.ts`
- Modify: `tests/node-event-store.test.ts`
- Modify: `tests/runtime-composition.test.ts`

**Interfaces:**

- Produces: `EventV1_2` and makes it the current event type.
- Produces: required `gateFailures: GateFailureV1_2[]` on every new event.
- Consumes: `compareGateFailures`, `GATE_PRIORITIES`, and the closed gate/reason mapping from Task 1.

- [ ] **Step 1: Write event-contract and semantic RED tests**

Create tests for a valid current event, unsafe/oversized detail, duplicate IDs, wrong priority, invalid reason pairing, wrong order, and a mixed stream containing v1.0, v1.1, and v1.2. Use this valid trace:

```ts
const gateFailures = [
  {
    gateId: "stop-loss",
    reasonCode: "blocked.stop_loss_flag",
    mode: "enforce",
    priority: 20,
    evidenceRefs: [".brain/03-memory/task_metrics.md"],
    detail: null,
  },
  {
    gateId: "gaps-closed",
    reasonCode: "gate.gaps_abertos",
    mode: "shadow",
    priority: 50,
    evidenceRefs: [".brain/02-features/active"],
    detail: null,
  },
] as const;
```

- [ ] **Step 2: Run event RED tests**

Run: `npx vitest run tests/event-gate-failures.test.ts tests/event-sealing.test.ts tests/event-chain.test.ts tests/event-chain-properties.test.ts tests/schema-catalog.test.ts tests/schema-registry-types.test.ts`

Expected: FAIL because event 1.2.0, its generated type, and safe snapshot handling are absent.

- [ ] **Step 3: Add and register event 1.2.0**

Copy event v1.1 into a new authored schema without changing v1.1. Require `gateFailures`, bound it to `maxItems: 8`, and define each closed item with the six approved fields. Use the closed gate IDs, closed reason-code enum, three modes, safe integer priority, at most 16 unique safe references, and `detail` as null or a safe string of at most 4096 characters.

Register the schema/fixture, set `CONTRACT_VERSIONS["state.event"]` to 1.2.0, generate declarations, and extend readable/current aliases and registry unions.

- [ ] **Step 4: Snapshot gate failures without invoking untrusted behavior**

Add `gateFailures` to `DRAFT_KEYS` and implement a bounded copier using the existing plain-record, exact-key, data-property, proxy, and array guards:

```ts
function copyGateFailure(value: unknown, isProxy: EventServices["isProxy"]): GateFailureV1_2 {
  const failure = requirePlainRecord(value, isProxy);
  requireExactKeys(failure, [
    "gateId", "reasonCode", "mode", "priority", "evidenceRefs", "detail",
  ]);
  const detail = requireDataValue(failure, "detail");
  if (typeof detail !== "string" && detail !== null) invalidEvent();
  return {
    gateId: requireString(failure, "gateId") as GateFailureV1_2["gateId"],
    reasonCode: requireString(failure, "reasonCode") as GateFailureV1_2["reasonCode"],
    mode: requireString(failure, "mode") as GateFailureV1_2["mode"],
    priority: requireRevision(failure, "priority"),
    evidenceRefs: copyReferences(requireDataValue(failure, "evidenceRefs"), isProxy),
    detail,
  };
}
```

The array copier must cap length at `GATE_IDS.length`, reject sparse/accessor arrays, and return fresh plain records and arrays.

- [ ] **Step 5: Add semantic trace validation**

In event semantics, for v1.2 events:

```ts
const ids = event.gateFailures.map(({ gateId }) => gateId);
if (new Set(ids).size !== ids.length) throw new Error("invalid event semantics");
if (event.gateFailures.some((failure) =>
  failure.priority !== GATE_PRIORITIES[failure.gateId] ||
  !GATE_REASON_CODES[failure.gateId].includes(failure.reasonCode)
)) throw new Error("invalid event semantics");
if (event.gateFailures.some((failure, index, failures) =>
  index > 0 && compareGateFailures(failures[index - 1]!, failure) > 0
)) throw new Error("invalid event semantics");
if (!event.operation.startsWith("sdd.continue:") && event.gateFailures.length > 0) {
  throw new Error("invalid event semantics");
}
```

- [ ] **Step 6: Update every current event producer and typed test draft**

Make workflow and lock event producers emit event 1.2.0 and `gateFailures: []` until Task 5 supplies workflow traces. Update event test drafts, golden current event fixture, protected-scalar property coverage, current type imports, and expected hashes. Do not modify `fixtures/contracts/v1/event.json`, `fixtures/contracts/v1.1/event.json`, or `tests/fixtures/events/golden-event-v1.1.json`.

- [ ] **Step 7: Run event GREEN and contract checks**

Run: `npx vitest run tests/event-gate-failures.test.ts tests/event-sealing.test.ts tests/event-chain.test.ts tests/event-chain-properties.test.ts tests/event-reducer-properties.test.ts tests/event-store-corruption.test.ts tests/schema-catalog.test.ts tests/schema-registry-types.test.ts tests/contract-type-generation.test.ts`

Expected: PASS with mixed-version streams readable, new events sealed as 1.2.0, and semantic forgeries rejected.

- [ ] **Step 8: Commit the event contract slice**

```bash
git add schemas/state/event.v1.2.schema.json fixtures/contracts/v1.2/event.json packages/contracts/catalogs/contract-families.v1.json packages/contracts/src/compatibility.ts packages/contracts/src/index.ts packages/contracts/src/generated/contracts.ts packages/runtime/src/domain/schema/contracts.ts packages/runtime/src/infra/schema/catalog.ts packages/runtime/src/domain/events packages/runtime/src/domain/locks/lifecycle.ts tests/event-gate-failures.test.ts tests/event-chain-properties.test.ts tests/event-chain.test.ts tests/event-reducer-boundary.test.ts tests/event-reducer-properties.test.ts tests/event-reducer.test.ts tests/event-sealing.test.ts tests/event-store-corruption.test.ts tests/event-store-fault-campaign.test.ts tests/event-store-preparation.test.ts tests/event-store-transaction.test.ts tests/node-event-store.test.ts tests/runtime-composition.test.ts tests/schema-catalog.test.ts tests/schema-registry-types.test.ts tests/contract-type-generation.test.ts
git commit -m "feat(events): record effective gate failure modes"
```

---

### Task 5: Propagate mixed decisions through workflow and approvals

**Files:**

- Modify: `packages/runtime/src/composition/workflow.ts`
- Modify: `packages/runtime/src/domain/cli/spec.ts`
- Modify: `packages/runtime/src/domain/cli/workflow.ts`
- Modify: `packages/runtime/src/domain/workflow/model.ts`
- Modify: `packages/runtime/src/domain/workflow/decision.ts`
- Modify: `packages/runtime/src/domain/acceptance/index.ts`
- Modify: `tests/workflow-state-machine.test.ts`
- Modify: `tests/gate-facts.test.ts`
- Modify: `tests/gap-records.test.ts`
- Modify: `tests/acceptance.test.ts`
- Modify: `tests/gates-approvals-evidence.test.ts`

**Interfaces:**

- Changes: workflow observation carries `defaultGateMode: GateMode` and the complete `GateDecision`.
- Changes: `ContinueWorkflowRequest` carries `gateDecision` separately from non-gate `rejectionReasons`.
- Produces: `approvalModeFor(target, defaultMode, gateModes): GateMode`.
- Consumes: the current event's structured `gateFailures`.

- [ ] **Step 1: Write mixed workflow and approval RED tests**

Add integration cases that assert:

```ts
expect(shadowAndEnforce.gateDecision.outcome).toBe("block");
expect(shadowAndEnforce.gateDecision.primary?.gateId).toBe("spec-approved");
expect(rejected.event.gateFailures.map(({ mode }) => mode)).toEqual([
  "enforce",
  "shadow",
]);

expect(warnAccepted.transition).toBe("accepted");
expect(warnAccepted.event.gateFailures[0]?.mode).toBe("warn");

expect(shadowAccepted.transition).toBe("accepted");
expect(shadowAccepted.event.gateFailures[0]?.mode).toBe("shadow");
```

Add approval assertions proving a `gaps-closed` override does not change a spec challenge, while a `spec-approved` override does.

- [ ] **Step 2: Run workflow RED tests**

Run: `npx vitest run tests/workflow-state-machine.test.ts tests/gate-facts.test.ts tests/gap-records.test.ts tests/acceptance.test.ts tests/gates-approvals-evidence.test.ts`

Expected: FAIL because composition still supplies a global mode, workflow rejects on any failure list, and events contain empty traces.

- [ ] **Step 3: Resolve policy once in composition**

Change the policy observation to:

```ts
interface ObservedGatePolicy {
  readonly readable: boolean;
  readonly defaultMode: GateMode;
  readonly gateModes: GateModes;
}
```

For valid config, call `resolveGateModes(config.policyMode, config.gateModes)`. For an unreadable config, return `defaultMode: "enforce"` and `resolveGateModes("strict", {})`. Pass `gateModes` into the evaluator and retain `defaultGateMode` only for legacy single-mode lineage fields.

- [ ] **Step 4: Bind approvals to the authorized gate mode**

Add this pure selector in the gate policy module or composition-local policy boundary:

```ts
export function approvalModeFor(
  target: string,
  defaultMode: GateMode,
  gateModes: GateModes,
): GateMode {
  if (target === "spec") return gateModes["spec-approved"];
  if (target === "final-acceptance") return gateModes["final-acceptance"];
  return Object.hasOwn(gateModes, target)
    ? gateModes[target as GateId]
    : defaultMode;
}
```

Use it for both validation and generation of `approvalChallenge`. Preserve the canonical challenge key `policyMode` and the existing challenge algorithm.

- [ ] **Step 5: Separate gate decisions from rejection reasons**

Change `ContinueWorkflowRequest` so every action can carry the evaluated trace at the top level:

```ts
export interface ContinueWorkflowRequest {
  // existing identity, revision, and execution fields
  readonly gateDecision: Pick<GateDecision, "outcome" | "failures">;
  readonly action:
    | {
        readonly kind: "complete-phase";
        readonly artifactRefs: readonly string[];
        readonly evidenceRefs: readonly string[];
        readonly rejectionReasons: readonly string[];
        readonly allowFinalCompletion: boolean;
      }
    | { readonly kind: "resume" }
    | { readonly kind: "reject"; readonly artifactRefs: readonly string[]; readonly evidenceRefs: readonly string[] };
}
```

`decideContinueWorkflow` rejects completion when `gateDecision.outcome === "block"` or a non-gate rejection reason exists. Every recorded continue event copies `request.gateDecision.failures` into `event.gateFailures`, even when the transition is accepted. The `--gate-failure` compatibility flag remains a non-gate rejection reason because user input is not an evaluated `GateFailure`.

- [ ] **Step 6: Make final acceptance outcome-aware**

Replace the current `candidate.gates.failures.length > 0` refusal with:

```ts
if (candidate.gates.outcome === "block") {
  return {
    kind: "refused",
    reasonCode: "trail.gate_divergente",
    evidenceRefs: [
      ...evidenceRefs,
      ...candidate.gates.failures.flatMap(({ evidenceRefs: refs }) => refs),
    ],
  };
}
```

In `doneCommand`, make selection of the bound final approval use the same
outcome rule:

```ts
const accepted =
  finalApproval !== undefined &&
  observation.gateDecision.outcome !== "block" &&
  observation.approvalChallenge !== null;
```

This allows shadow and warn findings to remain recorded while final acceptance continues. For a blocked completion, build `why` from the already ordered gate failures so its first gate is exactly `gateDecision.primary`.

- [ ] **Step 7: Run workflow GREEN tests**

Run: `npx vitest run tests/workflow-state-machine.test.ts tests/gate-facts.test.ts tests/gap-records.test.ts tests/acceptance.test.ts tests/gates-approvals-evidence.test.ts tests/architecture.test.ts`

Expected: PASS; enforced failures block, warn/shadow failures advance and persist, primary belongs to the aggregate outcome, and approval challenge compatibility is exact.

- [ ] **Step 8: Commit workflow and approval propagation**

```bash
git add packages/runtime/src/composition/workflow.ts packages/runtime/src/domain/cli/spec.ts packages/runtime/src/domain/cli/workflow.ts packages/runtime/src/domain/workflow packages/runtime/src/domain/acceptance/index.ts tests/workflow-state-machine.test.ts tests/gate-facts.test.ts tests/gap-records.test.ts tests/acceptance.test.ts tests/gates-approvals-evidence.test.ts
git commit -m "feat(workflow): aggregate mixed gate outcomes"
```

---

### Task 6: Update observability and prove host-neutral compatibility

**Files:**

- Modify: `packages/runtime/src/domain/observability/index.ts`
- Modify: `packages/runtime/src/domain/cli/diagnostics.ts`
- Modify: `packages/runtime/src/domain/cli/workflow.ts`
- Modify: `tests/observability.test.ts`
- Modify: `tests/doctor-command.test.ts`
- Modify: `tests/host-adapter-contract.test.ts`
- Modify: `tests/cli-narrate.test.ts`
- Modify: `tests/narration-projection.test.ts` only if its gate fixture uses the old decision shape
- Modify: current config and event fixtures in affected command tests

**Interfaces:**

- Consumes: `GateDecision.gateModes` and `GateFailure.mode`.
- Produces: dashboard rows that render each failure's own mode.
- Preserves: identical normalized host results for Claude Code and Codex.

- [ ] **Step 1: Write observability and parity RED tests**

Change dashboard expectations from the removed decision-wide mode to per-row modes:

```ts
expect(html).toContain("<td>gaps-closed</td><td>gate.gaps_abertos</td><td>shadow</td>");
expect(html).toContain("<td>spec-approved</td><td>gate.aprovacao_spec</td><td>enforce</td>");
```

Add a host conformance scenario with the same mixed decision delivered through both adapter factories and assert byte-equivalent normalized payloads.

- [ ] **Step 2: Run projection RED tests**

Run: `npx vitest run tests/observability.test.ts tests/doctor-command.test.ts tests/host-adapter-contract.test.ts tests/cli-narrate.test.ts tests/narration-projection.test.ts`

Expected: FAIL where consumers still read `GateDecision.mode` or old fixtures omit `gateModes`/`mode`.

- [ ] **Step 3: Render the effective per-failure policy**

Change each dashboard gate row to:

```ts
`<tr><td>${html(gate.gateId)}</td><td>${html(gate.reasonCode)}</td><td>${html(gate.mode)}</td></tr>`
```

Replace the ambiguous page-level value with the literal label `Policy: per-gate.` and keep the per-row table as the detailed policy trace. Keep diagnostics status derived from aggregate `outcome`.

- [ ] **Step 4: Update current fixtures and host-neutral projections**

Add total `gateModes` to every current `GateDecision` fixture and `mode` to every failure fixture. Add `gateFailures: []` to every current event fixture created in code. Preserve narration reason codes and prose unless a test proves the old prose claims one global mode.

- [ ] **Step 5: Run projection GREEN tests and typecheck**

Run: `npx vitest run tests/observability.test.ts tests/doctor-command.test.ts tests/host-adapter-contract.test.ts tests/cli-narrate.test.ts tests/narration-projection.test.ts && npm run typecheck`

Expected: PASS with no remaining typed read of `GateDecision.mode` and equal Claude/Codex normalized output.

- [ ] **Step 6: Commit projections and parity**

```bash
git add packages/runtime/src/domain/observability/index.ts packages/runtime/src/domain/cli/diagnostics.ts packages/runtime/src/domain/cli/workflow.ts tests/observability.test.ts tests/doctor-command.test.ts tests/host-adapter-contract.test.ts tests/cli-narrate.test.ts tests/narration-projection.test.ts
git commit -m "feat(observability): render per-gate policy modes"
```

---

### Task 7: Document behavior, attach evidence, and run full verification

**Files:**

- Modify: `docs/architecture/gates-approvals-evidence.md`
- Modify: `docs/architecture/event-store.md`
- Modify: `docs/compatibility/contract-versioning.md`
- Modify: `docs/user/configuration-and-state.md`
- Modify: `docs/user/migration-and-recovery.md`
- Modify: `schemas/README.md`
- Create: `docs/verification/issue-143-per-gate-policy-modes-evidence.md`
- Modify: `tests/contract-documentation.test.ts`

**Interfaces:**

- Documents: exact default/override resolution, mixed aggregation, primary selection, event history, migration, approval binding, host neutrality, and recovery.
- Produces: one evidence row per acceptance criterion and the exact verification transcript summary.

- [ ] **Step 1: Add documentation-contract RED assertions**

Extend `tests/contract-documentation.test.ts` to require all of these literal concepts in public docs:

```ts
for (const phrase of [
  "gateModes",
  "gaps-closed",
  "shadow",
  "warn",
  "enforce",
  "state.event@1.2.0",
  "state.project-config@1.4.0",
]) {
  expect(documentation).toContain(phrase);
}
```

- [ ] **Step 2: Run documentation RED test**

Run: `npx vitest run tests/contract-documentation.test.ts`

Expected: FAIL because the published docs still describe one project-wide gate mode and event 1.1.0 as current.

- [ ] **Step 3: Update public architecture, compatibility, and user guidance**

Document the exact JSON configuration example, inheritance table, severity ordering, primary rule, shadow/warn continuation, enforced blocking, event trace fields, 1.3.0-to-1.4.0 migration, mixed event readability, and gate-specific approval binding. State explicitly that prompts and hosts do not decide or override modes.

- [ ] **Step 4: Run every narrow affected suite together**

Run:

```bash
npx vitest run \
  tests/gate-policy-modes.test.ts \
  tests/gates-approvals-evidence.test.ts \
  tests/project-configuration.test.ts \
  tests/config-migration.test.ts \
  tests/contract-compatibility.test.ts \
  tests/contract-schemas.test.ts \
  tests/event-gate-failures.test.ts \
  tests/event-sealing.test.ts \
  tests/event-chain.test.ts \
  tests/workflow-state-machine.test.ts \
  tests/gate-facts.test.ts \
  tests/gap-records.test.ts \
  tests/acceptance.test.ts \
  tests/observability.test.ts \
  tests/host-adapter-contract.test.ts \
  tests/contract-documentation.test.ts
```

Expected: PASS with zero failed tests.

- [ ] **Step 5: Run full repository verification**

Run: `npm run verify`

Expected: exit 0 across formatting, spelling, English, lint, typecheck, unit tests, coverage, mutation checks, gap calibration, performance checks, oracle, parity, result contracts, contract generation checks, differential checks, build, package verification, and benchmarks.

- [ ] **Step 6: Write the acceptance evidence from observed output**

Create `docs/verification/issue-143-per-gate-policy-modes-evidence.md` with:

```markdown
# Issue #143 per-gate policy mode evidence

## Impact

- Compatibility: legacy policy defaults resolve identically after explicit migration; prior events remain readable and byte-preserved.
- State: project configuration advances to 1.4.0 and new events to 1.2.0; no historical event is rewritten.
- Security: unreadable policy remains fail-closed, approval challenges bind the authorized gate's effective mode, and hosts gain no policy authority.

## Acceptance evidence

| Criterion | Test evidence |
| --- | --- |
| Shadow records while enforce blocks in the same evaluation | `gate-policy-modes`, `workflow-state-machine` |
| Primary selected from the deciding outcome | `gate-policy-modes` mixed-primary case |
| Equal-outcome ordering is unchanged | `gate-policy-modes` stable-order case |
| Every recorded failure carries its mode | `event-gate-failures`, `workflow-state-machine` |
| Legacy global configuration preserves behavior | `config-migration`, canonical decision comparison |
| Evaluator remains pure | `architecture` |

## Verification

- `npx vitest run tests/gate-policy-modes.test.ts tests/gates-approvals-evidence.test.ts tests/project-configuration.test.ts tests/config-migration.test.ts tests/contract-compatibility.test.ts tests/contract-schemas.test.ts tests/event-gate-failures.test.ts tests/event-sealing.test.ts tests/event-chain.test.ts tests/workflow-state-machine.test.ts tests/gate-facts.test.ts tests/gap-records.test.ts tests/acceptance.test.ts tests/observability.test.ts tests/host-adapter-contract.test.ts tests/contract-documentation.test.ts` — PASS
- `npm run verify` — PASS
```

Record the observed test counts and duration beside both commands. Do not claim remote CI until the actual CI run is green.

- [ ] **Step 7: Re-run documentation and cleanliness checks**

Run: `npx prettier --check . && npx cspell --gitignore-root . --no-progress --show-suggestions "**/*.md" && git diff --check && git status --short`

Expected: all checks pass; status lists only intended source, test, fixture, generated, documentation, and evidence changes.

- [ ] **Step 8: Commit documentation and evidence**

```bash
git add docs/architecture/gates-approvals-evidence.md docs/architecture/event-store.md docs/compatibility/contract-versioning.md docs/user/configuration-and-state.md docs/user/migration-and-recovery.md docs/verification/issue-143-per-gate-policy-modes-evidence.md schemas/README.md tests/contract-documentation.test.ts
git commit -m "docs: document per-gate policy compatibility"
```

- [ ] **Step 9: Prepare pull-request text without publishing it**

Draft English PR text that includes `Closes #143`, compatibility/state/security impact from the evidence document, every exact verification command, and one evidence bullet for every acceptance criterion. Publishing or opening the PR requires the repository's normal integration workflow and is not part of this implementation plan.
