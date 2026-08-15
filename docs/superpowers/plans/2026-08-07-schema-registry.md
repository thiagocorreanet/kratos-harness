# Schema Registry and Validation Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one embedded, version-aware schema registry with typed validation,
stable sanitized diagnostics, canonical JSON serialization, and production
project-configuration integration for issue #19.

**Architecture:** The domain owns closed contract identifiers, typed result
vocabulary, canonical JSON, and boundary preparation. Infrastructure embeds and
compiles the committed schemas with Ajv. Composition adapts the registry to
project discovery and later persistence/adapter boundaries without exposing Ajv
to domain or ports.

**Tech Stack:** TypeScript 6.0.2, Node.js 24.18.0, npm 11.16.0, Ajv 8.20.0,
Vitest 4.1.10, esbuild 0.28.1, JSON Schema 2020-12.

## Global Constraints

- Use Node.js `24.18.0` and npm `11.16.0` exactly before running any npm command.
- Run `npm ci`, not `npm install`, in the clean issue worktree before the first
  test.
- Keep all repository source, tests, fixtures, comments, errors,
  documentation, commits, and PR text in English.
- Follow strict TDD: add one failing behavior, observe the expected failure,
  implement the minimum, and rerun focused plus affected tests.
- Use only committed, embedded schemas. No runtime filesystem discovery,
  checkout-relative read, dynamic schema registration, or network access.
- Do not coerce, default, clone, remove properties from, or otherwise mutate a
  validated value.
- Do not add or change a public reason code, schema, compatibility window, or
  legacy profile.
- Preserve the three-file plugin distribution and no-external-import package
  contract.
- Preserve `0 / 400 (0.00%)` parity until dedicated differential and end-to-end
  evidence exists.
- End every independently green task with a DCO sign-off commit (`git commit
  -s`).

---

### Task 1: Define the closed registry vocabulary

**Files:**

- Create: `packages/runtime/src/domain/schema/contracts.ts`
- Create: `packages/runtime/src/domain/schema/validation.ts`
- Create: `packages/runtime/src/domain/schema/index.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/schema-registry-types.test.ts`
- Test: `tests/package-boundaries.test.ts`

**Interfaces:**

- Consumes: `AdapterMessageV1`, `ApprovalV1`, `EventV1`, `EvidenceV1`,
  `LockLeaseV1`, `MigrationV1`, `ProjectConfigV1`, and `SnapshotV1` from
  `@mestre-yoda/contracts`.
- Produces: `ContractId`, `ContractValue<I>`, `StructuralReasonCode`,
  `ContractRequest<I>`, `ValidationDiagnostic`, `ValidationResult<T>`, and
  `SchemaRegistry` from `@mestre-yoda/runtime/domain/schema`.

- [ ] **Step 1: Write the failing public-type test**

Create `tests/schema-registry-types.test.ts` with compile-time and runtime
assertions for the closed identifier map:

```ts
import type { ProjectConfigV1 } from "@mestre-yoda/contracts";
import type {
  ContractId,
  ContractRequest,
  ContractValue,
  SchemaRegistry,
  StructuralReasonCode,
  ValidationDiagnostic,
  ValidationResult,
} from "@mestre-yoda/runtime/domain/schema";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("schema registry vocabulary", () => {
  it("maps every closed contract identifier to one generated type", () => {
    const ids = [
      "host.adapter-message",
      "state.approval",
      "state.event",
      "state.evidence",
      "state.lock",
      "state.migration",
      "state.project-config",
      "state.snapshot",
    ] as const satisfies readonly ContractId[];
    expect(ids).toHaveLength(8);
    expectTypeOf<ContractValue<"state.project-config">>().toEqualTypeOf<ProjectConfigV1>();
  });

  it("requires the caller to select an existing structural failure policy", () => {
    const policies = [
      "guard.config_corrupt",
      "runtime.state_corrupt",
      "trail.uso",
      "trail.output_invalido",
    ] as const satisfies readonly StructuralReasonCode[];
    expect(policies).toHaveLength(4);
  });

  it("keeps unknown input outside the typed domain until validation", () => {
    const request: ContractRequest<"state.project-config"> = {
      id: "state.project-config",
      version: "1.0.0",
      value: { untrusted: true },
      structuralReasonCode: "guard.config_corrupt",
    };
    const registry = null as unknown as SchemaRegistry;
    expectTypeOf(registry.validate(request)).toEqualTypeOf<
      ValidationResult<ProjectConfigV1>
    >();
    expectTypeOf<ValidationDiagnostic>().toHaveProperty("pointer");
  });
});
```

