# Schema Registry Re-evaluation Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the clean-checkout, inert-data, output-boundary, coverage, and
version-corpus gaps found while re-evaluating issue #19 and PR #91.

**Architecture:** Version classification remains the first registry step. A new
infrastructure data-shape guard rejects proxies, accessors, custom prototypes,
cycles, and non-JSON values before Ajv can observe them. CLI composition uses
the existing production registry and `prepareContract` before publishing the
existing adapter message. Distribution tests build their own artifact, and the
coverage gate expands to the complete registry implementation.

**Tech Stack:** TypeScript 6.0.2, Node.js 24.18.0, npm 11.16.0, Ajv 8.20.0,
Vitest 4.1.10, esbuild 0.28.1, JSON Schema 2020-12.

## Global Constraints

- Use Node.js `24.18.0` and npm `11.16.0` exactly for every npm command.
- Follow strict RED-GREEN-REFACTOR; record the expected RED output before
  changing production behavior.
- Keep source, tests, fixtures, comments, errors, documentation, commits, and
  PR text in English.
- Do not change a JSON Schema, generated declaration, public reason code,
  compatibility window, legacy profile, command inventory, or parity row.
- Keep all schema access embedded and offline; add no filesystem or network
  capability to the registry.
- Preserve original value identity for accepted ordinary and null-prototype
  data objects; do not coerce, default, clone, or mutate values.
- Preserve the three-file plugin distribution and only Node built-in external
  imports.
- Keep parity exactly `0 / 400 (0.00%)`.
- End every independently green task with a DCO sign-off commit.

---

### Task 1: Make distribution verification hermetic

**Files:**

- Modify: `tests/runtime-distribution.test.ts:1-70`

**Interfaces:**

- Consumes: `scripts/build.mjs` and the repository-root path already computed
  by the test.
- Produces: a distribution suite that creates the exact artifact it inspects,
  even when `dist/` is absent.

- [ ] **Step 1: Reproduce RED from a clean detached worktree**

Create a temporary detached worktree at the task base SHA, run `npm ci` under
the exact toolchain, assert `dist/` is absent, then run:

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c \
  './node_modules/.bin/vitest run tests/runtime-distribution.test.ts'
