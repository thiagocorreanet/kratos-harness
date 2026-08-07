import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  ])("rejects a changed %s", async (_name, mutate) => {
    const path = await writeMutation(mutate);
    expect(() => verify("--manifest", path)).toThrow();
  });

  it("rejects a checkout that is not the frozen source", () => {
    expect(() => verify("--source", repositoryRoot)).toThrow();
  });
});
