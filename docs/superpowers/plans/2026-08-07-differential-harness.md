# Golden-Fixture Differential Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned, isolated, fail-closed harness that runs identical golden scenarios against frozen Go v3 and the TypeScript candidate and reports normalized field-level differences without mutating the developer checkout.

**Architecture:** Strict JSON scenarios feed focused TypeScript units for validation, materialization, capture, normalization, comparison, and bounded process execution. A Node 24 CLI runs an original public self-test corpus by default or an authorized live corpus with explicit runners; only exact equality exits successfully.

**Tech Stack:** Node.js 24.18.0, strict TypeScript 6, Vitest 4, AJV 8/JSON Schema 2020-12, native process/filesystem/Git APIs, SHA-256, and the existing repository verification toolchain.

## Global Constraints

- Live Go execution accepts only `go-v3-v0.6.5`, Linux SHA-256 `da4ec4a2394ae90a94722f633bcb9157ddc5ee0133f46540b7c2c700abe378b8`.
- Keep repository content and delivery text English-only and DCO-sign every commit.
- Never publish private predecessor code, prose, schemas, fixtures, help output, local paths, customer data, or secrets.
- Keep PRD `prd-output.schema.json` at `migration-only` and its frozen digest `7fa4f468520fac2f2a0d3b766257e162d25f37520dd7507230616257f2fe503e` until every required PRD differential case passes.
- Every scenario is an equality claim; any mismatch exits nonzero and grants no parity credit.
- Spawn literal argument arrays with `shell: false`; scenario workspaces always live in external temporary roots removed in `finally`.
- Reject absolute, traversing, backslash, URL, NUL, control-character, duplicate, and case-fold-colliding paths before mutation.
- Normalization is closed and field-scoped and cannot alter process outcomes, reason/status, mutations, unexpected files, or Git effects.
- Reports default to byte/digest summaries and never expose stack traces, absolute paths, environment secrets, or private output.

---

### Task 1: Freeze scenario and observation contracts

**Files:**

- Create: `packages/differential/package.json`
- Create: `packages/differential/src/types.ts`
- Create: `packages/differential/src/scenario.ts`
- Create: `packages/differential/src/index.ts`
- Create: `schemas/compatibility/differential-scenario.v1.schema.json`
- Create: `schemas/compatibility/differential-observation.v1.schema.json`
- Create: `tests/differential-contract.test.ts`
- Modify: `tsconfig.json`
- Modify: `package-lock.json`

**Interfaces:**

- Produces `loadScenario(path, matrixPath?): Promise<DifferentialScenario>` and `validateSafeRelativePath(path): string`.
- Produces closed `DifferentialScenario`, `DifferentialObservation`, `GoldenAssertions`, `NormalizationRule`, `Mismatch`, and `DifferentialReport` types.
- Consumes real row IDs from `compatibility/inventory/go-v3-v0.6.5/matrix.json`.

- [ ] **Step 1: Write failing contract tests**

Compile both schemas and validate one complete fixture. Mutate every object with
an unknown key. Test missing/unknown/duplicate matrix IDs, timeout over `30000`,
bad environment keys, duplicate/case-fold-colliding entries, and unsafe paths:

```ts
it.each(["../x", "/x", "C:\\x", "https://x.invalid", "a\\b", "a/./b", "a//b", "a\u0000b"])(
  "rejects unsafe path %j",
  (path) => expect(() => validateSafeRelativePath(path)).toThrow("Differential scenario path is unsafe"),
);
```

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/differential-contract.test.ts
```

Expected: FAIL because package and schemas do not exist.

- [ ] **Step 3: Implement closed contracts and loader**

Define discriminated workspace entries and normalization operations:

```ts
export type WorkspaceEntry =
  | { readonly type: "directory"; readonly path: string }
  | { readonly type: "file"; readonly path: string; readonly content: string; readonly executable: boolean }
  | { readonly type: "symlink"; readonly path: string; readonly target: string };

export type NormalizationRule =
  | { readonly operation: "line_endings"; readonly pointer: string }
  | { readonly operation: "workspace_path"; readonly pointer: string }
  | { readonly operation: "replace_json_value"; readonly pointer: string; readonly token: "<TIMESTAMP>" | "<DURATION>" }
  | { readonly operation: "sort_json_array"; readonly pointer: string; readonly identityKey: string }
  | { readonly operation: "remove_field"; readonly pointer: string; readonly justification: string };
