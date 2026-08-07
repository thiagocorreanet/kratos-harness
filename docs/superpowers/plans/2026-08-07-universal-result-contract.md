# Universal Result Contract Implementation Plan

<!-- cspell:words divergente estado ilegivel trilho -->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish and mechanically verify the version 1 universal result schema, complete reason catalog, six exit-category examples, safe renderers, and compatibility documentation.

**Architecture:** JSON Schema owns closed wire shapes, a versioned JSON catalog owns reason policy, and an offline JavaScript library cross-validates the two. Fixtures prove all exit classes and rendering functions prove deterministic human/JSON output without introducing runtime state behavior.

**Tech Stack:** Node.js 24.18.0, npm 11.16.0, ESM JavaScript, JSON Schema 2020-12, Ajv 8.20.0, TypeScript 6, Vitest 4, Prettier 3.

## Global Constraints

- Preserve all 71 `reason_codes` names in `compatibility/inventory/go-v3-v0.6.5/discovery.json` exactly.
- Add only these runtime reasons: `runtime.internal_failure`, `runtime.state_corrupt`, `runtime.recovery_required`, `runtime.lease_conflict`, and `runtime.revision_conflict`.
- Preserve legacy process exits 0 through 3; exits 4 and 5 are additive and must not be described as Go behavior.
- Every result contains exactly `contractVersion`, `status`, `exitCode`, `reasonCode`, `summary`, `why`, `evidence`, `stateChanged`, `retryable`, and `recovery` in that canonical order.
- Never publish private source, prompt/schema bodies, fixture payloads, binaries, clone URLs, credentials, absolute local paths, customer data, or stack traces.
- Repository-authored source, data, examples, tests, comments, errors, documentation, commits, and PR text are English-only.
- Use DCO-signed commits (`git commit -s`).
- Keep public CI offline and deterministic.

---

### Task 1: Lock the Wire and Catalog Shapes with RED Tests

**Files:**

- Create: `tests/result-contract-schema.test.ts`
- Create: `tests/result-contract-catalog.test.ts`

**Interfaces:**

- Consumes: design fields/status/exit rules and the parity discovery reason names.
- Produces: executable requirements for `schemas/result.v1.schema.json`, `schemas/reason-catalog.v1.schema.json`, and `packages/contracts/catalogs/reason-codes.v1.json`.

- [x] **Step 1: Write the absent-artifact schema test**

Create a test that loads both schemas and the catalog, compiles schemas with
`new Ajv2020({ allErrors: true, strict: true })`, and asserts exact identities:

```ts
expect(resultSchema).toMatchObject({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://mestre-yoda.dev/schemas/result/v1",
  title: "Mestre Yoda Universal Result v1",
  type: "object",
  additionalProperties: false,
});
expect(catalogSchema.$id).toBe(
  "https://mestre-yoda.dev/schemas/reason-catalog/v1",
);
expect(catalog).toMatchObject({
  contractVersion: "1.0.0",
  reasons: expect.any(Array),
});
```

Assert the result required fields are exactly the ten global fields, statuses
are `success|failure|blocked`, and exit codes are integers 0..5. Validate one
minimal result for each conditional and reject an unknown property, a failure
with empty `why`, a success with recovery, and an absolute evidence ref.

- [x] **Step 2: Write the absent-catalog completeness test**

Load the 71 discovery names and assert:

```ts
const runtimeCodes = [
  "runtime.internal_failure",
  "runtime.lease_conflict",
  "runtime.recovery_required",
  "runtime.revision_conflict",
  "runtime.state_corrupt",
];
expect(catalog.reasons.map(({ code }) => code)).toEqual(
  [...legacyCodes, ...runtimeCodes].sort(),
);
expect(catalog.reasons).toHaveLength(76);
```

For every entry assert exact keys `code`, `description`, `status`, `exitCode`,
`evidence`, `stateChanged`, `retryable`, `recovery`; nonempty condition-specific
description and non-success recovery; null success recovery; lowercase stable
code; exit/status consistency; sorted unique codes; and no description or
non-null recovery duplicated across entries.

