# Runtime Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic core that cannot reach the filesystem, clock, randomness, process, Git, or a host, because the dependency direction that would allow it fails CI; effects arrive only through injected ports wired by one composition root.

**Architecture:** Four layers — `domain`, `ports`, `infra`, `composition` — with one direction, enforced by a test that reads every package source and resolves each import specifier to a layer. Ports are interfaces; each has a Node implementation and a deterministic fake, both proven by the same contract suite.

**Tech Stack:** Node.js 24.18.0, strict TypeScript 6, Vitest 4.

## Global Constraints

- `domain` and `ports` must not import `node:*`, `infra`, or `composition`.
- Only an entry point may import `composition`.
- `@mestre-yoda/contracts` must not import runtime layers.
- The composition root selects a fake only from an explicit caller argument; no environment check, no `isTest` branch.
- Every port implementation passes the same contract suite; a genuine divergence is a named exception, never a skipped case.
- New `domain`, `ports`, and `composition` modules join the 100% coverage gate. `infra/node` does not, to avoid unreachable defensive branches written only to satisfy a threshold.
- Keep repository content and delivery text English-only and DCO-sign every commit.

## Status

Task 1 landed before this plan was written, which was a process deviation: the
implementation started before the plan existed. The task is recorded here as
completed so the plan describes the whole change rather than only its remainder.

---

### Task 1: Enforce dependency direction

**Files:**

- Create: `tests/support/architecture.ts`
- Create: `tests/architecture.test.ts`
- Create: `packages/runtime/src/domain/effects.ts`
- Create: `packages/runtime/src/ports/index.ts`

**Interfaces:**

- Produces `collectImports(file)`, `classifyLayer(path)`, and `violations(modules)`.
- Produces `Effect`, `EffectPlan`, `planOf`. `concatPlans` and `touchedPaths` were dropped: they had no consumer, and a test written only to satisfy the coverage gate would have kept speculative code alive.
- Produces `Clock`, `Ids`, `FileSystem`, `Git`, `Locks`, `Environment`, `Output`, `RuntimePorts`.

- [x] **Step 1: Write the failing architecture tests**
- [x] **Step 2: Run RED**
- [x] **Step 3: Implement the rule engine and the first two layers**
- [x] **Step 4: Run GREEN and commit**

Delivered in `9e18378`. Static and side-effect imports are matched anchored to
the start of a line so a specifier quoted inside an expression is not counted;
the extractor is tested against exactly that case. The repository sweep asserts
it saw `domain` and `ports` files, so an empty glob cannot report success.

### Task 2: Implement deterministic fakes and one shared contract suite

**Files:**

- Create: `packages/runtime/src/infra/fake/index.ts`
- Create: `tests/support/port-contracts.ts`
- Create: `tests/ports-contract.test.ts`

**Interfaces:**

- Produces `fixedClock(iso)`, `sequentialIds(prefix?)`, `memoryFileSystem(seed?)`, `stubGit(state?)`, `memoryLocks()`, `fixedEnvironment(values, cwd)`, `recordingOutput()`.
- Produces `describeClockContract`, `describeIdsContract`, `describeFileSystemContract`, `describeGitContract`, `describeLocksContract`, `describeEnvironmentContract`, `describeOutputContract`, each taking `(label: string, factory: () => Port)`.
- Consumes the port interfaces from Task 1.

- [x] **Step 1: Write the failing contract suites**

Each suite states behavior every implementation must share. The filesystem suite
is the substantial one:

