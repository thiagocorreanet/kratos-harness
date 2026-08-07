import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const checker = join(repositoryRoot, "scripts/check-contracts.mjs");
const generated = join(
  repositoryRoot,
  "packages/contracts/src/generated/contracts.ts",
);

function check(...args: string[]) {
  return spawnSync(process.execPath, [checker, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

describe("schema-derived contract declarations", () => {
  it("verifies committed declarations without rewriting them", async () => {
    const before = await readFile(generated, "utf8");
    const result = check();
    const after = await readFile(generated, "utf8");

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "contract families v1.0.0: verified (8 schemas; 14 legacy profiles; generated types current)\n",
    );
    expect(after).toBe(before);
    expect(after).toContain("Generated from registered JSON Schemas.");
    expect(after).toContain("export type AdapterMessageV1");
    expect(after).toContain("export interface ProjectConfigV1");
  });

  it("detects drift through an alternate generated path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yoda-contract-test-"));
    try {
      const stale = join(directory, "contracts.ts");
      await writeFile(stale, "export type Stale = true;\n", "utf8");
      const result = check("--generated", stale);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "Contract verification failed: generated declarations drifted\n",
      );
      expect(await readFile(stale, "utf8")).toBe("export type Stale = true;\n");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("rejects extra adapter fields and mismatched response payloads", async () => {
    const directory = await mkdtemp(
      join(repositoryRoot, ".contract-type-test-"),
    );
    try {
      const source = join(directory, "invalid-adapter.mts");
      await writeFile(
        source,
        `
          import type { AdapterMessageV1 } from "../packages/contracts/src/generated/contracts.js";
          const common = {
            contractVersion: "1.0.0" as const,
            hostContract: "1.0.0" as const,
            messageId: "message-01",
            host: "codex",
            operation: "sdd.continue",
            capabilities: [] as string[],
            observedIdentity: { adapterVersion: "1.0.0", model: null as string | null },
            payloadContract: "state.snapshot@1.0.0",
            correlationId: "correlation-01",
          };
          ({
            ...common,
            messageType: "request",
            payload: { ref: "snapshot.json", sha256: "${"a".repeat(64)}" },
            unexpected: true,
          }) satisfies AdapterMessageV1;
          ({
            ...common,
            messageType: "response",
            payload: { ref: "snapshot.json", sha256: "${"a".repeat(64)}" },
          }) satisfies AdapterMessageV1;
        `,
        "utf8",
      );
      const result = spawnSync(
        process.execPath,
        [
          join(repositoryRoot, "node_modules/typescript/lib/tsc.js"),
          "--ignoreConfig",
          "--noEmit",
          "--strict",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--target",
          "ES2024",
          source,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("unexpected");
      expect(result.stdout).toContain(
        "not assignable to type 'MestreYodaUniversalResultV1'",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it.each([
    ["unknown option", ["--other", "value"]],
    ["duplicate option", ["--generated", "one", "--generated", "two"]],
    ["missing value", ["--generated"]],
  ])("rejects %s as safe usage failure", (_name, args) => {
    const result = check(...args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Contract verification usage error: expected at most one --generated path\n",
    );
  });
});