```

Set `additionalProperties: false` recursively. Bound entries to 256, each file
to 256 KiB, aggregate materialized bytes to 4 MiB, timeout to 50–30000 ms, and
each process stream to 1 MiB. AJV errors expose scenario ID and keyword only.
Validate matrix IDs and safe POSIX paths before returning. Add exact dependency
`ajv: 8.20.0` and `allowImportingTsExtensions: true`.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm install --package-lock-only --ignore-scripts
npm test -- tests/differential-contract.test.ts
npm run typecheck
npm run lint
git add package-lock.json packages/differential schemas/compatibility tsconfig.json tests/differential-contract.test.ts
git commit -s -m "feat: define differential scenario contracts"
```

### Task 2: Implement immutable normalization and comparison

**Files:**

- Create: `packages/differential/src/normalize.ts`
- Create: `packages/differential/src/compare.ts`
- Create: `tests/differential-comparator.test.ts`
- Modify: `packages/differential/src/index.ts`

**Interfaces:**

- Produces `normalizeObservation(observation, rules, workspace): DifferentialObservation`.
- Produces `compareGolden(side, expected, actual): readonly Mismatch[]`.
- Produces `compareObservations(scenario, oracle, candidate): DifferentialReport`.

- [ ] **Step 1: Write failing comparator tests**

Cover exact equality, missing/unexpected/type/value differences, unexpected
file, timeout, crash, partial mutation, and side-specific golden failure. Assert
stable pointer ordering:

```ts
expect(report.mismatches.map(({ pointer, kind }) => [pointer, kind])).toEqual([
  ["/candidate/filesystem/2", "unexpected"],
  ["/candidate/process/exitCode", "value"],
]);
```

Prove LF/workspace/JSON-token/keyed-sort rules work, while rules targeting
exit/status/reason/filesystem mutation/Git fail closed.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/differential-comparator.test.ts
```

Expected: FAIL because comparator modules do not exist.

- [ ] **Step 3: Implement normalization and comparison**

Use `structuredClone` and exact RFC 6901 traversal. Protect these prefixes and
their parents from remove/replace operations:

```ts
const protectedPointers = [
  "/process/exitCode",
  "/process/outcome",
  "/structured/result/status",
  "/structured/result/reasonCode",
  "/filesystem",
  "/git",
] as const;
```

Compare objects by sorted key union and arrays by index. Emit stable JSON
Pointers with `missing | unexpected | type | value | timeout | crash |
partial_mutation`, scenario ID, real contract IDs, and disclosure-safe value
summaries. Compare each side to the golden observation and then both sides,
deduplicating only exact mismatch tuples.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm test -- tests/differential-comparator.test.ts tests/differential-contract.test.ts
npm run typecheck
npm run lint
git add packages/differential/src tests/differential-comparator.test.ts
git commit -s -m "feat: compare normalized differential observations"
```

### Task 3: Materialize and capture deterministic workspaces

**Files:**

- Create: `packages/differential/src/materialize.ts`
- Create: `packages/differential/src/capture.ts`
- Create: `tests/differential-capture.test.ts`

**Interfaces:**

- Produces `materializeWorkspace(root, entries): Promise<string>`.
- Produces `captureBefore(project, selector): Promise<CaptureBaseline>`.
- Produces `captureAfter(project, selector, baseline, process): Promise<DifferentialObservation>`.

- [ ] **Step 1: Write failing capture tests**

Use external `mkdtemp` roots. Cover deterministic files/directories/executable
mode/safe link manifests, selected JSON, Git HEAD/status/ref/diff digests,
added/modified/deleted classifications, malformed JSON, unsafe link, special
file, limit overflow, cleanup, and byte-identical source checkout status.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/differential-capture.test.ts
```

Expected: FAIL because capture modules do not exist.

- [ ] **Step 3: Implement materialization and observation**

Create directories, files with `flag: "wx"`, then links. Resolve each parent
immediately before mutation and require it below project root. Require lexical
link targets below root. Use modes `0755`/`0644` and recheck aggregate bytes
before the first write.

Enumerate with `lstat`, never follow links, sort UTF-8 relative paths, hash file
bytes, and represent mode classes rather than numeric modes. Canonicalize
selected JSON object keys. Capture Git using literal `spawn` arguments:

```text
git status --porcelain=v2 --branch
git diff --binary --no-ext-diff
git diff --cached --binary --no-ext-diff
git for-each-ref --format=%(refname)%00%(objectname)
```

Use isolated Git config and bounded output. Non-Git workspaces produce
`git: null`; malformed selected JSON and unsafe/special files fail explicitly.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm test -- tests/differential-capture.test.ts tests/differential-comparator.test.ts
npm run typecheck
npm run lint
git add packages/differential/src tests/differential-capture.test.ts
git commit -s -m "feat: capture isolated differential workspaces"
```

