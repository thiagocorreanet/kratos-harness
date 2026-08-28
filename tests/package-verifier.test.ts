import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import {
  buildPlugin,
  buildRoot,
  hostPackage,
  repositoryRoot,
} from "./support/built-plugin.js";

/**
 * Every case here spawns the real verifier over a freshly built plugin, which
 * digests both host packages and the whole modular runtime tree. That is
 * seconds of honest work — about two and a half on an idle machine — against
 * Vitest's five-second default, so a loaded runner decided the outcome rather
 * than the verifier did. The budget below is a guard against a hang, not a
 * performance assertion; `check-performance.mjs` is what holds the runtime to
 * a number.
 */
const verifierTimeoutMilliseconds = 60_000;

function verify(): string {
  return execFileSync(
    process.execPath,
    ["scripts/verify-package.mjs", "--source", buildRoot],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
}

async function hostAssetsDigest(root: string): Promise<string> {
  const files = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !relative(root, file).startsWith(`runtime${sep}`))
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(relative(root, file).split(sep).join("/"));
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

// Rebuilt before each case rather than once for the file: three of the four
// tamper with the built output to prove the verifier notices, so each needs a
// pristine package to damage.
beforeEach(buildPlugin, verifierTimeoutMilliseconds);

describe("package verifier", () => {
  it(
    "proves both host packages and project flows",
    () => {
      expect(verify()).toBe(
        "Kratos package verification passed for Codex and Claude Code.\n",
      );
    },
    verifierTimeoutMilliseconds,
  );

  it(
    "rejects a core that no longer matches its recorded digest",
    async () => {
      const core = join(hostPackage("codex"), "runtime/kratos.core.mjs");
      await writeFile(core, `${await readFile(core, "utf8")}\n// tampered\n`);

      expect(verify).toThrow();
    },
    verifierTimeoutMilliseconds,
  );

  it(
    "rejects a modified modular runtime tree",
    async () => {
      const source = join(
        hostPackage("claude-code"),
        "runtime/source/packages/runtime/src/main.js",
      );
      await writeFile(
        source,
        `${await readFile(source, "utf8")}\n// tampered\n`,
      );

      expect(verify).toThrow();
    },
    verifierTimeoutMilliseconds,
  );

  it(
    "rejects a development-only TypeScript file",
    async () => {
      await writeFile(
        join(hostPackage("codex"), "forbidden.ts"),
        "export {};\n",
      );

      expect(verify).toThrow();
    },
    verifierTimeoutMilliseconds,
  );

  it(
    "rejects a package whose manifest hides a missing phase agent",
    async () => {
      const root = hostPackage("claude-code");
      await rm(join(root, "agents/prd-researcher.md"));
      const manifestPath = join(root, "runtime/manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        host: { assetsSha256: string };
      };
      manifest.host.assetsSha256 = await hostAssetsDigest(root);
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      expect(verify).toThrow();
    },
    verifierTimeoutMilliseconds,
  );
});