- [x] **Step 3: Confirm RED**

Run:

```bash
npm test -- --run tests/result-contract-schema.test.ts tests/result-contract-catalog.test.ts
```

Expected: both files fail because schemas and catalog do not exist.

- [x] **Step 4: Commit the failing contract**

```bash
git add tests/result-contract-schema.test.ts tests/result-contract-catalog.test.ts
git commit -s -m "test: specify universal result contract"
```

---

### Task 2: Implement Closed JSON Schemas and the Complete Reason Ledger

**Files:**

- Create: `schemas/result.v1.schema.json`
- Create: `schemas/reason-catalog.v1.schema.json`
- Create: `packages/contracts/catalogs/reason-codes.v1.json`
- Modify: `schemas/README.md`

**Interfaces:**

- Consumes: Task 1 exact tests and the 71 immutable discovery keys.
- Produces: schemas compiled by Ajv and a sorted 76-entry catalog consumed by every later task.

- [x] **Step 1: Implement the result schema**

Define closed `$defs.evidence` with required `kind` and `ref`, optional
lowercase-hex `sha256`, `kind` enum `artifact|event|approval|test|observation`,
and safe-ref pattern rejecting slash-rooted paths, drive/UNC paths, traversal,
control characters, schemes, and credential-like text. Define the ten required
properties in canonical order. Use `allOf` `if/then` branches:

```json
{
  "if": { "properties": { "exitCode": { "const": 0 } }, "required": ["exitCode"] },
  "then": {
    "properties": {
      "status": { "const": "success" },
      "retryable": { "const": false },
      "recovery": { "type": "null" }
    }
  }
}
```

Repeat for exits 1/2 => failure and 3/4/5 => blocked, requiring nonempty `why`
and string recovery. Make summary/why safe nonempty single-line strings with a
4,096-character ceiling and disallow control characters.

- [x] **Step 2: Implement the catalog schema**

Require exact top-level fields `contractVersion` and `reasons`. Each closed
reason entry uses the eight fields from Task 1. Enforce the stable code regex,
description/recovery safe-line rules, null success recovery, status/exit
conditionals, evidence enum
`required|optional|forbidden`, and a minimum of 76 entries.

- [x] **Step 3: Author all 76 reason entries**

Use the old Go behavior and parity row reference to assign legacy exits:

- exit 0: `run.*`, `done.all_steps`, `trail.ok`, `trail.nao_trilho`,
  `trail.sem_run`, `no_git`, `guard.external_path`, and
  `guard.uninspectable` orientation/success outcomes;
- exit 1: the two `dashboard.*` validation/read outcomes;
- exit 2: usage/environment reasons including `trail.uso`,
  `trail.maintenance_tty`, `trail.worktree_dirty`, blocking guard
  invocation/layout failures, and `runtime.internal_failure`;
- exit 3: `blocked.*`, `gate.*`, `loop.*`, `judge.*`, `complete.*`, and the
  remaining trail gate/policy refusals;
- exit 4: only `runtime.state_corrupt` and `runtime.recovery_required`;
- exit 5: only `runtime.lease_conflict` and `runtime.revision_conflict`.

Each description states its unique trigger. Evidence policy is required when
the outcome relies on an artifact/event/approval/observation, forbidden for
pure usage failures, optional otherwise. State mutation is false for every
failure/blocked reason and true only as an allowance for successful reasons
that can commit. Retry is true only after the entry-specific recovery can
change the prerequisite or conflict.

- [x] **Step 4: Document schema ownership**

Update `schemas/README.md` to name v1 as the first public runtime result
contract, link both schemas and catalog, explain that issue #12 will define the
remaining plugin/state/host schema families, and state that catalog version is
independent of package version.

- [x] **Step 5: Make Task 1 GREEN and commit**

```bash
npm test -- --run tests/result-contract-schema.test.ts tests/result-contract-catalog.test.ts
git diff --check
git add schemas packages/contracts/catalogs tests schemas/README.md
git commit -s -m "feat: publish universal result schemas"
```

