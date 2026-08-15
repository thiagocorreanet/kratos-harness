# Contract Family Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish independently versioned plugin, persisted-state, and host contracts with closed schemas, deterministic compatibility classification, generated TypeScript declarations, and clean-room Go v3 migration profiles.

**Architecture:** JSON Schema 2020-12 files are the canonical wire definitions. A closed manifest registers current schemas, exact compatibility windows, and metadata-only legacy profiles; a pure contracts-package classifier consumes that manifest and returns universal results before any payload validation or mutation. Generated TypeScript declarations are committed and reproduced in a temporary directory for drift verification.

**Tech Stack:** Node.js `24.18.0`, npm `11.16.0`, TypeScript `6.0.2`, Ajv `8.20.0`, Vitest `4.1.10`, `json-schema-to-typescript` `15.0.4`, JSON Schema 2020-12.

## Global Constraints

- Keep `pluginVersion` at `0.0.0-development`, `stateContract` at `1.0.0`, and `hostContract` at `1.0.0`.
- Keep `schemas/`, fixtures, catalogs, and generated declarations immutable by versioned filename.
- Preserve `packages/contracts/catalogs/reason-codes.v1.json` and its SHA-256 digest `63f91e9ae2c2d1f0dce1ac6313b75a4e3fb27627920620c7bc6eed3ad63dc2e2`.
- Public artifacts may use only hash-and-metadata observations from the private Go v3 oracle; never copy private schema text, field lists, descriptions, fixtures, prompts, templates, source, or binaries.
- Register all 14 discovered legacy schema names as `migration-only`; bind `prd-output.schema.json` to digest `7fa4f468520fac2f2a0d3b766257e162d25f37520dd7507230616257f2fe503e` and preserve its inner payload bytes during later migration.
- Reject missing, non-string, malformed, untrimmed, unknown earlier, and future contract identities before payload validation or mutation.
- Commit every independently passing task with `git commit -s` and English commit messages.

---

### Task 1: Additive reason catalog revision

**Files:**

- Create: `packages/contracts/catalogs/reason-codes.v1.1.json`
- Create: `tests/contract-reason-catalog.test.ts`
- Modify: `scripts/lib/result-contract.mjs`

**Interfaces:**

- Consumes: the immutable `reason-codes.v1.json` catalog and `result.v1.schema.json`.
- Produces: current catalog revision `1.1.0`, containing all original entries plus six `contract.*` entries; the universal renderer resolves those new reasons.

- [ ] **Step 1: Write the failing additive-catalog test**

```ts
const additions = new Map([
  ["contract.plugin_version_invalid", 2],
  ["contract.plugin_version_unsupported", 2],
  ["contract.host_version_invalid", 2],
  ["contract.host_version_unsupported", 2],
  ["contract.state_version_invalid", 4],
  ["contract.state_version_unsupported", 4],
]);

expect(createHash("sha256").update(v1Text).digest("hex")).toBe(
  "63f91e9ae2c2d1f0dce1ac6313b75a4e3fb27627920620c7bc6eed3ad63dc2e2",
);
expect(v11.contractVersion).toBe("1.0.0");
expect(v11.reasons.slice(0, v1.reasons.length)).toEqual(v1.reasons);
expect(v11.reasons).toHaveLength(82);
for (const [code, exitCode] of additions) {
  expect(v11.reasons.find((reason) => reason.code === code)).toMatchObject({
    exitCode,
    evidence: "forbidden",
    stateChanged: false,
    retryable: false,
  });
}
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `npm test -- tests/contract-reason-catalog.test.ts`

Expected: FAIL because `reason-codes.v1.1.json` does not exist.

- [ ] **Step 3: Create the catalog and select it for rendering**

Copy the 76 parsed entries without changing their values or order, append the six exact codes above with unique safe descriptions/recoveries and the specified exit policy, and change only the renderer catalog path:

```js
join(repositoryRoot, "packages/contracts/catalogs/reason-codes.v1.1.json")
```

Keep `loadResultContract()` and `result:check` pointed at revision 1.0 so its immutable parity proof remains intact.

- [ ] **Step 4: Prove the new reasons render through the universal contract**

Extend the test to call `canonicalResultJson()` with one result per new reason. Use `status: "failure"` for exit 2 and `status: "blocked"` for exit 4, empty evidence, `stateChanged: false`, `retryable: false`, and the exact catalog recovery. Assert parsing the output returns the unchanged object.

- [ ] **Step 5: Run focused and regression tests**

Run: `npm test -- tests/contract-reason-catalog.test.ts tests/result-contract-catalog.test.ts tests/result-contract-rendering.test.ts`

Expected: PASS with the old digest test and all six new render cases green.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/catalogs/reason-codes.v1.1.json scripts/lib/result-contract.mjs tests/contract-reason-catalog.test.ts
git commit -s -m "feat: add contract compatibility reasons"
```

