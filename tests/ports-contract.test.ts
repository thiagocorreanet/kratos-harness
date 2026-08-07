import {
  fixedClock,
  fixedEnvironment,
  memoryFileSystem,
  memoryLocks,
  recordingOutput,
  sequentialIds,
  stubGit,
} from "@mestre-yoda/runtime/infra/fake";
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