```ts
export function describeFileSystemContract(
  label: string,
  factory: () => Promise<{ fileSystem: FileSystem; dispose: () => Promise<void> }>,
): void {
  describe(`FileSystem contract: ${label}`, () => {
    it("round-trips a written file", async () => {
      const { fileSystem, dispose } = await factory();
      try {
        await fileSystem.write("a.txt", "hello");
        expect(await fileSystem.read("a.txt")).toBe("hello");
        expect(await fileSystem.stat("a.txt")).toEqual({ kind: "file", size: 5 });
      } finally {
        await dispose();
      }
    });

    it("creates parent directories for a nested write", async () => {
      const { fileSystem, dispose } = await factory();
      try {
        await fileSystem.write("nested/deep/a.txt", "x");
        expect(await fileSystem.read("nested/deep/a.txt")).toBe("x");
        expect((await fileSystem.stat("nested"))?.kind).toBe("directory");
      } finally {
        await dispose();
      }
    });

    it("reports a missing path as null rather than throwing", async () => {
      const { fileSystem, dispose } = await factory();
      try {
        expect(await fileSystem.stat("missing.txt")).toBeNull();
      } finally {
        await dispose();
      }
    });

    it("rejects reading a missing file", async () => {
      const { fileSystem, dispose } = await factory();
      try {
        await expect(fileSystem.read("missing.txt")).rejects.toThrow();
      } finally {
        await dispose();
      }
    });

    it("lists entries in sorted order", async () => {
      const { fileSystem, dispose } = await factory();
      try {
        await fileSystem.write("b.txt", "b");
        await fileSystem.write("a.txt", "a");
        await fileSystem.makeDirectory("c");
        expect(await fileSystem.list(".")).toEqual(["a.txt", "b.txt", "c"]);
      } finally {
        await dispose();
      }
    });

    it("removes a file and forgets it", async () => {
      const { fileSystem, dispose } = await factory();
      try {
        await fileSystem.write("a.txt", "a");
        await fileSystem.remove("a.txt");
        expect(await fileSystem.stat("a.txt")).toBeNull();
      } finally {
        await dispose();
      }
    });

    it.each(["../escape.txt", "/absolute.txt", "a/../../escape.txt"])(
      "refuses the escaping path %s",
      async (path) => {
        const { fileSystem, dispose } = await factory();
        try {
          await expect(fileSystem.write(path, "x")).rejects.toThrow(
            "path escapes the project",
          );
        } finally {
          await dispose();
        }
      },
    );
  });
}
```

The clock, ids, environment, and output suites assert the properties that make
them injectable at all:

```ts
export function describeClockContract(label: string, factory: () => Clock): void {
  describe(`Clock contract: ${label}`, () => {
    it("returns a valid instant", () => {
      expect(Number.isNaN(factory().now().getTime())).toBe(false);
    });

    it("does not hand out a mutable shared instant", () => {
      const clock = factory();
      const first = clock.now();
      first.setFullYear(1990);
      expect(clock.now().getFullYear()).not.toBe(1990);
    });
  });
}

export function describeIdsContract(label: string, factory: () => Ids): void {
  describe(`Ids contract: ${label}`, () => {
    it("never repeats within one provider", () => {
      const ids = factory();
      const produced = Array.from({ length: 100 }, () => ids.next());
      expect(new Set(produced).size).toBe(100);
    });

    it("produces safe opaque identifiers", () => {
      expect(factory().next()).toMatch(/^[A-Za-z0-9_-]{1,64}$/u);
    });
  });
}
```

Then invoke each suite against the fake in `tests/ports-contract.test.ts`.

- [x] **Step 2: Run RED**

```bash
npm test -- tests/ports-contract.test.ts
```

Expected: FAIL because `infra/fake` does not exist.

- [x] **Step 3: Implement the fakes**

`memoryFileSystem` stores a `Map<string, string>` of normalized project-relative
paths plus a `Set<string>` of directories. Normalization rejects absolute paths
and any path whose resolved segments escape the root, throwing an error whose message contains `path escapes the project`, which is
what the contract asserts. Writing creates parent directories. `list` sorts with
`localeCompare(…, "en-US")` so ordering is stable across platforms.

`fixedClock(iso)` returns a new `Date` each call so a caller cannot mutate the
provider's instant. `sequentialIds(prefix = "id")` returns `` `${prefix}-1` ``,
`` `${prefix}-2` ``, and so on. `stubGit` returns configured values.
`memoryLocks` grants a lease when the scope is free and returns `null`
otherwise, incrementing a fencing token per grant. `recordingOutput` appends to
two arrays a test can read.

- [x] **Step 4: Run GREEN and commit**

```bash
npm test -- tests/ports-contract.test.ts tests/architecture.test.ts
npm run typecheck
npm run lint
git add packages/runtime/src/infra tests
git commit -s -m "feat: add deterministic port fakes and one shared contract suite"
```