```

Expected: FAIL at `tests/runtime-distribution.test.ts:51` with `ENOENT` for
`dist/plugin/runtime/manifest.json`.

- [ ] **Step 2: Build synchronously before reading the artifact**

Add the child-process import:

```ts
import { execFileSync } from "node:child_process";
```

Change the existing top-level `beforeAll` to run the repository build before
the `Promise.all` reads:

```ts
beforeAll(async () => {
  execFileSync(process.execPath, ["scripts/build.mjs"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
  const [manifestText, entryText, coreBytes, catalogText] = await Promise.all([
    // Preserve the existing reads unchanged.
  ]);
  // Preserve the existing assignments unchanged.
});
```

- [ ] **Step 3: Verify focused GREEN without a pre-existing artifact**

Remove only the temporary worktree's ignored `dist/`, then run the same focused
command from Step 1.

Expected: PASS, 1 file and 22 tests.

- [ ] **Step 4: Run affected static checks**

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c \
  './node_modules/.bin/prettier --check tests/runtime-distribution.test.ts && npm run lint && npm run typecheck'
```

Expected: PASS.

- [ ] **Step 5: Commit the hermetic suite**

```bash
git add tests/runtime-distribution.test.ts
git commit -s -m "test: build distribution before inspection"
```

---

### Task 2: Reject executable and non-inert input before Ajv

**Files:**

- Create: `packages/runtime/src/infra/schema/data-shape.ts`
- Modify: `packages/runtime/src/infra/schema/diagnostics.ts`
- Modify: `packages/runtime/src/infra/schema/registry.ts`
- Test: `tests/schema-registry.test.ts`

**Interfaces:**

- Produces internally:
  `isInertJsonData(value: unknown): boolean`.
- Produces internally:
  `dataShapeDiagnostics(contract, version, structuralReasonCode)` returning one
  root `type` diagnostic with the existing recovery policy.
- Preserves the public `SchemaRegistry` interface and validation result shape.

- [ ] **Step 1: Write failing zero-execution tests**

Add real production-registry tests covering:

```ts
it("rejects an own accessor without invoking it", () => {
  let calls = 0;
  const value = structuredClone(projectConfig) as Record<string, unknown>;
  Object.defineProperty(value, "language", {
    enumerable: true,
    get() {
      calls += 1;
      return "en";
    },
  });

  expect(registry.validate(projectConfigRequest(value))).toEqual({
    kind: "invalid",
    diagnostics: [rootProjectConfigTypeDiagnostic],
  });
  expect(calls).toBe(0);
});
```

Add separate cases for a throwing own getter, a nested getter, a custom
prototype with an inherited getter, and a proxy whose `ownKeys`,
`getOwnPropertyDescriptor`, and `get` traps increment counters. Every counter
must remain zero and every result must contain only the sanitized root
diagnostic. Update the existing inherited-only test to assert zero observation
rather than Ajv's required-field list.

- [ ] **Step 2: Verify RED is the demonstrated execution defect**

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c \
  './node_modules/.bin/vitest run tests/schema-registry.test.ts'
```

Expected: FAIL because own/inherited getters or proxy traps execute, or the
accessor-backed object is accepted.

- [ ] **Step 3: Implement the inert-data guard**

Create `data-shape.ts` with this internal contract:

```ts
import { types } from "node:util";

export function isInertJsonData(value: unknown): boolean {
  return inspect(value, new WeakSet<object>());
}

function inspect(value: unknown, active: WeakSet<object>): boolean {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || types.isProxy(value)) return false;
  if (active.has(value)) return false;

  if (Array.isArray(value)) return inspectArray(value, active);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return inspectObject(value as Record<string, unknown>, active);
}
```

`inspectArray` must enter/delete the active set in `try/finally`, require one
own data descriptor for every numeric index from zero through `length - 1`, and
recursively inspect only `descriptor.value`. `inspectObject` must likewise use
`Object.keys`, require own data descriptors, inspect descriptor values, and
never evaluate `value[key]`. Shared acyclic objects remain allowed because each
container leaves the active set after its subtree is inspected.

- [ ] **Step 4: Add one sanitized data-shape diagnostic**

Refactor recovery lookup in `diagnostics.ts` into one private helper shared by
Ajv normalization and:

```ts
export function dataShapeDiagnostics(
  contract: ContractId,
  version: string,
  structuralReasonCode: StructuralReasonCode,
): readonly ValidationDiagnostic[] {
  return [
    {
      contract,
      version,
      pointer: "",
      keyword: "type",
      reasonCode: structuralReasonCode,
      recovery: recoveryFor(structuralReasonCode),
    },
  ];
}
```

The helper must throw only `Embedded schema registry is invalid` when the
committed policy is unavailable.

- [ ] **Step 5: Place the guard after version selection and before Ajv**

In `registry.ts`, preserve version-first behavior, then add:

```ts
if (!isInertJsonData(request.value)) {
  return {
    kind: "invalid" as const,
    diagnostics: dataShapeDiagnostics(
      request.id,
      version,
      request.structuralReasonCode,
    ),
  };
}
```

Keep the call inside the existing sanitized registry error boundary so an
internal policy defect never leaks implementation text.

- [ ] **Step 6: Add data-model edge tests and verify GREEN**

Add cases for cycles, sparse arrays, non-finite numbers, symbols, functions,
ordinary objects, null-prototype objects, and one shared acyclic child. Reject
the unsupported cases at the root without leaking data; accept the supported
cases only when their schema also matches.

Run:

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c \
  './node_modules/.bin/vitest run tests/schema-registry.test.ts tests/schema-registry-fixtures.test.ts tests/schema-boundary.test.ts tests/canonical-json.test.ts'
```

Expected: PASS with every getter/trap counter equal to zero.

- [ ] **Step 7: Run affected architecture and type checks**

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c \
  './node_modules/.bin/vitest run tests/architecture.test.ts tests/schema-registry-types.test.ts && npm run lint && npm run typecheck'
```

Expected: PASS. `node:util` exists only in infrastructure.

- [ ] **Step 8: Commit the inert boundary**

```bash
git add packages/runtime/src/infra/schema tests/schema-registry.test.ts
git commit -s -m "fix: reject executable schema input"
```

---

### Task 3: Revalidate adapter messages before effects and output

**Files:**

- Modify: `packages/runtime/src/composition/cli.ts`
- Test: `tests/cli-composition.test.ts`
- Test: `tests/cli-contracts.test.ts`
- Test: `tests/runtime-composition.test.ts`

**Interfaces:**

- Consumes: `CONTRACT_IDENTITIES.host`, `prepareContract`, `SchemaRegistry`,
  and the singleton returned by `createSchemaRegistry()`.
- Preserves the first three `runCommandLine` arguments.
- Adds an optional fourth `schemaRegistry: SchemaRegistry` injection defaulting
  to the production registry.

- [ ] **Step 1: Write a failing malformed-output regression**

Add a command registry entry declaring `adapter-message@1.0.0`, returning a
successful result, a `write_file` plan, and an ordinary JSON payload such as
`{ not: "an adapter message" }`. Call `runCommandLine` in JSON mode.

Assert:

```ts
expect(exitCode).toBe(2);
expect(await fileSystem.stat("must-not-change.txt")).toBeNull();
expect(output.structured_.join("")).not.toContain("an adapter message");
expect(JSON.parse(output.structured_.join(""))).toMatchObject({
  reasonCode: "runtime.internal_failure",
});
```

Add an injected recording `SchemaRegistry` test proving validation occurs
before `applyPlan` and output. Add a valid handshake assertion that stdout is
exactly the canonical adapter payload plus one newline.

- [ ] **Step 2: Verify RED publishes the malformed payload**

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c \
  './node_modules/.bin/vitest run tests/cli-composition.test.ts tests/cli-contracts.test.ts'
```

Expected: FAIL because the malformed payload exits zero or reaches stdout.

- [ ] **Step 3: Add the schema-registry composition dependency**

Change the public function signature without breaking existing callers:

```ts
export async function runCommandLine(
  argv: readonly string[],
  ports: RuntimePorts,
  commandRegistry: CommandRegistry = DEFAULT_REGISTRY,
  schemaRegistry: SchemaRegistry = createSchemaRegistry(),
): Promise<number> {
```

Rename internal uses of the third argument from `registry` to
`commandRegistry`. Import the schema types/helpers only at the composition
layer.

- [ ] **Step 4: Prepare adapter output before any effect**

Add a focused helper:

```ts
function prepareAdapterPayload(
  payload: unknown,
  registry: SchemaRegistry,
): string {
  const prepared = prepareContract(registry, {
    id: "host.adapter-message",
    version: CONTRACT_IDENTITIES.host,
    value: payload,
    structuralReasonCode: "trail.output_invalido",
  });
  if (prepared.kind === "invalid") {
    throw new Error("Command payload does not satisfy its declared contract");
  }
  validatePublicText(prepared.canonical);
  return `${prepared.canonical}\n`;
}
```

After `validateResult` and `validatePlan`, prepare an adapter payload whenever
the command declares `adapter-message@1.0.0`. Do this before calculating final
stdout, calling `applyPlan`, or writing output. Use the prepared canonical text
for both JSON and human invocation of that adapter command. Result commands
retain their existing renderers and human text behavior.

- [ ] **Step 5: Verify focused GREEN and compatibility**

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c \
  './node_modules/.bin/vitest run tests/cli-composition.test.ts tests/cli-contracts.test.ts tests/cli-commands.test.ts tests/runtime-composition.test.ts tests/schema-boundary.test.ts'
```

Expected: PASS. Invalid adapter output applies no effect and emits only the
sanitized internal failure. Handshake remains schema-valid and deterministic.

- [ ] **Step 6: Run lint and type checks**

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c \
  'npm run lint && npm run typecheck'
```

Expected: PASS.

- [ ] **Step 7: Commit output-boundary integration**

```bash
git add packages/runtime/src/composition/cli.ts tests/cli-composition.test.ts tests/cli-contracts.test.ts tests/runtime-composition.test.ts
git commit -s -m "fix: validate adapter output before publication"
```

---

### Task 4: Expand registry coverage and version evidence

**Files:**

- Modify: `vitest.config.ts`
- Modify: `tests/schema-catalog.test.ts`
- Modify: `tests/schema-registry.test.ts`
- Modify: `tests/schema-registry-fixtures.test.ts`
- Modify: `docs/architecture/schema-registry.md`

**Interfaces:**

- Expands the existing coverage allowlist; changes no production API.
- Consumes `fixtures/contracts/v1/version-cases.json` as the committed version
  evidence source.

- [ ] **Step 1: Expand coverage and observe RED**

Add this entry to `coverage.include` in `vitest.config.ts`:

```ts
"packages/runtime/src/infra/schema/**",
```

Run:

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c 'npm run test:coverage'
```

Expected: FAIL the 100% thresholds. Record the exact uncovered branches and
lines; the pre-remediation measurement was 95.55% statements, 87.87% branches,
100% functions, and 98.37% lines for `infra/schema` alone.

- [ ] **Step 2: Cover real catalog and diagnostic branches**

Extend catalog tests with cloned entries that independently exercise missing or
empty `$id`, duplicate `$id`, inconsistent family/version constraints,
enum-backed versions, and missing manifest positions. Extend diagnostic tests
with a forged required error whose missing property is not a string and
multi-diagnostic ties that reach every deterministic comparator field.

Each case must call the real exported registry/catalog behavior and assert only
the sanitized public error or diagnostics. Do not add tests solely to execute
unreachable code.

- [ ] **Step 3: Cover registry sanitization branches**

Add injectable catalog/dependency cases that exercise invalid schema IDs,
version-diagnostic policy failures, missing compiled validators, and the inert
data-shape branches introduced by Task 2. Preserve one exact assertion that no
engine exception or payload text escapes.

- [ ] **Step 4: Route the committed version corpus through the registry**

Import `version-cases.json`. Exclude only plugin cases because the schema
registry intentionally contains state and host contracts. For each remaining
case, validate a representative family contract with `value: null` and assert:

- current versions proceed to structural validation;
- invalid versions return the family invalid reason with `version: null`;
- future/previous unsupported versions return the family unsupported reason;
- migration-only state identities map to the existing unsupported recovery.

Additionally parameterize every catalog entry for missing, `2.0.0`, and the
family-applicable `0.9.0` case so each registered contract has direct boundary
evidence.

- [ ] **Step 5: Update the architecture guarantee**

Document that current-version payloads must be inert JSON data before Ajv,
accessors and proxies are rejected without execution, and the existing
handshake adapter output crosses `prepareContract` before effects or stdout.
State that coverage includes the complete registry implementation.

- [ ] **Step 6: Reach honest 100% coverage**

Repeat focused tests after every added case, then run:

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c 'npm run test:coverage'
```

Expected: PASS at 100% statements, branches, functions, and lines with
`infra/schema/**` included.

- [ ] **Step 7: Run focused registry/documentation verification**

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c \
  './node_modules/.bin/vitest run tests/schema-catalog.test.ts tests/schema-registry.test.ts tests/schema-registry-fixtures.test.ts tests/readme-honesty.test.ts tests/architecture.test.ts && npm run spellcheck && npm run typecheck'
```

Expected: PASS.

- [ ] **Step 8: Commit honest coverage and evidence**

```bash
git add vitest.config.ts tests/schema-catalog.test.ts tests/schema-registry.test.ts tests/schema-registry-fixtures.test.ts docs/architecture/schema-registry.md
git commit -s -m "test: cover the complete schema boundary"
```

---

### Task 5: Verify clean delivery and refresh PR evidence

**Files:**

- Modify: PR #91 body through GitHub after all local evidence is green.
- No repository source file is expected unless a preceding verification finds
  a concrete defect.

**Interfaces:**

- Produces final reproducible evidence for issue #19; changes no runtime API.

- [ ] **Step 1: Run all focused affected suites**

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c \
  './node_modules/.bin/vitest run tests/runtime-distribution.test.ts tests/schema-registry.test.ts tests/schema-registry-fixtures.test.ts tests/schema-boundary.test.ts tests/schema-composition.test.ts tests/cli-composition.test.ts tests/cli-contracts.test.ts tests/package-verifier.test.ts'
```

Expected: PASS.

- [ ] **Step 2: Run repository verification in the issue worktree**

```bash
npx --yes -p node@24.18.0 -p npm@11.16.0 -c 'npm run verify'
git diff --check origin/main...HEAD
git status --short
```

Expected: PASS, clean diff check, and clean worktree.

- [ ] **Step 3: Prove a clean checkout independently**

Create a temporary detached worktree at final HEAD, confirm `dist/` and
`node_modules/` are absent, run exact `npm ci`, then run `npm run verify` under
the pinned toolchain.

Expected: all tests and 100% expanded coverage pass without any earlier build;
package inventory is exactly `runtime/manifest.json`,
`runtime/yoda.core.mjs`, and `runtime/yoda.mjs`; parity remains
`0 / 400 (0.00%)`.

- [ ] **Step 4: Request an independent whole-branch review**

Review `origin/main...HEAD` against issue #19, the original design, and the
remediation design. The reviewer must explicitly reassess clean-checkout
reproducibility, zero getter/proxy execution, adapter output ordering,
sanitization, expanded coverage, compatibility, and package boundaries.

Expected: no Critical or Important findings and `Ready to merge? Yes`.

- [ ] **Step 5: Push and refresh draft PR #91**

Push the branch, replace stale verification/review totals in the PR body, and
retain `Closes #19`. Do not mark ready or merge until both GitHub Actions checks
are green.

- [ ] **Step 6: Monitor GitHub Actions**

Watch PR #91 checks to completion. If a GitHub Actions check fails, inspect its
logs, report the root cause, and return to the corresponding TDD task before
attempting another fix.

Expected: Documentation and `Node quality and package` both succeed.
