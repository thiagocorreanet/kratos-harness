import { execFileSync } from "node:child_process";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nodeGitRunner, sha256Digests } from "@kratos/runtime/infra/node";
import { afterEach, describe, expect, it } from "vitest";

import { composeGit } from "../packages/runtime/src/composition/git.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kratos-git-runner-"));
  roots.push(root);
  execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: root });
  return root;
}

describe("nodeGitRunner", () => {
  it("returns raw bytes and a zero exit for a successful command", async () => {
    const root = await repository();
    const result = await nodeGitRunner(root).run([
      "rev-parse",
      "--is-inside-work-tree",
    ]);

    expect(result.spawned).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe("true");
  });

  it("reports a failing command without throwing", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-git-runner-"));
    roots.push(root);
    const result = await nodeGitRunner(root).run(["rev-parse", "--git-dir"]);

    expect(result.spawned).toBe(true);
    expect(result.exitCode).toBe(128);
  });

  it("reports a missing executable as not spawned", async () => {
    const root = await repository();
    // An empty PATH is how the adapter sees Git absent from the system.
    const result = await nodeGitRunner(root, { pathOverride: "" }).run([
      "status",
    ]);

    expect(result.spawned).toBe(false);
    expect(result.exitCode).toBeNull();
  });

  it("composes to a git_absent observation when PATH cannot find git", async () => {
    const root = await repository();

    const observation = await composeGit(
      nodeGitRunner(root, { pathOverride: "" }),
      sha256Digests(),
    ).observe();

    expect(observation.kind).toBe("git_absent");
  });

  it("reports a timeout without throwing", async () => {
    const root = await repository();
    const result = await nodeGitRunner(root, { timeoutMs: 1 }).run([
      "-c",
      "alias.slow=!sleep 5",
      "slow",
    ]);

    expect(result.timedOut).toBe(true);
  });

  it("reports a maxBuffer overflow without throwing", async () => {
    const root = await repository();
    const result = await nodeGitRunner(root, { maxBuffer: 1 }).run([
      "rev-parse",
      "--is-inside-work-tree",
    ]);

    expect(result.bufferExceeded).toBe(true);
  });

  it("composes to an unreadable observation when status output exceeds maxBuffer", async () => {
    const root = await repository();
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        writeFile(join(root, `untracked-${String(index)}.txt`), "x", "utf8"),
      ),
    );

    // Sized from the real rev-parse output so this is not a guess at a
    // magic number: large enough for rev-parse to succeed, far too small
    // for a status listing 50 untracked files to fit.
    const refs = await nodeGitRunner(root).run([
      "rev-parse",
      "--path-format=absolute",
      "--is-inside-work-tree",
      "--git-dir",
      "--git-common-dir",
    ]);
    const maxBuffer = refs.stdout.length + 16;

    const observation = await composeGit(
      nodeGitRunner(root, { maxBuffer }),
      sha256Digests(),
    ).observe();

    expect(observation.kind).toBe("unreadable");
  });

  it("does not write the index while observing", async () => {
    const root = await repository();
    await writeFile(join(root, "a.txt"), "a", "utf8");
    execFileSync("git", ["add", "a.txt"], { cwd: root });
    execFileSync(
      "git",
      ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-qm", "i"],
      {
        cwd: root,
      },
    );
    // Right after a commit, the index's cached stat info for a.txt already
    // matches the working tree, so `git status` has nothing to refresh and
    // the guard would be untested. Bumping the file's mtime forward makes
    // the cached stat stale, which is what makes an unguarded `git status`
    // rewrite the index — see the guard-removal experiment in the report.
    const stale = new Date(Date.now() + 60_000);
    await utimes(join(root, "a.txt"), stale, stale);
    const before = await readIndexDigest(root);

    await nodeGitRunner(root).run([
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "-uall",
      "--ignored=matching",
    ]);

    expect(await readIndexDigest(root)).toBe(before);
  });

  it("lists git-directory entries", async () => {
    const root = await repository();
    const entries = await nodeGitRunner(root).listGitDirectory(
      join(root, ".git"),
    );

    expect(entries).toContain("HEAD");
  });

  it("returns null for an unreadable git directory", async () => {
    const root = await repository();
    const entries = await nodeGitRunner(root).listGitDirectory(
      join(root, "absent"),
    );

    expect(entries).toBeNull();
  });
});

async function readIndexDigest(root: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const { readFile } = await import("node:fs/promises");
  return createHash("sha256")
    .update(await readFile(join(root, ".git", "index")))
    .digest("hex");
}
