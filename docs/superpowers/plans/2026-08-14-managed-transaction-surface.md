# Managed Transaction Surface Implementation Plan

Implements the design in
[`2026-08-14-managed-transaction-surface-design.md`](../specs/2026-08-14-managed-transaction-surface-design.md)
for issue [#101](https://github.com/thiagocorreanet/kratos-harness/issues/101)
(`RUN-05a`).

## Global constraints

- Test-first: write the failing assertion, watch it fail for the stated reason,
  then implement.
- No existing refusal weakens. Every path refused before this change is refused
  after it.
- Coverage stays at 100% on all four measures.
- Source, tests, comments, and commits in English.

## Specification coverage map

| Design section | Task |
| --- | --- |
| One rule, three consumers | 1, 2 |
| The widened surface | 1, 2 |
| The project root as a parent | 3 |
| What stays refused | 1, 4 |
| Testing strategy | 1-4 |

---

### Task 1: One rule

**Files:**

- Create: `packages/runtime/src/domain/transactions/surface.ts`
- Create: `tests/managed-surface.test.ts`
- Modify: `packages/runtime/src/domain/transactions/normalize.ts`

**Interfaces:**

- Produces: `isManagedDestination(path): boolean`, total and pure.

- [ ] **Step 1: Write the accept and refuse tables**

Both tables in one place, since they are one rule. The refuse table is the
existing one from `tests/transaction-normalization.test.ts`, copied
deliberately: a rule that stops refusing what it refused is the regression this
task exists to prevent.

- [ ] **Step 2: Verify RED, implement, verify GREEN**

The normalizer keeps throwing `guard.outside_allow`; only the question it asks
moves.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: state the managed-surface rule once"
```

---

### Task 2: Three consumers, one answer

**Files:**

- Modify: `packages/runtime/src/composition/transactions.ts`,
  `packages/runtime/src/infra/node/transactions.ts`
- Modify: `tests/managed-surface.test.ts`

- [ ] **Step 1: Write the agreement property**

Over the accept table, the refuse table, and generated near-misses -- a
trailing slash, a doubled separator, a case variant, a traversal, a root file
one character off -- the normalizer, the composition predicate, and the adapter
reach the same verdict. Disagreement is the defect this asserts against, so the
property compares them rather than checking each against a list.

- [ ] **Step 2: Verify RED, replace both restatements, verify GREEN**

`infra` may import `domain`, so the adapter consumes the rule rather than
restating it.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor: have every layer ask the one surface rule"
```

---

### Task 3: A root destination has a parent

**Files:**

- Modify: `packages/runtime/src/ports/transactions.ts`,
  `packages/runtime/src/infra/node/transactions.ts`,
  `packages/runtime/src/infra/fake/**`,
  `packages/runtime/src/composition/transactions.ts`
- Modify: `tests/node-transaction-security.test.ts`,
  `tests/transaction-port-contract.ts`

- [ ] **Step 1: Write the sentinel contract test**

`inspect(".")` reports a directory, resolved through the same anchored root the
adapter validates for every other operation, and a project root that is not a
usable directory fails the way it already does. The port contract suite carries
this so the fake and the Node adapter answer alike.

- [ ] **Step 2: Publish a root file end to end**

A plan writing `CLAUDE.md` commits: its parent is inspected, its directory is
synchronized, and the receipt records the destination. The `parentOf` coverage
ignore goes away because the branch is now reached.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: inspect the project root a managed file sits in"
```

---

### Task 4: Interruption across the whole surface

**Files:**

- Create: `tests/transaction-surface-campaign.test.ts`
- Modify: `docs/architecture/atomic-transactions.md`

- [ ] **Step 1: Campaign across the three zones**

One plan writing under `.brain/`, under `.claude/`, and at the project root,
interrupted at every mutating durable boundary, leaves the project untouched or
complete. The campaign shape is the one `RUN-05` and `RUN-07` already use, and
the timeout allows for coverage instrumentation.

- [ ] **Step 2: Correct the documented contract**

The architecture document states the `.brain/`-only rule as the contract in
three places. It becomes the surface table from the design, including what
stays refused and why root files are accepted by exact name.

- [ ] **Step 3: Full repository gate**

```bash
npm test && npm run test:coverage
npm run format:check && npm run spellcheck && npm run lint && npm run typecheck
npm run oracle:verify && npm run parity:check && npm run result:check
npm run contracts:check && npm run differential:check
npm run build && npm run package:verify
```

- [ ] **Step 4: Commit, open the PR, merge on green**

The PR links #101, states that no refusal weakened, and carries `Closes #101`.
