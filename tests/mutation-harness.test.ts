import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");
const mutationRunner = join(repositoryRoot, "scripts/run-mutation.mjs");

describe("gate mutation harness", () => {
  it("loads the modular per-gate evaluator and kills every sentinel", () => {
    const result = spawnSync(process.execPath, [mutationRunner], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("gate mutation score: 4 / 4 (100.00%)\n");
  });
});