### Task 2: Canonical state and host schemas with fixtures

**Files:**

- Create: `schemas/contracts/contract-manifest.v1.schema.json`
- Create: `schemas/state/project-config.v1.schema.json`
- Create: `schemas/state/snapshot.v1.schema.json`
- Create: `schemas/state/event.v1.schema.json`
- Create: `schemas/state/approval.v1.schema.json`
- Create: `schemas/state/evidence.v1.schema.json`
- Create: `schemas/state/lock.v1.schema.json`
- Create: `schemas/state/migration.v1.schema.json`
- Create: `schemas/host/adapter-message.v1.schema.json`
- Create: `fixtures/contracts/v1/project-config.json`
- Create: `fixtures/contracts/v1/snapshot.json`
- Create: `fixtures/contracts/v1/event.json`
- Create: `fixtures/contracts/v1/approval.json`
- Create: `fixtures/contracts/v1/evidence.json`
- Create: `fixtures/contracts/v1/lock.json`
- Create: `fixtures/contracts/v1/migration.json`
- Create: `fixtures/contracts/v1/adapter-message.json`
- Create: `tests/contract-schemas.test.ts`

**Interfaces:**

- Consumes: universal result schema by `$ref` from the host response branch.
- Produces: nine closed JSON Schema 2020-12 documents and one valid fixture for each of the eight payload schemas.

- [ ] **Step 1: Write strict-compilation and fixture tests**

```ts
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(resultSchema);
for (const { schema, fixture } of artifacts) {
  expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  expect(schema.unevaluatedProperties ?? schema.additionalProperties).toBe(false);
  const validate = ajv.compile(schema);
  expect(validate(fixture), JSON.stringify(validate.errors)).toBe(true);
  expect(JSON.parse(JSON.stringify(fixture))).toEqual(fixture);
  expect(validate({ ...fixture, unexpected: true })).toBe(false);
}
```

Add mutations that remove each required family version and replace it with `2.0.0`; both must fail. Assert state fixtures carry `contractVersion` then `stateContract` as their first two keys and the host fixture carries `contractVersion` then `hostContract`.

- [ ] **Step 2: Run the schema test and verify red**

Run: `npm test -- tests/contract-schemas.test.ts`

Expected: FAIL because schema and fixture files are absent.

- [ ] **Step 3: Author common closed schema boundaries**