- [ ] **Step 2: Verify the type test fails because the export is absent**

Run:

```bash
npx vitest run tests/schema-registry-types.test.ts
npm run typecheck
```

Expected: FAIL because `@mestre-yoda/runtime/domain/schema` is not exported.

- [ ] **Step 3: Add the minimal closed type map and registry interface**

Create `contracts.ts` with the exact identifier-to-type mapping:

```ts
import type {
  AdapterMessageV1,
  ApprovalV1,
  EventV1,
  EvidenceV1,
  LockLeaseV1,
  MigrationV1,
  ProjectConfigV1,
  SnapshotV1,
} from "@mestre-yoda/contracts";

export interface ContractValues {
  readonly "host.adapter-message": AdapterMessageV1;
  readonly "state.approval": ApprovalV1;
  readonly "state.event": EventV1;
  readonly "state.evidence": EvidenceV1;
  readonly "state.lock": LockLeaseV1;
  readonly "state.migration": MigrationV1;
  readonly "state.project-config": ProjectConfigV1;
  readonly "state.snapshot": SnapshotV1;
}

export type ContractId = keyof ContractValues;
export type ContractValue<I extends ContractId> = ContractValues[I];
export type StructuralReasonCode =
  | "guard.config_corrupt"
  | "runtime.state_corrupt"
  | "trail.uso"
  | "trail.output_invalido";
```

Create `validation.ts`:

```ts
import type {
  ContractId,
  ContractValue,
  StructuralReasonCode,
} from "./contracts.js";

export interface ContractRequest<I extends ContractId> {
  readonly id: I;
  readonly version: unknown;
  readonly value: unknown;
  readonly structuralReasonCode: StructuralReasonCode;
}

export interface ValidationDiagnostic {
  readonly contract: ContractId;
  readonly version: string | null;
  readonly pointer: string;
  readonly keyword: string;
  readonly reasonCode: string;
  readonly recovery: string;
}

export type ValidationResult<T> =
  | { readonly kind: "valid"; readonly value: T }
  | {
      readonly kind: "invalid";
      readonly diagnostics: readonly ValidationDiagnostic[];
    };

export interface SchemaRegistry {
  validate<I extends ContractId>(
    request: ContractRequest<I>,
  ): ValidationResult<ContractValue<I>>;
}
```

Re-export these declarations from `domain/schema/index.ts`, then add:

```json
"./domain/schema": "./src/domain/schema/index.ts"
```

to the runtime package exports.

- [ ] **Step 4: Verify the vocabulary and package boundary are green**

Run:

```bash
npx vitest run tests/schema-registry-types.test.ts tests/package-boundaries.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the public vocabulary**

```bash
git add packages/runtime/src/domain/schema packages/runtime/package.json tests/schema-registry-types.test.ts tests/package-boundaries.test.ts
git commit -s -m "feat: define the schema registry vocabulary"
```

### Task 2: Implement strict canonical JSON

**Files:**

- Create: `packages/runtime/src/domain/schema/canonical-json.ts`
- Modify: `packages/runtime/src/domain/schema/index.ts`
- Test: `tests/canonical-json.test.ts`
- Test: `tests/canonical-json-properties.test.ts`

**Interfaces:**

- Consumes: unknown JavaScript values.
- Produces: `canonicalizeJson(value: unknown): string` and
  `CanonicalJsonError`, with no Node, Ajv, or infrastructure dependency.

- [ ] **Step 1: Write failing example and property tests**

Create `tests/canonical-json.test.ts` with one assertion per supported behavior:

```ts
import {
  CanonicalJsonError,
  canonicalizeJson,
} from "@mestre-yoda/runtime/domain/schema";
import { describe, expect, it } from "vitest";

