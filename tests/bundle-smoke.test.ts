import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRuntime = join(repositoryRoot, "dist/plugin/runtime");
// The runtime boots in two files, so an isolated copy needs both.
const stagedFiles = ["manifest.json", "yoda.core.mjs", "yoda.mjs"];
let cleanRoom = "";
let isolatedArtifact = "";

function execute(argument: "--help" | "--version") {
  return spawnSync(process.execPath, [isolatedArtifact, argument], {
    cwd: cleanRoom,
    encoding: "utf8",
    env: {
      HOME: cleanRoom,
      NODE_OPTIONS: "",
      NODE_PATH: "",
      PATH: dirname(process.execPath),
      TMPDIR: tmpdir(),
    },
  });
}

beforeAll(async () => {
  execFileSync(process.execPath, ["scripts/build.mjs"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
  cleanRoom = await mkdtemp(join(tmpdir(), "mestre-yoda-bundle-test-"));
  const runtime = join(cleanRoom, "runtime");
  await mkdir(runtime, { recursive: true });
  for (const staged of stagedFiles) {
    await copyFile(join(sourceRuntime, staged), join(runtime, staged));
  }
  isolatedArtifact = join(runtime, "yoda.mjs");
});

afterAll(async () => {
  if (cleanRoom !== "") {
    await rm(cleanRoom, { force: true, recursive: true });
  }
});

describe("standalone runtime bundle", () => {
  it("prints help outside the repository", () => {
    const result = execute("--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Usage: yoda [--help | --version]\n");
    expect(result.stderr).toBe("");
  });

  it("prints its version outside the repository", () => {
    const result = execute("--version");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("0.0.0-development\n");
    expect(result.stderr).toBe("");
  });
});
