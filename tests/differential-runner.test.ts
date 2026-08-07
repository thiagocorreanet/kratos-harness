import {
  chmod,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runScenario,
  runScenarioSide,
  type DifferentialScenario,
} from "@mestre-yoda/differential";
import { afterEach, describe, expect, it } from "vitest";

const fixtureDriver = join(
  import.meta.dirname,
  "fixtures/differential/driver.mjs",
);
const emptyDigest =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const roots: string[] = [];

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "yoda-differential-runner-test-"));
  roots.push(value);
  return value;
}

/**
 * Digest the tracked state of the real repository so a harness run can be
 * proven not to touch the developer checkout.
 */
async function snapshotSourceCheckout(): Promise<string> {
  const repository = join(import.meta.dirname, "..");
  const status = execFileSync("git", ["status", "--porcelain"], {
    cwd: repository,
    encoding: "utf8",
  });
  const tree = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repository,
    encoding: "utf8",
  });
  const driver = await readFile(fixtureDriver, "utf8");
  return `${tree}${status}${driver}`;
}

async function scenario(mode: string): Promise<DifferentialScenario> {
  const driver = await readFile(fixtureDriver, "utf8");
  return {
    schemaVersion: 1,
    id: `runner-${mode}`,
    parityContractIds: ["CLI-VERSION"],
    workspace: {
      entries: [
        {
          type: "file",
          path: "driver.mjs",
          content: driver,
          executable: false,
        },
      ],
    },
    invocation: {
      args: ["driver.mjs", mode],
      stdin: "",
      environment: {},
      timeoutMs: mode === "timeout" ? 75 : 2_000,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
    },
    capture: {
      structured:
        mode === "state" ? [{ id: "state", path: ".brain/state.json" }] : [],
      git: false,
    },
    normalization: [],
    disclosure: {
      stdout: "content",
      stderr: "content",
      artifacts: "digest",
    },
    expected: {
      process: {
        outcome: "exit",
        exitCode: 0,
        signal: null,
        stdout: { bytes: 0, sha256: emptyDigest },
        stderr: { bytes: 0, sha256: emptyDigest },
      },
      filesystem: { before: [], after: [], mutations: [] },
      structured: [],
      git: null,
    },
  };
}