describe("canonical JSON", () => {
  it("sorts object keys recursively and preserves array order", () => {
    expect(canonicalizeJson({ z: 1, a: { y: 2, x: [3, 1] } })).toBe(
      '{"a":{"x":[3,1],"y":2},"z":1}',
    );
  });

  it.each([
    [null, "null"],
    [true, "true"],
    [-0, "0"],
    ["café\n", '"café\\n"'],
  ])("serializes %j deterministically", (value, expected) => {
    expect(canonicalizeJson(value)).toBe(expected);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, Symbol("x"), () => 1])(
    "rejects unsupported scalar %s without exposing it",
    (value) => {
      expect(() => canonicalizeJson(value)).toThrow(CanonicalJsonError);
      expect(() => canonicalizeJson(value)).toThrow("Value is not canonical JSON");
    },
  );

  it("rejects unsupported properties, sparse arrays, and cycles", () => {
    expect(() => canonicalizeJson({ safe: 1, rejected: undefined })).toThrow(
      CanonicalJsonError,
    );
    expect(() => canonicalizeJson(Array(1))).toThrow(CanonicalJsonError);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalizeJson(cycle)).toThrow(CanonicalJsonError);
  });
});
```

Create `tests/canonical-json-properties.test.ts` with a fixed-seed generator that
produces 200 nested JSON values. Generate null, booleans, finite safe integers,
Unicode strings, arrays, and objects up to depth four. For each value assert:

```ts
const encoded = canonicalizeJson(value);
expect(canonicalizeJson(JSON.parse(encoded) as unknown)).toBe(encoded);
expect(canonicalizeJson(reverseObjectInsertionOrder(value))).toBe(encoded);
```

`reverseObjectInsertionOrder` must preserve arrays and recursively rebuild
object keys in reverse insertion order.

- [ ] **Step 2: Verify both canonicalizer tests fail for the missing API**

Run:

```bash
npx vitest run tests/canonical-json.test.ts tests/canonical-json-properties.test.ts
```

Expected: FAIL because `canonicalizeJson` and `CanonicalJsonError` do not exist.

- [ ] **Step 3: Implement the smallest recursive canonicalizer**

Implement a recursive encoder that tracks active containers in a `WeakSet`,
uses `Object.keys(value).sort()` for object keys, verifies every array index with
`Object.hasOwn`, serializes finite numbers through `JSON.stringify`, and throws
only:

```ts
export class CanonicalJsonError extends Error {
  public constructor() {
    super("Value is not canonical JSON");
    this.name = "CanonicalJsonError";
  }
}
```

Do not call `JSON.stringify` on whole objects, because it silently omits
unsupported object members and rewrites sparse or unsupported array members to
`null`.

- [ ] **Step 4: Verify examples and properties pass**

Run:

```bash
npx vitest run tests/canonical-json.test.ts tests/canonical-json-properties.test.ts
```

Expected: PASS. If a property fails, implement only the demonstrated missing
edge and rerun until the examples and properties are both green.

- [ ] **Step 5: Rerun all schema-domain checks**

Run:

```bash
npx vitest run tests/canonical-json.test.ts tests/canonical-json-properties.test.ts tests/schema-registry-types.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit canonical JSON**

```bash
git add packages/runtime/src/domain/schema tests/canonical-json.test.ts tests/canonical-json-properties.test.ts
git commit -s -m "feat: add strict canonical JSON serialization"
```

### Task 3: Build and integrity-check the embedded schema catalog

**Files:**

- Create: `packages/runtime/src/infra/schema/catalog.ts`
- Create: `packages/runtime/src/infra/schema/types.ts`
- Create: `packages/runtime/src/infra/schema/index.ts`
- Modify: `packages/runtime/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/schema-catalog.test.ts`
- Test: `tests/architecture.test.ts`

**Interfaces:**

- Consumes: `contract-families.v1.json`, the eight registered current schemas,
  and `schemas/result.v1.schema.json` as the adapter-message dependency.
- Produces: immutable `EMBEDDED_SCHEMA_CATALOG`, `EmbeddedSchemaEntry`, and
  `assertSchemaCatalog(entries): void` inside infrastructure.

- [ ] **Step 1: Write failing catalog completeness and integrity tests**

Create `tests/schema-catalog.test.ts`:

