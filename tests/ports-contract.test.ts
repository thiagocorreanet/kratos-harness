import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fixedClock,
  fixedEnvironment,
  fixedModelRouting,
  memoryFileSystem,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
  stubGit,
} from "@kratos/runtime/infra/fake";
import {
  nodeClock,
  nodeEnvironment,
  nodeFileSystem,
  nodeGitRunner,
  nodeIds,
  nodeOutput,
  unavailableModelRouting,
  nodeDurableFileSystem,
  sha256Digests,
} from "@kratos/runtime/infra/node";
import { describe, expect, expectTypeOf, it } from "vitest";

import { composeGit } from "../packages/runtime/src/composition/git.js";

import { codexCatalog } from "./support/model-routing.js";

import {
  describeClockContract,
  describeEnvironmentContract,
  describeFileSystemContract,
  describeGitContract,
  describeIdsContract,
  describeModelRoutingContract,
  describeOutputContract,
} from "./support/port-contracts.js";
import {
  describeDurableFileSystemContract,
  type DurableFileSystemContractFactory,
} from "./support/transaction-port-contract.js";

const noDispose = (): Promise<void> => Promise.resolve();

describe("durable filesystem contract suite", () => {
  it("exports the reusable contract factory shape", () => {
    expectTypeOf(describeDurableFileSystemContract).toEqualTypeOf<
      (label: string, factory: DurableFileSystemContractFactory) => void
    >();
    expect(describeDurableFileSystemContract).toBeTypeOf("function");
  });
});

describeDurableFileSystemContract("memory", () => {
  const storage = memoryTransactionStorage();
  return Promise.resolve({
    port: storage.durableFileSystem,
    dispose: noDispose,
  });
});

describeDurableFileSystemContract("node", async () => {
  const root = await mkdtemp(join(tmpdir(), "kratos-transaction-port-"));
  return {
    port: nodeDurableFileSystem(root),
    dispose: () => rm(root, { force: true, recursive: true }),
  };
});

describeClockContract("fixed", () => fixedClock("2026-08-07T00:00:00.000Z"));
describeIdsContract("sequential", () => sequentialIds());
describeFileSystemContract("memory", () =>
  Promise.resolve({
    port: memoryFileSystem(),
    dispose: noDispose,
  }),
);
describeFileSystemContract("memory transaction storage", () =>
  Promise.resolve({
    port: memoryTransactionStorage().fileSystem,
    dispose: noDispose,
  }),
);
describeEnvironmentContract("fixed", () =>
  fixedEnvironment({ EXAMPLE: "value" }, "/project"),
);
describeOutputContract("recording", () => recordingOutput());
describeModelRoutingContract("fixed without catalogs", () =>
  fixedModelRouting([]),
);
describeModelRoutingContract(
  "unavailable node catalog",
  unavailableModelRouting,
);

describe("fixed model routing", () => {
  it("returns a closed snapshot only for the host that supplied it", async () => {
    const catalog = codexCatalog();
    const routing = fixedModelRouting([catalog]);
    const observed = await routing.observe("codex");
    expect(observed).not.toBe(catalog);
    expect(observed).not.toBeNull();
    expect(Object.isFrozen(observed)).toBe(true);
    expect(await routing.observe("claude")).toBeNull();
  });
});
describeGitContract("stub", () =>
  Promise.resolve({ port: stubGit(), dispose: noDispose }),
);

// The same suites, run against the real implementations. This is the point of
// having one suite: a fake that drifts from the Node behavior fails here.
describeClockContract("node", () => nodeClock());
describeIdsContract("node", () => nodeIds());
describeFileSystemContract("node", async () => {
  const root = await mkdtemp(join(tmpdir(), "kratos-node-fs-"));
  return {
    port: nodeFileSystem(root),
    dispose: () => rm(root, { force: true, recursive: true }),
  };
});
describeEnvironmentContract("node", () => nodeEnvironment());
describeOutputContract("node", () =>
  // Discard the bytes so the suite does not write to the test runner's streams.
  nodeOutput({
    structured: () => undefined,
    human: () => undefined,
  }),
);

// `RUN-07` and `RUN-08` own the full semantics of leases and repository
// classification. What is shared here is only what both implementations must
// already agree on; the exception is per-assertion, not per-port.

const GIT_IDENTITY = [
  "-c",
  "user.email=t@e.com",
  "-c",
  "user.name=T",
  "-c",
  "commit.gpgsign=false",
] as const;

/**
 * A freshly initialized repository whose change list needs a real sort to
 * land in `compareGitPaths` order, so the shared "changes sorted by path
 * bytes" contract property has data it can actually fail against.
 *
 * Two properties of `git status --porcelain=v2` make an unordered fixture
 * insufficient here. First, it groups records by category -- ordinary
 * tracked changes before untracked entries -- regardless of path bytes, so a
 * modified `m.txt` is emitted *before* an untracked `a.txt` even though `a`
 * sorts first; confirmed empirically before writing this. Only a fixture
 * that spans both categories can catch a regression that drops the sort
 * entirely. Second, `B.txt` exercises byte order against locale order: byte
 * order sorts upper-case ASCII before lower-case (`B.txt` < `a.txt` <
 * `m.txt`), while locale collation would not put it there.
 */
