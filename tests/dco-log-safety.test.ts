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

const ESCAPE = "\u001b";
const BELL = "\u0007";
const EIGHT_BIT_CSI = "\u009b";

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

async function commitWith(
  root: string,
  message: string,
  file: string,
  signOff: boolean,
): Promise<string> {
  await writeFile(join(root, file), `${file}\n`, "utf8");
  git(root, ["add", file]);
  git(root, [
    ...author,
    "commit",
    "-q",
    ...(signOff ? ["-s"] : []),
    "-m",
    message,
  ]);
  return git(root, ["rev-parse", "HEAD"]);
}

function check(
  root: string,
  base: string,
  head: string,
): { status: number | null; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [checker, "--base", base, "--head", head],
    { cwd: root, encoding: "utf8" },
  );
  return { status: result.status, stderr: result.stderr };
}

/**
 * The subject of an unsigned commit reaches an Actions log, and it comes from a
 * fork branch nobody reviewed. Nothing sanitized it: an escape sequence there
 * could clear the screen or move the cursor over the remedy that follows.
 */
describe("the remedy printed for an unsigned commit", () => {
  it("never lets an unreviewed subject drive the build log", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-dco-log-"));
    roots.push(root);
    git(root, ["init", "-q", "--initial-branch=main"]);
    const base = await commitWith(root, "base", "base.txt", true);
    const hostile = `feat: add${ESCAPE}[2Jthing${BELL} and ${EIGHT_BIT_CSI}more`;
    const head = await commitWith(root, hostile, "hostile.txt", false);

    const result = check(root, base, head);

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain(ESCAPE);
    expect(result.stderr).not.toContain(BELL);
    expect(result.stderr).not.toContain(EIGHT_BIT_CSI);
    // The commit is still named, so a contributor can find what to sign.
    expect(result.stderr).toContain(head.slice(0, 12));
    expect(result.stderr).toContain("feat: add");
  });

  it("keeps an ordinary subject intact", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-dco-log-"));
    roots.push(root);
    git(root, ["init", "-q", "--initial-branch=main"]);
    const base = await commitWith(root, "base", "base.txt", true);
    const head = await commitWith(
      root,
      "feat: add the objective command",
      "one.txt",
      false,
    );

    expect(check(root, base, head).stderr).toContain(
      "feat: add the objective command",
    );
    expect(head).toHaveLength(40);
  });

  it("bounds one subject so it cannot bury the remedy", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-dco-log-"));
    roots.push(root);
    git(root, ["init", "-q", "--initial-branch=main"]);
    const base = await commitWith(root, "base", "base.txt", true);
    await commitWith(root, `feat: ${"a".repeat(500)}`, "long.txt", false);
    const head = git(root, ["rev-parse", "HEAD"]);

    const { stderr } = check(root, base, head);

    expect(stderr).toContain("…");
    expect(stderr).toContain("git rebase --signoff");
    for (const line of stderr.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(140);
    }
    expect(head).toHaveLength(40);
  });
});