### Task 3: Implement the Node-backed ports

**Files:**

- Create: `packages/runtime/src/infra/node/index.ts`
- Modify: `tests/ports-contract.test.ts`

**Interfaces:**

- Produces `nodeClock()`, `nodeIds()`, `nodeFileSystem(root)`, `nodeGit(root)`, `nodeLocks(root)`, `nodeEnvironment()`, `nodeOutput()`.
- Consumes the same contract suites from Task 2.

- [x] **Step 1: Extend the contract test to run every suite twice**

```ts
describeFileSystemContract("memory", async () => ({
  fileSystem: memoryFileSystem(),
  dispose: async () => {},
}));

describeFileSystemContract("node", async () => {
  const root = await mkdtemp(join(tmpdir(), "yoda-fs-"));
  return {
    fileSystem: nodeFileSystem(root),
    dispose: () => rm(root, { force: true, recursive: true }),
  };
});
```

Do the same for clock, ids, environment, and output. Git and locks run their
suites against the fake only, with an explicit comment naming why: `RUN-07` and
`RUN-08` own those semantics, and asserting real Git or real lease expiry here
would pre-empt issues that have not been designed.

- [x] **Step 2: Run RED**

```bash
npm test -- tests/ports-contract.test.ts
```

Expected: FAIL because `infra/node` does not exist.

- [x] **Step 3: Implement the Node ports**

`nodeFileSystem(root)` resolves every path through the same normalization the
fake uses, then `realpath`s the parent and requires it below `root` before any
mutation, so a symlink cannot redirect a write outside the project. It uses
`mkdir(..., { recursive: true })` before writing and reads with `utf8`.

`nodeIds()` uses `randomUUID()` with hyphens removed, which satisfies the
opaque-identifier pattern the contract asserts. `nodeClock()` returns
`new Date()`. `nodeEnvironment()` reads `process.env` and `process.cwd()`.
`nodeOutput()` writes to `process.stdout` and `process.stderr`.

`nodeGit(root)` and `nodeLocks(root)` are deliberately minimal: `nodeGit`
classifies via `git rev-parse` and `git status --porcelain` with a literal
argument vector and `shell: false`; `nodeLocks` writes a lock file with `flag:
"wx"` so acquisition is atomic. Both carry a comment naming the issue that owns
their full semantics.

- [x] **Step 4: Run GREEN and commit**

```bash
npm test -- tests/ports-contract.test.ts
npm run typecheck
npm run lint
git add packages/runtime/src/infra tests
git commit -s -m "feat: add Node-backed port implementations"
```

### Task 4: Compose the runtime and apply effect plans

**Files:**

- Create: `packages/runtime/src/composition/runtime.ts`
- Create: `packages/runtime/src/domain/decision.ts`
- Create: `tests/runtime-composition.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**

- Produces `createRuntime(overrides?: Partial<RuntimePorts>): RuntimePorts`.
- Produces `applyPlan(plan: EffectPlan, ports: RuntimePorts): Promise<void>`.
- Produces `Decision` binding a `result.v1` document to an `EffectPlan`.

- [x] **Step 1: Write the failing composition tests**

```ts
it("uses Node implementations when nothing is overridden", () => {
  const ports = createRuntime();
  expect(ports.environment.workingDirectory()).toBe(process.cwd());
});

it("replaces exactly the overridden ports", () => {
  const clock = fixedClock("2026-08-07T00:00:00.000Z");
  const ports = createRuntime({ clock });
  expect(ports.clock).toBe(clock);
  expect(ports.environment.workingDirectory()).toBe(process.cwd());
});

it("produces byte-identical output for two fixed runs", async () => {
  const run = async () => {
    const output = recordingOutput();
    const ports = createRuntime({
      clock: fixedClock("2026-08-07T00:00:00.000Z"),
      ids: sequentialIds(),
      fileSystem: memoryFileSystem(),
      output,
    });
    await applyPlan(
      planOf(
        { kind: "create_directory", path: ".brain" },
        { kind: "write_file", path: ".brain/state.json", content: "{}" },
        { kind: "emit", channel: "structured", text: ports.ids.next() },
      ),
      ports,
    );
    return output.structured.join("");
  };

  expect(await run()).toBe(await run());
});

