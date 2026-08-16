import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPlugin, hostPackage } from "./support/built-plugin.js";

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
  buildPlugin();
  cleanRoom = await mkdtemp(join(tmpdir(), "kratos-bundle-test-"));
  const plugin = join(cleanRoom, "codex");
  await cp(hostPackage("codex"), plugin, { recursive: true });
  isolatedArtifact = join(plugin, "runtime/kratos.mjs");
});

afterAll(async () => {
  if (cleanRoom !== "") await rm(cleanRoom, { force: true, recursive: true });
});

describe("standalone runtime package", () => {
  it("prints help outside the repository", () => {
    const result = execute("--help");

    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")[0]).toBe(
      "Usage: kratos [--expect <version>] [--json] <command>",
    );
    expect(result.stdout).toContain("  init");
    expect(result.stdout).not.toContain("discover");
    expect(result.stderr).toBe("");
  });

  it("prints its version outside the repository", () => {
    const result = execute("--version");

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("0.0.0-development\n");
    expect(result.stderr).toBe("");
  });
});
