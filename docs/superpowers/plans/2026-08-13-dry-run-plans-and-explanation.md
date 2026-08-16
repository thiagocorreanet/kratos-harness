# Dry-Run Plans and Decision Explanation Implementation Plan

Implements the design in
[`2026-08-13-dry-run-plans-and-explanation-design.md`](../specs/2026-08-13-dry-run-plans-and-explanation-design.md)
for issue [#47](https://github.com/thiagocorreanet/kratos-harness/issues/47)
(`RUN-09`).

## Global constraints

- Every task is test-first: write the failing assertion, watch it fail for the
  stated reason, then implement.
- No new command, flag, schema, or persisted artifact.
- Coverage stays at 100% statements, branches, functions, and lines.
- Source, tests, comments, and commits in English.

## Specification coverage map

| Design section | Task |
| --- | --- |
| Proving zero mutation | 1 |
| Where the decision already lives; preview shape | 2 |
| Preconditions and invalidation | 3 |
| Redaction; explanation primitives | 4 |
| Delivery boundary | 5 |

---

### Task 1: Read-only ports

**Files:**

- Create: `packages/runtime/src/composition/read-only.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Create: `tests/read-only-ports.test.ts`

**Interfaces:**

- Consumes: `RuntimePorts`, `DurableFileSystem`, `FileSystem`.
- Produces: `readOnlyPorts(ports)`, and a `ReadOnlyViolation` error naming the
  primitive that was called.

- [ ] **Step 1: Write the refusal table**

Every mutating primitive on both filesystem views refuses, and every reading
primitive passes through:

```ts
it.each([
  "createDirectory",
  "createDirectoryExclusive",
  "writeSynced",
  "replaceFile",
  "linkFileExclusive",
  "renameDirectoryExclusive",
  "removeFile",
  "removeEmptyDirectory",
  "syncDirectory",
])("refuses %s", async (primitive) => {
  await expect(call(readOnlyPorts(ports).durableFileSystem, primitive)).rejects.toBeInstanceOf(
    ReadOnlyViolation,
  );
});
```

The refusal names the primitive so a failing preview test says which write was
attempted, not merely that one was.

- [ ] **Step 2: Verify RED, then implement**

Run: `npx vitest run tests/read-only-ports.test.ts`

Expected: FAIL because the module is absent.

Implement the wrapper by enumerating the port surface explicitly. A proxy that
refuses anything not on an allow list would silently start refusing a future
read primitive; an explicit table fails to compile instead.

- [ ] **Step 3: Prove the reads still work**

`inspect`, `list`, and `readText` return the same values through the wrapper as
through the real ports, against a real temporary project.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: add read-only runtime ports"
```

---

### Task 2: The preview itself

**Files:**

- Modify: `packages/runtime/src/composition/index.ts`
- Create: `tests/mutation-preview.test.ts`

**Interfaces:**

- Consumes: the existing `applyPlan` decision prefix.
- Produces: `previewPlan(plan, ports, options): Promise<MutationPreview>`, with
  `applyPlan` calling it.

- [ ] **Step 1: Write the equality property**

The preview is the object the commit consumes, so the plan it reports and the
manifest the commit records must agree:

```ts
it("previews the plan the commit submits", async () => {
  const preview = await previewPlan(plan, readOnlyPorts(ports));
  const receipt = await applyPlan(plan, ports);
  expect(preview.kind).toBe("ready");
  expect(previewedDigest(preview)).toBe(manifestDigestOf(receipt));
});
```

- [ ] **Step 2: Write the blocked and no-op verdicts**

A project holding an incomplete transaction previews as blocked with
`runtime.recovery_required`, names that transaction, and leaves its directory
byte-identical — proving the preview did not reconcile.

A plan whose effects are already satisfied previews as `noop`.

- [ ] **Step 3: Verify RED**

Run: `npx vitest run tests/mutation-preview.test.ts`

Expected: FAIL because `previewPlan` is absent.

- [ ] **Step 4: Extract the prefix**

Move the decision prefix out of `applyPlan` into `previewPlan`, and have
`applyPlan` call it and commit its result. `applyPlan` keeps
`preflightManagedTransactions`; `previewPlan` inspects without reconciling.

`ids.next()` is not called during a preview. Where the prefix needs an
identifier, the preview reports the operation without one.

- [ ] **Step 5: Verify GREEN and no regression**

Run:

```bash
npx vitest run tests/mutation-preview.test.ts tests/runtime-composition.test.ts \
  tests/transaction-execution.test.ts tests/event-store-transaction.test.ts
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: preview the decision a mutation would commit"
```

---

### Task 3: Invalidation properties

**Files:**

- Create: `tests/mutation-preview-properties.test.ts`

**Interfaces:**

- Consumes: `previewPlan`, `applyPlan`, the transaction precondition boundary.
- Produces: no new API.

- [ ] **Step 1: Write the determinism property**

Over generated effect plans, two previews of the same plan against unchanged
state are byte-identical, and the preview's operation order matches the
committed manifest's.

- [ ] **Step 2: Write the invalidation property**

```ts
it("invalidates a preview whose destination moved", async () => {
  const preview = await previewPlan(plan, readOnlyPorts(ports));
  await mutateDestination(previewedPath(preview));
  await expect(applyPlan(plan, ports)).rejects.toMatchObject({
    reasonCode: "runtime.revision_conflict",
  });
});
```

- [ ] **Step 3: Verify GREEN**

Run: `npx vitest run tests/mutation-preview-properties.test.ts`

Expected: PASS without production changes. If a property fails, the defect is
in the shared path and is fixed there, never worked around in the test.

- [ ] **Step 4: Commit**

```bash
git commit -m "test: prove preview determinism and invalidation"
```

---

### Task 4: Rendering and explanation

**Files:**

- Create: `packages/runtime/src/composition/preview-result.ts`
- Modify: `packages/runtime/src/composition/index.ts`
- Create: `tests/preview-explanation.test.ts`

**Interfaces:**

- Consumes: `MutationPreview`, `resultFor`, `renderResultHuman`,
  `renderResultJson`.
- Produces: `previewResult(preview): Result`.

- [ ] **Step 1: Write the redaction assertion**

A plan writing a known sentinel renders, in both modes, without the sentinel and
with its digest:

```ts
const rendered = renderResultJson(previewResult(preview));
expect(rendered).not.toContain(SENTINEL);
expect(rendered).toContain(sha256(SENTINEL));
```

- [ ] **Step 2: Write the explanation assertions**

A ready preview reports its operation count, plan digest, and destinations as
evidence. A blocked preview reports its reason code and the artifact to act on.
A no-op preview says the requested state already holds rather than rendering an
empty result.

Human mode is sorted by destination path, so two runs are byte-identical.

- [ ] **Step 3: Verify RED, implement, verify GREEN**

Run: `npx vitest run tests/preview-explanation.test.ts tests/cli-contracts.test.ts`

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: explain a previewed decision through the result contract"
```

---

### Task 5: Documentation, evidence, and gate

**Files:**

- Create: `docs/architecture/dry-run-plans.md`
- Create: `docs/verification/issue-47-dry-run-evidence.md`
- Modify: `docs/architecture/runtime-boundaries.md`
- Modify: `tests/architecture.test.ts`

- [ ] **Step 1: Write failing documentation assertions**

```ts
it.each([
  "one code path, two exits",
  "readOnlyPorts",
  "runtime.revision_conflict",
  "runtime.recovery_required",
  "does not add a public command",
  "--dry-run",
])("publishes the preview boundary: %s", (required) => {
  expect(dryRunGuide).toContain(required);
});
```

The `--dry-run` token is asserted because the document must state why the flag
is absent. A reader who finds no mention will assume it was forgotten.

- [ ] **Step 2: Write the documents**

`dry-run-plans.md` documents the decision seam, the preview shape, the
zero-mutation proof, invalidation, redaction, the explanation projection, and
the compatibility reasoning for the absent flag. `runtime-boundaries.md` stops
saying public dry-run wiring is deferred and points at it.

`issue-47-dry-run-evidence.md` records the environment, the RED command, the
per-suite counts, and every acceptance criterion mapped to a named test.

- [ ] **Step 3: Full repository gate**

Run each separately and record the output:

```bash
npm test
npm run test:coverage
npm run format:check && npm run spellcheck && npm run lint && npm run typecheck
npm run oracle:verify && npm run parity:check && npm run result:check
npm run contracts:check && npm run differential:check
npm run build && npm run package:verify
```

Expected: every command exits 0; coverage reports 100% on all four measures;
parity unchanged at 0 / 400.

- [ ] **Step 4: Commit, open the PR, merge on green**

```bash
git commit -m "docs: publish dry-run plan evidence"
```

The PR links #47, states the compatibility decision about `--dry-run` and the
alternative rejected, lists the exact verification commands, and carries
`Closes #47`.