```ts
import manifest from "../packages/contracts/catalogs/contract-families.v1.json" with { type: "json" };
import {
  EMBEDDED_SCHEMA_CATALOG,
  assertSchemaCatalog,
} from "@mestre-yoda/runtime/infra/schema";
import { describe, expect, it } from "vitest";

describe("embedded schema catalog", () => {
  it("contains every and only current state and host manifest entry", () => {
    expect(
      EMBEDDED_SCHEMA_CATALOG.map(({ id, version }) => ({ id, version })),
    ).toEqual(manifest.schemas.map(({ id, version }) => ({ id, version })));
  });

  it("rejects duplicate keys and inconsistent metadata", () => {
    const first = EMBEDDED_SCHEMA_CATALOG[0];
    if (first === undefined) throw new Error("catalog fixture unavailable");
    expect(() => assertSchemaCatalog([...EMBEDDED_SCHEMA_CATALOG, first])).toThrow(
      "Embedded schema catalog is inconsistent",
    );
    expect(() =>
      assertSchemaCatalog([{ ...first, version: "9.9.9" }]),
    ).toThrow("Embedded schema catalog is inconsistent");
  });
});
```

Extend `tests/architecture.test.ts` with a fixture proving a domain import of
`ajv`, a schema JSON path, or `../infra/schema/index.js` is rejected. Add `ajv`
and `schemas/` as explicit forbidden domain targets in
`tests/support/architecture.ts`; do not rely only on the existing generic infra
rule.

- [ ] **Step 2: Verify catalog and architecture tests fail**

Run:

```bash
npx vitest run tests/schema-catalog.test.ts tests/architecture.test.ts
```

Expected: FAIL because the infrastructure export and schema-specific
architecture rule do not exist.

- [ ] **Step 3: Move Ajv to the runtime dependency boundary**

Add exact `"ajv": "8.20.0"` to `packages/runtime/package.json` dependencies.
Keep the root dev dependency because repository contract scripts and tests import
Ajv directly. Run `npm install --package-lock-only --ignore-scripts` under the
pinned toolchain so the lockfile records the workspace production edge without
changing any version.

- [ ] **Step 4: Implement the literal embedded catalog**

Define `EmbeddedSchemaEntry` as:

```ts
export interface EmbeddedSchemaEntry {
  readonly id: ContractId;
  readonly family: "state" | "host";
  readonly version: string;
  readonly path: string;
  readonly schema: object;
}
```

Import the eight schema JSON documents with JSON import attributes. Preserve
manifest order in `EMBEDDED_SCHEMA_CATALOG`. Import the result schema separately
as `EMBEDDED_SCHEMA_DEPENDENCIES`, because it resolves the adapter-message
external `$ref` but is not itself a registry `ContractId`.

`assertSchemaCatalog` must compare entries to `manifest.schemas` exactly, reject
duplicate `(id, version)` keys and `$id` values, require the family-specific
version property (`stateContract` or `hostContract`) to contain the entry
version, and verify that every path is the manifest path.

- [ ] **Step 5: Verify catalog, architecture, and lockfile checks**

Run:

```bash
npx vitest run tests/schema-catalog.test.ts tests/architecture.test.ts tests/package-boundaries.test.ts
npm run typecheck
npm run contracts:check
```

Expected: PASS.

- [ ] **Step 6: Commit the embedded catalog**

```bash
git add package.json package-lock.json packages/runtime/package.json packages/runtime/src/infra/schema tests/schema-catalog.test.ts tests/architecture.test.ts tests/support/architecture.ts
git commit -s -m "feat: embed the versioned schema catalog"
```

### Task 4: Compile the Ajv registry and normalize diagnostics

**Files:**

- Create: `packages/runtime/src/infra/schema/diagnostics.ts`
- Create: `packages/runtime/src/infra/schema/registry.ts`
- Modify: `packages/runtime/src/infra/schema/index.ts`
- Test: `tests/schema-registry.test.ts`
- Test: `tests/schema-registry-fixtures.test.ts`

**Interfaces:**

- Consumes: `EMBEDDED_SCHEMA_CATALOG`,
  `EMBEDDED_SCHEMA_DEPENDENCIES`, `classifyContractVersion`, `reasonPolicy`, and
  the domain `SchemaRegistry` interface.
