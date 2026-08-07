import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const verifier = join(repositoryRoot, "scripts/verify-go-v3-oracle.mjs");
const manifestPath = join(
  repositoryRoot,
  "compatibility/oracles/go-v3/v0.6.5/manifest.json",
);

let canonical: Record<string, unknown>;

beforeAll(async () => {
  canonical = JSON.parse(await readFile(manifestPath, "utf8")) as Record<
    string,
    unknown
  >;
});

function verify(...args: readonly string[]): string {
  return execFileSync(process.execPath, [verifier, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function writeMutation(
  mutate: (manifest: Record<string, unknown>) => void,
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "yoda-oracle-manifest-"));
  const copy = structuredClone(canonical);
  mutate(copy);
  const path = join(directory, "manifest.json");
  await writeFile(path, `${JSON.stringify(copy, null, 2)}\n`, "utf8");
  return path;
}

describe("Go v3 oracle verifier", () => {
  it("validates the committed public catalog offline", () => {
    expect(verify()).toBe(
      "oracle go-v3-v0.6.5: public catalog verified (12 surfaces, 4 PRD anchors, 3 binaries)\n",
    );
  });

  it.each([
    [
      "tag",
      (manifest: Record<string, unknown>) => {
        (manifest.source as Record<string, unknown>).tag = "main";
      },
    ],
    [
      "digest",
      (manifest: Record<string, unknown>) => {
        const firstSurface = (
          manifest.surfaces as Record<string, unknown>[]
        )[0];
        if (firstSurface === undefined) throw new Error("missing test surface");
        firstSurface.sha256 = "0";
      },
    ],
    [
      "provenance",
      (manifest: Record<string, unknown>) => {
        delete manifest.provenance;
      },
    ],
    [
      "private URL",
      (manifest: Record<string, unknown>) => {
        (manifest.source as Record<string, unknown>).clone_url =
          "ssh://private.invalid/oracle";
      },
    ],
    [
      "unknown payload field",
      (manifest: Record<string, unknown>) => {
        manifest.notes = "customer payload";
      },
    ],
    [
      "Windows path",
      (manifest: Record<string, unknown>) => {
        (manifest.source as Record<string, unknown>).repository_slug =
          "C:\\private\\oracle";
      },
    ],
    [
      "command arguments",
      (manifest: Record<string, unknown>) => {
        const command = (
          manifest.command_outputs as Record<string, unknown>[]
        )[0];
        if (command === undefined) throw new Error("missing test command");
        command.arguments = ["migrate", "--force"];
      },
    ],
    [
      "PRD path",
      (manifest: Record<string, unknown>) => {
        const anchor = (manifest.prd_anchors as Record<string, unknown>[])[0];
        if (anchor === undefined) throw new Error("missing test anchor");
        anchor.source_path = "agents/other.md";
      },
    ],
    [
      "PRD byte count",
      (manifest: Record<string, unknown>) => {
        const anchor = (manifest.prd_anchors as Record<string, unknown>[])[0];
        if (anchor === undefined) throw new Error("missing test anchor");
        anchor.bytes = 1;
      },
    ],
  ])("rejects a changed %s", async (_name, mutate) => {
    const path = await writeMutation(mutate);
    expect(() => verify("--manifest", path)).toThrow();
  });

  it("rejects a checkout that is not the frozen source", () => {
    expect(() => verify("--source", repositoryRoot)).toThrow();
  });

  it("does not disclose a missing private binary path", () => {
    const privatePath = join(tmpdir(), "customer-secret", "missing-yoda");
    const result = spawnSync(
      process.execPath,
      [verifier, "--binary", privatePath],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "Go v3 oracle verification failed: private input could not be verified\n",
    );
    expect(result.stderr).not.toContain(privatePath);
  });

  it("does not disclose a mismatched private plugin path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yoda-private-projection-"));
    const distribution = join(directory, "distribution");
    const cache = join(directory, "cache");
    const privateRelativePath = "customers/acme-secret.txt";
    await mkdir(join(distribution, "customers"), { recursive: true });
    await mkdir(join(cache, "customers"), { recursive: true });
    await writeFile(join(distribution, privateRelativePath), "expected");
    await writeFile(join(cache, privateRelativePath), "different");
    execFileSync("git", ["init", "--quiet", distribution]);
    execFileSync("git", ["-C", distribution, "add", privateRelativePath]);

    const script = [
      `import { verifyPluginCache } from ${JSON.stringify(verifier)};`,
      `const manifest = ${JSON.stringify(canonical)};`,
      `try { verifyPluginCache(${JSON.stringify(cache)}, ${JSON.stringify(distribution)}, manifest); }`,
      `catch (error) { console.error(error.message); process.exitCode = 1; }`,
    ].join("\n");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe(
      "Go v3 oracle verification failed: plugin projection contents do not match\n",
    );
    expect(result.stderr).not.toContain(privateRelativePath);
  });
});