it("applies effects in declared order", async () => {
  const fileSystem = memoryFileSystem();
  const ports = createRuntime({ fileSystem, output: recordingOutput() });
  await applyPlan(
    planOf(
      { kind: "write_file", path: "a.txt", content: "first" },
      { kind: "write_file", path: "a.txt", content: "second" },
    ),
    ports,
  );
  expect(await fileSystem.read("a.txt")).toBe("second");
});
```

- [x] **Step 2: Run RED**

```bash
npm test -- tests/runtime-composition.test.ts
```

Expected: FAIL because `composition/runtime.ts` does not exist.

- [x] **Step 3: Implement composition and plan application**

`createRuntime` builds the Node ports and spreads `overrides` over them, so an
absent key keeps the real implementation and a present key replaces exactly
that one. It reads no environment variable to decide.

`applyPlan` switches exhaustively over `Effect["kind"]`, so adding a variant
without handling it fails `tsc` rather than being silently ignored. It applies
effects sequentially in declared order.

Add `packages/runtime/src/domain/**` and `packages/runtime/src/composition/**`
to the `vitest.config.ts` coverage `include` array. Leave `infra` out.

- [x] **Step 4: Run GREEN and commit**

```bash
npm test -- tests/runtime-composition.test.ts
npm run test:coverage
npm run typecheck
npm run lint
git add packages/runtime/src vitest.config.ts tests
git commit -s -m "feat: compose runtime ports and apply effect plans"
```

### Task 5: Document, verify, review, and deliver

**Files:**

- Create: `docs/architecture/runtime-boundaries.md`
- Modify: `docs/development/toolchain.md`
- Modify: `tests/architecture.test.ts`
- Modify: this plan

**Interfaces:**

- Publishes the layer table, the port catalogue, the composition contract, and honest unchanged parity.

- [x] **Step 1: Write documentation RED tests**

Add a guide test requiring `docs/architecture/runtime-boundaries.md` to contain
each layer name, each port name, `createRuntime`, `EffectPlan`, and the sentence
that only an entry point may import composition. Assert parity still reads
`0 / 400 (0.00%)`.

- [x] **Step 2: Run RED**

```bash
npm test -- tests/architecture.test.ts
```

Expected: FAIL because the guide does not exist.

- [x] **Step 3: Publish exact documentation**

Document the four layers and their allowed imports; why the rule is a test
rather than a linter plugin; the seven ports and which issue owns the full
semantics of `Git` and `Locks`; the composition contract and why it takes
overrides rather than reading the environment; the effect plan and its
relationship to dry run; and that this issue adds no policy, no transition, and
no parity evidence.

- [x] **Step 4: Run final verification**

```bash
export PATH=/tmp/tmp.qb2rcwG3r2/node-v24.18.0-linux-x64/bin:$PATH
npm test -- tests/architecture.test.ts tests/ports-contract.test.ts tests/runtime-composition.test.ts
npm run verify
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.12 .github/workflows/ci.yml .github/workflows/docs.yml
npx markdownlint-cli2 "**/*.md" "#node_modules" "#.worktrees"
rg --files -g '*.md' -g '!node_modules/**' -g '!.worktrees/**' -0 | xargs -0 /tmp/tmp.KmVAr8uMu3/lychee-x86_64-unknown-linux-gnu/lychee --config .lychee.toml
git diff --check main...HEAD
git status --short
```

Expected: all gates PASS, parity unchanged, only intended changes remain.

- [x] **Step 5: Commit and review**

```bash
git add docs tests
git commit -s -m "docs: publish the runtime boundary contract"
```

Use `requesting-code-review` against `main...HEAD`; resolve every Critical and
Important finding with `receiving-code-review`, then rerun Step 4.

- [ ] **Step 6: Deliver and close #16**

Push, open an English PR with `Closes #16`, include the exact commands and the
determinism evidence, wait for GitHub checks, squash merge, confirm issue `#16`
closed, mark only `#16` in epic `#15`, fast-forward `main`, and remove this
owned worktree and branch.
