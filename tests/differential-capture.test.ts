import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureAfter,
  captureBefore,
  materializeWorkspace,
  type ProcessObservation,
} from "@kratos/differential";
import { afterEach, describe, expect, it } from "vitest";

const emptyDigest =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const temporaryRoots: string[] = [];

function digestOf(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
const processObservation: ProcessObservation = {
  outcome: "exit",
  exitCode: 0,
  signal: null,
  stdout: { bytes: 0, sha256: emptyDigest },
  stderr: { bytes: 0, sha256: emptyDigest },
};

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kratos-differential-capture-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("differential workspace capture", () => {
  it("materializes and classifies deterministic filesystem and JSON changes", async () => {
    const root = await temporaryRoot();
    const project = await materializeWorkspace(root, [
      { type: "directory", path: ".brain" },
      {
        type: "file",
        path: ".brain/state.json",
        content: '{"revision":1,"stateContract":"1.0.0"}\n',
        executable: false,
      },
      {
        type: "file",
        path: "tool.mjs",
        content: "process.exit(0);\n",
        executable: true,
      },
      { type: "symlink", path: "state-link.json", target: ".brain/state.json" },
    ]);
    const capture = {
      structured: [{ id: "state", path: ".brain/state.json" }],
      git: false,
    };
    const baseline = await captureBefore(project, capture);

    await writeFile(
      join(project, ".brain/state.json"),
      '{"revision":2,"stateContract":"1.0.0"}\n',
      "utf8",
    );
    await writeFile(join(project, "created.txt"), "created\n", "utf8");
    await unlink(join(project, "tool.mjs"));

    const result = await captureAfter(
      project,
      capture,
      baseline,
      processObservation,
      "digest",
    );
    expect(result.filesystem.before.map(({ path }) => path)).toEqual([
      ".brain",
      ".brain/state.json",
      "state-link.json",
      "tool.mjs",
    ]);
    expect(result.filesystem.mutations).toEqual([
      { path: ".brain/state.json", kind: "modified" },
      { path: "created.txt", kind: "added" },
      { path: "tool.mjs", kind: "deleted" },
    ]);
    expect(result.structured).toEqual([
      {
        id: "state",
        path: ".brain/state.json",
        state: "valid",
        value: { revision: 2, stateContract: "1.0.0" },
      },
    ]);
    expect(result.git).toBeNull();
    expect(await readFile(join(project, "state-link.json"), "utf8")).toContain(
      '"revision":2',
    );
  });

  it("captures Git identity, status, refs, and worktree differences", async () => {
    const root = await temporaryRoot();
    const project = await materializeWorkspace(root, [
      {
        type: "file",
        path: "tracked.txt",
        content: "before\n",
        executable: false,
      },
    ]);
    execFileSync("git", ["init", "-q", "--initial-branch=main"], {
      cwd: project,
    });
    execFileSync("git", ["add", "tracked.txt"], { cwd: project });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Differential Test",
        "-c",
        "user.email=differential@example.invalid",
        "commit",
        "-qm",
        "fixture",
      ],
      { cwd: project },
    );
    const capture = { structured: [], git: true };
    const baseline = await captureBefore(project, capture);
    await writeFile(join(project, "tracked.txt"), "after\n", "utf8");

    const result = await captureAfter(
      project,
      capture,
      baseline,
      processObservation,
      "digest",
    );
    expect(result.git?.head).toMatch(/^[a-f0-9]{40}$/u);
    expect(result.git?.status.bytes).toBeGreaterThan(0);
    expect(result.git?.worktreeDiff.bytes).toBeGreaterThan(0);
    expect(result.git?.indexDiff.bytes).toBe(0);
    expect(result.git?.refs).toEqual([
      { name: "refs/heads/main", object: result.git?.head },
    ]);
  });

  it("rejects unsafe links before writing a workspace", async () => {
    const root = await temporaryRoot();
    await expect(
      materializeWorkspace(root, [
        { type: "symlink", path: "escape", target: "../outside" },
      ]),
    ).rejects.toThrow("Differential workspace path is unsafe");
    await expect(lstat(join(root, "project"))).rejects.toThrow();
  });

  it("rejects a selected JSON file replaced by an escaping symlink", async () => {
    const root = await temporaryRoot();
    const project = await materializeWorkspace(root, [
      {
        type: "file",
        path: "state.json",
        content: '{"safe":true}\n',
        executable: false,
      },
    ]);
    const capture = {
      structured: [{ id: "state", path: "state.json" }],
      git: false,
    };
    const baseline = await captureBefore(project, capture);
    await writeFile(join(root, "outside.json"), '{"private":true}\n', "utf8");
    await unlink(join(project, "state.json"));
    await symlink("../outside.json", join(project, "state.json"));

    await expect(
      captureAfter(project, capture, baseline, processObservation, "digest"),
    ).rejects.toThrow("Differential structured capture path is unsafe");
  });

  it("observes malformed selected JSON as a comparable digest", async () => {
    const root = await temporaryRoot();
    const project = await materializeWorkspace(root, [
      {
        type: "file",
        path: "state.json",
        content: "{invalid\n",
        executable: false,
      },
    ]);
    const capture = {
      structured: [{ id: "state", path: "state.json" }],
      git: false,
    };
    const baseline = await captureBefore(project, capture);
    const result = await captureAfter(
      project,
      capture,
      baseline,
      processObservation,
      "digest",
    );

    // Invalid structured output is a behavioral difference the harness must be
    // able to compare, not a harness failure.
    expect(result.structured).toEqual([
      {
        id: "state",
        path: "state.json",
        state: "invalid",
        bytes: 9,
        sha256: digestOf("{invalid\n"),
      },
    ]);
  });

  it("observes a missing selected artifact instead of failing", async () => {
    const root = await temporaryRoot();
    const project = await materializeWorkspace(root, [
      {
        type: "file",
        path: "keep.txt",
        content: "keep\n",
        executable: false,
      },
    ]);
    const capture = {
      structured: [{ id: "result", path: "result.json" }],
      git: false,
    };
    const baseline = await captureBefore(project, capture);
    const result = await captureAfter(
      project,
      capture,
      baseline,
      processObservation,
      "digest",
    );

    // "The candidate produced no artifact" is the single most important
    // comparison; it must be a field-level mismatch, not an opaque exit 2.
    expect(result.structured).toEqual([
      { id: "result", path: "result.json", state: "absent" },
    ]);
  });

  it("observes a selected path that is not a regular file", async () => {
    const root = await temporaryRoot();
    const project = await materializeWorkspace(root, [
      { type: "directory", path: "result.json" },
    ]);
    const capture = {
      structured: [{ id: "result", path: "result.json" }],
      git: false,
    };
    const baseline = await captureBefore(project, capture);
    const result = await captureAfter(
      project,
      capture,
      baseline,
      processObservation,
      "digest",
    );

    expect(result.structured).toEqual([
      { id: "result", path: "result.json", state: "unreadable" },
    ]);
  });

  it("captures an unborn HEAD as a null identity", async () => {
    const root = await temporaryRoot();
    const project = await materializeWorkspace(root, [
      {
        type: "file",
        path: "untracked.txt",
        content: "new\n",
        executable: false,
      },
    ]);
    execFileSync("git", ["init", "-q", "--initial-branch=main"], {
      cwd: project,
    });
    const capture = { structured: [], git: true };
    const baseline = await captureBefore(project, capture);

    const result = await captureAfter(
      project,
      capture,
      baseline,
      processObservation,
      "digest",
    );

    // "Did the tool initialize a repository?" must be observable.
    expect(result.git).not.toBeNull();
    expect(result.git?.head).toBeNull();
    expect(result.git?.refs).toEqual([]);
  });

  it("fails closed when Git is required but unavailable", async () => {
    const root = await temporaryRoot();
    const project = await materializeWorkspace(root, [
      { type: "file", path: "keep.txt", content: "keep\n", executable: false },
    ]);
    const capture = { structured: [], git: true };
    const baseline = await captureBefore(project, capture);
    const originalPath = process.env.PATH;
    process.env.PATH = join(root, "empty-path");
    try {
      // A missing Git binary must not be silently recorded as "not a
      // repository" on both sides, which would be a vacuous equality.
      await expect(
        captureAfter(project, capture, baseline, processObservation, "digest"),
      ).rejects.toThrow("Differential Git capture cannot run git");
    } finally {
      process.env.PATH = originalPath;
    }
  });

  it("rejects a workspace containing a special file", async () => {
    const root = await temporaryRoot();
    const project = await materializeWorkspace(root, [
      { type: "file", path: "keep.txt", content: "keep\n", executable: false },
    ]);
    execFileSync("mkfifo", [join(project, "pipe")]);
    const capture = { structured: [], git: false };

    await expect(captureBefore(project, capture)).rejects.toThrow(
      "Differential filesystem capture found a special file",
    );
  });

  it("rejects a workspace that exceeds the manifest entry limit", async () => {
    const root = await temporaryRoot();
    const project = await materializeWorkspace(root, [
      { type: "file", path: "keep.txt", content: "keep\n", executable: false },
    ]);
    await Promise.all(
      Array.from({ length: 4_100 }, (_unused, index) =>
        writeFile(join(project, `f${String(index)}.txt`), "x", "utf8"),
      ),
    );
    const capture = { structured: [], git: false };

    await expect(captureBefore(project, capture)).rejects.toThrow(
      "Differential filesystem capture exceeds the entry limit",
    );
  });
});
