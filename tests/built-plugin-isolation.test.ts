import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

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
  it("accepts only the exact native temporary build root for cleanup", () => {
    const portableTempRoot = join(tmpdir(), "kratos-portable-build-root");
    const portablePid = 123_456;
    const expectedName = `kratos-plugin-vitest-build-${String(portablePid)}`;
    const expectedRoot = join(portableTempRoot, expectedName);

    expect(isOwnedBuildRoot(expectedRoot, portableTempRoot, portablePid)).toBe(
      true,
    );
    expect(
      isOwnedBuildRoot(portableTempRoot, portableTempRoot, portablePid),
    ).toBe(false);
    expect(
      isOwnedBuildRoot(repositoryRoot, portableTempRoot, portablePid),
    ).toBe(false);
    expect(
      isOwnedBuildRoot(`${expectedRoot}-other`, portableTempRoot, portablePid),
    ).toBe(false);
    expect(
      isOwnedBuildRoot(
        join(
          portableTempRoot,
          `kratos-plugin-vitest-build-${String(portablePid + 1)}`,
        ),
        portableTempRoot,
        portablePid,
      ),
    ).toBe(false);
  });

  it("derives this process's root with native path APIs", () => {
    expect(isOwnedBuildRoot(buildRoot)).toBe(true);
    expect(dirname(buildRoot)).toBe(tmpdir());
    expect(basename(buildRoot)).toBe(
      `kratos-plugin-vitest-build-${String(process.pid)}`,
    );
    expect(buildRoot).toBe(
      join(tmpdir(), `kratos-plugin-vitest-build-${String(process.pid)}`),
    );
  });

  it("isolates concurrent child builds and removes each exact root on normal exit", async () => {
    const roots = await Promise.all([buildInChild(), buildInChild()]);

    expect(new Set(roots).size).toBe(2);
    for (const root of roots) {
      expect(dirname(root)).toBe(tmpdir());
      expect(basename(root)).toMatch(/^kratos-plugin-vitest-build-\d+$/u);
      expect(root).toBe(join(dirname(root), basename(root)));
      expect(existsSync(root)).toBe(false);
    }
  }, 60_000);
});
