import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  buildPlugin,
  buildRoot,
  hostPackage,
  repositoryRoot,
} from "./support/built-plugin";

function verify(): string {
  return execFileSync(
    process.execPath,
    ["scripts/verify-package.mjs", "--source", buildRoot],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

beforeEach(buildPlugin);

describe("package verifier", () => {
  it("proves both host packages and project flows", () => {
    expect(verify()).toBe(
      "Kratos package verification passed for Codex and Claude Code.\n",
    );
  });

  it("rejects a core that no longer matches its recorded digest", async () => {
    const core = join(hostPackage("codex"), "runtime/kratos.core.mjs");
    await writeFile(core, `${await readFile(core, "utf8")}\n// tampered\n`);

    expect(verify).toThrow();
  });

  it("rejects a modified modular runtime tree", async () => {
    const source = join(
      hostPackage("claude-code"),
      "runtime/source/packages/runtime/src/main.js",
    );
    await writeFile(source, `${await readFile(source, "utf8")}\n// tampered\n`);

    expect(verify).toThrow();
  });

  it("rejects a development-only TypeScript file", async () => {
    await writeFile(join(hostPackage("codex"), "forbidden.ts"), "export {};\n");

    expect(verify).toThrow();
  });
});
