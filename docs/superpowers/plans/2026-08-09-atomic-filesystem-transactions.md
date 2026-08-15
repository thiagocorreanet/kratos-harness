# Atomic Filesystem Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `.brain/`-confined durable transaction boundary that stages,
publishes, diagnoses, and explicitly recovers multi-file state mutations.

**Architecture:** Pure domain modules normalize effect plans and decide legal
transaction/recovery transitions. A narrow `DurableFileSystem` port exposes the
observable filesystem primitives; deterministic memory and real Node adapters
share one contract, while composition drives one primitive at a time and maps
typed failures into the existing result catalog.

**Tech Stack:** TypeScript 6, Node.js 24.18.0, npm 11.16.0, Vitest 4, Ajv 8,
JSON Schema draft 2020-12, esbuild, and Node `fs/promises`/`crypto`.

## Global Constraints

- Do not start Task 1 until PR #91 (`RUN-04`) is merged and the implementation
  branch is rebased on the resulting `origin/main`.
- Use exactly Node.js `24.18.0` and npm `11.16.0`.
- Keep source, schemas, fixtures, tests, errors, docs, commits, and PR text in
  English.
- Add no runtime network access and no new production dependency.
- Domain and ports must not import a Node builtin.
- Caller destinations are limited to normalized paths below `.brain/`;
  `.brain/transactions/**` is reserved for the transaction manager.
- `existing` root mode is the default. Only explicit `initialize` mode may
  create empty `.brain/` and `.brain/transactions/` bootstrap directories.
- Before `publishing`, recovery may abort. At or after `publishing`, recovery
  only rolls forward or blocks on unexpected evidence.
- Never expose payload bytes, absolute paths, or secrets in public artifacts.
- Run narrow tests first and end every task with a signed-off English commit.

## File Structure

- `domain/transactions/model.ts`: immutable domain types.
- `domain/transactions/normalize.ts`: effect-plan and managed-path policy.
- `domain/transactions/transition.ts`: legal phase changes.
- `domain/transactions/recovery.ts`: pure recovery decisions.
- `ports/transactions.ts`: durable filesystem and digest interfaces.
- `infra/digests.ts`: SHA-256 adapter.
- `infra/fake/transactions.ts`: memory adapter and failure controller.
- `infra/node/transactions.ts`: no-follow Node primitives.
- `composition/transactions.ts`: execution, inspection, and recovery driver.
- `tests/support/transaction-port-contract.ts`: shared adapter contract.
- `tests/fixtures/transactions/worker.ts`: child-process crash driver.

---

### Task 1: Register transaction manifest and progress contracts

**Files:**

- Create: `schemas/state/transaction-manifest.v1.schema.json`
- Create: `schemas/state/transaction-progress.v1.schema.json`
- Create: `fixtures/contracts/v1/transaction-manifest.json`
- Create: `fixtures/contracts/v1/transaction-progress.json`
- Modify: `packages/contracts/catalogs/contract-families.v1.json`
- Modify: `packages/contracts/src/generated/contracts.ts` through the generator
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/runtime/src/domain/schema/contracts.ts`
- Modify: `packages/runtime/src/infra/schema/catalog.ts`
- Modify: `schemas/README.md`
- Test: `tests/contract-schemas.test.ts`
- Test: `tests/contract-type-generation.test.ts`
- Test: `tests/schema-catalog.test.ts`
- Test: `tests/schema-registry-types.test.ts`

**Interfaces:**

- Consumes: merged `SchemaRegistry.validate()` and `canonicalizeJson()`.
- Produces: generated `TransactionManifestV1`, `TransactionProgressV1`, and
  registry IDs `state.transaction-manifest` and `state.transaction-progress`.

- [ ] **Step 1: Add failing contract inventory tests**

Add both artifacts to `tests/contract-schemas.test.ts` and both IDs to the
closed registry type test:

```ts
[
  "state/transaction-manifest.v1.schema.json",
  "transaction-manifest.json",
  "state",
],
[
  "state/transaction-progress.v1.schema.json",
  "transaction-progress.json",
  "state",
],
```

```ts
expectTypeOf<
  ContractValue<"state.transaction-manifest">
>().toEqualTypeOf<TransactionManifestV1>();
expectTypeOf<
  ContractValue<"state.transaction-progress">
