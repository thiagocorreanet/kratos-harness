import { spawnSync } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPlugin, hostPackage } from "./support/built-plugin.js";

let cleanRoom = "";

function execute(
  host: "codex" | "claude-code" | "antigravity",
  argument: "--help" | "--version",
) {
  const isolatedArtifact = join(cleanRoom, host, "runtime/kratos.mjs");
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
  for (const host of ["codex", "claude-code", "antigravity"] as const) {
    const plugin = join(cleanRoom, host);
    await cp(hostPackage(host), plugin, { recursive: true });
  }
});

afterAll(async () => {
  if (cleanRoom !== "") await rm(cleanRoom, { force: true, recursive: true });
});

describe("standalone runtime package", () => {
  it.each(["codex", "claude-code", "antigravity"] as const)(
    "prints help outside the repository for %s",
    (host) => {
      const result = execute(host, "--help");

      expect(result.status).toBe(0);
      expect(result.stdout.split("\n")[0]).toBe(
        "Usage: kratos [--expect <version>] [--json] <command>",
      );
      expect(result.stdout).toContain("  init");
      expect(result.stdout).not.toContain("discover");
      expect(result.stderr).toBe("");
    },
  );

  it.each(["codex", "claude-code", "antigravity"] as const)(
    "prints its version outside the repository for %s",
    (host) => {
      const result = execute(host, "--version");

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("0.2.0\n");
      expect(result.stderr).toBe("");
    },
  );
});