Every schema starts with this exact identity pattern and specializes its remaining properties:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mestre-yoda.dev/schemas/state/project-config/v1",
  "title": "Mestre Yoda project configuration v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["contractVersion", "stateContract"],
  "properties": {
    "contractVersion": { "const": "1.0.0" },
    "stateContract": { "const": "1.0.0" }
  }
}
```

Use bounded identifiers `^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`, lowercase SHA-256 `^[a-f0-9]{64}$`, RFC 3339 UTC timestamps, safe logical/project-relative references that reject `/`, drive prefixes, `..`, URLs, and control characters, and `additionalProperties: false` on every object including nested objects.

- [ ] **Step 4: Add the eight independently authored fixtures**

Use deterministic public example identities (`project-01`, `run-01`, `event-01`, `message-01`), timestamps rooted at `2026-08-07T00:00:00Z`, and SHA-256 strings of 64 lowercase hex characters. The event fixture must include `previousHash: null` plus `eventHash`; approval binds `prdDigest` and `specDigest`; migration identifies `go-v3@0.6.5` to `1.0.0`; the adapter request carries a logical payload reference and no inline private content.

- [ ] **Step 5: Run the focused test**

Run: `npm test -- tests/contract-schemas.test.ts`

Expected: PASS for strict compilation, closed-object rejection, version requirements, and all eight round trips.

- [ ] **Step 6: Commit**

```bash
git add schemas/contracts schemas/state schemas/host fixtures/contracts/v1 tests/contract-schemas.test.ts
git commit -s -m "feat: define state and host schemas"
```

### Task 3: Compatibility manifest and clean-room legacy profiles

**Files:**

- Create: `packages/contracts/catalogs/contract-families.v1.json`
- Create: `tests/contract-manifest.test.ts`

**Interfaces:**

- Consumes: the nine schemas, generated-type target names, oracle metadata, discovery schema names, and parity schema-row IDs.
- Produces: one closed, sorted, path-safe compatibility registry for plugin, result, reason, state, host, current schemas, and legacy migration profiles.

- [ ] **Step 1: Write failing manifest invariants**

```ts
expect(manifest).toMatchObject({
  contractVersion: "1.0.0",
  pluginVersion: "0.0.0-development",
  resultContract: "1.0.0",
  reasonCatalog: "1.1.0",
  stateContract: {
    current: "1.0.0",
    readable: ["1.0.0"],
    migrationOnly: ["0.9.0", "go-v3@0.6.5"],
  },
  hostContract: { current: "1.0.0", accepted: ["1.0.0"] },
});
expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
expect(manifest.schemas).toHaveLength(8);
expect(manifest.legacyProfiles.map(({ name }) => name)).toEqual(discoveredNames);
```

Also assert unique/sorted schema IDs and legacy names, repository-relative schema paths below `schemas/`, one parity row for 13 names, and the separate PRD anchor for `prd-output.schema.json`.

- [ ] **Step 2: Run and verify red**

Run: `npm test -- tests/contract-manifest.test.ts`

Expected: FAIL because the manifest does not exist.

- [ ] **Step 3: Author the manifest and validate provenance boundaries**

Each current schema entry uses this closed shape:

```json
{
  "id": "state.project-config",
  "family": "state",
  "version": "1.0.0",
  "path": "schemas/state/project-config.v1.schema.json",
  "boundary": "persisted",
  "typeName": "ProjectConfigV1"
}
```

Each legacy profile uses only metadata:

```json
{
  "name": "prd-output.schema.json",
  "oracleId": "go-v3-v0.6.5",
  "payloadContract": "go-v3.prd-output@1",
  "schemaVersion": 1,
  "compatibility": "migration-only",
  "parityRow": null,
  "sha256": "7fa4f468520fac2f2a0d3b766257e162d25f37520dd7507230616257f2fe503e"
}
```

Other profiles omit `sha256`, use their matching `SCHEMA-*` row, and never include a legacy field list or prose copied from the predecessor.

- [ ] **Step 4: Add negative manifest cases**

Clone and mutate the manifest in the test to reject a duplicate schema ID, unsorted profile names, `/tmp/schema.json`, `../schema.json`, a missing PRD digest, a PRD parity claim, an unregistered schema file, and a mixed plugin version.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/contract-manifest.test.ts tests/contract-schemas.test.ts`

Expected: PASS with all 14 profiles present exactly once and no private content published.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/catalogs/contract-families.v1.json tests/contract-manifest.test.ts
git commit -s -m "feat: register contract compatibility families"
```

### Task 4: Pure version classifier and universal failures

**Files:**

- Create: `packages/contracts/src/compatibility.ts`
- Create: `fixtures/contracts/v1/version-cases.json`
- Create: `tests/contract-compatibility.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**

- Consumes: `contract-families.v1.json` and reason catalog `1.1.0`.
- Produces: `classifyContractVersion(family, value)` returning `current`, `migration_required`, `invalid`, or `unsupported`; `contractFailureResult(classification)` returning a safe universal result for non-current outcomes.

- [ ] **Step 1: Write table-driven failing tests**

```ts
interface VersionCase {
  readonly family: "plugin" | "state" | "host";
  readonly value?: unknown;
  readonly classification:
    | "current"
    | "migration_required"
    | "invalid"
    | "unsupported";
  readonly reasonCode: string | null;
}

for (const fixture of cases) {
  const before = structuredClone(fixture);
  const result = classifyContractVersion(fixture.family, fixture.value);
  expect(result.classification).toBe(fixture.classification);
  expect(result.reasonCode).toBe(fixture.reasonCode);
  expect(fixture).toEqual(before);
}
```

The fixture table covers each family at current `1.0.0` or `0.0.0-development`, state previous `0.9.0`, state legacy `go-v3@0.6.5`, host previous `0.9.0`, future `2.0.0`, malformed `1.x`, missing, numeric, and padded ` 1.0.0 `.

- [ ] **Step 2: Run and verify red**

Run: `npm test -- tests/contract-compatibility.test.ts`

Expected: FAIL because the exports do not exist.

- [ ] **Step 3: Implement exact, non-coercing classification**

```ts
export type ContractFamily = "plugin" | "state" | "host";
export type CompatibilityClass =
  | "current"
  | "migration_required"
  | "invalid"
  | "unsupported";

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

export function classifyContractVersion(
  family: ContractFamily,
  value: unknown,
): ContractClassification {
  if (typeof value !== "string" || !semver.test(value)) {
    return invalidClassification(family);
  }
  if (isCurrent(family, value)) return currentClassification(family, value);
  if (family === "state" && value === "0.9.0") {
    return migrationClassification(family, value);
  }
  return unsupportedClassification(family, value);
}
```

