import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const artifact = join(repositoryRoot, "dist/plugin/runtime/yoda.mjs");
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

describe("package verifier", () => {
  it("rejects a bundle with incorrect help text", async () => {
    const bundle = await readFile(artifact, "utf8");
    await writeFile(
      artifact,
      bundle.replace(
        "Usage: yoda [--help | --version]",
        "Usage: corrupted runtime",
      ),
      "utf8",
    );

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