- Produces: `ajvSchemaRegistry(): SchemaRegistry` and test-only injectable
  `compileSchemaRegistry(entries, dependencies): SchemaRegistry`.

- [ ] **Step 1: Write failing version-order and mutation tests**

Create `tests/schema-registry.test.ts` with:

```ts
import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import { ajvSchemaRegistry } from "@mestre-yoda/runtime/infra/schema";
import { describe, expect, it } from "vitest";

const registry = ajvSchemaRegistry();

describe("Ajv schema registry", () => {
  it("returns the original value after exact contract validation", () => {
    const result = registry.validate({
      id: "state.project-config",
      version: "1.0.0",
      value: projectConfig,
      structuralReasonCode: "guard.config_corrupt",
    });
    expect(result).toEqual({ kind: "valid", value: projectConfig });
    if (result.kind === "valid") expect(result.value).toBe(projectConfig);
  });

  it.each([
    [undefined, "contract.state_version_invalid"],
    ["go-v3@0.6.5", "contract.state_version_unsupported"],
    ["2.0.0", "contract.state_version_unsupported"],
  ])("rejects state version %s before schema validation", (version, reasonCode) => {
    const result = registry.validate({
      id: "state.snapshot",
      version,
      value: null,
      structuralReasonCode: "runtime.state_corrupt",
    });
    expect(result).toMatchObject({
      kind: "invalid",
      diagnostics: [{ reasonCode }],
    });
  });

  it("does not mutate or coerce rejected input", () => {
    const value = { ...projectConfig, unexpected: true };
    const before = structuredClone(value);
    expect(registry.validate({
      id: "state.project-config",
      version: "1.0.0",
      value,
      structuralReasonCode: "guard.config_corrupt",
    }).kind).toBe("invalid");
    expect(value).toEqual(before);
  });
});
```

For migration-only state versions, map `migration_required` to the existing
`contract.state_version_unsupported` policy; the diagnostic recovery already
directs the caller to explicit migration.

- [ ] **Step 2: Verify the registry tests fail for the missing implementation**

Run:

```bash
npx vitest run tests/schema-registry.test.ts
```

Expected: FAIL because `ajvSchemaRegistry` is not exported.

- [ ] **Step 3: Compile an immutable strict Ajv registry**

In `registry.ts`, instantiate `Ajv2020` with:

```ts
new Ajv2020({
  allErrors: true,
  coerceTypes: false,
  removeAdditional: false,
  strict: true,
  useDefaults: false,
  validateFormats: false,
});
```

Call `assertSchemaCatalog`, add dependency schemas before registered schemas,
compile every exact `$id`, and store validators in a private `Map`. Catch any
construction or compilation error and throw only `new Error("Embedded schema registry is invalid")`.

Before Ajv validation, derive the family from the identifier and call
`classifyContractVersion`. Convert invalid/unsupported classifications through
`contractFailureResult`; convert migration-required state to the unsupported
state policy. Return one root-pointer diagnostic for a version refusal.

- [ ] **Step 4: Verify version and identity behavior passes**

Run:

```bash
npx vitest run tests/schema-registry.test.ts
```

Expected: the version and valid identity cases PASS; structural diagnostic cases
remain to be added.

- [ ] **Step 5: Write failing sanitized diagnostic tests**

Add cases for required, type, pattern, additional property, nested field, and
multiple simultaneous failures. Assert exact normalized diagnostics:

```ts
expect(result).toEqual({
  kind: "invalid",
  diagnostics: [
    {
      contract: "state.project-config",
      version: "1.0.0",
      pointer: "/managedState/eventLog",
      keyword: "const",
      reasonCode: "guard.config_corrupt",
      recovery:
        "Correct project configuration against its schema before rerunning the guard.",
    },
  ],
});
```

Use an additional property named `secret-token-value` and assert that neither
that value nor Ajv's English `message`, `schemaPath`, or rejected data appears in
`JSON.stringify(result)`. Assert diagnostics are deduplicated and sorted by
pointer, keyword, reason code, then contract.

- [ ] **Step 6: Implement diagnostic normalization**

`diagnostics.ts` must:

