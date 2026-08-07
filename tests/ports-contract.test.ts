import { mkdtemp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fixedClock,
  fixedEnvironment,
  memoryFileSystem,
  memoryLocks,
  recordingOutput,
  sequentialIds,
  stubGit,
} from "@mestre-yoda/runtime/infra/fake";
import {
  nodeClock,
  nodeEnvironment,
  nodeFileSystem,
  nodeIds,
  nodeOutput,
} from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import {
  describeClockContract,
  describeEnvironmentContract,
  describeFileSystemContract,
  describeGitContract,
  describeIdsContract,
  describeLocksContract,
  describeOutputContract,
} from "./support/port-contracts.js";

const noDispose = (): Promise<void> => Promise.resolve();

describeClockContract("fixed", () => fixedClock("2026-08-07T00:00:00.000Z"));
describeIdsContract("sequential", () => sequentialIds());
describeFileSystemContract("memory", () =>
  Promise.resolve({
    port: memoryFileSystem(),
    dispose: noDispose,
  }),
);
describeGitContract("stub", () =>
  Promise.resolve({
    port: stubGit(),
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

// Git and locks run against the fake only. `RUN-08` and `RUN-07` own their real
// semantics; asserting repository classification or lease expiry here would
// pre-empt issues that have not been designed yet.

describe("node filesystem safety", () => {
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

  it("reports the repository state it was configured with", async () => {
    const git = stubGit({
      state: "dirty",
      head: "a".repeat(40),
      changedPaths: ["b.txt", "a.txt"],
    });
    expect(await git.state()).toBe("dirty");
    expect(await git.head()).toBe("a".repeat(40));
    // Sorting is the port's job, not the caller's.
    expect(await git.changedPaths()).toEqual(["a.txt", "b.txt"]);
  });
});
