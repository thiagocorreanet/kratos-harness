import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const repositoryRoot = join(import.meta.dirname, "..");
const cli = join(repositoryRoot, "scripts/run-differential.mjs");
const temporaryRoots: string[] = [];

function invoke(args: readonly string[] = []) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      YODA_TEST_SECRET: "must-not-leak",
    },
  });
}

async function temporaryExecutable(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "yoda-differential-cli-"));
  temporaryRoots.push(root);
  const path = join(root, "candidate.mjs");
  await writeFile(path, source, "utf8");
  await chmod(path, 0o755);
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("differential harness CLI", () => {
  it("runs the public self-test corpus as deterministic JSON", () => {
    const result = invoke();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      schemaVersion: 1,
      oracleId: "synthetic-public-self-test",
      class: "self-test",
      equal: true,
      planned: 12,
      scenarios: [{ id: "self-test-equality", equal: true, mismatches: [] }],
    });
  });

  it("renders a concise human report", () => {
    const result = invoke(["--format", "human"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "Differential corpus self-test: PASS (1 scenario; 12 planned)\nPASS self-test-equality\n",
    );
    expect(result.stderr).toBe("");
  });

  it("rejects a corpus with no selected runnable scenarios", async () => {
    const root = await mkdtemp(join(tmpdir(), "yoda-differential-cli-corpus-"));
    temporaryRoots.push(root);
    const corpus = join(root, "corpus.json");
    await writeFile(
      corpus,
      JSON.stringify({
        schemaVersion: 1,
        oracleId: "go-v3-v0.6.5",
        entries: [],
      }),
      "utf8",
    );

    const result = invoke(["--corpus", corpus]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Differential harness error: execution failed\n",
    );
  });

  it.each([
    [["--unknown"], "unknown option"],
    [["--format"], "missing value"],
    [["--format", "yaml"], "invalid format"],
    [["--class", "live"], "live runners are required"],
  ] as const)("rejects invalid usage: %s", (args, message) => {
    const result = invoke(args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `Differential harness usage error: ${message}\n`,
    );
    expect(result.stderr).not.toContain(" at ");
  });

  it("rejects a wrong live oracle digest before scenario execution", async () => {
    const executable = await temporaryExecutable(
      "#!/usr/bin/env node\nprocess.stdout.write('not the oracle\\n');\n",
    );
    const result = invoke([
      "--class",
      "live",
      "--oracle",
      executable,
      "--candidate",
      process.execPath,
    ]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "Differential harness provenance error: oracle digest does not match go-v3-v0.6.5\n",
    );
    expect(result.stderr).not.toContain(executable);
  });

  it("returns one and field pointers for a seeded behavioral difference", async () => {
    const candidate = await temporaryExecutable(
      "#!/usr/bin/env node\nawait import('node:fs/promises').then(({writeFile}) => writeFile('unexpected.txt', 'x'));\n",
    );
    const result = invoke(["--candidate", candidate]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as {
      equal: boolean;
      scenarios: { mismatches: { pointer: string }[] }[];
    };
    expect(report.equal).toBe(false);
    expect(
      report.scenarios[0]?.mismatches.some(({ pointer }) =>
        pointer.includes("filesystem"),
      ),
    ).toBe(true);
    expect(result.stdout).not.toContain(candidate);
    expect(result.stdout).not.toContain("must-not-leak");
  });
});
