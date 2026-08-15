import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { nodeWorkspace } from "@kratos/runtime/infra/node";
import { discoverProject } from "@kratos/runtime/composition/discovery";
import { fixedEnvironment } from "@kratos/runtime/infra/fake";
import { describe, expect, it } from "vitest";

import { describeWorkspaceContract } from "./support/workspace-contract.js";

const run = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<void> {
  await run("git", [...args], {
    cwd,
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" },
  });
}

async function linkedFixture() {
  const base = await mkdtemp(join(tmpdir(), "kratos-workspace-"));
  const principal = join(base, "repos", "café project");
  const project = join(base, "worktrees", "café task");
  const start = join(project, "src", "deep");
  await mkdir(principal, { recursive: true });
  await git(principal, ["init"]);
  await writeFile(join(principal, "README.md"), "fixture\n");
  await git(principal, ["add", "README.md"]);
  await git(principal, [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "fixture",
  ]);
  await mkdir(dirname(project), { recursive: true });
  await git(principal, ["worktree", "add", "-b", "fixture-task", project]);
  await mkdir(join(project, ".brain"));
  await writeFile(
    join(project, ".brain", "config.json"),
    '{"stateContract":"1.0.0"}\n',
  );
  await mkdir(start, { recursive: true });
  return {
    port: nodeWorkspace(),
    start,
    project,
    principal,
    dispose: () => rm(base, { recursive: true, force: true }),
  };
}

describeWorkspaceContract("node", linkedFixture);

describe("node workspace edge classifications", () => {
  it("classifies marker files and missing explicit directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-workspace-file-"));
    try {
      await writeFile(join(root, ".brain"), "not a directory");
      const workspace = nodeWorkspace();
      expect((await workspace.ancestors(root))[0]).toMatchObject({
        brain: "other",
        configuration: { kind: "absent" },
      });
      expect(await workspace.canonicalize("missing", root)).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("propagates unexpected canonicalization failures", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-workspace-error-"));
    try {
      await expect(
        nodeWorkspace().canonicalize("x".repeat(5_000), root),
      ).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts an internal marker symlink and refuses an escaping one", async () => {
    const base = await mkdtemp(join(tmpdir(), "kratos-workspace-link-"));
    const project = join(base, "project");
    const internal = join(project, "state");
    const external = join(base, "private");
    await Promise.all([
      mkdir(internal, { recursive: true }),
      mkdir(external, { recursive: true }),
    ]);
    await writeFile(join(internal, "config.json"), "safe");
    try {
      await symlink(internal, join(project, ".brain"));
      const workspace = nodeWorkspace();
      expect((await workspace.ancestors(project))[0]).toMatchObject({
        brain: "directory",
        configuration: { kind: "file", text: "safe" },
      });
      await rm(join(project, ".brain"));
      await symlink(external, join(project, ".brain"));
      expect((await workspace.ancestors(project))[0]).toMatchObject({
        brain: "escaping",
        configuration: { kind: "absent" },
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("observes legacy sibling state without reading it", async () => {
    const base = await mkdtemp(join(tmpdir(), "kratos-workspace-legacy-"));
    const project = join(base, "project");
    const legacy = join(base, "project-brain", ".brain");
    await Promise.all([mkdir(project), mkdir(legacy, { recursive: true })]);
    await writeFile(join(legacy, "config.json"), "legacy-secret");
    try {
      expect((await nodeWorkspace().ancestors(project))[0]).toMatchObject({
        brain: "absent",
        legacyBrain: true,
        configuration: { kind: "absent" },
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("locates the same repository while detached", async () => {
    const fixture = await linkedFixture();
    try {
      await git(fixture.project, ["checkout", "--detach"]);
      expect(await fixture.port.locateWorktree(fixture.start)).toEqual({
        kind: "linked",
        topLevel: fixture.project,
        principal: fixture.principal,
      });
      expect((await lstat(fixture.project)).isDirectory()).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });

  it("locates an unborn ordinary repository", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-workspace-unborn-"));
    try {
      await git(root, ["init"]);
      expect(await nodeWorkspace().locateWorktree(root)).toEqual({
        kind: "principal",
        topLevel: root,
        principal: root,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses ambiguous principal topology when Git metadata is stored separately", async () => {
    const base = await mkdtemp(join(tmpdir(), "kratos-workspace-separated-"));
    const principal = join(base, "principal");
    const metadata = join(base, "metadata", "project.git");
    const linked = join(base, "linked");
    try {
      await mkdir(principal, { recursive: true });
      await mkdir(dirname(metadata), { recursive: true });
      await git(principal, ["init", "--separate-git-dir", metadata]);
      await writeFile(join(principal, "README.md"), "fixture\n");
      await git(principal, ["add", "README.md"]);
      await git(principal, [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-m",
        "fixture",
      ]);
      await git(principal, ["worktree", "add", "-b", "separated", linked]);

      expect(await nodeWorkspace().locateWorktree(linked)).toBeNull();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("refuses a malformed Git marker instead of selecting it as a root", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-workspace-malformed-git-"));
    try {
      await writeFile(
        join(root, ".git"),
        "gitdir: /missing/private/location\n",
      );
      await expect(
        discoverProject(
          {
            workingDirectory: root,
            explicitRoot: null,
            worktreeMode: "principal",
          },
          {
            workspace: nodeWorkspace(),
            environment: fixedEnvironment({}, root),
          },
          () => ({ kind: "invalid" }),
        ),
      ).resolves.toEqual({
        kind: "marker-unusable",
        root,
        reasonCode: "guard.project_marker_corrupt",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
