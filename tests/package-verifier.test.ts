import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const artifact = join(repositoryRoot, "dist/plugin/runtime/yoda.mjs");
const core = join(repositoryRoot, "dist/plugin/runtime/yoda.core.mjs");
const manifestFile = join(repositoryRoot, "dist/plugin/runtime/manifest.json");
const metadataFile = join(repositoryRoot, "dist/build-meta.json");

function build() {
  execFileSync(process.execPath, ["scripts/build.mjs"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
}

function verify() {
  execFileSync(process.execPath, ["scripts/verify-package.mjs"], {
    cwd: repositoryRoot,
    stdio: "pipe",
  });
}

beforeEach(() => {
  build();
});

afterAll(() => {
  build();
});

/** Corrupt the core and re-record its digest, so the manifest check passes. */
async function corruptCore(replacement: string): Promise<void> {
  const bundle = await readFile(core, "utf8");
  const corrupted = bundle.replace(
    "Usage: yoda [--expect <version>] [--help | --version | handshake]",
    replacement,
  );
  expect(corrupted).not.toBe(bundle);
  await writeFile(core, corrupted, "utf8");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as {
    runtime: { coreSha256: string };
  };
  manifest.runtime.coreSha256 = createHash("sha256")
    .update(corrupted)
    .digest("hex");
  await writeFile(
    manifestFile,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

describe("package verifier", () => {
  it("rejects a bundle with incorrect help text", async () => {
    await corruptCore("Usage: corrupted runtime");

    expect(verify).toThrow();
  });

  it("rejects a core that no longer matches its recorded digest", async () => {
    const bundle = await readFile(core, "utf8");
    await writeFile(core, `${bundle}\n// tampered\n`, "utf8");

    expect(verify).toThrow();
  });

  it("rejects an entry point retaining an unsubstituted placeholder", async () => {
    const entry = await readFile(artifact, "utf8");
    await writeFile(artifact, `${entry}\n// __LEFTOVER__\n`, "utf8");

    expect(verify).toThrow();
  });

  it("rejects a fake node-prefixed external import", async () => {
    const metadata = await readFile(metadataFile, "utf8");
    const importsMarker = '"imports": []';
    const outputImportsIndex = metadata.lastIndexOf(importsMarker);
    expect(outputImportsIndex).toBeGreaterThan(-1);
    const corruptedMetadata = `${metadata.slice(0, outputImportsIndex)}"imports": [{"external":true,"kind":"dynamic-import","path":"node:not-a-real-builtin"}]${metadata.slice(outputImportsIndex + importsMarker.length)}`;
    await writeFile(metadataFile, corruptedMetadata, "utf8");

    expect(verify).toThrow();
  });

  it("rejects an unexpected empty staged directory", async () => {
    await mkdir(join(repositoryRoot, "dist/plugin/unexpected"));

    expect(verify).toThrow();
  });
});