Expected: all Task 1 tests pass.

---

### Task 3: Add Examples and the Offline Cross-File Verifier

**Files:**

- Create: `fixtures/result-contract/v1/exit-0-success.json`
- Create: `fixtures/result-contract/v1/exit-1-validation.json`
- Create: `fixtures/result-contract/v1/exit-2-contract.json`
- Create: `fixtures/result-contract/v1/exit-3-policy.json`
- Create: `fixtures/result-contract/v1/exit-4-recovery.json`
- Create: `fixtures/result-contract/v1/exit-5-conflict.json`
- Create: `scripts/lib/result-contract.mjs`
- Create: `scripts/check-result-contract.mjs`
- Create: `tests/result-contract-checker.test.ts`
- Modify: `package.json`
- Modify: `tests/readme-honesty.test.ts`

**Interfaces:**

- Consumes: Task 2 schemas/catalog.
- Produces: `validateResultContract({ catalog, examples, resultSchema, catalogSchema })`, `canonicalResultJson(result)`, CLI `npm run result:check`.

- [x] **Step 1: Write CLI and mutation RED tests**

Expect canonical success output:

```text
result contract v1.0.0: verified (76 reasons; exits 0,1,2,3,4,5; 6 examples)
```

Copy inputs into temporary directories and mutate one condition per test:
missing legacy code, duplicate code, wrong reason exit, wrong status, forbidden
evidence, false `stateChanged`, false retry claim, duplicate why/evidence,
unknown property, stack trace, credential, absolute path, traversal, and an
example exit gap. Every mutation exits 1 with a sanitized
`Result contract validation failed:` message. Unknown/malformed CLI options exit
2 without echoing a supplied path.

- [x] **Step 2: Confirm RED**

```bash
npm test -- --run tests/result-contract-checker.test.ts
```

Expected: fail because checker and examples are absent.

- [x] **Step 3: Author six canonical examples**

Use these reason/exit pairs:

- 0: `trail.ok`, successful state change, event evidence;
- 1: `dashboard.estado_ilegivel`, no state change, observation evidence;
- 2: `runtime.internal_failure`, no evidence, sanitized recovery;
- 3: `trail.gate_divergente`, approval/event evidence and exact-gate recovery;
- 4: `runtime.state_corrupt`, event evidence and explicit audit recovery;
- 5: `runtime.lease_conflict`, observation evidence and reload/wait recovery.

All examples use contract version `1.0.0`, safe English prose, canonical field
order, unique ordered why/evidence, and 64-character lowercase fixture digests.

- [x] **Step 4: Implement reusable validation**

In `scripts/lib/result-contract.mjs`, export `loadResultContract(paths)` returning
the four parsed artifacts plus sorted examples;
`validateResultContract(input, repositoryRoot)` returning validated input;
`canonicalResultJson(result)` returning a newline-terminated JSON string; and
`renderHumanResult(result)` returning `{ stdout, stderr, exitCode }`.

Compile schemas with Ajv 2020 strict mode. Cross-check catalog codes against
discovery, exact five runtime codes, sorted/unique entries, unique prose,
exit/status rules, evidence/state/retry policy, safe recursive strings,
canonical property order, six exact exits, and duplicate why/evidence. Return
validated data; throw only sanitized prefixed errors.

- [x] **Step 5: Implement the thin CLI and verify chain**

Support documented `--result-schema`, `--catalog-schema`, `--catalog`, and
`--examples` option/value pairs for mutation tests. Default to repository paths.
Add:

```json
"result:check": "node scripts/check-result-contract.mjs"
```

Insert `npm run result:check` after `npm run parity:check` in `verify`, and update
the README-honesty script assertion.

- [x] **Step 6: Make the checker GREEN and commit**

```bash
npm test -- --run tests/result-contract-checker.test.ts tests/readme-honesty.test.ts
npm run result:check
git diff --check
git add fixtures/result-contract scripts package.json tests
git commit -s -m "feat: verify universal result contract"
```

---

### Task 4: Prove Deterministic Human and JSON Rendering

**Files:**