### Task 4: Add bounded process runners

**Files:**

- Create: `packages/differential/src/runner.ts`
- Create: `tests/differential-runner.test.ts`
- Create: `tests/fixtures/differential/driver.mjs`
- Modify: `packages/differential/src/index.ts`

**Interfaces:**

- Produces `runScenarioSide(options: RunSideOptions): Promise<SideRun>`.
- Produces `runScenario(scenario, oracle, candidate): Promise<DifferentialReport>`.
- `RunSideOptions` accepts an executable path and never a command string.

- [ ] **Step 1: Write failing runner tests**

The original driver supports `equal`, `normalize`, `unexpected-file`,
`timeout`, `crash`, `partial-mutation`, `state`, and `git`. Assert independent
equal seeds, retained mutations after failures, signal/timeout classification,
child termination, isolated HOME/TMPDIR/Git config, dropped `NODE_OPTIONS` and
secret variables, source immutability, and cleanup on every path.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/differential-runner.test.ts
```

Expected: FAIL because runner orchestration does not exist.

- [ ] **Step 3: Implement bounded direct execution**

Use this spawn shape:

```ts
spawn(executable, scenario.invocation.args, {
  shell: false,
  detached: process.platform !== "win32",
  cwd: project,
  env: safeEnvironment,
  stdio: ["pipe", "pipe", "pipe"],
});
```

Allow only necessary platform variables plus isolated `HOME`, `TMPDIR`, `PATH`,
`LANG=C.UTF-8`, `LC_ALL=C.UTF-8`, `NO_COLOR=1`, `GIT_CONFIG_NOSYSTEM=1`, and
declared overlays. Bound streams separately. On timeout/overflow send SIGTERM,
wait 250 ms, then SIGKILL to the POSIX group with direct-child fallback. Always
await close, capture after-state, and clean nested roots in `finally`. Hash
runners before materialization and run independent sides sequentially.

- [ ] **Step 4: Run GREEN and commit**

```bash
npm test -- tests/differential-runner.test.ts tests/differential-capture.test.ts tests/differential-comparator.test.ts
npm run typecheck
npm run lint
git add packages/differential/src tests/differential-runner.test.ts tests/fixtures/differential/driver.mjs
git commit -s -m "feat: run bounded differential sandboxes"
```

### Task 5: Publish corpus CLI and live evidence

**Files:**

- Create: `compatibility/fixtures/differential/v1/corpus.json`
- Create: `compatibility/fixtures/differential/v1/scenarios/self-test-equality.json`
- Create: `compatibility/fixtures/differential/v1/scenarios/live-version.json`
- Create: `compatibility/fixtures/differential/v1/scenarios/live-help.json`
- Create: `compatibility/fixtures/differential/v1/scenarios/prd-*.json`
- Create: `scripts/run-differential.mjs`
- Create: `tests/differential-cli.test.ts`
- Modify: `package.json`
- Modify: `eslint.config.mjs`

**Interfaces:**

- Produces `npm run differential:check` for public self-tests.
- Live mode requires `--class live --oracle <path> --candidate <path>`.
- Exit `0` means all selected scenarios equal, `1` means mismatch, and `2` means usage/contract/provenance/harness failure.

- [ ] **Step 1: Write failing CLI tests**

Cover default JSON self-test, human rendering, unknown/duplicate/missing options,
missing live runners, wrong oracle digest before mutation, valid oracle with
seeded version/help mismatch, and redaction of absolute paths, secrets, stack
text, and nondisclosed streams.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/differential-cli.test.ts
```

Expected: FAIL because CLI and corpus do not exist.

- [ ] **Step 3: Add corpus and strict CLI**

Classify corpus entries as `self-test`, `live`, or `planned`. Default mode runs
the materialized original driver with `process.execPath` on both sides and a
complete equal golden observation. Live `--version` and `--help` scenarios name
real matrix IDs and store only issue #9 byte counts/digests. Planned PRD files
name all four real PRD IDs and sufficient/insufficient context, `needs_input`,
blocking/deferred questions, 5 Whys/5W2H applied/skipped, root cause, invalid
structured output, lineage drift, revision, and content-bound approval; they
contain no private anchor expression and cannot execute or count as evidence.

