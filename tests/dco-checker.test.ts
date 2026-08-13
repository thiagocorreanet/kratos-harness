import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = join(repositoryRoot, "scripts/check-dco.mjs");

const author = [
  "-c",
  "user.name=Test Author",
  "-c",
  "user.email=author@example.com",
];

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function git(root: string, args: readonly string[]): string {
  const result = spawnSync("git", [...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yoda-dco-"));
  roots.push(root);
  git(root, ["init", "-q", "--initial-branch=main"]);
  return root;
}

async function commit(
  root: string,
  message: string,
  options: { readonly signOff?: boolean; readonly file?: string } = {},
): Promise<void> {
  // Each commit touches its own file by default, so a branch can be merged
  // without contriving a conflict the test is not about.
  const file = options.file ?? `${message.replaceAll(" ", "-")}.txt`;
  await writeFile(join(root, file), `${message}\n`, "utf8");
  git(root, ["add", file]);
  git(root, [
    ...author,
    "commit",
    "-q",
    ...(options.signOff === true ? ["-s"] : []),
    "-m",
    message,
  ]);
}

function check(
  root: string,
  base: string,
  head: string,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [checker, "--base", base, "--head", head],
    { cwd: root, encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe("DCO sign-off checker", () => {
  it("accepts a range where every commit is signed", async () => {
    const root = await repository();
    await commit(root, "base", { signOff: true });
    const base = git(root, ["rev-parse", "HEAD"]);
    await commit(root, "first change", { signOff: true });
    await commit(root, "second change", { signOff: true });

    const result = check(root, base, "HEAD");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 commits signed off");
  });

  it("rejects an unsigned commit and names it", async () => {
    const root = await repository();
    await commit(root, "base", { signOff: true });
    const base = git(root, ["rev-parse", "HEAD"]);
    await commit(root, "compliant change", { signOff: true });
    await commit(root, "missing trailer");

    const result = check(root, base, "HEAD");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("1 commit without");
    expect(result.stderr).toContain("missing trailer");
    // The report must name only the offenders; listing a compliant commit
    // would send the author looking for a problem that is not there.
    expect(result.stderr).not.toContain("compliant change");
    expect(result.stderr).toContain("git commit -s");
  });

  it("reports every unsigned commit, not just the first", async () => {
    const root = await repository();
    await commit(root, "base", { signOff: true });
    const base = git(root, ["rev-parse", "HEAD"]);
    await commit(root, "first unsigned");
    await commit(root, "second unsigned");

    const result = check(root, base, "HEAD");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("2 commits without");
    expect(result.stderr).toContain("first unsigned");
    expect(result.stderr).toContain("second unsigned");
  });

  // A merge has no author to certify anything and cannot be signed after the
  // forge creates it. Requiring one would fail every branch that merges its
  // base, which is the normal way to update a pull request.
  it("exempts a merge commit while still checking its new commits", async () => {
    const root = await repository();
    await commit(root, "base", { signOff: true });
    const base = git(root, ["rev-parse", "HEAD"]);
    git(root, ["checkout", "-q", "-b", "side"]);
    await commit(root, "side change", { signOff: true });
    git(root, ["checkout", "-q", "main"]);
    await commit(root, "main change", { signOff: true });
    git(root, [
      ...author,
      "merge",
      "-q",
      "--no-ff",
      "-m",
      "Merge side",
      "side",
    ]);

    const result = check(root, base, "HEAD");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 commits signed off");
  });

  // `Signed-off-by: me` certifies nothing. Accepting it would make the gate
  // theatre, which is worse than no gate because it looks enforced.
  it("refuses a trailer with no reachable address", async () => {
    const root = await repository();
    await commit(root, "base", { signOff: true });
    const base = git(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, "file.txt"), "malformed\n", "utf8");
    git(root, ["add", "file.txt"]);
    git(root, [
      ...author,
      "commit",
      "-q",
      "-m",
      "malformed trailer\n\nSigned-off-by: nobody",
    ]);

    const result = check(root, base, "HEAD");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("malformed trailer");
  });

  it("accepts a sign-off that is not the last trailer", async () => {
    const root = await repository();
    await commit(root, "base", { signOff: true });
    const base = git(root, ["rev-parse", "HEAD"]);
    await writeFile(join(root, "file.txt"), "trailers\n", "utf8");
    git(root, ["add", "file.txt"]);
    git(root, [
      ...author,
      "commit",
      "-q",
      "-m",
      "many trailers\n\nSigned-off-by: Test Author <author@example.com>\nCo-Authored-By: Someone <someone@example.com>",
    ]);

    const result = check(root, base, "HEAD");

    expect(result.status).toBe(0);
  });

  it("reports usage rather than a stack trace when arguments are missing", async () => {
    const root = await repository();
    await commit(root, "base", { signOff: true });

    const result = spawnSync(process.execPath, [checker, "--base"], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("expected --base <commit> --head <commit>");
  });
});