- normalize an empty Ajv instance path to `""`;
- use RFC 6901 escaping (`~` to `~0`, `/` to `~1`) for schema-owned required
  property names;
- keep `additionalProperties` at its safe parent pointer instead of exposing an
  attacker-controlled property name;
- expose only `error.keyword`, never `message`, `params`, `schemaPath`, or data;
- obtain recovery from `reasonPolicy(structuralReasonCode)` and throw the
  sanitized registry-integrity error if that committed policy is unavailable;
- deduplicate by the six public diagnostic fields and sort deterministically.

- [ ] **Step 7: Run the complete valid/invalid fixture corpus**

Create `tests/schema-registry-fixtures.test.ts`. Define one table pairing each
manifest id with its committed fixture and version. For each entry, assert the
fixture passes. Then create invalid candidates by deleting the family version
field, replacing it with `2.0.0`, adding an unexpected root property, and
changing one required field to `null`; assert rejection and the expected version
or structural policy.

For `host.adapter-message`, run both the committed request fixture and a response
fixture whose `payload` is a valid universal result, proving the embedded result
schema reference resolves offline.

- [ ] **Step 8: Verify registry, fixtures, contracts, and type checks**

Run:

```bash
npx vitest run tests/schema-registry.test.ts tests/schema-registry-fixtures.test.ts tests/contract-schemas.test.ts
npm run typecheck
npm run contracts:check
```

Expected: PASS with stable diagnostics and no warnings.

- [ ] **Step 9: Commit the compiled registry**

```bash
git add packages/runtime/src/infra/schema tests/schema-registry.test.ts tests/schema-registry-fixtures.test.ts
git commit -s -m "feat: validate contracts through the embedded registry"
```

### Task 5: Add a validate-before-serialization boundary helper

**Files:**

- Create: `packages/runtime/src/domain/schema/prepare.ts`
- Modify: `packages/runtime/src/domain/schema/index.ts`
- Test: `tests/schema-boundary.test.ts`

**Interfaces:**

- Consumes: `SchemaRegistry`, `ContractRequest<I>`, and `canonicalizeJson`.
- Produces:
  `prepareContract<I>(registry, request): PreparedContract<I>`, where success
  returns the typed value and canonical text and failure returns the registry
  diagnostics unchanged.

- [ ] **Step 1: Write the failing boundary-order test**

Create `tests/schema-boundary.test.ts` with recording fakes:

```ts
import {
  prepareContract,
  type SchemaRegistry,
} from "@mestre-yoda/runtime/domain/schema";
import { describe, expect, it } from "vitest";

describe("contract boundary preparation", () => {
  it("validates before producing canonical text", () => {
    const calls: string[] = [];
    const value = { contractVersion: "1.0.0", stateContract: "1.0.0" };
    const registry: SchemaRegistry = {
      validate: () => {
        calls.push("validate");
        return { kind: "valid", value } as never;
      },
    };
    const result = prepareContract(registry, {
      id: "state.snapshot",
      version: "1.0.0",
      value,
      structuralReasonCode: "runtime.state_corrupt",
    });
    expect(calls).toEqual(["validate"]);
    expect(result).toMatchObject({ kind: "valid", canonical: expect.any(String) });
  });

  it("returns validation diagnostics without serializing rejected input", () => {
    const rejected = { cyclic: null as unknown };
    rejected.cyclic = rejected;
    const diagnostics = [{
      contract: "state.snapshot" as const,
      version: "1.0.0",
      pointer: "",
      keyword: "type",
      reasonCode: "runtime.state_corrupt",
      recovery: "recover",
    }];
    const registry: SchemaRegistry = {
      validate: () => ({ kind: "invalid", diagnostics }),
    };
    expect(prepareContract(registry, {
      id: "state.snapshot",
      version: "1.0.0",
      value: rejected,
      structuralReasonCode: "runtime.state_corrupt",
    })).toEqual({ kind: "invalid", diagnostics });
  });
});
```

- [ ] **Step 2: Verify the boundary test fails for the missing helper**

Run:

```bash
npx vitest run tests/schema-boundary.test.ts
```

Expected: FAIL because `prepareContract` does not exist.

- [ ] **Step 3: Implement validate-then-canonicalize**