- Create: `tests/result-contract-rendering.test.ts`
- Modify: `scripts/lib/result-contract.mjs`

**Interfaces:**

- Consumes: Task 3 `canonicalResultJson` and `renderHumanResult`.
- Produces: deterministic renderer semantics reusable by the future runtime.

- [x] **Step 1: Write renderer RED tests**

Assert JSON is one compact object with canonical field order plus newline and
contains no stderr concept. Assert success human rendering is summary-only on
stdout. Assert failure/blocked rendering returns empty stdout and stderr lines
in this exact order: summary, each `why`, `reasonCode`, each evidence ref,
`stateChanged`, `retryable`, recovery. Test all six examples.

Add unsafe-result tests for `Error:`, `at function (file.ts:1:2)`, token/secret
patterns, private URL, absolute Unix/Windows paths, control characters, and
inline evidence content; rendering must reject before returning any text.

- [x] **Step 2: Confirm RED**

```bash
npm test -- --run tests/result-contract-rendering.test.ts
```

Expected: fail until renderer behavior is complete.

- [x] **Step 3: Implement renderer return types**

`canonicalResultJson(result)` returns `${JSON.stringify(result)}\n` after full
validation. `renderHumanResult(result)` returns:

```js
{ stdout: string, stderr: string, exitCode: number }
```

Success uses `${summary}\n` on stdout. Failure/blocked uses labeled, newline-
terminated stderr and empty stdout. Never sort semantic arrays; preserve their
validated order. Never render `recovery: null`.

- [x] **Step 4: Make renderer tests GREEN and commit**

```bash
npm test -- --run tests/result-contract-rendering.test.ts tests/result-contract-checker.test.ts
git diff --check
git add scripts/lib/result-contract.mjs tests/result-contract-rendering.test.ts
git commit -s -m "test: prove safe result rendering"
```

---

### Task 5: Publish the Compatibility Guide and Close the Evidence Loop

**Files:**

- Create: `docs/compatibility/result-contract.md`
- Modify: `README.md`
- Modify: `docs/development/toolchain.md`
- Modify: `.cspell.json`
- Modify: `docs/superpowers/plans/2026-08-07-universal-result-contract.md`

**Interfaces:**

- Consumes: all implemented artifacts and exact checker output.
- Produces: contributor/consumer documentation and completion evidence.

- [x] **Step 1: Document the public contract**

Explain all ten fields, evidence shape, exits 0..5, catalog fields, rendering
ownership, safety/redaction, versioning, additive TypeScript-only exits, and how
to run `npm run result:check`. Include one success and one blocked example from
checked fixtures, not hand-maintained variants.

- [x] **Step 2: Update discoverability**

Link the guide from README failure explanations and replace the illustrative
uppercase `GATE_EVIDENCE_STALE` with the checked `trail.gate_divergente`
example. Add `npm run result:check` to the toolchain command table and explain
that 76 catalog entries comprise 71 frozen plus five runtime-only codes.

- [x] **Step 3: Run focused documentation checks**

```bash
npm run spellcheck
npx --yes markdownlint-cli2@0.23.2 '**/*.md' '#node_modules'
lychee --config .lychee.toml docs/compatibility/result-contract.md
git diff --check
```

Expected: zero spelling, Markdown, link, and whitespace findings.

- [ ] **Step 4: Run full verification and independent review**

```bash
npm ci
npm run templates:validate
npm run verify
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml
git diff --check
```

Request independent review of schema strictness, all 76 reason mappings,
example/catalog cross-validation, rendering/redaction, compatibility claims,
and issue #11 acceptance criteria. Resolve all Critical and Important findings.

- [x] **Step 5: Commit documentation**

```bash
git add README.md .cspell.json docs
git commit -s -m "docs: publish universal result contract"
```

- [ ] **Step 6: Open, merge, close, and continue**

Open a PR with `Closes #11`, design/compatibility rationale, exact verification,
failure evidence, and provenance boundary. After required CI passes, merge it,
confirm #11 closed, mark #11 complete in epic #8, synchronize `main`, and begin
issue #12.