>().toEqualTypeOf<TransactionProgressV1>();
```

Change the closed schema count from 8 to 10.

- [ ] **Step 2: Verify the tests fail for absent contracts**

```bash
npm test -- tests/contract-schemas.test.ts tests/schema-registry-types.test.ts
```

Expected: FAIL because schemas, fixtures, exports, and IDs are absent.

- [ ] **Step 3: Add closed schemas and fixtures**

The manifest must require these exact top-level fields:

```json
{
  "contractVersion": "1.0.0",
  "stateContract": "1.0.0",
  "transactionId": "transaction-01",
  "planDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "createdAt": "2026-08-09T00:00:00.000Z",
  "operations": [
    {
      "operationId": "operation-0001",
      "kind": "write_file",
      "path": ".brain/state.json",
      "expected": { "kind": "missing" },
      "result": {
        "kind": "file",
        "size": 3,
        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      "stagedPath": ".brain/transactions/transaction-01/staging/operation-0001.payload"
    }
  ]
}
```

Set `operations.minItems` to 1. Each closed operation requires
`operationId`, `kind`, `path`, `expected`, `result`, and `stagedPath`. Use kinds
`create_directory`, `write_file`, and `delete_file`; fingerprints are the closed
union `missing`, `directory`, or `file` with safe integer byte size and SHA-256.
Require non-null `stagedPath` only for a write through `allOf` conditionals.

The progress schema and fixture use:

```json
{
  "contractVersion": "1.0.0",
  "stateContract": "1.0.0",
  "transactionId": "transaction-01",
  "manifestDigest": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "recoveryToken": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "phase": "prepared",
  "publishedOperationIds": [],
  "fileSync": "required",
  "directorySync": "supported",
  "createdAt": "2026-08-09T00:00:00.000Z",
  "updatedAt": "2026-08-09T00:00:01.000Z"
}
```

Require `recoveryToken` as SHA-256. Allow `manifestDigest: null` for `begun` and
for an `aborted` transaction that never reached `prepared`; require a digest
for `prepared`, `publishing`, and `committed`. Phases are `begun`, `prepared`,
`publishing`, `committed`, and `aborted`. Reuse the neighboring state schemas'
bounded ID, safe relative reference, SHA-256, integer, and UTC definitions.

- [ ] **Step 4: Register and generate types**

Append these manifest entries in order:

```json
{
  "id": "state.transaction-manifest",
  "family": "state",
  "version": "1.0.0",
  "path": "schemas/state/transaction-manifest.v1.schema.json",
  "boundary": "persisted",
  "typeName": "TransactionManifestV1"
},
{
  "id": "state.transaction-progress",
  "family": "state",
  "version": "1.0.0",
  "path": "schemas/state/transaction-progress.v1.schema.json",
  "boundary": "persisted",
  "typeName": "TransactionProgressV1"
}
```

Wire both into contract exports, `ContractValues`, embedded catalog imports,
entries, and expected IDs. Run `npm run contracts:generate`.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- tests/contract-schemas.test.ts tests/contract-type-generation.test.ts tests/schema-catalog.test.ts tests/schema-registry-types.test.ts
npm run contracts:check
git add schemas fixtures/contracts/v1 packages/contracts packages/runtime/src/domain/schema/contracts.ts packages/runtime/src/infra/schema/catalog.ts tests/contract-schemas.test.ts tests/contract-type-generation.test.ts tests/schema-catalog.test.ts tests/schema-registry-types.test.ts
git commit -s -m "feat: register transaction state contracts"
```

Expected: PASS and contract verification reports 10 schemas.

---

### Task 2: Normalize managed mutation plans

**Files:**

- Create: `packages/runtime/src/domain/transactions/model.ts`
- Create: `packages/runtime/src/domain/transactions/normalize.ts`
- Create: `packages/runtime/src/domain/transactions/index.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/transaction-normalization.test.ts`
- Test: `tests/transaction-normalization-properties.test.ts`

**Interfaces:**

- Consumes: `EffectPlan`, an observed path map, and injected SHA-256 function.
- Produces: `normalizeManagedMutationPlan`, `ManagedMutationPlan`,
  `ManagedOperation`, `PathFingerprint`, and `TransactionPolicyError`.

- [ ] **Step 1: Write failing examples**

Assert a `.brain/runs/a/state.json` write becomes `operation-0001`; output
effects are excluded; missing parents become explicit earlier operations;
already-equal writes produce `{ kind: "noop" }`; and declared order is stable.
Assert `append_event`, outside `.brain/`, `.brain` itself, reserved metadata,
traversal, backslashes, drives, controls, overlaps, and delete-directory fail.

```ts
expect(() =>
  normalizeManagedMutationPlan(
    planOf({
      kind: "write_file",
      path: ".brain/transactions/forbidden",
      content: "x",
    }),
    new Map(),
    sha256,
  ),
).toThrowError(
  expect.objectContaining({ reasonCode: "guard.outside_allow" }),
);
```

- [ ] **Step 2: Confirm the module is absent**

```bash
npm test -- tests/transaction-normalization.test.ts tests/transaction-normalization-properties.test.ts
```

Expected: FAIL on missing package export.

- [ ] **Step 3: Define the exact domain vocabulary**

```ts
export type PathFingerprint =
  | { readonly kind: "missing" }
  | { readonly kind: "directory" }
  | { readonly kind: "file"; readonly size: number; readonly sha256: string };

export interface ManagedMutationPlan {
  readonly operations: readonly ManagedOperation[];
}

export class TransactionPolicyError extends Error {
  public constructor(
    public readonly reasonCode:
      | "guard.outside_allow"
      | "runtime.state_corrupt",
  ) {
    super("Managed mutation plan is invalid");
    this.name = "TransactionPolicyError";
  }
}
```

Define the three-operation discriminated union with `operationId`, `kind`,
`path`, `expected`, `result`, and `stagedPath`; only writes carry transient
`content`, and persisted conversion must omit it.

- [ ] **Step 4: Implement normalization**

```ts
export function normalizeManagedMutationPlan(
  effectPlan: EffectPlan,
  observations: ReadonlyMap<string, PathFingerprint>,
  sha256: (text: string) => string,
):
  | { readonly kind: "noop" }
  | { readonly kind: "ready"; readonly plan: ManagedMutationPlan };
```

Use forward-slash segments, require `.brain` first, refuse `transactions`
second, synthesize each absent parent once, calculate UTF-8 size without Node,
remove satisfied operations, and assign IDs after final ordering.

- [ ] **Step 5: Add deterministic generated cases and commit**

Generate 200 safe and 200 unsafe paths with the repository's seeded generator.
Assert repeated normalization is identical and no accepted path escapes.

```bash
npm test -- tests/transaction-normalization.test.ts tests/transaction-normalization-properties.test.ts
npm run typecheck
git add packages/runtime/src/domain/transactions packages/runtime/package.json tests/transaction-normalization*.test.ts
git commit -s -m "feat: normalize managed mutation plans"
```

---

### Task 3: Implement pure phase and recovery decisions

**Files:**

- Create: `packages/runtime/src/domain/transactions/transition.ts`
- Create: `packages/runtime/src/domain/transactions/recovery.ts`
- Modify: `packages/runtime/src/domain/transactions/model.ts`
- Modify: `packages/runtime/src/domain/transactions/index.ts`
- Test: `tests/transaction-transition.test.ts`
- Test: `tests/transaction-recovery-properties.test.ts`

**Interfaces:**

- Consumes: manifest, progress, and observed fingerprints.
- Produces: `assertPhaseTransition`, `decideRecovery`,
  `TransactionObservation`, and `RecoveryDecision`.

```ts
export interface TransactionObservation {
  readonly destinations: ReadonlyMap<string, PathFingerprint>;
  readonly stagedPayloads: ReadonlyMap<string, PathFingerprint>;
}

export function assertPhaseTransition(
  from: TransactionProgressV1["phase"],
  to: TransactionProgressV1["phase"],
): void;

export function decideRecovery(
  manifest: TransactionManifestV1,
  progress: TransactionProgressV1,
  observation: TransactionObservation,
): RecoveryDecision;
```

- [ ] **Step 1: Write the complete phase table test**

Legal edges are exactly:

```ts
const legal = [
  ["begun", "prepared"],
  ["begun", "aborted"],
  ["prepared", "publishing"],
  ["prepared", "aborted"],
  ["publishing", "committed"],
] as const;
```

Test every pair in the five-phase Cartesian product; all other edges throw
`Illegal transaction phase transition`.

- [ ] **Step 2: Write the recovery table tests**

```ts
expect(decideRecovery(manifest, begun, allPreconditions)).toEqual({
  kind: "abort",
});
expect(decideRecovery(manifest, publishing, firstAlreadyPublished)).toEqual({
  kind: "record_published",
  operationId: "operation-0001",
});
expect(decideRecovery(manifest, publishing, nextAtPrecondition)).toEqual({
  kind: "publish",
  operationId: "operation-0002",
});
expect(decideRecovery(manifest, publishing, unexpectedTarget)).toEqual({
  kind: "blocked",
  reasonCode: "runtime.state_corrupt",
  operationId: "operation-0002",
});
```

Add committed/aborted cleanup and all-results commit cases.

- [ ] **Step 3: Confirm missing behavior**

```bash
npm test -- tests/transaction-transition.test.ts tests/transaction-recovery-properties.test.ts
```

Expected: FAIL on missing exports.

- [ ] **Step 4: Implement the closed decision union**

```ts
export type RecoveryDecision =
  | { readonly kind: "abort" }
  | { readonly kind: "record_published"; readonly operationId: string }
  | { readonly kind: "publish"; readonly operationId: string }
  | { readonly kind: "commit" }
  | { readonly kind: "cleanup"; readonly terminal: "committed" | "aborted" }
  | { readonly kind: "complete"; readonly terminal: "committed" | "aborted" }
  | {
      readonly kind: "blocked";
      readonly reasonCode: "runtime.state_corrupt";
      readonly operationId: string | null;
    };
```

Validate identity, digest, unique progress IDs, and manifest-order prefix.
Compare each destination with both expected and result fingerprints; never
infer success from progress alone.

- [ ] **Step 5: Add generated crash-state properties and commit**

Generate 1-20 operation plans at every crash index. Assert pre-publication only
aborts, publishing never aborts, successful decisions terminate, published IDs
are monotonic, and terminal decisions are idempotent.

```bash
npm test -- tests/transaction-transition.test.ts tests/transaction-recovery-properties.test.ts
npm run typecheck
git add packages/runtime/src/domain/transactions tests/transaction-transition.test.ts tests/transaction-recovery-properties.test.ts
git commit -s -m "feat: decide deterministic transaction recovery"
```

---

### Task 4: Define the durable filesystem port and shared contract

**Files:**

- Create: `packages/runtime/src/ports/transactions.ts`
- Modify: `packages/runtime/src/ports/index.ts`
- Create: `packages/runtime/src/infra/digests.ts`
- Create: `tests/support/transaction-port-contract.ts`
- Modify: `tests/ports-contract.test.ts`
- Test: `tests/transaction-digests.test.ts`

**Interfaces:**

- Consumes: project-relative paths and UTF-8 strings.
- Produces: `DurableFileSystem`, `Digests`, `DurableEntry`, and
  `sha256Digests()`.

- [ ] **Step 1: Add compile-time and behavioral tests first**

Define the expected interface in the tests:

```ts
export interface DurableFileSystem {
  inspect(path: string): Promise<DurableEntry>;
  list(path: string): Promise<readonly string[]>;
  readText(path: string): Promise<string>;
  createDirectory(path: string): Promise<void>;
  createDirectoryExclusive(path: string): Promise<void>;
  writeSynced(path: string, content: string): Promise<void>;
  replaceFile(stagedPath: string, targetPath: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  removeEmptyDirectory(path: string): Promise<void>;
  syncDirectory(path: string): Promise<"supported" | "unsupported">;
}

export interface Digests {
  sha256(text: string): string;
}
```

`DurableEntry` is a closed union of `missing`, `directory`, `symlink`,
`special`, and regular `file` with byte size and SHA-256. The shared contract
asserts complete write/read, exclusive create, replace, regular delete,
empty-directory-only removal, sorted listing, and identical unsafe-path refusal.

```ts
export type DurableEntry =
  | { readonly kind: "missing" }
  | { readonly kind: "directory" | "symlink" | "special" }
  | { readonly kind: "file"; readonly size: number; readonly sha256: string };
```

- [ ] **Step 2: Confirm the types are absent**

Run `npm run typecheck`; expect missing transaction port exports.

- [ ] **Step 3: Add the interface and digest implementation**

```ts
import { createHash } from "node:crypto";
import type { Digests } from "../ports/index.js";

export function sha256Digests(): Digests {
  return {
    sha256: (text) => createHash("sha256").update(text, "utf8").digest("hex"),
  };
}
```

Keep this Node import in `infra`; domain and ports remain builtin-free.

- [ ] **Step 4: Export the shared contract suite**

Create `describeDurableFileSystemContract(label, factory)` using the same
`Disposable<T>` shape as other port suites. Do not broaden the existing simple
`FileSystem` contract.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- tests/transaction-digests.test.ts tests/architecture.test.ts
npm run typecheck
git add packages/runtime/src/ports packages/runtime/src/infra/digests.ts tests/support/transaction-port-contract.ts tests/ports-contract.test.ts tests/transaction-digests.test.ts
git commit -s -m "feat: define durable filesystem transaction port"
```

The shared suite may remain without a factory only until Task 5; do not skip
individual assertions.

---

### Task 5: Build the memory adapter and failure controller

**Files:**

- Create: `packages/runtime/src/infra/fake/transactions.ts`
- Modify: `packages/runtime/src/infra/fake/index.ts`
- Modify: `tests/ports-contract.test.ts`
- Test: `tests/fake-transactions.test.ts`

**Interfaces:**

- Consumes: optional seed files/directories.
- Produces: `memoryTransactionStorage`, shared simple/durable views,
  `snapshot()`, `calls()`, and `fail(rule)`.

- [ ] **Step 1: Invoke the shared contract before the factory exists**

```ts
describeDurableFileSystemContract("memory", async () => {
  const storage = memoryTransactionStorage();
  return { port: storage.durableFileSystem, dispose: async () => undefined };
});
```

Add an ambiguous after-effect failure assertion:

```ts
storage.fail({ operation: "replace_file", timing: "after", occurrence: 1 });
await storage.durableFileSystem.writeSynced(".brain/staged", "new");
await expect(
  storage.durableFileSystem.replaceFile(".brain/staged", ".brain/state.json"),
).rejects.toThrow("Injected durable filesystem failure");
expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
```

- [ ] **Step 2: Run and observe the missing factory**

```bash
npm test -- tests/ports-contract.test.ts tests/fake-transactions.test.ts
```

Expected: FAIL on `memoryTransactionStorage`.

- [ ] **Step 3: Implement one shared memory model**

```ts
export type DurableOperation =
  | "inspect"
  | "list"
  | "read_text"
  | "create_directory"
  | "create_directory_exclusive"
  | "open_file"
  | "write_file"
  | "sync_file"
  | "close_file"
  | "replace_file"
  | "remove_file"
  | "remove_empty_directory"
  | "sync_directory";

export interface FailureRule {
  readonly operation: DurableOperation;
  readonly timing: "before" | "after";
  readonly occurrence: number;
  readonly fault?: "generic" | "permission" | "disk_full";
}

export interface MemoryTransactionStorage {
  readonly fileSystem: FileSystem;
  readonly durableFileSystem: DurableFileSystem;
  readonly digests: Digests;
  readonly fail: (rule: FailureRule) => void;
  readonly calls: () => readonly DurableOperation[];
  readonly snapshot: () => {
    readonly files: Readonly<Record<string, string>>;
    readonly directories: readonly string[];
  };
}
```

Use one map/set model for both views. Check failure rules immediately before and
after primitives, count occurrences per operation, and clone snapshots.
`writeSynced` must emit `open_file`, `write_file`, `sync_file`, and `close_file`
in that order so the fault campaign reaches every durable boundary.

- [ ] **Step 4: Prove before/after behavior for every operation**

Table-drive all `DurableOperation` values. Before-fail leaves storage unchanged;
after-fail exposes the completed effect. Assert recorded calls contain no
content or absolute path values.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- tests/ports-contract.test.ts tests/fake-transactions.test.ts
npm run typecheck
git add packages/runtime/src/infra/fake tests/ports-contract.test.ts tests/fake-transactions.test.ts
git commit -s -m "test: add fault-injectable transaction storage"
```

---

### Task 6: Drive preparation, publication, inspection, and recovery

**Files:**

- Create: `packages/runtime/src/composition/transactions.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Test: `tests/transaction-execution.test.ts`
- Test: `tests/transaction-recovery.test.ts`
- Test: `tests/transaction-schema-boundary.test.ts`

**Interfaces:**

- Consumes: `ManagedMutationPlan`, clock, IDs, digests, durable filesystem, and
  schema registry.
- Produces: `executeManagedMutation`, `inspectManagedTransactions`,
  `recoverManagedMutation`, `TransactionReceipt`, and `TransactionFailure`.

```ts
export interface TransactionReceipt {
  readonly transactionId: string;
  readonly manifestDigest: string | null;
  readonly recoveryToken: string;
  readonly phase: "committed" | "aborted";
  readonly directorySync: "not_attempted" | "supported" | "unsupported";
}

export interface TransactionSummary {
  readonly transactionId: string;
  readonly manifestDigest: string | null;
  readonly recoveryToken: string;
  readonly phase: TransactionProgressV1["phase"];
  readonly evidenceRef: string;
}

export function executeManagedMutation(
  plan: ManagedMutationPlan,
  options: { readonly rootMode: "existing" | "initialize" },
  services: TransactionServices,
): Promise<TransactionReceipt>;

export function inspectManagedTransactions(
  services: TransactionServices,
): Promise<readonly TransactionSummary[]>;

export function recoverManagedMutation(
  request: { readonly transactionId: string; readonly recoveryToken: string },
  services: TransactionServices,
): Promise<TransactionReceipt>;
```

- [ ] **Step 1: Write successful execution first**

```ts
const receipt = await executeManagedMutation(plan, { rootMode: "existing" }, {
  clock: fixedClock("2026-08-09T00:00:00.000Z"),
  ids: sequentialIds("transaction"),
  digests: storage.digests,
  durableFileSystem: storage.durableFileSystem,
  schemaRegistry: createSchemaRegistry(),
});
expect(receipt).toMatchObject({
  transactionId: "transaction-1",
  phase: "committed",
  directorySync: "supported",
});
```

Create `storage` with seeded `.brain` and `.brain/transactions` directories so
this example tests `existing` mode. Add a separate empty-storage test for
`initialize` mode.

Assert terminal metadata remains, staging payloads are gone, and manifest/
progress validate without a `content` property.

- [ ] **Step 2: Write explicit recovery tests**

Cover failure after prepared progress, after first rename, after directory sync,
committed cleanup failure, stale ID/token, and an unexpected destination.
Normal execution with a marker must throw:

```ts
expect(error).toMatchObject({
  reasonCode: "runtime.recovery_required",
  evidence: [
    {
      kind: "artifact",
      ref: ".brain/transactions/transaction-1/progress.json",
    },
  ],
});
```

Repeated recovery returns the same terminal receipt.

- [ ] **Step 3: Confirm missing composition exports**

```bash
npm test -- tests/transaction-execution.test.ts tests/transaction-recovery.test.ts tests/transaction-schema-boundary.test.ts
```

Expected: FAIL on missing functions.

- [ ] **Step 4: Add typed services and safe failure**

```ts
export interface TransactionServices {
  readonly clock: Clock;
  readonly ids: Ids;
  readonly digests: Digests;
  readonly durableFileSystem: DurableFileSystem;
  readonly schemaRegistry: SchemaRegistry;
}

export class TransactionFailure extends Error {
  public constructor(
    public readonly reasonCode:
      | "guard.outside_allow"
      | "runtime.internal_failure"
      | "runtime.recovery_required"
      | "runtime.revision_conflict"
      | "runtime.state_corrupt",
    public readonly evidence: readonly EvidenceRef[],
  ) {
    super("Managed transaction failed");
    this.name = "TransactionFailure";
  }
}
```

- [ ] **Step 5: Implement the observe/decide/apply driver**

Order: reject incomplete markers; verify root mode; create exclusive transaction
directory; persist `begun`; stage/sync payloads; canonicalize, validate, and sync
manifest; recheck preconditions; persist `prepared`; persist `publishing`; then
publish in order and finish `committed` cleanup.

Use this single atomic progress helper:

```ts
async function persistProgress(
  progress: TransactionProgressV1,
  services: TransactionServices,
): Promise<void> {
  validateProgress(progress, services.schemaRegistry);
  const encoded = `${canonicalizeJson(progress)}\n`;
  const root = transactionRoot(progress.transactionId);
  await services.durableFileSystem.writeSynced(`${root}/progress.next`, encoded);
  await services.durableFileSystem.replaceFile(
    `${root}/progress.next`,
    `${root}/progress.json`,
  );
  await services.durableFileSystem.syncDirectory(root);
}
```

After a rejected primitive, re-observe phase and targets before classifying it.

- [ ] **Step 6: Implement bootstrap and safe cleanup**

`existing` refuses missing `.brain`; `initialize` creates and syncs only empty
`.brain` and `.brain/transactions`. Cleanup removes validated staged regular
files and known empty directories, never recursively removing unknown content.

- [ ] **Step 7: Verify and commit**

```bash
npm test -- tests/transaction-execution.test.ts tests/transaction-recovery.test.ts tests/transaction-schema-boundary.test.ts
npm run typecheck
git add packages/runtime/src/composition tests/transaction-execution.test.ts tests/transaction-recovery.test.ts tests/transaction-schema-boundary.test.ts
git commit -s -m "feat: execute and recover managed transactions"
```

---

### Task 7: Implement no-follow durable Node primitives

**Files:**

- Create: `packages/runtime/src/infra/node/transactions.ts`
- Modify: `packages/runtime/src/infra/node/index.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Modify: `packages/runtime/src/ports/index.ts`
- Modify: `tests/ports-contract.test.ts`
- Test: `tests/node-transactions.test.ts`
- Test: `tests/node-transaction-security.test.ts`
- Modify: `tests/runtime-composition.test.ts`

**Interfaces:**

- Consumes: canonical project root.
- Produces: `nodeDurableFileSystem(root, observer?)` and production runtime
  ports.

```ts
export interface DurableOperationEvent {
  readonly operation: DurableOperation;
  readonly timing: "before" | "after";
}

export type DurableOperationObserver = (
  event: DurableOperationEvent,
) => Promise<void>;
```

- [ ] **Step 1: Run the shared contract against the absent factory**

```ts
describeDurableFileSystemContract("node", async () => {
  const root = await mkdtemp(join(tmpdir(), "yoda-transaction-port-"));
  return {
    port: nodeDurableFileSystem(root),
    dispose: () => rm(root, { force: true, recursive: true }),
  };
});
```

Run `npm test -- tests/ports-contract.test.ts`; expect FAIL.

- [ ] **Step 2: Add real security tests before implementation**

Cover internal and escaping symlinks, FIFO where supported, directory-as-file,
case-colliding sibling on case-sensitive filesystems, and substitution between
observations. No external sentinel may change.

- [ ] **Step 3: Implement anchored no-follow inspection and synced writes**

Use `lstat` on every existing component below canonical `.brain`; refuse every
symlink on a mutation path. Use `open` with create/exclusive flags,
`FileHandle.writeFile()`, `sync()`, and `close()` in `finally`. Hash bytes read
from a proven regular file without following a final symlink.

Call the optional observer before and after each internal operation. Production
composition passes no observer; fault and child-process tests pass explicit
observers. An observer rejection must be able to model both pre-effect and
post-effect failure without changing the public port interface.

Do not reuse ordinary `resolveInside()`, which permits internal symlinks for
reads and has a deliberately weaker contract.

- [ ] **Step 4: Implement rename, delete, and directory sync narrowly**

Use same-filesystem `rename` after revalidating both parents. Delete only a
regular file with `unlink`; remove only empty directories with `rmdir`. Downgrade
directory sync only for the exact platform errors asserted by tests; rethrow
every unexpected error. File sync and rename remain mandatory.

- [ ] **Step 5: Compose the ports**

Extend `RuntimePorts`:

```ts
readonly digests: Digests;
readonly durableFileSystem: DurableFileSystem;
```

Add `sha256Digests()` and `nodeDurableFileSystem(root)` in `createRuntimeAt` and
update the exact port-key assertion. Overrides still replace one named port.

- [ ] **Step 6: Verify and commit**

```bash
npm test -- tests/ports-contract.test.ts tests/node-transactions.test.ts tests/node-transaction-security.test.ts tests/runtime-composition.test.ts
npm run typecheck
git add packages/runtime/src/infra/node packages/runtime/src/infra/digests.ts packages/runtime/src/composition/index.ts packages/runtime/src/ports tests/ports-contract.test.ts tests/node-transactions.test.ts tests/node-transaction-security.test.ts tests/runtime-composition.test.ts
git commit -s -m "feat: add durable Node transaction storage"
```

---

### Task 8: Route effects and stable transaction failures

**Files:**

- Modify: `packages/runtime/src/composition/index.ts`
- Modify: `packages/runtime/src/composition/cli.ts`
- Modify: `packages/runtime/src/domain/result/result.ts`
- Modify: `packages/runtime/src/domain/result/index.ts`
- Modify: `tests/runtime-composition.test.ts`
- Modify: `tests/cli-composition.test.ts`
- Modify: `tests/cli-contracts.test.ts`

**Interfaces:**

- Consumes: `EffectPlan`, `RuntimePorts`, and production schema registry.
- Produces: atomic `applyPlan`, post-commit output, and
  `transactionFailureResult`.

- [ ] **Step 1: Replace partial-prefix expectations with atomic ones**

Use `memoryTransactionStorage()` and override `fileSystem`,
`durableFileSystem`, and `digests` from that same storage. Assert an invalid
second effect does not apply the first:

```ts
await expect(
  applyPlan(
    planOf(
      { kind: "write_file", path: ".brain/first.json", content: "one" },
      {
        kind: "write_file",
        path: ".brain/transactions/forbidden",
        content: "two",
      },
    ),
    ports,
  ),
).rejects.toMatchObject({ reasonCode: "guard.outside_allow" });
expect(storage.snapshot().files).not.toHaveProperty(".brain/first.json");
```

Update all state paths to `.brain/`, assert output only appears after commit,
and assert `append_event` fails closed until `RUN-06`.

- [ ] **Step 2: Add CLI result mapping tests**

For each transaction reason, inject a `TransactionFailure` and assert exact
catalog status, exit code, retry policy, recovery, and relative evidence in
human and JSON output. Assert absolute roots and payload content are absent.

- [ ] **Step 3: Confirm legacy behavior fails**

```bash
npm test -- tests/runtime-composition.test.ts tests/cli-composition.test.ts tests/cli-contracts.test.ts
```

Expected: FAIL because `applyPlan` still writes prefixes and CLI collapses typed
failures to `runtime.internal_failure`.

- [ ] **Step 4: Route managed effects through one transaction**

Separate `emit` effects, observe and normalize managed effects, execute one
transaction, and emit only after a committed receipt. Reject `append_event` with
`runtime.state_corrupt`. Add an options argument defaulting to
`{ rootMode: "existing" }`; only an initialization caller passes `initialize`.

```ts
export async function applyPlan(
  plan: EffectPlan,
  ports: RuntimePorts,
  options: { readonly rootMode: "existing" | "initialize" } = {
    rootMode: "existing",
  },
): Promise<void>;
```

- [ ] **Step 5: Add catalog-backed failure rendering**

```ts
export function transactionFailureResult(error: TransactionFailure): Result {
  return resultFor(error.reasonCode, {
    evidence:
      error.reasonCode === "runtime.internal_failure" ? [] : error.evidence,
    summary: "The managed transaction did not reach a committed state.",
    why: ["The durable transaction boundary reported a blocked condition."],
  });
}
```

Catch `TransactionFailure` before the generic fallback in `runCommandLine`.
Never classify by matching an error message. An `append_event` refusal uses
`runtime.state_corrupt` with `.brain/events.jsonl` as required relative
artifact evidence; internal failure has no evidence because the catalog
forbids it.

- [ ] **Step 6: Verify and commit**

```bash
npm test -- tests/runtime-composition.test.ts tests/cli-composition.test.ts tests/cli-contracts.test.ts
npm run typecheck
git add packages/runtime/src/composition packages/runtime/src/domain/result tests/runtime-composition.test.ts tests/cli-composition.test.ts tests/cli-contracts.test.ts
git commit -s -m "feat: apply state effects through transactions"
```

---

### Task 9: Prove fault, termination, security, and idempotence behavior

**Files:**

- Create: `tests/transaction-fault-campaign.test.ts`
- Create: `tests/transaction-process-recovery.test.ts`
- Create: `tests/fixtures/transactions/worker.ts`
- Modify: `vitest.config.ts` only if the existing timeout is insufficient
- Create: `docs/architecture/atomic-transactions.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `README.md`
- Modify: `.cspell.json` only for genuine project vocabulary

**Interfaces:**

- Consumes: production transaction composition and both adapters.
- Produces: required crash/fault evidence and public architecture docs.

- [ ] **Step 1: Add the deterministic fake matrix**

Enumerate every `DurableOperation`, `before`/`after`, and every occurrence
reached by a two-write/one-delete plan. Execute, inspect, recover, and recover
again. Assert terminal state and exact results:

```ts
expect(secondRecovery).toEqual(firstRecovery);
expect(finalSnapshot.files[".brain/a.json"]).toBe("a2");
expect(finalSnapshot.files[".brain/b.json"]).toBe("b1");
expect(finalSnapshot.files).not.toHaveProperty(".brain/delete.json");
```

Before publication the expected terminal phase is `aborted`; after publication
it is `committed`.

- [ ] **Step 2: Add named permission and disk-full injection**

Use sanitized internal labels `permission` and `disk_full`, but expose only
catalog-backed results. Assert staging bytes and absolute roots never enter
output or receipts.

- [ ] **Step 3: Build a killable worker fixture**

The worker accepts project root, barrier, and plan JSON as arguments, imports
the real Node transaction path, passes a test-only observer to
`nodeDurableFileSystem`, and sends IPC `{ kind: "barrier", name }` immediately
before or after the selected primitive. The parent bundles the TS fixture into
a temporary `.mjs` with esbuild, forks it with IPC, kills it at the barrier,
then inspects and recovers in a fresh process.

Do not pass payloads through environment variables or print them.

- [ ] **Step 4: Cover all durable process boundaries**

Cover after `begun`, final staged sync, manifest sync, `prepared`, `publishing`,
each rename/delete, each directory sync, `committed`, and cleanup. Use `SIGKILL`
where supported and an explicit forced-termination branch on Windows.

- [ ] **Step 5: Document the contract accurately**

Document the five phases, directory layout, explicit recovery binding, root
bootstrap modes, roll-forward rule, sync capabilities, reason mapping, reserved
namespace, and recoverable-vs-simultaneous atomicity. Link from runtime
boundaries and README without claiming a complete SDD trail.

- [ ] **Step 6: Verify and commit**

```bash
npm test -- tests/transaction-fault-campaign.test.ts tests/transaction-process-recovery.test.ts tests/node-transaction-security.test.ts
npm run spellcheck
npx --yes markdownlint-cli2@0.23.2 '**/*.md'
git add tests/transaction-fault-campaign.test.ts tests/transaction-process-recovery.test.ts tests/fixtures/transactions/worker.ts docs/architecture/atomic-transactions.md docs/architecture/runtime-boundaries.md README.md
git commit -s -m "test: prove transaction crash recovery"
```

Add `vitest.config.ts` or `.cspell.json` only if they actually changed.

---

### Task 10: Verify package boundaries and record evidence

**Files:**

- Modify: `tests/architecture.test.ts`
- Modify: `tests/runtime-distribution.test.ts`
- Modify: `tests/package-verifier.test.ts`
- Create: `docs/verification/issue-20-transaction-evidence.md`

**Interfaces:**

- Consumes: all transaction slices.
- Produces: bundle/package proof and PR-ready verification evidence.

- [ ] **Step 1: Add final boundary assertions**

Assert domain/ports import no builtins, the bundle embeds both transaction
schemas and the `runtime.recovery_required` policy, no checkout-relative schema
import survives, and the isolated three-file plugin still runs its public
orientation commands without global Yoda. Task 8's composition test owns actual
transaction-failure rendering until a public recovery command exists.

- [ ] **Step 2: Run package gates**

```bash
npm test -- tests/architecture.test.ts tests/runtime-distribution.test.ts tests/package-verifier.test.ts
npm run build
npm run package:verify
```

Expected: PASS and a version-coherent built manifest.

- [ ] **Step 3: Run complete repository verification**

```bash
npm run verify
```

Expected: formatting, spelling, lint, type, unit, coverage, oracle, parity,
result, contracts, differential, build, and package gates all pass.

- [ ] **Step 4: Write reproducible issue evidence**

Record exact toolchain, commands, test counts, fault-matrix count, termination
barriers, directory-sync capability, package result, issue/PR links, and explicit
out-of-scope status for `RUN-06`, `RUN-07`, and public recovery command wiring.
Do not include absolute local paths or staged content.

- [ ] **Step 5: Validate and commit evidence**

```bash
npx prettier --check docs/verification/issue-20-transaction-evidence.md
npx cspell --no-progress --show-suggestions --no-gitignore docs/verification/issue-20-transaction-evidence.md
npx --yes markdownlint-cli2@0.23.2 docs/verification/issue-20-transaction-evidence.md
git diff --check
git add tests/architecture.test.ts tests/runtime-distribution.test.ts tests/package-verifier.test.ts docs/verification/issue-20-transaction-evidence.md
git commit -s -m "docs: record transaction verification evidence"
```

- [ ] **Step 6: Re-run from a clean worktree**

```bash
test -z "$(git status --short)"
npm run verify
git status --short
```

Expected: both status checks are empty and verification exits 0. Update the PR
body with `Closes #20`, design decisions, compatibility impact, exact commands,
and CI links.
