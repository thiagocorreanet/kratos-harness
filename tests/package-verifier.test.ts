import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    "Usage: yoda [--expect <version>] [--json] <command>",
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
    const metadata = JSON.parse(await readFile(metadataFile, "utf8")) as {
      outputs: Record<
        string,
        {
          imports: {
            external: boolean;
            kind: string;
            path: string;
          }[];
        }
      >;
    };
    const output = Object.values(metadata.outputs)[0];
    expect(output).toBeDefined();
    if (output === undefined)
      throw new Error("Build output metadata is absent");
    output.imports.push({
      external: true,
      kind: "dynamic-import",
      path: "node:not-a-real-builtin",
    });
    await writeFile(
      metadataFile,
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );

    expect(verify).toThrow();
  });

  it("rejects an unexpected empty staged directory", async () => {
    await mkdir(join(repositoryRoot, "dist/plugin/unexpected"));

    expect(verify).toThrow();
  });

  it("runs every orientation command from an isolated three-file copy", async () => {
    const cleanRoom = await mkdtemp(join(tmpdir(), "yoda-package-verifier-"));
    try {
      const runtime = join(cleanRoom, "runtime");
      await mkdir(runtime, { recursive: true });
      for (const staged of ["manifest.json", "yoda.core.mjs", "yoda.mjs"]) {
        await copyFile(
          join(repositoryRoot, "dist/plugin/runtime", staged),
          join(runtime, staged),
        );
      }

      const isolatedEntry = join(runtime, "yoda.mjs");
      for (const [argument, accepts] of [
        ["--help", (stdout: string) => stdout.startsWith("Usage: yoda ")],
        ["--version", (stdout: string) => stdout === "0.0.0-development\n"],
        [
          "handshake",
          (stdout: string) =>
            (JSON.parse(stdout) as { operation?: unknown }).operation ===
            "handshake",
        ],
      ] as const) {
        const result = spawnSync(process.execPath, [isolatedEntry, argument], {
          cwd: cleanRoom,
          encoding: "utf8",
          env: {
            HOME: cleanRoom,
            NODE_OPTIONS: "",
            NODE_PATH: "",
            PATH: dirname(process.execPath),
            TMPDIR: tmpdir(),
          },
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        expect(accepts(result.stdout)).toBe(true);
      }
    } finally {
      await rm(cleanRoom, { force: true, recursive: true });
    }
  });
});