Define:

```ts
export type PreparedContract<I extends ContractId> =
  | {
      readonly kind: "valid";
      readonly value: ContractValue<I>;
      readonly canonical: string;
    }
  | {
      readonly kind: "invalid";
      readonly diagnostics: readonly ValidationDiagnostic[];
    };
```

`prepareContract` must call `registry.validate(request)`, immediately return the
invalid result, and call `canonicalizeJson(result.value)` only on valid results.
Do not catch `CanonicalJsonError`: a schema that accepted non-JSON data is an
embedded registry integrity defect, not invalid user data.

- [ ] **Step 4: Verify boundary and canonical tests pass**

Run:

```bash
npx vitest run tests/schema-boundary.test.ts tests/canonical-json.test.ts tests/schema-registry.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the reusable boundary helper**

```bash
git add packages/runtime/src/domain/schema tests/schema-boundary.test.ts
git commit -s -m "feat: validate contracts before canonical serialization"
```

### Task 6: Replace the provisional production configuration validator

**Files:**

- Create: `packages/runtime/src/composition/schema.ts`
- Modify: `packages/runtime/src/composition/discovery.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/schema-composition.test.ts`
- Test: `tests/project-discovery-composition.test.ts`
- Test: `tests/runtime-composition.test.ts`

**Interfaces:**

- Consumes: `ajvSchemaRegistry`, `SchemaRegistry`, `CONTRACT_IDENTITIES.state`,
  and the existing `ConfigurationValidator` seam.
- Produces: `createSchemaRegistry(): SchemaRegistry`,
  `configurationValidator(registry): ConfigurationValidator`, and a production
  `discoverProject(request, ports, validator?)` default that uses the registry
  adapter while preserving explicit test injection.

- [ ] **Step 1: Write failing composition and adapter tests**

Create `tests/schema-composition.test.ts`:

```ts
import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import {
  configurationValidator,
  createSchemaRegistry,
} from "@mestre-yoda/runtime/composition/schema";
import { describe, expect, it } from "vitest";

describe("schema composition", () => {
  it("adapts project configuration to the discovery seam", () => {
    const validate = configurationValidator(createSchemaRegistry());
    expect(validate(projectConfig)).toEqual({ kind: "valid", value: projectConfig });
    expect(validate({ ...projectConfig, unexpected: true })).toEqual({ kind: "invalid" });
  });
});
```

Extend `tests/project-discovery-composition.test.ts` with a project containing
the full committed configuration fixture. Call `discoverProject(request, ports)`
without an explicit validator and assert an initialized resolution. Retain one
test that injects a recording validator and proves the explicit override remains
available for pure deterministic tests.

- [ ] **Step 2: Verify composition tests fail for missing default wiring**

Run:

```bash
npx vitest run tests/schema-composition.test.ts tests/project-discovery-composition.test.ts
```

Expected: FAIL because the composition module does not exist and
`discoverProject` still requires a validator.

- [ ] **Step 3: Add schema composition and the discovery default**

Implement `createSchemaRegistry` as a fresh Ajv registry factory. Implement
`configurationValidator` with the fixed request:

```ts
const result = registry.validate({
  id: "state.project-config",
  version: CONTRACT_IDENTITIES.state,
  value,
  structuralReasonCode: "guard.config_corrupt",
});
return result.kind === "valid"
  ? { kind: "valid", value: result.value }
  : { kind: "invalid" };
```

Make the third `discoverProject` parameter optional and default it to
`configurationValidator(createSchemaRegistry())`. Keep registry creation out of
the pure `resolveProject` domain function. Export `./composition/schema` in the
runtime package.

- [ ] **Step 4: Verify discovery failure order and runtime composition**

Run:

```bash
npx vitest run tests/schema-composition.test.ts tests/project-configuration.test.ts tests/project-discovery-composition.test.ts tests/runtime-composition.test.ts
npm run typecheck
```

Expected: PASS. Syntax and version failures still occur before the registry
adapter, and no mutation port exists during discovery.

- [ ] **Step 5: Commit production integration**

```bash
git add packages/runtime/src/composition packages/runtime/package.json tests/schema-composition.test.ts tests/project-discovery-composition.test.ts tests/runtime-composition.test.ts
git commit -s -m "feat: compose schema validation for project discovery"
```

### Task 7: Document, bundle, and verify the complete boundary

**Files:**

- Create: `docs/architecture/schema-registry.md`
- Modify: `README.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `docs/architecture/project-discovery.md`
- Modify: `tests/readme-honesty.test.ts`
- Modify: `tests/runtime-distribution.test.ts`
- Modify: `tests/package-verifier.test.ts`

