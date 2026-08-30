import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  buildPlugin,
  buildRoot,
  repositoryRoot,
} from "./support/built-plugin.js";

const installer = join(repositoryRoot, "scripts/install-plugin.mjs");
const roots: string[] = [];

beforeAll(buildPlugin);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function run(
  command: string,
  host: "codex" | "claude-code" | "antigravity",
  source: string | null,
  target: string,
): string {
  return execFileSync(
    process.execPath,
    [
      installer,
      command,
      "--host",
      host,
      ...(source === null ? [] : ["--source", source]),
      "--target",
      target,
    ],
    { encoding: "utf8" },
  );
}

async function digestTree(directory: string): Promise<string> {
  const hash = createHash("sha256");
  const entries = (
    await readdir(directory, {
      recursive: true,
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  for (const file of entries) {
    hash.update(relative(directory, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

describe("atomic plugin installer", () => {
  it("installs idempotently, updates, and rolls back", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-install-"));
    roots.push(root);
    const target = join(root, "installed", "kratos-plugin");
    const secondBuild = join(root, "second-build");
    await cp(buildRoot, secondBuild, { recursive: true });

    expect(
      JSON.parse(run("install", "codex", buildRoot, target)),
    ).toMatchObject({
      host: "codex",
      installed: true,
    });
    expect(
      JSON.parse(run("install", "codex", buildRoot, target)),
    ).toMatchObject({
      host: "codex",
      installed: true,
    });

    const changed = join(
      secondBuild,
      "codex/runtime/source/packages/runtime/src/main.js",
    );
    await writeFile(changed, `${await readFile(changed, "utf8")}\n// update\n`);
    const manifestFile = join(secondBuild, "codex/runtime/manifest.json");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
      runtime: { sourceRoot: string; sourceTreeSha256: string };
    };
    manifest.runtime.sourceTreeSha256 = await digestTree(
      join(secondBuild, "codex", manifest.runtime.sourceRoot),
    );
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

    run("update", "codex", secondBuild, target);
    expect(
      await readFile(join(target, "runtime/manifest.json"), "utf8"),
    ).toContain(manifest.runtime.sourceTreeSha256);
    run("rollback", "codex", null, target);
    expect(
      await readFile(join(target, "runtime/manifest.json"), "utf8"),
    ).not.toContain(manifest.runtime.sourceTreeSha256);
  });

  it("installs antigravity package cleanly", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-install-antigravity-"));
    roots.push(root);
    const target = join(root, "installed", "kratos-antigravity");

    expect(
      JSON.parse(run("install", "antigravity", buildRoot, target)),
    ).toMatchObject({
      host: "antigravity",
      installed: true,
    });
    expect(
      JSON.parse(run("install", "antigravity", buildRoot, target)),
    ).toMatchObject({
      host: "antigravity",
      installed: true,
    });
  });

  it("refuses a source whose core digest was substituted", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-install-"));
    roots.push(root);
    const source = join(root, "source");
    await cp(buildRoot, source, { recursive: true });
    await writeFile(
      join(source, "claude-code/runtime/kratos.core.mjs"),
      "tampered",
    );

    expect(() =>
      run("install", "claude-code", source, join(root, "installed", "kratos")),
    ).toThrow();
  });
});
