# Exhaustive Go v3 Parity Inventory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a metadata-only, machine-checked inventory that accounts for every frozen Go v3 surface and reports TypeScript parity without subjective credit.

**Architecture:** Store immutable source discovery separately from the living compatibility matrix. A reusable Node.js validation module enforces both contracts and calculates parity; a thin CLI runs offline in public CI and optionally re-discovers authorized private source metadata at tag `v0.6.5`.

**Tech Stack:** Node.js 24.18.0, TypeScript/Vitest, JSON, Git, Go source metadata, SHA-256.

## Global Constraints

- Use only Go v3 oracle `go-v3-v0.6.5`, tag object `720f0a35074451208a0673324d223803add249e0`, commit `632f1e9bb283cf83412ef3e9e0b642daefdb0784`, and distribution commit `e6e6803c9329a53d362217a8f829a2801c83609d`.
- Publish no private source, prompt, schema body, fixture payload, help prose, binary, private URL, credential, internal absolute path, customer data, or confidential business payload.
- Keep the default checker offline; private discovery occurs only through explicit `--source` and `--dist-source` arguments.
- Preserve the PRD process as a dedicated P0 boundary, including WHAT/WHY ownership, adaptive discovery, `needs_input` no-write behavior, and completed structured output.
- Every discovery key is covered exactly once and every matrix row has a stable ID, legacy reference, expected behavior, priority, TypeScript owner, four verification cases, and status.
- Give parity credit only to `parity` or approved `intentional_difference` rows with all four evidence cases passed and present.
- Keep all repository content, identifiers, output, commits, and pull-request text in English.

---

### Task 1: Specify the discovery and matrix contracts

**Files:**

- Create: `tests/parity-inventory-contract.test.ts`
- Create later: `compatibility/inventory/go-v3-v0.6.5/discovery.json`
- Create later: `compatibility/inventory/go-v3-v0.6.5/matrix.json`

**Interfaces:**

- Consumes: the approved design, issue #10, and the issue #9 oracle manifest.
- Produces: executable assertions for immutable identity, discovery coverage, row shape, PRD priority, evidence shape, and initial parity.

- [x] **Step 1: Write the missing-catalog RED test**

Read both future JSON files and assert these fixed discovery facts:

```ts
expect(discovery).toMatchObject({
  schema_version: 1,
  oracle_id: "go-v3-v0.6.5",
  source: {
    tag: "v0.6.5",
    tag_object: "720f0a35074451208a0673324d223803add249e0",
    commit: "632f1e9bb283cf83412ef3e9e0b642daefdb0784",
    distribution_commit: "e6e6803c9329a53d362217a8f829a2801c83609d",
  },
  provenance_id: "private-go-v3-hash-only",
});
expect(discovery.namespaces.commands).toHaveLength(30);
expect(discovery.namespaces.retired_commands).toHaveLength(8);
expect(discovery.namespaces.packages).toHaveLength(49);
expect(discovery.namespaces.schemas).toHaveLength(14);
expect(discovery.namespaces.plugin_files).toHaveLength(59);
expect(discovery.namespaces.workflows).toHaveLength(5);
expect(discovery.namespaces.reason_codes).toHaveLength(71);
```

Assert the exact 30 active command names, eight retired commands, 49 package
paths, 14 schema names, 59 distribution paths, five workflow names, and closed
reason-code set measured during design. Assert all mandatory manual namespaces
exist: aliases, global flags, generated files, phases, human gates, state
transitions, benchmarks, and documentation.

For the matrix, assert unique IDs and the exact mandatory object shape:

```ts
expect(row).toEqual({
  id: expect.stringMatching(/^[A-Z][A-Z0-9-]+$/u),
  category: expect.any(String),
  title: expect.any(String),
  legacy_refs: expect.any(Array),
  covers: expect.any(Array),
  expected_behavior: expect.any(String),
  priority: expect.stringMatching(/^P[0-2]$/u),
  typescript_owner: expect.stringMatching(
    /^@mestre-yoda\/(contracts|runtime|adapters)$|^plugin$/u,
  ),
  verification: {
    unit: expect.any(Object),
    differential: expect.any(Object),
    integration: expect.any(Object),
    e2e: expect.any(Object),
  },
  status: "not_started",
  intentional_difference: null,
});
```

