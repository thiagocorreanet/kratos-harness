import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { PHASE_AGENT_PROMPTS } from "@kratos/runtime/domain/phase-agents";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildPlugin,
  buildRoot,
  hostPackage,
  repositoryRoot,
} from "./support/built-plugin.js";

interface DistributionManifest {
  readonly contractVersion: string;
  readonly pluginVersion: string;
  readonly host: { readonly name: string; readonly assetsSha256: string };
  readonly runtime: {
    readonly entry: string;
    readonly core: string;
    readonly coreSha256: string;
    readonly sourceRoot: string;
    readonly sourceTreeSha256: string;
    readonly minimumNode: string;
  };
  readonly contracts: {
    readonly result: string;
    readonly reasonCatalog: string;
    readonly state: string;
    readonly host: string;
  };
}

beforeAll(buildPlugin);

describe("runtime distribution", () => {
  it("stages one independent package per host outside the repository", async () => {
    expect((await readdir(buildRoot)).sort()).toEqual([
      ".agents",
      ".claude-plugin",
      "antigravity",
      "claude-code",
      "codex",
    ]);
    expect(buildRoot.startsWith(repositoryRoot)).toBe(false);
  });

  it.each(["codex", "claude-code", "antigravity"] as const)(
    "binds the %s manifest to its runtime and host",
    async (host) => {
      const root = hostPackage(host);
      const manifest = JSON.parse(
        await readFile(join(root, "runtime/manifest.json"), "utf8"),
      ) as DistributionManifest;
      const core = await readFile(join(root, manifest.runtime.core));

      expect(manifest.contractVersion).toBe("1.0.0");
      expect(manifest.pluginVersion).toBe("0.0.0-development");
      expect(manifest.host.name).toBe(host);
      expect(manifest.host.assetsSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(manifest.runtime).toMatchObject({
        entry: "runtime/kratos.mjs",
        core: "runtime/kratos.core.mjs",
        sourceRoot: "runtime/source",
        minimumNode: "24.0.0",
      });
      expect(manifest.runtime.coreSha256).toBe(
        createHash("sha256").update(core).digest("hex"),
      );
      expect(manifest.runtime.sourceTreeSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(manifest.contracts).toEqual({
        result: "1.0.0",
        reasonCatalog: "1.10.0",
        state: "1.4.0",
        host: "1.3.0",
      });
    },
  );

  it.each(["codex", "claude-code", "antigravity"] as const)(
    "ships no development-only files in %s",
    async (host) => {
      const root = hostPackage(host);
      const entries = await readdir(root, { recursive: true });
      const denied = entries
        .map((entry) => relative(root, join(root, entry)))
        .filter(
          (entry) =>
            entry.includes("node_modules") ||
            entry.endsWith(".ts") ||
            entry.endsWith(".map"),
        );
      expect(denied).toEqual([]);
    },
  );

  it("keeps the executable preflight resolved", async () => {
    const entry = await readFile(
      join(hostPackage("codex"), "runtime/kratos.mjs"),
      "utf8",
    );
    expect(entry).not.toMatch(/__[A-Z_]+__/u);
    expect(entry).toContain("runtime.node_unsupported");
    expect(entry).toContain('import("./kratos.core.mjs")');
    expect(entry.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("stages every Claude phase agent from the canonical body", async () => {
    const root = hostPackage("claude-code");
    for (const definition of PHASE_AGENT_PROMPTS) {
      const content = await readFile(
        join(root, "agents", `${definition.id}.md`),
        "utf8",
      );
      const body = /^---\n[\s\S]*?\n---\n\n([\s\S]+)$/u.exec(content)?.[1];
      expect(body, definition.id).toBe(definition.instructions);
    }
  });

  it("keeps the Claude orchestrator unchanged while adding phase agents", async () => {
    const [source, staged] = await Promise.all([
      readFile(
        join(
          repositoryRoot,
          "distribution/claude-code/agents/kratos-orchestrator.md",
        ),
        "utf8",
      ),
      readFile(
        join(hostPackage("claude-code"), "agents/kratos-orchestrator.md"),
        "utf8",
      ),
    ]);
    expect(staged).toBe(source);
  });
});