afterEach(async () => {
  delete process.env.YODA_TEST_SECRET;
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("isolated differential runner", () => {
  it("runs independent equal sides and removes both temporary roots", async () => {
    const temporaryParent = await root();
    const fixture = await scenario("equal");
    const seed = await runScenarioSide({
      side: "oracle",
      executable: process.execPath,
      scenario: fixture,
      temporaryParent,
    });
    fixture.expected = seed.observation;

    const report = await runScenario(
      fixture,
      process.execPath,
      process.execPath,
      temporaryParent,
    );
    expect(report.equal).toBe(true);
    expect(report.mismatches).toEqual([]);
    expect(await readdir(temporaryParent)).toEqual([]);
  });

  it.each([
    ["unexpected-file", "added", "exit"],
    ["partial-mutation", "added", "exit"],
    ["timeout", "added", "timeout"],
  ] as const)("retains %s mutations", async (mode, mutation, outcome) => {
    const temporaryParent = await root();
    const result = await runScenarioSide({
      side: "candidate",
      executable: process.execPath,
      scenario: await scenario(mode),
      temporaryParent,
    });
    expect(result.observation.process.outcome).toBe(outcome);
    expect(result.observation.filesystem.mutations).toContainEqual({
      path: mode === "unexpected-file" ? "unexpected.txt" : "partial.txt",
      kind: mutation,
    });
    expect(await readdir(temporaryParent)).toEqual([]);
  });

  it("classifies a signal crash and still cleans the workspace", async () => {
    const temporaryParent = await root();
    const result = await runScenarioSide({
      side: "candidate",
      executable: process.execPath,
      scenario: await scenario("crash"),
      temporaryParent,
    });
    expect(result.observation.process).toMatchObject({
      outcome: "signal",
      exitCode: null,
      signal: "SIGABRT",
    });
    expect(await readdir(temporaryParent)).toEqual([]);
  });

  it("bounds captured output, hashes the retained prefix, and terminates promptly", async () => {
    const temporaryParent = await root();
    const fixture = await scenario("output-limit");
    fixture.invocation.timeoutMs = 2_000;
    fixture.invocation.maxStdoutBytes = 10;
    const result = await runScenarioSide({
      side: "candidate",
      executable: process.execPath,
      scenario: fixture,
      temporaryParent,
    });

    expect(result.observation.process).toMatchObject({
      outcome: "output_limit",
      stdout: {
        bytes: 10,
        content: "abcdefghij",
        sha256:
          "72399361da6a7754fec986dca5b7cbaf1c810a28ded4abaf56b2106d06cb78b0",
      },
    });
    expect(result.durationMs).toBeLessThan(1_000);
    expect(await readdir(temporaryParent)).toEqual([]);
  });

  it("survives a child that never drains a large stdin", async () => {
    const temporaryParent = await root();
    const fixture = await scenario("ignore-stdin");
    // Larger than the operating-system pipe buffer, so the unread write fails
    // with EPIPE once the child exits.
    fixture.invocation.stdin = "x".repeat(400_000);

    const result = await runScenarioSide({
      side: "candidate",
      executable: process.execPath,
      scenario: fixture,
      temporaryParent,
    });

    expect(result.observation.process).toMatchObject({
      outcome: "exit",
      exitCode: 0,
      stdout: { content: "ignored\n" },
    });
    expect(await readdir(temporaryParent)).toEqual([]);
  });

  it("records a created Git repository even when Git capture is disabled", async () => {
    const temporaryParent = await root();
    const fixture = await scenario("git-create");
    expect(fixture.capture.git).toBe(false);

    const result = await runScenarioSide({
      side: "candidate",
      executable: process.execPath,
      scenario: fixture,
      temporaryParent,
    });

    // A side that creates a repository must never be byte-identical to a side
    // that does nothing.
    expect(result.observation.filesystem.mutations).toContainEqual({
      path: ".git",
      kind: "added",
    });
    expect(await readdir(temporaryParent)).toEqual([]);
  });

  it("leaves the source checkout byte-identical", async () => {
    const temporaryParent = await root();
    const before = await snapshotSourceCheckout();
    await runScenario(
      await scenario("unexpected-file"),
      process.execPath,
      process.execPath,
      temporaryParent,
    );
    expect(await snapshotSourceCheckout()).toEqual(before);
    expect(await readdir(temporaryParent)).toEqual([]);
  });

  it("uses isolated environment roots and drops unrelated secrets", async () => {
    process.env.YODA_TEST_SECRET = "must-not-leak";
    const temporaryParent = await root();
    const result = await runScenarioSide({
      side: "candidate",
      executable: process.execPath,
      scenario: await scenario("state"),
      temporaryParent,
    });
    const artifact = result.observation.structured[0];
    expect(artifact?.state).toBe("valid");
    const value = artifact?.state === "valid" ? artifact.value : undefined;
    expect(value).toMatchObject({ leakedSecret: null });
    expect(value).toHaveProperty("home");
    expect(value).toHaveProperty("temporary");
    expect(JSON.stringify(value)).not.toContain("must-not-leak");
    expect(JSON.stringify(value)).not.toContain(process.cwd());
  });

  it("accepts a distinct executable and reports a field-level mismatch", async () => {
    const temporaryParent = await root();
    const fixture = await scenario("equal");
    const seed = await runScenarioSide({
      side: "oracle",
      executable: process.execPath,
      scenario: fixture,
      temporaryParent,
    });
    fixture.expected = seed.observation;
    const candidate = join(temporaryParent, "candidate.mjs");
    await writeFile(
      candidate,
      "#!/usr/bin/env node\nawait import('node:fs/promises').then(({writeFile}) => writeFile('unexpected.txt', 'x'));\n",
      "utf8",
    );
    await chmod(candidate, 0o755);

    const report = await runScenario(
      fixture,
      process.execPath,
      candidate,
      temporaryParent,
    );
    expect(report.equal).toBe(false);
    expect(
      report.mismatches.some(({ pointer }) => pointer.includes("filesystem")),
    ).toBe(true);
    expect(await readdir(temporaryParent)).toEqual(["candidate.mjs"]);
  });
});