Require dedicated P0 rows covering all four frozen PRD anchors and assert every
row starts `not_started` with four `planned`, null-path verification cases.

- [x] **Step 2: Confirm RED**

```bash
npm test -- tests/parity-inventory-contract.test.ts
```

Expected: FAIL because `discovery.json` and `matrix.json` do not exist.

- [x] **Step 3: Commit the failing contract**

```bash
git add tests/parity-inventory-contract.test.ts
git commit -s -m "test: specify exhaustive parity inventory"
```

### Task 2: Capture the immutable discovery snapshot

**Files:**

- Create: `compatibility/inventory/go-v3-v0.6.5/discovery.json`
- Create: `scripts/lib/parity-inventory.mjs`
- Create: `tests/parity-inventory-discovery.test.ts`

**Interfaces:**

- Produces: `loadCatalogs(options)`, `validateDiscovery(discovery)`, and `discoverLegacy(source, distribution)`.
- Consumes later: the matrix validator and CLI in Tasks 3–4.

- [x] **Step 1: Add source-derived discovery regression tests**

Test that the public snapshot contains exactly these principal sets:

```text
commands: ac, bench, budgets, complete, continue, dashboard, decide, doctor,
done, evidence, gaps-sync, gen, guard, guardrails, handoff, help, hook, init,
judge, migrate, objective, partition, start, stats, status, step, unlock,
validate, version, views
retired_commands: prd, spec, review, code, eval, auto, run, next
global_flags: --expect, --require-contract
phases: research, prd, spec, review, code, eval, done
human_gates: gaps_abertos, particionamento, aprovacao_spec, aceitacao_final
```

Assert exact package/schema/plugin/workflow/reason sets from the frozen source,
sorted keys, unique stable keys, repository-relative references, and the
provenance ID on every entry. Reject a URL, absolute POSIX/Windows/UNC path,
traversal, secret marker, unknown field, or private payload field recursively.

- [x] **Step 2: Confirm the new tests fail**

```bash
npm test -- tests/parity-inventory-discovery.test.ts
```

Expected: FAIL because the discovery module and snapshot are absent.

- [x] **Step 3: Implement the snapshot and strict validator**

Create the metadata-only snapshot with entries shaped as:

```json
{
  "key": "commands.objective",
  "name": "objective",
  "legacy_refs": ["cmd/yoda/help.go", "cmd/yoda/trailcli.go#runObjective"],
  "provenance_id": "private-go-v3-hash-only"
}
```

In `scripts/lib/parity-inventory.mjs`, use exact-key allowlists and recursive
safe-string checks. Define immutable expected identity constants and validate
all arrays as sorted, unique, non-empty metadata. Export:

```js
export function validateDiscovery(discovery) {}
export function discoverLegacy(source, distribution) {}
export function loadCatalogs({ discoveryPath, matrixPath }) {}
```

`discoverLegacy` must:

- verify the annotated tag object and commit with argument-safe `spawnSync`;
- read `Cmd:` metadata from `cmd/yoda/help.go` without emitting the file;
- collect Go packages with `go list ./...` and normalize module prefixes;
- list schema filenames, workflow filenames, and distribution tracked files;
- read only closed string constants from `internal/decide/codes.go`,
  `internal/guard/codes.go`, `internal/complete/codes.go`, and the two judge
  reason literals;
- compare metadata sets and report only category counts.

- [x] **Step 4: Make discovery tests GREEN**

```bash
npm test -- tests/parity-inventory-discovery.test.ts
npm run lint
npm run typecheck
```

- [x] **Step 5: Commit the discovery layer**

```bash
git add compatibility/inventory/go-v3-v0.6.5/discovery.json scripts/lib/parity-inventory.mjs tests/parity-inventory-discovery.test.ts
git commit -s -m "feat: capture Go v3 parity discovery"
```

### Task 3: Build the exhaustive living matrix

**Files:**

- Create: `compatibility/inventory/go-v3-v0.6.5/matrix.json`
- Modify: `scripts/lib/parity-inventory.mjs`
- Modify: `tests/parity-inventory-contract.test.ts`
- Create: `tests/parity-inventory-matrix.test.ts`

