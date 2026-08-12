import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nodeGitRunner } from "@mestre-yoda/runtime/infra/node";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yoda-git-runner-"));
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
    const root = await mkdtemp(join(tmpdir(), "yoda-git-runner-"));
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

  it("reports a timeout without throwing", async () => {
    const root = await repository();
    const result = await nodeGitRunner(root, { timeoutMs: 1 }).run([
      "-c",
      "alias.slow=!sleep 5",
      "slow",
    ]);

    expect(result.timedOut).toBe(true);
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
