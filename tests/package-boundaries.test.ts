import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");
const entry = join(repositoryRoot, "dist/plugin/runtime/yoda.mjs");
const roots: string[] = [];

/** Patterns a project install must never contain. */
const denied = [
  /(^|\/)node_modules(\/|$)/u,
  /(^|\/)packages(\/|$)/u,
  /(^|\/)runtime(\/|$)/u,
  /\.(ts|map)$/u,
];

beforeAll(() => {
  execFileSync(process.execPath, ["scripts/build.mjs"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
});

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

/** A project directory whose name has a space and non-ASCII characters. */
async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yoda-boundary-"));
  roots.push(root);
  const directory = join(root, "a project ç ü");
  await mkdir(directory, { recursive: true });
  return directory;
}

/** A directory holding a decoy `yoda` that fails loudly if it is ever run. */
async function decoy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yoda-decoy-"));
  roots.push(root);
  const executable = join(root, "yoda");
  await writeFile(
    executable,
    "#!/bin/sh\necho 'the global yoda was used' >&2\nexit 99\n",
    "utf8",
  );
  await chmod(executable, 0o755);
  return root;
}

function run(cwd: string, args: readonly string[], path?: string): string {
  return execFileSync(process.execPath, [entry, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      HOME: cwd,
      NODE_OPTIONS: "",
      NODE_PATH: "",
      PATH: path ?? dirname(process.execPath),
      TMPDIR: tmpdir(),
    },
  });
}

describe("distribution boundaries", () => {
  it("runs from the plugin directory against a project with spaces and non-ASCII characters", async () => {
    const cwd = await project();

    expect(run(cwd, ["--version"]).trim()).toBe("0.0.0-development");
    expect(run(cwd, ["handshake"]).trim().startsWith("{")).toBe(true);
  });

  it("resolves the plugin root from the module, never from the working directory", async () => {
    const first = await project();
    const second = await project();

    // One installed plugin must serve any number of unrelated projects.
    expect(run(first, ["--version"])).toBe(run(second, ["--version"]));
  });

  it("never consults a global yoda on PATH", async () => {
    const cwd = await project();
    const decoyDirectory = await decoy();
    const path = `${decoyDirectory}:${dirname(process.execPath)}`;

    // Prove the decoy is actually reachable and fails loudly first. Without
    // this the next assertion would pass just as happily against a decoy that
    // was never executable, which would prove nothing at all.
    expect(() =>
      execFileSync("yoda", ["--version"], {
        cwd,
        encoding: "utf8",
        env: { PATH: path },
      }),
    ).toThrow();

    // The decoy exits 99 and writes to stderr if it is ever reached, so a
    // successful run is direct evidence that no global executable was used.
    expect(run(cwd, ["--version"], path).trim()).toBe("0.0.0-development");
  });

  it("leaves no runtime source or dependency in the project", async () => {
    const cwd = await project();
    run(cwd, ["--help"]);
    run(cwd, ["handshake"]);

    const entries = await readdir(cwd, { recursive: true });
    for (const found of entries) {
      const normalized = found.split("\\").join("/");
      for (const pattern of denied) {
        expect(normalized, `project install contains ${found}`).not.toMatch(
          pattern,
        );
      }
    }
  });

  it("does not write into the project at all", async () => {
    const cwd = await project();
    run(cwd, ["--version"]);

    // Nothing in this issue's scope mutates a project, and the runtime must
    // not create state surfaces as a side effect of being asked its version.
    expect(await readdir(cwd)).toEqual([]);
  });
});
