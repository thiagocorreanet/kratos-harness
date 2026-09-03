import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  buildPlugin,
  hostPackage,
  runtimeEntry,
} from "./support/built-plugin.js";

const roots: string[] = [];

beforeAll(buildPlugin);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kratos-boundary-"));
  roots.push(root);
  const directory = join(root, "a project ç ü");
  await mkdir(directory, { recursive: true });
  return directory;
}

describe("distribution boundaries", () => {
  it("one installed plugin serves unrelated project directories", async () => {
    const first = await project();
    const second = await project();
    const run = (cwd: string) =>
      execFileSync(process.execPath, [runtimeEntry(), "--version"], {
        cwd,
        encoding: "utf8",
      });

    expect(run(first)).toBe("0.3.0\n");
    expect(run(second)).toBe(run(first));
    expect(await readdir(first)).toEqual([]);
    expect(await readdir(second)).toEqual([]);
  });

  it("runs from a plugin root containing spaces and Unicode", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-plugin-root-"));
    roots.push(root);
    const installed = join(root, "plúg in dir ç ü");
    await cp(hostPackage("codex"), installed, { recursive: true });

    expect(
      execFileSync(
        process.execPath,
        [join(installed, "runtime/kratos.mjs"), "--version"],
        { cwd: await project(), encoding: "utf8" },
      ),
    ).toBe("0.3.0\n");
  });
});