Treat `go-v3@0.6.5` as the sole non-SemVer recognized state sentinel before the SemVer check and classify it `migration_required`. Host `0.9.0` remains `unsupported`. Return no caller value in public summary, why, or recovery.

- [ ] **Step 4: Build catalog-owned universal failure results**

Map invalid/unsupported classifications to the six catalog entries, use fixed family-specific summary/why strings, empty evidence, and validate each returned result through `canonicalResultJson()`. A `current` or `migration_required` classification must not be passed to `contractFailureResult()` and throws a fixed programmer error with no input echo.

- [ ] **Step 5: Verify classification happens before mutation**

Use a mutation spy callback in the test harness, invoke it only after `current`, and assert it remains untouched for previous/future/malformed/missing cases. Assert JSON round-trip and exact reason/exit/recovery for every failure case.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/contract-compatibility.test.ts tests/contract-reason-catalog.test.ts`

Expected: PASS for all table rows, safe result rendering, and zero mutation claims.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/compatibility.ts packages/contracts/src/index.ts fixtures/contracts/v1/version-cases.json tests/contract-compatibility.test.ts
git commit -s -m "feat: classify contract compatibility"
```

### Task 5: Reproducible schema-derived TypeScript declarations

**Files:**

- Create: `scripts/generate-contract-types.mjs`
- Create: `scripts/check-contracts.mjs`
- Create: `packages/contracts/src/generated/contracts.ts`
- Create: `tests/contract-type-generation.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes: manifest `schemas[].path`/`typeName` and all registered schemas.
- Produces: deterministic generated declarations; `npm run contracts:generate`; non-mutating `npm run contracts:check`.

- [ ] **Step 1: Pin the generator and add a failing drift test**

Run: `npm install --save-dev --save-exact json-schema-to-typescript@15.0.4`

Then add:

```ts
const result = spawnSync(process.execPath, ["scripts/check-contracts.mjs"], {
  cwd: repositoryRoot,
  encoding: "utf8",
});
expect(result.status).toBe(0);
expect(result.stderr).toBe("");
expect(result.stdout).toMatch(/^contract families v1\.0\.0: verified/u);
```

- [ ] **Step 2: Run and verify red**

Run: `npm test -- tests/contract-type-generation.test.ts`

Expected: FAIL because the checker is absent.

- [ ] **Step 3: Implement deterministic generation**

The generator exports `generateContractTypes({ outputPath })`, loads sorted manifest schema entries, computes SHA-256 over each source text, invokes `compile(schema, typeName, { bannerComment: "", format: false, ignoreMinAndMaxItems: false, strictIndexSignatures: true })`, formats a deterministic header plus declarations with Prettier, and writes only the explicit output path. The checked-in header records each `$id` and digest, not local absolute paths.

- [ ] **Step 4: Implement non-mutating verification**

```js
const temporary = await mkdtemp(join(tmpdir(), "mestre-yoda-contracts-"));
try {
  const candidate = join(temporary, "contracts.ts");
  await generateContractTypes({ outputPath: candidate });
  if ((await readFile(candidate, "utf8")) !== (await readFile(committed, "utf8"))) {
    throw new Error("Contract verification failed: generated declarations drifted");
  }
} finally {
  await rm(temporary, { force: true, recursive: true });
}
```

The same checker compiles all schemas in strict Ajv 2020 mode, validates the manifest, ensures every `schemas/state`, `schemas/host`, and `schemas/contracts` JSON file is registered, and reports only fixed safe failure categories.

- [ ] **Step 5: Generate, export, and script the declarations**

Add these exact scripts:

```json
"contracts:generate": "node scripts/generate-contract-types.mjs",
"contracts:check": "node scripts/check-contracts.mjs"
```

Export generated declarations using `export type { ... } from "./generated/contracts.js";`, run `npm run contracts:generate`, and make `verify` run `contracts:check` after `result:check`.

- [ ] **Step 6: Prove drift is detected without modifying the checkout**

In the test, copy the generated declaration to a temporary fixture, alter one digest, invoke the checker with a documented `--generated` path, assert fixed exit 1, and compare the real checked-in file before/after. Add usage tests for unknown or duplicate flags returning exit 2.

- [ ] **Step 7: Run focused verification**

Run: `npm run contracts:check && npm test -- tests/contract-type-generation.test.ts && npm run typecheck`

Expected: PASS; output names contract family version `1.0.0`, eight payload schemas, 14 legacy profiles, and generated-type parity.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json scripts/generate-contract-types.mjs scripts/check-contracts.mjs packages/contracts/src/generated/contracts.ts packages/contracts/src/index.ts tests/contract-type-generation.test.ts
git commit -s -m "build: verify schema-derived contract types"
```

