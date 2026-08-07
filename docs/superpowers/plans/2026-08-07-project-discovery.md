# Project Discovery and `.brain` Configuration Resolution Implementation Plan

> **Issue:** [#18](https://github.com/thiagocorreanet/mestre-yoda/issues/18) (`RUN-03`)
>
> **Design:** `docs/superpowers/specs/2026-08-07-project-discovery-design.md`

**Goal:** Resolve a safe project root, classify project-local `.brain` state,
load configuration through a version-first validation seam, and preserve
setting provenance without exposing mutation capabilities during discovery.

**Architecture:** The Node and fake `Workspace` ports collect canonical,
read-only observations. Pure domain functions select the root, classify the raw
configuration, and layer validated settings. Composition performs bootstrap
discovery first and creates rooted mutation ports only after a successful
resolution. `RUN-04` owns schema interpretation; this issue defines and tests a
pure `ConfigurationValidator` seam rather than duplicating a registry.

**Toolchain:** TypeScript 6, Node 24, Vitest 4, existing contracts package,
native `node:fs/promises`, `node:path`, and `git` process invocation.

**Compatibility constraints:** Keep the frozen public inventory at `0 / 400`.
Do not add commands, flags, reason codes, schemas, or configuration defaults.
Treat the old sibling `<project>-brain/.brain` layout as migration input only.
Never publish absolute paths or caller-provided root values.

---

## Task 1: Define the closed discovery vocabulary

**Files:**

- Create: `packages/runtime/src/domain/project/request.ts`
- Create: `packages/runtime/src/domain/project/observation.ts`
- Create: `packages/runtime/src/domain/project/validation.ts`
- Create: `packages/runtime/src/domain/project/resolution.ts`
- Create: `packages/runtime/src/domain/project/index.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/project-types.test.ts`

### RED

Write compile-time/runtime assertions for:

- `DiscoveryRequest` with canonical working directory, optional explicit root,
  and `principal | local` worktree mode;
- nearest-first `DirectoryProbe` values with closed brain, Git, legacy, and
  raw-configuration classifications;
- `ConfigurationValidator` accepting unknown parsed data and returning either
  a typed project configuration or a schema-invalid outcome;
- discriminated `ProjectResolution` variants from the design;
- a public `@mestre-yoda/runtime/domain/project` export.

Run:

```bash
npx vitest run tests/project-types.test.ts
npm run typecheck
```

Expected: FAIL because the project domain and export do not exist.

### GREEN

Add only the interfaces, discriminants, and barrel exports needed by the test.
Keep every absolute path field explicitly internal-only in its documentation.
Do not add behavior or defaults.

Run the focused test and typecheck again. Commit with DCO:

```bash
git commit -s -m "feat: define the project discovery vocabulary"
```

## Task 2: Select roots with explicit precedence

**Files:**

- Create: `packages/runtime/src/domain/project/resolve-root.ts`
- Modify: `packages/runtime/src/domain/project/index.ts`
- Test: `tests/project-root-resolution.test.ts`

### RED

Table-test these policies with literal observations:

1. an explicit canonical root is the only candidate and never walks upward;
2. without an explicit root, the nearest usable `.brain` marker wins;
3. an unusable or escaping nearest marker refuses rather than falling through;
4. absent markers fall back to the discovered Git top level;
5. a linked worktree falls back to its principal worktree unless local mode is
   explicitly requested;
6. a local `.brain` wins before principal fallback;
7. no marker and no Git root returns `not-found`;
8. a legacy sibling classifies `migration-pending` and never becomes storage;
9. spaces, composed/decomposed Unicode, detached HEAD metadata, and repeated
   identical input do not alter selection;
10. every refusal contains a stable reason code and no input path in public
    prose.

Run:

```bash
npx vitest run tests/project-root-resolution.test.ts
```

Expected: FAIL because `resolveRoot` does not exist.

### GREEN

Implement a pure nearest-first selector. It may compare canonical paths but may
not import Node builtins, call ports, parse Git output, or mutate observations.
Map outcomes through one reason binding table so an oracle correction changes
one place.

Run the focused test, typecheck, lint, and commit:

```bash
git commit -s -m "feat: resolve project roots from workspace observations"
```

## Task 3: Classify configuration before schema validation

**Files:**

- Create: `packages/runtime/src/domain/project/configuration.ts`
- Modify: `packages/runtime/src/domain/project/index.ts`
- Test: `tests/project-configuration.test.ts`

### RED

Prove the exact failure order:

- absent document -> `guard.config_missing`;
- non-file document or invalid JSON -> `guard.config_corrupt` with no parser
  message or source bytes;
- missing, non-string, or untrimmed `stateContract` ->
  `contract.state_version_invalid`;
- unsupported or migration-only state contract -> the corresponding frozen
  contract reason;
- only a current contract invokes `ConfigurationValidator`;
- a validator rejection -> `guard.config_corrupt`;
- a validator success carries the typed configuration unchanged.

Use a recording validator and assert zero calls for every pre-schema failure.
Include quoted strings, absolute paths, credential-shaped text, duplicate JSON
keys, and future fields to prove no raw value reaches diagnostics.

Run:

```bash
npx vitest run tests/project-configuration.test.ts
```

Expected: FAIL because configuration classification is absent.

### GREEN

Implement JSON parsing behind a sanitized catch, call the existing state-family
version classifier before the injected validator, and return data-only outcomes.
Do not implement JSON Schema keywords and do not cast unknown data to
`ProjectConfigV1` without validator success.

Run focused tests, typecheck, lint, and commit:

```bash
git commit -s -m "feat: classify project configuration before validation"
```

## Task 4: Resolve layered values with attached provenance

**Files:**

- Create: `packages/runtime/src/domain/project/layers.ts`
- Modify: `packages/runtime/src/domain/project/index.ts`
- Test: `tests/project-configuration-layers.test.ts`

### RED

Table-test a generic closed-key layer resolver:

- precedence is `default < project < flag`;
- every output is `{ value, source, ref }`;
- default refs are `null`, project refs are `.brain/config.json`, and flag refs
  are declared flag names;
- absent higher layers preserve both the lower value and its provenance;
- unknown keys and undefined values fail closed;
- input objects are not mutated;
- output key order is deterministic;
- no absolute path can be used as a provenance ref.

Run:

```bash
npx vitest run tests/project-configuration-layers.test.ts
```

Expected: FAIL because the layer resolver does not exist.

### GREEN

Implement the smallest generic resolver satisfying the closed key list supplied
by its caller. Do not choose shipped language, policy, or snapshot defaults.

Run focused tests and commit:

```bash
git commit -s -m "feat: retain provenance across configuration layers"
```

## Task 5: Add the read-only Workspace port and deterministic fake

**Files:**

- Modify: `packages/runtime/src/ports/index.ts`
- Modify: `packages/runtime/src/infra/fake/index.ts`
- Create: `tests/support/workspace-contract.ts`
- Create: `tests/fake-workspace.test.ts`
- Modify: `tests/runtime-fakes.test.ts`

### RED

Define one shared contract that requires:

- path canonicalization is idempotent;
- ancestor probes are nearest-first and end at the filesystem root;
- marker kinds distinguish absent, real directory, other, and escaping symlink;
- configuration bytes are returned only for a real project-local marker;
- a sibling legacy Brain is observed but never read as current state;
- worktree location distinguishes ordinary/principal and linked roots;
- traversal, NUL/control characters, empty segments, drive prefixes in the
  wrong path dialect, and symlink escapes are refused;
- every method is read-only.

Run:

```bash
npx vitest run tests/fake-workspace.test.ts tests/runtime-fakes.test.ts
```

Expected: FAIL because `Workspace` and `memoryWorkspace` are absent.

### GREEN

Add `Workspace` as a bootstrap port, not to `RuntimePorts`. Implement a fake
from an inert path tree with no mutation methods. Match the async rejection
behavior of Node ports.

Run focused tests, typecheck, lint, and commit:

```bash
git commit -s -m "feat: add the read-only workspace boundary"
```

## Task 6: Implement the Node workspace adapter

**Files:**

- Create: `packages/runtime/src/infra/node/workspace.ts`
- Modify: `packages/runtime/src/infra/node/index.ts`
- Test: `tests/node-workspace.test.ts`

### RED

Run the shared workspace contract against real temporary directories and Git
repositories. Include:

- ordinary repositories and nested directories;
- non-repository directories;
- detached HEAD and unborn repositories;
- linked worktrees whose paths contain spaces and Unicode;
- project-local `.brain`, marker-as-file, safe internal symlink target, and
  escaping symlink target;
- legacy sibling `<project>-brain/.brain`;
- an explicit root that does not exist or is not a directory;
- a real Git worktree fixture proving the synthetic topology is not vacuous.

Run:

```bash
npx vitest run tests/node-workspace.test.ts
```

Expected: FAIL because `nodeWorkspace` does not exist.

### GREEN

Implement canonicalization with `realpath`, inspect marker entries without
following an unsafe final symlink, walk parents with `dirname`, and query Git
with fixed locale/environment arguments. Never change process cwd. Convert
expected absence to data and allow unexpected I/O errors to reject for the
sanitized composition boundary.

Run the focused suite, typecheck, lint, and commit:

```bash
git commit -s -m "feat: observe projects through the node workspace adapter"
```

## Task 7: Compose bootstrap discovery before rooted runtime creation

**Files:**

- Create: `packages/runtime/src/composition/discovery.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Modify: `packages/runtime/package.json`
- Test: `tests/project-discovery-composition.test.ts`
- Modify: `tests/runtime-composition.test.ts`

### RED

Prove:

- `observeProject` receives only `Workspace` and `Environment` bootstrap ports;
- failure paths cannot access `FileSystem`, `Git`, `Locks`, `Ids`, or output;
- explicit roots are resolved relative to the observed working directory and
  process cwd never changes;
- validated `initialized` and `root-only` resolutions can create a runtime
  whose file/Git/lock adapters are rooted at the selected canonical root;
- validation, serialization, or observation failure happens before runtime
  creation;
- repeated observations are byte/deep equal.

Use recording factories and make a deliberately mutating bootstrap fixture fail
the test, proving the non-mutation assertion is active.

Run:

```bash
npx vitest run tests/project-discovery-composition.test.ts tests/runtime-composition.test.ts
```

Expected: FAIL because two-phase composition is absent.

### GREEN

Add a separate bootstrap composition type and an explicit
`createRuntimeAt(root, overrides)` function. Preserve `createRuntime` for the
existing public commands until a later command opts into project discovery.
Do not silently change help/version/handshake behavior.

Run focused tests, typecheck, lint, and commit:

```bash
git commit -s -m "feat: compose runtime creation after project discovery"
```

## Task 8: Prove normalization, traversal refusal, and determinism

**Files:**

- Create: `tests/project-discovery-properties.test.ts`
- Create: `tests/project-discovery-integration.test.ts`

### RED

Add a seeded generator without a new dependency. Generate path segments with
`.` / `..`, empty values, controls, separators, drive/UNC forms, spaces,
combining Unicode, and ordinary names. Assert:

- successful canonicalization is idempotent;
- no accepted project marker escapes its selected root;
- explicit traversal is never clamped into a valid project;
- equivalent observations resolve identically;
- local/principal worktree precedence is stable;
- discovery creates, writes, deletes, and appends nothing.

Print the seed on failure and include a deliberately weakened resolver fixture
that proves the properties detect an escape.

Run:

```bash
npx vitest run tests/project-discovery-properties.test.ts tests/project-discovery-integration.test.ts
```

Expected: FAIL until the property and integration boundaries expose every edge.

### GREEN

Fix only the production branches exposed by the tests. Do not add coverage
ignores for reachable logic.

Run focused tests and commit:

```bash
git commit -s -m "test: prove project discovery path safety"
```

## Task 9: Document the public internal contract and package it

**Files:**

- Create: `docs/architecture/project-discovery.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `README.md`
- Modify: `scripts/verify-package.mjs`
- Modify: `tests/bundle-smoke.test.ts`
- Modify: `tests/readme-honesty.test.ts`
- Modify: `tests/contract-documentation.test.ts`

### RED

Pin documentation and package assertions for:

- project-owned `.brain` and migration-only sibling state;
- explicit-root, ancestor, Git, and worktree precedence;
- no environment-variable configuration layer;
- provenance refs that are safe to render;
- the schema-registry seam owned by `RUN-04`;
- no change to the shipped command surface;
- bundle import of the discovery API with no runtime asset outside the three
  allowed plugin files.

Run the focused documentation, bundle, and package tests. Expected: FAIL until
the docs and bundle contract are updated.

### GREEN

Write concise public architecture documentation. Mention only public/redacted
legacy evidence; never include local paths or private source excerpts. Update
package verification only for actual bundled exports.

Run focused tests, build, package verification, and commit:

```bash
git commit -s -m "docs: publish the project discovery contract"
```

## Task 10: Complete verification, independent review, and delivery

### Local verification

Run, in order:

```bash
npm run verify
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 \
  .github/workflows/ci.yml .github/workflows/docs.yml
```

Require:

- focused and full suites green;
- 100% covered statements, branches, functions, and lines;
- typecheck, lint, format, spelling, contracts, oracle, parity, differential,
  build, and package verification green;
- parity still exactly `0 / 400`;
- `git diff --check` clean;
- every issue commit contains a DCO sign-off.

### Independent review

Review `origin/main..HEAD` with an independent agent. Fix every Critical and
Important finding using a new RED test before production changes. Repeat full
verification after the final fix and obtain a merge verdict.

### GitHub delivery

Push `feat/issue-18-project-discovery`, open a ready PR linking and closing #18,
list exact verification evidence, monitor both GitHub Actions workflows, fix
any failure, and squash-merge only when all required checks pass. Ensure the
squash commit has DCO sign-off.

After merge:

1. verify #18 is closed and mark every issue checklist item complete;
2. mark #18 complete in epic #15;
3. fast-forward local `main` without touching `.claude/` user worktrees;
4. delete the remote feature branch;
5. preserve the externally managed worktree registration rather than removing
   it from the host;
6. continue to the next open executable issue.