**Interfaces:**

- Produces: `validateMatrix(discovery, matrix)` and `calculateParity(matrix)`.
- Consumes: every stable discovery key from Task 2.

- [x] **Step 1: Write matrix completeness and parity RED tests**

Require every discovery key to occur exactly once across row `covers` arrays.
Require globally unique row IDs, verification IDs, and legacy references within
each row. Require all four evidence kinds and explicit `normal:`, `failure:`,
and `edge:` clauses for P0/P1 behavior.

Mutation cases must fail for:

```ts
delete matrix.rows[0].typescript_owner;
matrix.rows[1].covers = matrix.rows[0].covers;
delete matrix.rows[0].verification.e2e;
matrix.rows[0].expected_behavior = "Works like legacy.";
matrix.rows[0].status = "parity"; // evidence remains planned
```

Assert the untouched initial result is `{ credited: 0, total: rows.length,
percent: "0.00" }`, with separate P0 and P1 results computed by the same rule.

- [x] **Step 2: Confirm RED**

```bash
npm test -- tests/parity-inventory-matrix.test.ts
```

Expected: FAIL because matrix validation and the complete catalog are absent.

- [x] **Step 3: Add every compatibility row**

Populate the matrix in these audited groups:

1. CLI rows for 30 active commands, nested forms, aliases, global/value flags,
   stdin/stdout/stderr routing, exit classes, and eight retired commands;
2. P0 trail/PRD rows for objective, ordered phases, decision flow, human gates,
   adaptive Problem Discovery, structured `needs_input`, completed PRD output,
   artifact no-write/write effects, approval lineage, and final acceptance;
3. state rows for plans, run/feature state, gaps, partition, AC state, budgets,
   events, transactions, locks, recovery, Git baselines, telemetry, and views;
4. one ownership row for every Go package and one contract row for every schema
   and stable reason-code family;
5. generated-file rows covering the init skeleton, `config.json`,
   `guardrails.json`, `stack-profile.md`, host context/settings, five Codex agent
   files, active feature/objective history, run state/plan/events/artifacts,
   evidence/handoff views, telemetry files, journals, locks, and migration
   records;
6. plugin rows covering all 59 distribution files, grouped only by indivisible
   manifest, skill, agent, provider, hook, schema, template, reference,
   installer, or notice contract;
7. benchmark, CI, release, migration, and documentation rows.

Every row uses one of the approved owners, assigns P0/P1/P2 from user impact,
names deterministic four-case IDs derived from the row ID, starts
`not_started`, and carries no intentional-difference waiver.

- [x] **Step 4: Implement validation and calculation**

`validateMatrix` returns a validated matrix or throws one concise public error.
It checks exact keys, enum values, safety, coverage equality, case uniqueness,
evidence paths for passed cases, and ADR/migration requirements for intentional
differences.

`calculateParity` uses integer arithmetic:

```js
const credited = rows.filter(isCredited).length;
const basisPoints = Math.round((credited * 10_000) / rows.length);
return {
  credited,
  total: rows.length,
  percent: `${Math.floor(basisPoints / 100)}.${String(basisPoints % 100).padStart(2, "0")}`,
};
```

Return overall, P0, and P1 results. No partial or weighted credit is allowed.

- [x] **Step 5: Make matrix tests GREEN and commit**

```bash
npm test -- tests/parity-inventory-contract.test.ts tests/parity-inventory-discovery.test.ts tests/parity-inventory-matrix.test.ts
npm run lint
npm run typecheck
git diff --check
```

```bash
git add compatibility/inventory/go-v3-v0.6.5/matrix.json scripts/lib/parity-inventory.mjs tests
git commit -s -m "docs: map exhaustive Go v3 parity contracts"
```

### Task 4: Add the completeness CLI and failure campaign

**Files:**