async function initGitRepository(root: string): Promise<void> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  execFileSync("git", ["init", "-q", "--initial-branch=main"], {
    cwd: root,
    env,
  });
  await writeFile(join(root, "m.txt"), "1\n", "utf8");
  execFileSync("git", [...GIT_IDENTITY, "add", "--", "m.txt"], {
    cwd: root,
    env,
  });
  execFileSync("git", [...GIT_IDENTITY, "commit", "-q", "-m", "initial"], {
    cwd: root,
    env,
  });
  // Tracked and modified: an ordinary "1 " record, emitted by Git before any
  // untracked record regardless of path bytes.
  await writeFile(join(root, "m.txt"), "2\n", "utf8");
  // Untracked, and alphabetically before "m.txt" -- only a real sort moves
  // it ahead of the ordinary record above.
  await writeFile(join(root, "a.txt"), "a\n", "utf8");
  // Untracked, upper-case: byte order puts this ahead of "a.txt" too.
  await writeFile(join(root, "B.txt"), "B\n", "utf8");
}

describeGitContract("node", async () => {
  const root = await mkdtemp(join(tmpdir(), "kratos-node-git-"));
  await initGitRepository(root);
  return {
    port: composeGit(nodeGitRunner(root), sha256Digests()),
    dispose: () => rm(root, { force: true, recursive: true }),
  };
});

describe("node filesystem safety", () => {
  it("refuses a final component that is a symlink out of the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-node-fs-"));
    const outside = await mkdtemp(join(tmpdir(), "kratos-outside-"));
    try {
      const secret = join(outside, "secret.txt");
      await writeFile(secret, "SECRET", "utf8");
      await symlink(secret, join(root, "link.txt"));
      const fileSystem = nodeFileSystem(root);

      // Resolving only the parent misses this: the parent is the root itself,
      // so the redirect lives entirely in the last segment.
      await expect(fileSystem.read("link.txt")).rejects.toThrow(
        "escapes the project",
      );
      await expect(fileSystem.write("link.txt", "PWNED")).rejects.toThrow(
        "escapes the project",
      );
      await expect(fileSystem.stat("link.txt")).rejects.toThrow(
        "escapes the project",
      );
      expect(await readFile(secret, "utf8")).toBe("SECRET");
    } finally {
      await Promise.all([
        rm(root, { force: true, recursive: true }),
        rm(outside, { force: true, recursive: true }),
      ]);
    }
  });

  it("still allows a symlink that stays inside the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-node-fs-"));
    try {
      const fileSystem = nodeFileSystem(root);
      await fileSystem.write("real.txt", "inside");
      await symlink(join(root, "real.txt"), join(root, "alias.txt"));

      // A refusal must be about escaping, not about symlinks as such.
      expect(await fileSystem.read("alias.txt")).toBe("inside");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("refuses a write redirected outside the root by a symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-node-fs-"));
    const outside = await mkdtemp(join(tmpdir(), "kratos-outside-"));
    try {
      await symlink(outside, join(root, "escape"));
      const fileSystem = nodeFileSystem(root);

      // The path is lexically safe, so only resolving the real parent catches
      // this. Normalization alone would have written outside the project.
      await expect(fileSystem.write("escape/a.txt", "x")).rejects.toThrow(
        "escapes the project",
      );
      expect(await readdir(outside)).toEqual([]);
    } finally {
      await Promise.all([
        rm(root, { force: true, recursive: true }),
        rm(outside, { force: true, recursive: true }),
      ]);
    }
  });
});

describe("deterministic fakes", () => {
  it("returns the same instant every time", () => {
    const clock = fixedClock("2026-08-07T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-07T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-08-07T00:00:00.000Z");
  });

  it("numbers identifiers in order from a stable prefix", () => {
    const ids = sequentialIds("event");
    expect([ids.next(), ids.next(), ids.next()]).toEqual([
      "event-1",
      "event-2",
      "event-3",
    ]);
  });

  it("seeds a filesystem from an initial map", async () => {
    const fileSystem = memoryFileSystem({ "a.txt": "seeded" });
    expect(await fileSystem.read("a.txt")).toBe("seeded");
  });

  it("records output per channel in order", () => {
    const output = recordingOutput();
    output.structured("one");
    output.human("two");
    output.structured("three");
    expect(output.structured_).toEqual(["one", "three"]);
    expect(output.human_).toEqual(["two"]);
  });

  it("reads only the values it was given", () => {
    const environment = fixedEnvironment({ EXAMPLE: "value" }, "/project");
    expect(environment.get("EXAMPLE")).toBe("value");
    expect(environment.get("PATH")).toBeUndefined();
    expect(environment.workingDirectory()).toBe("/project");
  });

  it("defaults to an observed clean principal worktree", async () => {
    const result = await stubGit().observe();
    // `toEqual`, not `toMatchObject`: the latter would silently skip `head`,
    // the only stub field no other test in this suite checks.
    expect(result).toEqual({
      kind: "observed",
      repository: {
        head: {
          kind: "branch",
          branch: "main",
          commit: "0".repeat(40),
          upstream: null,
        },
        worktree: "principal",
        operation: "none",
        changes: [],
      },
      evidence: [],
    });
  });

  it("reports the fixed observation it was configured with", async () => {
    // `describeGitContract("stub", …)` only ever calls `stubGit()` with no
    // argument, so the parameterized echo -- the entire reason `observation`
    // is a parameter -- needs its own assertion. `toEqual` rather than `toBe`:
    // a defensively-copying implementation would still satisfy the contract,
    // and this test should not forbid one.
    const observation = { kind: "not_a_repository" as const, evidence: [] };
    expect(await stubGit(observation).observe()).toEqual(observation);
  });
});