### Task 6: Public contract documentation and end-to-end evidence

**Files:**

- Create: `docs/compatibility/contract-versioning.md`
- Modify: `schemas/README.md`
- Modify: `fixtures/README.md`
- Modify: `README.md`
- Create: `tests/contract-documentation.test.ts`

**Interfaces:**

- Consumes: finalized manifest, schemas, compatibility API, commands, fixtures, and provenance rules.
- Produces: public operational documentation whose claims are executable and keep runtime status honest.

- [ ] **Step 1: Write failing documentation contract tests**

```ts
for (const token of [
  "pluginVersion",
  "stateContract",
  "hostContract",
  "migration-only",
  "npm run contracts:check",
  "go-v3.prd-output@1",
]) {
  expect(guide).toContain(token);
}
expect(readme).toContain("Contract schemas and compatibility checks are available");
expect(readme).toContain("The harness runtime is not usable yet");
```

- [ ] **Step 2: Run and verify red**

Run: `npm test -- tests/contract-documentation.test.ts`

Expected: FAIL because the guide and README claim do not exist.

- [ ] **Step 3: Document support and recovery**

Explain exact identity ownership, state `0.9.0` and `go-v3@0.6.5` migration-only handling, host `0.9.0` upgrade requirement, future-version rejection, failure-before-mutation, reason exits, schema/type workflow, and versioned immutability. State explicitly that PRD behavior remains migration-only until issue #13 proves differential parity and that the legacy PRD bytes are never rewritten inside their envelope.

- [ ] **Step 4: Update schema, fixture, and README indexes**

Link the guide, enumerate all eight payload fixtures, show `npm run contracts:generate` and `npm run contracts:check`, and describe schemas as shipped contract infrastructure rather than a usable orchestration runtime.

- [ ] **Step 5: Run documentation and link verification**

Run: `npm test -- tests/contract-documentation.test.ts && npm run format:check && npm run spellcheck`

Run: `markdownlint-cli2 "**/*.md" "!node_modules/**" && lychee --offline --no-progress "**/*.md"`

Expected: all tests, formatting, spelling, Markdown rules, and offline links pass.

- [ ] **Step 6: Commit**

```bash
git add docs/compatibility/contract-versioning.md schemas/README.md fixtures/README.md README.md tests/contract-documentation.test.ts
git commit -s -m "docs: publish contract versioning guide"
```

### Task 7: Full verification and delivery

**Files:**

- Modify only files required by concrete failures or review findings.

**Interfaces:**

- Consumes: all prior task deliverables.
- Produces: reproducible repository evidence and a review-ready issue #12 delivery.

- [ ] **Step 1: Run focused contract verification**

Run: `npm run contracts:check && npm test -- tests/contract-reason-catalog.test.ts tests/contract-schemas.test.ts tests/contract-manifest.test.ts tests/contract-compatibility.test.ts tests/contract-type-generation.test.ts tests/contract-documentation.test.ts`

Expected: PASS with eight current payload schemas, 14 migration profiles, 82 current reasons, and every version case classified.

- [ ] **Step 2: Run the full repository gate**

Run: `npm run verify`

Expected: format, spelling, lint, typecheck, tests, 100% configured runtime coverage, oracle, parity, old result contract, new contract check, build, and package verification all pass.

- [ ] **Step 3: Run repository policy checks**

Run: `git diff --check main...HEAD && actionlint && markdownlint-cli2 "**/*.md" "!node_modules/**" && lychee --offline --no-progress "**/*.md"`

Expected: no whitespace, Actions, Markdown, or offline-link failures.

- [ ] **Step 4: Request independent review**

Ask the reviewer to compare issue #12, the approved design, old immutable catalog digest, clean-room provenance boundary, PRD migration-only guarantee, all schemas/fixtures, classifier fail-closed behavior, and generated-type reproducibility. Resolve every Critical or Important finding with a failing regression test followed by a DCO commit.

- [ ] **Step 5: Publish and close**

Push `feat/issue-12-contract-families`, open a PR whose body includes `Closes #12`, compatibility impact, provenance statement, PRD guarantee, and verification evidence. After all required checks pass, squash-merge, verify issue #12 is closed, check its item in epic #8, pull `main`, and remove the owned worktree/branch.
