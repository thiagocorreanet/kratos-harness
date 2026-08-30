import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildRoot,
  isOwnedBuildRoot,
  repositoryRoot,
} from "./support/built-plugin.js";

const helperUrl = new URL("./support/built-plugin.ts", import.meta.url).href;
const buildInChildProgram = [
  `import { buildPlugin, buildRoot } from ${JSON.stringify(helperUrl)};`,
  "buildPlugin();",
  "process.stdout.write(buildRoot);",
].join("\n");

function buildInChild(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--input-type=module", "--eval", buildInChildProgram],
      { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let errors = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      errors += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(`built-plugin child exited ${String(code)}: ${errors}`),
        );
        return;
      }
      resolve(output);
    });
  });
}

describe("built plugin test isolation", () => {
  it("accepts only this process's exact /tmp build root for cleanup", () => {
    expect(isOwnedBuildRoot(buildRoot)).toBe(true);
    expect(isOwnedBuildRoot("/tmp")).toBe(false);
    expect(isOwnedBuildRoot(repositoryRoot)).toBe(false);
    expect(isOwnedBuildRoot(`${buildRoot}-other`)).toBe(false);
    expect(
      isOwnedBuildRoot(
        `/tmp/kratos-plugin-vitest-build-${String(process.pid + 1)}`,
      ),
    ).toBe(false);
  });

  it("isolates concurrent child builds and removes each exact root on normal exit", async () => {
    const roots = await Promise.all([buildInChild(), buildInChild()]);

    expect(new Set(roots).size).toBe(2);
    for (const root of roots) {
      expect(root).toMatch(/^\/tmp\/kratos-plugin-vitest-build-\d+$/u);
      expect(existsSync(root)).toBe(false);
    }
  }, 60_000);
});
