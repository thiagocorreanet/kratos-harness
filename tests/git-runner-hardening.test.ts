import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { nodeGitRunner } from "@kratos/runtime/infra/node";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

/**
 * Run the real runner against a `git` that only records how it was called.
 *
 * The hardening this file pins is a set of constants nothing asserted: the
 * fixed argument prefix and the environment that neutralizes system and global
 * configuration. Deleting `GIT_CONFIG_NOSYSTEM` or `-c core.quotepath=false`
 * used to change no test, while changing what a gate sees. `pathOverride` is
 * the seam that already exists for this, so nothing in the adapter moves.
 */
async function record(
  args: readonly string[],
): Promise<{ argv: readonly string[]; env: Record<string, string> }> {
  const root = await mkdtemp(join(tmpdir(), "kratos-git-hardening-"));
  roots.push(root);
  const binaries = join(root, "bin");
  await mkdir(binaries, { recursive: true });
  const argvPath = join(root, "argv");
  const envPath = join(root, "env");
  const shim = join(binaries, "git");
  await writeFile(
    shim,
    [
      "#!/bin/sh",
      `: > '${argvPath}'`,
      `for argument in "$@"; do printf '%s\\n' "$argument" >> '${argvPath}'; done`,
      // `env` is not reachable: PATH is replaced by the shim directory alone,
      // which is itself part of what this test proves. `export -p` is a shell
      // builtin, so it needs no PATH entry.
      `export -p > '${envPath}'`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(shim, 0o755);
  await nodeGitRunner(root, { pathOverride: binaries }).run(args);
  const argv = (await readFile(argvPath, "utf8")).split("\n").slice(0, -1);
  const env: Record<string, string> = {};
  for (const raw of (await readFile(envPath, "utf8")).split("\n")) {
    const line = raw.startsWith("export ") ? raw.slice(7) : raw;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const value = line.slice(separator + 1);
    env[line.slice(0, separator)] = /^'.*'$/su.test(value)
      ? value.slice(1, -1).replaceAll("'\\''", "'")
      : value;
  }
  return { argv, env };
}

describe("the Git runner's fixed argument prefix", () => {
  it("prefixes every command with the exact hardening flags", async () => {
    const { argv } = await record(["status", "--porcelain=v2"]);
    expect(argv).toEqual([
      "--no-optional-locks",
      "--no-pager",
      "-c",
      "core.quotepath=false",
      "-c",
      "status.renames=copies",
      "status",
      "--porcelain=v2",
    ]);
  });

  it("pins path quoting and rename detection past a repository's own config", async () => {
    // `-c` on the command line outranks `.git/config`, which this adapter does
    // not neutralize. A repository that turned rename detection off would
    // otherwise turn every rename into an add plus a delete.
    const { argv } = await record(["rev-parse"]);
    expect(argv.slice(0, 6)).toContain("core.quotepath=false");
    expect(argv.slice(0, 6)).toContain("status.renames=copies");
  });

  it("passes the caller's arguments after the prefix and never before it", async () => {
    const { argv } = await record(["--version"]);
    expect(argv.at(-1)).toBe("--version");
    expect(argv[0]).toBe("--no-optional-locks");
  });
});

describe("the Git runner's environment", () => {
  it("neutralizes system and global configuration", async () => {
    const { env } = await record(["rev-parse"]);
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    // A path that cannot exist is what makes a personal ~/.gitconfig inert.
    expect(env.GIT_CONFIG_GLOBAL).toContain("kratos-absent-global-config");
    expect(env.GIT_OPTIONAL_LOCKS).toBe("0");
    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.LC_ALL).toBe("C");
  });

  it("hands Git nothing else from the ambient environment", async () => {
    const { env } = await record(["rev-parse"]);
    const declared = [
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_OPTIONAL_LOCKS",
      "GIT_TERMINAL_PROMPT",
      "LC_ALL",
      "PATH",
    ];
    // Node adds its own variables to a spawned child, so the assertion is that
    // nothing the adapter declares is missing and no other GIT_* leaks in.
    for (const name of declared) expect(env[name]).toBeDefined();
    expect(
      Object.keys(env)
        .filter((name) => name.startsWith("GIT_"))
        .sort(),
    ).toEqual([
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_OPTIONAL_LOCKS",
      "GIT_TERMINAL_PROMPT",
    ]);
  });

  it("uses the supplied PATH rather than the ambient one", async () => {
    const { env } = await record(["rev-parse"]);
    expect(env.PATH).not.toBe(process.env.PATH);
    expect(env.PATH).toContain("kratos-git-hardening-");
  });
});