**Interfaces:**

- Consumes: the complete registry, boundary helper, configuration adapter, and
  current three-file distribution verifier.
- Produces: public architecture documentation and reproducible issue #19
  verification evidence.

- [ ] **Step 1: Write failing documentation and package assertions**

Extend `tests/readme-honesty.test.ts` to require links to the schema registry
contract and the phrases `embedded schemas`, `validation before domain use`, and
`canonical JSON`.

Extend distribution/package tests to assert:

- no `ajv` external import remains in `dist/plugin/runtime/yoda.core.mjs`;
- no checkout-relative `schemas/` path appears in the staged bundle;
- the staged inventory remains exactly `manifest.json`, `yoda.core.mjs`, and
  `yoda.mjs`;
- copying the staged runtime outside the checkout still runs help, version, and
  handshake successfully with module lookup influences cleared.

- [ ] **Step 2: Verify documentation/package assertions fail**

Run:

```bash
npx vitest run tests/readme-honesty.test.ts tests/runtime-distribution.test.ts tests/package-verifier.test.ts
```

Expected: FAIL because the architecture link and schema-registry prose are
absent; package assertions may also fail until the build includes Ajv correctly.

- [ ] **Step 3: Publish the architecture contract**

Write `docs/architecture/schema-registry.md` from the approved design, covering:

- the closed identifier table and generated TypeScript mapping;
- version selection before structural validation;
- caller-selected existing structural reason policy;
- stable sanitized diagnostic fields and ordering;
- embedded catalog initialization failures;
- validate-on-input and revalidate-before-output flow;
- strict canonical JSON rules;
- project-discovery adapter behavior;
- no network, filesystem schema discovery, mutation, or parity claim.

Update the runtime boundary and project discovery documents to link this
contract and remove language saying `RUN-04` is future work. Add a concise README
link without claiming that later state commands already exist.

- [ ] **Step 4: Run focused documentation and bundle verification**

Run:

```bash
npx vitest run tests/readme-honesty.test.ts tests/runtime-distribution.test.ts tests/package-verifier.test.ts
npm run build
npm run package:verify
```

Expected: PASS. The three-file staged runtime has no external imports or schema
assets.

- [ ] **Step 5: Run formatting, spelling, linting, types, tests, and coverage**

Run:

```bash
npm run format:check
npm run spellcheck
npm run lint
npm run typecheck
npm test
npm run test:coverage
```

Expected: PASS with 100% statements, branches, functions, and lines and no
warnings. If formatting alone fails, run `npx prettier --write` only on files
changed by this issue, then repeat the checks.

- [ ] **Step 6: Run the complete repository verification chain**

Run:

```bash
npm run verify
```

Expected: PASS, including oracle metadata, parity inventory
`0 / 400 (0.00%)`, result contract, schema/type drift, differential self-test,
bundle build, and package verification.

- [ ] **Step 7: Commit documentation and final evidence-ready state**

```bash
git add README.md docs/architecture tests/readme-honesty.test.ts tests/runtime-distribution.test.ts tests/package-verifier.test.ts
git commit -s -m "docs: publish the schema validation boundary"
```

- [ ] **Step 8: Inspect final branch state before review**

Run:

```bash
git status --short
git log --oneline --decorate origin/main..HEAD
git diff --check origin/main...HEAD
```

Expected: clean worktree, the design commit plus independently reviewable task
commits, and no whitespace errors.

Record in the PR body:

- `Closes #19` and the relationship to epic #15;
- architecture and compatibility choices;
- exact focused and full verification commands;
- observed TDD failures before each implementation;
- `npm run verify` result and coverage totals;
- confirmation that runtime schema access is offline and embedded;
- confirmation that parity remains `0 / 400 (0.00%)`;
- independent code-review outcome.