- Create: `scripts/check-parity-inventory.mjs`
- Create: `tests/parity-inventory-checker.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `npm run parity:check` and optional `--source`/`--dist-source` source revalidation.
- Consumes: validated catalogs and functions from `scripts/lib/parity-inventory.mjs`.

- [x] **Step 1: Write CLI RED tests**

Spawn the future checker and require exact offline output containing discovery
counts plus `overall 0 / N (0.00%)`, `P0 0 / N (0.00%)`, and
`P1 0 / N (0.00%)`.

Copy and mutate catalogs in temporary directories. Verify exit 1 for a missing
row, missing case reference, duplicate coverage key, unsafe path, unknown field,
and false parity claim. Verify exit 2 for unknown/malformed options. Verify
stderr never includes a caller-supplied private path.

- [x] **Step 2: Confirm RED**

```bash
npm test -- tests/parity-inventory-checker.test.ts
```

- [x] **Step 3: Implement the thin CLI**

Support only documented option/value pairs:

```text
--discovery <file>
--matrix <file>
--source <authorized-checkout>
--dist-source <authorized-distribution-checkout>
```

Require source and distribution together for private discovery. Catch every
exception at the entrypoint and render only a catalog ID or generic private
input failure. Never execute an argument derived from either catalog.

- [x] **Step 4: Integrate the offline gate**

Add:

```json
"parity:check": "node scripts/check-parity-inventory.mjs"
```

Insert `npm run parity:check` after `oracle:verify` and before build in `verify`.
No dependency or lockfile package change is expected.

- [x] **Step 5: Run the failure campaign and commit**

```bash
npm run parity:check
npm test -- tests/parity-inventory-checker.test.ts
npm run lint
npm run typecheck
git diff --check
```

```bash
git add scripts/check-parity-inventory.mjs tests/parity-inventory-checker.test.ts package.json package-lock.json
git commit -s -m "test: enforce parity inventory completeness"
```

### Task 5: Publish traceability guidance and complete issue #10

**Files:**

- Create: `docs/compatibility/parity-inventory.md`
- Modify: `README.md`
- Modify: `docs/development/toolchain.md`
- Modify: this plan

**Interfaces:**

- Produces: contributor workflow, reproducible evidence, reviewed PR, closed issue #10, and updated epic #8.

- [x] **Step 1: Document the matrix workflow**

Explain discovery versus matrix authority, every row field, evidence state
transitions, parity formula, intentional-difference approval, public/private
commands, privacy boundary, and how later issues add evidence without
renumbering contract IDs. Publish current overall/P0/P1 counts directly from
the checker output and clearly state that inventory completion is not runtime
parity.

- [x] **Step 2: Add discoverability and focused documentation checks**

Link the inventory from README status and the toolchain guide. Run:

```bash
npm run spellcheck
npx --yes markdownlint-cli2@0.23.2 '**/*.md' '#node_modules'
lychee --config .lychee.toml docs/compatibility/parity-inventory.md
git diff --check
```

- [x] **Step 3: Run authorized private discovery**

```bash
node scripts/check-parity-inventory.mjs \
  --source <authorized-source-checkout> \
  --dist-source <authorized-distribution-checkout>
```

Expected: clean detached immutable source identity; 30 top-level commands, 10
nested forms, 59 command flags, nine stream contracts, four exit classes, 49
packages, 14 schemas, 59 plugin files, five workflows, and 71 closed reason
codes are rediscovered and match without private payload output. Confirm both
repositories remain clean.

- [x] **Step 4: Run full verification and independent review**

```bash
npm ci
npm run templates:validate
npm run verify
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml
git diff --check
```

Review issue coverage, source cross-check correctness, row completeness, P0/P1
requirements, PRD locking, objective percentage, failure mutations, command
safety, and private-public provenance. Resolve every valid finding and rerun
affected checks.

- [x] **Step 5: Commit documentation**

```bash
git add README.md docs/compatibility/parity-inventory.md docs/development/toolchain.md docs/superpowers/plans/2026-08-07-parity-inventory.md
git commit -s -m "docs: publish parity inventory workflow"
```

- [ ] **Step 6: Open, merge, close, and continue**

Open a PR with `Closes #10`, design rationale, compatibility impact, exact
public/private verification results, failure evidence, and the complete
provenance checklist. Merge only after CI and documentation checks pass. Confirm
issue #10 closed, mark it complete in epic #8, sync `main`, and begin issue #11.
