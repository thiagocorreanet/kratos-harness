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
  memoryFileSystem,
  memoryLocks,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
  stubGit,
} from "@mestre-yoda/runtime/infra/fake";
import {
  nodeClock,
  nodeEnvironment,
  nodeFileSystem,
  nodeIds,
  nodeLocks,
  nodeOutput,
  nodeDurableFileSystem,
} from "@mestre-yoda/runtime/infra/node";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  describeClockContract,
  describeEnvironmentContract,
  describeFileSystemContract,
  describeIdsContract,
  describeLocksContract,
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
  const root = await mkdtemp(join(tmpdir(), "yoda-transaction-port-"));
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
describeLocksContract("memory", () =>
  Promise.resolve({
    port: memoryLocks(),
    dispose: noDispose,
  }),
);
describeEnvironmentContract("fixed", () =>
  fixedEnvironment({ EXAMPLE: "value" }, "/project"),
);
describeOutputContract("recording", () => recordingOutput());

// The same suites, run against the real implementations. This is the point of
// having one suite: a fake that drifts from the Node behavior fails here.
describeClockContract("node", () => nodeClock());
describeIdsContract("node", () => nodeIds());
describeFileSystemContract("node", async () => {
  const root = await mkdtemp(join(tmpdir(), "yoda-node-fs-"));
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

describeLocksContract("node", async () => {
  const root = await mkdtemp(join(tmpdir(), "yoda-node-locks-"));
  return {
    port: nodeLocks(root),
    dispose: () => rm(root, { force: true, recursive: true }),
  };
});
// `RUN-07` and `RUN-08` own the full semantics of leases and repository
// classification. What is shared here is only what both implementations must
// already agree on; the exception is per-assertion, not per-port.
//
// TODO(RUN-08 Task 8): rewrite the Git port contract suite for the
// `observe()` shape, covering both `stubGit()` and
// `composeGit(nodeGitRunner(root), digests)` against a real repository. The
// classification semantics themselves are exercised by
// `tests/git-observation.test.ts`.

describe("node filesystem safety", () => {
  it("refuses a final component that is a symlink out of the root", async () => {
    const root = await mkdtemp(join(tmpdir(), "yoda-node-fs-"));
    const outside = await mkdtemp(join(tmpdir(), "yoda-outside-"));
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
    const root = await mkdtemp(join(tmpdir(), "yoda-node-fs-"));
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
    const root = await mkdtemp(join(tmpdir(), "yoda-node-fs-"));
    const outside = await mkdtemp(join(tmpdir(), "yoda-outside-"));
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
    expect(result).toMatchObject({
      kind: "observed",
      repository: { worktree: "principal", operation: "none", changes: [] },
      evidence: [],
    });
  });

  it("reports the fixed observation it was configured with", async () => {
    const observation = { kind: "not_a_repository" as const, evidence: [] };
    expect(await stubGit(observation).observe()).toBe(observation);
  });
});