Default runners are Node only for `self-test`. Live mode requires regular
executable files and verifies Go SHA before loading scenarios. JSON recursively
sorts keys; human output prints scenario and mismatch pointers only. Add
`"differential:check": "node scripts/run-differential.mjs"` after
`contracts:check` in `verify` and before build.

- [ ] **Step 4: Run GREEN and authorized live evidence**

```bash
npm test -- tests/differential-cli.test.ts tests/differential-runner.test.ts
npm run differential:check
npm run build
node scripts/run-differential.mjs --class live --oracle /home/thiago-botelho/.betaup/bin/yoda --candidate dist/plugin/runtime/yoda.mjs
```

Expected: tests/self-test PASS; authorized live comparison verifies the oracle,
reports only safe version/help pointer/digest differences, and exits `1` because
the candidate is not yet parity-complete.

- [ ] **Step 5: Commit**

```bash
git add compatibility/fixtures/differential package.json eslint.config.mjs scripts/run-differential.mjs tests/differential-cli.test.ts
git commit -s -m "test: add golden differential corpus"
```

### Task 6: Document, verify, review, and deliver

**Files:**

- Create: `docs/compatibility/differential-harness.md`
- Modify: `README.md`
- Modify: `fixtures/README.md`
- Modify: `schemas/README.md`
- Modify: `docs/compatibility/parity-inventory.md`
- Modify: `docs/compatibility/contract-versioning.md`
- Modify: `docs/development/toolchain.md`
- Modify: `tests/readme-honesty.test.ts`
- Modify: `tests/parity-inventory-matrix.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: this plan

**Interfaces:**

- Publishes operation, exit/redaction/security contracts, current live mismatch evidence, and honest unchanged parity until full row evidence exists.

- [ ] **Step 1: Write documentation RED tests**

Require docs to name public/live commands, exit 0/1/2, digest-only disclosure,
temporary isolation, current known mismatch, source immutability, and PRD
`migration-only`. Require CI to run the public self-test without private paths
or secrets. Assert parity remains `0 / 400` if no row gained all four evidence
classes.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/readme-honesty.test.ts tests/parity-inventory-matrix.test.ts
```

Expected: FAIL because docs do not expose the harness.

- [ ] **Step 3: Publish exact documentation**

Document scenario fields/limits, capture/normalization/mismatch semantics,
public and authorized commands, exit codes, no-shell/path controls, disclosure
boundary, version/help differences, all planned PRD cases, and the rule that
unit+differential+integration+E2E are required before parity. Keep CI on public
`npm run verify`; add no oracle secret or private artifact. Check completed plan
steps in this file.

- [ ] **Step 4: Run final verification**

```bash
export PATH=/tmp/tmp.qb2rcwG3r2/node-v24.18.0-linux-x64/bin:$PATH
npm test -- tests/differential-contract.test.ts tests/differential-comparator.test.ts tests/differential-capture.test.ts tests/differential-runner.test.ts tests/differential-cli.test.ts tests/readme-honesty.test.ts tests/parity-inventory-matrix.test.ts
npm run differential:check
npm run verify
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml .github/workflows/docs.yml
npx markdownlint-cli2 "**/*.md" "#node_modules" "#.worktrees"
rg --files -g '*.md' -g '!node_modules/**' -g '!.worktrees/**' -0 | xargs -0 /tmp/tmp.KmVAr8uMu3/lychee-x86_64-unknown-linux-gnu/lychee --config .lychee.toml
git diff --check main...HEAD
git status --short
```

Expected: all public gates PASS, live mismatch remains honest evidence, no
unsupported parity claim, and only intended changes remain.

- [ ] **Step 5: Commit and review**

```bash
git add .github/workflows/ci.yml README.md fixtures/README.md schemas/README.md docs tests/readme-honesty.test.ts tests/parity-inventory-matrix.test.ts
git commit -s -m "docs: publish differential harness workflow"
```

Use `requesting-code-review` against `main...HEAD`; resolve every Critical and
Important finding with `receiving-code-review`, then rerun Step 4.

- [ ] **Step 6: Deliver and close #13**

Push, open an English PR with `Closes #13`, include exact commands and the
redacted nonzero live evidence, wait for GitHub checks, squash merge, confirm
issue `#13` closed, mark only `#13` in epic `#8`, fast-forward `main`, and remove this owned
worktree/branch before proceeding to #14.
