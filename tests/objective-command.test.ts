import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRuntime } from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import { observeObjective } from "@kratos/runtime/composition/objective";
import { DEFAULT_REGISTRY, parseInvocation } from "@kratos/runtime/domain/cli";
import {
  fixedClock,
  fixedEnvironment,
  memoryFileSystem,
  memoryTransactionStorage,
  memoryWorkspace,
  pipedInput,
  recordingOutput,
  sequentialIds,
} from "@kratos/runtime/infra/fake";
import type { RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

const ROOT = "/project";
const NOW = "2026-08-14T12:00:00.000Z";
const TEXT = "Ship the export pipeline";
const FEATURE = "ship-the-export-pipeline";
const ANSWERS_FOR_INIT = JSON.stringify({
  contractVersion: "1.0.0",
  hostContract: "1.0.0",
  hosts: ["claude"],
});

interface Subject {
  readonly ports: RuntimePorts;
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
}

function subject(
  files: Readonly<Record<string, string>> = {},
  directories: readonly string[] = [".brain", ".brain/transactions"],
): Subject {
  const storage = memoryTransactionStorage({ files, directories });
  const output = recordingOutput();
  return {
    storage,
    output,
    ports: {
      clock: fixedClock(NOW),
      ids: sequentialIds("transaction"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem({}),
      environment: fixedEnvironment({}, ROOT),
      output,
      standardInput: pipedInput(null),
      workspace: memoryWorkspace({ directories: [ROOT] }),
    } as unknown as RuntimePorts,
  };
}

/** A project whose objective is already recorded, as the command leaves it. */
async function withObjective(text = TEXT): Promise<Subject> {
  const first = subject();
  await runCommandLine(["objective", text], first.ports);
  const settled = first.storage.snapshot();
  return subject(
    Object.fromEntries(
      Object.entries(settled.files).filter(
        ([path]) => !path.startsWith(".brain/transactions/"),
      ),
    ),
    settled.directories.filter((path) => !path.includes("/transactions/")),
  );
}

function files(run: Subject): Record<string, string> {
  return Object.fromEntries(
    Object.entries(run.storage.snapshot().files).filter(
      ([path]) => !path.startsWith(".brain/transactions/"),
    ),
  );
}

/**
 * Parity evidence for `CLI-OBJECTIVE`, `FLAG-OBJECTIVE-REPLACE`,
 * `FLAG-OBJECTIVE-ROOT`, `FILE-BRAIN-02-FEATURES-FEATURE-OBJECTIVE-MD`, and
 * `FILE-BRAIN-02-FEATURES-FEATURE-OBJECTIVE-HISTORY-JSONL`.
 *
 * The inventory establishes the command, its two flags, and the two generated
 * paths. What divergence means is this runtime's contract, so the rows stay
 * `in_progress` until a differential capture exists.
 */
describe("the objective command", () => {
  it("records the demand and activates its feature", async () => {
    const run = subject();

    expect(await runCommandLine(["objective", TEXT], run.ports)).toBe(0);

    const written = files(run);
    expect(Object.keys(written).sort()).toEqual([
      ".brain/02-features/active",
      `.brain/02-features/${FEATURE}/objective-history.jsonl`,
      `.brain/02-features/${FEATURE}/objective.md`,
      `.brain/02-features/${FEATURE}/state.json`,
    ]);
    expect(written[".brain/02-features/active"]).toBe(`${FEATURE}\n`);
    expect(written[`.brain/02-features/${FEATURE}/objective.md`]).toContain(
      TEXT,
    );
  });

  it("preserves quoted Unicode text exactly", async () => {
    const text = 'Ship the "café" pipeline — 日本語 included';
    const run = subject();

    expect(await runCommandLine(["objective", text], run.ports)).toBe(0);

    const state: unknown = JSON.parse(
      files(run)[
        ".brain/02-features/ship-the-cafe-pipeline-included/state.json"
      ] ?? "{}",
    );
    expect(state).toMatchObject({ objective: { text } });
  });

  it("is idempotent when the same demand repeats", async () => {
    const run = await withObjective();
    const before = files(run);

    expect(await runCommandLine(["objective", TEXT], run.ports)).toBe(0);

    // Repetition is how a caller confirms where they are: nothing moves, and
    // the history gains no line.
    expect(files(run)).toEqual(before);
  });

  it("refuses a divergent objective without --replace", async () => {
    const run = await withObjective();
    const before = files(run);

    const code = await runCommandLine(
      ["objective", "Rewrite the importer"],
      run.ports,
    );

    expect(code).toBe(3);
    expect(run.output.human_.join("")).toContain("trail.objetivo_divergente");
    expect(files(run)).toEqual(before);
  });

  it("replaces a divergent objective when told to", async () => {
    const run = await withObjective();

    expect(
      await runCommandLine(
        ["objective", "Rewrite the importer", "--replace"],
        run.ports,
      ),
    ).toBe(0);

    const written = files(run);
    expect(written[".brain/02-features/active"]).toBe("rewrite-the-importer\n");
    // The displaced objective keeps its own directory: the trail explains what
    // happened rather than erasing it.
    expect(written).toHaveProperty(
      `.brain/02-features/${FEATURE}/objective.md`,
    );
  });

  it("records the lineage of a replacement in the history", async () => {
    const run = await withObjective();
    await runCommandLine(
      ["objective", "Rewrite the importer", "--replace"],
      run.ports,
    );

    const history =
      files(run)[
        ".brain/02-features/rewrite-the-importer/objective-history.jsonl"
      ] ?? "";
    const entries: unknown[] = history
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as unknown);

    expect(entries).toEqual([
      {
        at: NOW,
        replaced: TEXT,
        revision: 2,
        text: "Rewrite the importer",
        transition: "replaced",
      },
    ]);
  });

  it("refuses text that names nothing", async () => {
    const run = subject();

    expect(await runCommandLine(["objective", "   "], run.ports)).toBe(2);
    expect(files(run)).toEqual({});
  });

  it("refuses a missing demand", async () => {
    const run = subject();

    expect(await runCommandLine(["objective"], run.ports)).toBe(2);
    expect(files(run)).toEqual({});
  });

  it("refuses an active feature whose state cannot be read", async () => {
    const run = subject({
      ".brain/02-features/active": `${FEATURE}\n`,
      [`.brain/02-features/${FEATURE}/state.json`]: "{ not json",
    });

    const code = await runCommandLine(["objective", TEXT], run.ports);

    // Starting over would silently discard whatever that feature was for.
    expect(code).not.toBe(0);
    expect(run.output.human_.join("")).toContain("runtime.state_corrupt");
  });

  it("treats the empty active marker init writes as nothing started", async () => {
    const run = subject({ ".brain/02-features/active": "" });

    expect(await runCommandLine(["objective", TEXT], run.ports)).toBe(0);
    expect(files(run)[".brain/02-features/active"]).toBe(`${FEATURE}\n`);
  });

  it("records the objective in the directory --root names", async () => {
    const target = await mkdtemp(join(tmpdir(), "kratos-objective-root-"));
    try {
      const output = recordingOutput();
      const ports = createRuntime({
        output,
        standardInput: pipedInput(ANSWERS_FOR_INIT),
      });
      // A project has to exist before it can have an objective.
      expect(await runCommandLine(["init", "--root", target], ports)).toBe(0);

      expect(
        await runCommandLine(["objective", TEXT, "--root", target], ports),
      ).toBe(0);

      expect(
        await readFile(join(target, ".brain/02-features/active"), "utf8"),
      ).toBe(`${FEATURE}\n`);
      expect(
        await readFile(
          join(target, `.brain/02-features/${FEATURE}/objective.md`),
          "utf8",
        ),
      ).toContain(TEXT);
    } finally {
      await rm(target, { force: true, recursive: true });
    }
  });

  it("refuses a flag this command does not declare", async () => {
    const run = subject();

    // The inventory freezes two flags for `objective`. `--detect-root` belongs
    // to `init`, and accepting it here would publish a surface the oracle does
    // not establish.
    expect(
      await runCommandLine(["objective", TEXT, "--detect-root"], run.ports),
    ).toBe(2);
    expect(files(run)).toEqual({});
  });

  it("reopens after the objective was completed", async () => {
    const completed = {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      feature: FEATURE,
      objective: {
        text: TEXT,
        status: "completed",
        createdAt: NOW,
        updatedAt: NOW,
        revision: 2,
      },
    };
    const run = subject({
      ".brain/02-features/active": `${FEATURE}\n`,
      [`.brain/02-features/${FEATURE}/state.json`]: `${JSON.stringify(completed)}\n`,
    });

    // Nothing unfinished is being displaced, so no authorization is needed.
    expect(
      await runCommandLine(["objective", "Rewrite the importer"], run.ports),
    ).toBe(0);

    const history =
      files(run)[
        ".brain/02-features/rewrite-the-importer/objective-history.jsonl"
      ] ?? "";
    expect(history).toContain('"transition":"reopened"');
    expect(history).toContain('"revision":3');
  });

  it("refuses an active feature whose state is not a file", async () => {
    const run = subject({ ".brain/02-features/active": `${FEATURE}\n` });

    expect(await runCommandLine(["objective", TEXT], run.ports)).not.toBe(0);
    expect(run.output.human_.join("")).toContain("runtime.state_corrupt");
  });

  it("refuses feature state that parses but is not feature state", async () => {
    const run = subject({
      ".brain/02-features/active": `${FEATURE}\n`,
      [`.brain/02-features/${FEATURE}/state.json`]: '{ "feature": 12 }',
    });

    expect(await runCommandLine(["objective", TEXT], run.ports)).not.toBe(0);
    expect(run.output.human_.join("")).toContain("runtime.state_corrupt");
  });

  it("keeps one history when a reworded demand names the same feature", async () => {
    const run = await withObjective("Ship it");

    // Different text, same slug: the feature did not move, so its history
    // gains a line rather than starting over.
    expect(
      await runCommandLine(["objective", "Ship it!", "--replace"], run.ports),
    ).toBe(0);

    const history =
      files(run)[".brain/02-features/ship-it/objective-history.jsonl"] ?? "";
    const lines = history.split("\n").filter((line) => line !== "");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"replaced":"Ship it"');
  });

  it("publishes a result contract object in JSON mode", async () => {
    const run = subject();

    await runCommandLine(["--json", "objective", TEXT], run.ports);

    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
      evidence: expect.arrayContaining([
        { kind: "artifact", ref: `.brain/02-features/${FEATURE}/objective.md` },
      ]) as unknown,
    });
  });
});

describe("the objective observation", () => {
  it("refuses a root request the resolver cannot satisfy", async () => {
    // Reachable only by constructing the invocation: the command declares no
    // `--detect-root`, so the parser rejects that combination first. The
    // composition still has to handle a resolver failure, because the resolver
    // is shared with commands that do declare it.
    const run = subject();
    const parsed = parseInvocation(["objective", TEXT], DEFAULT_REGISTRY);
    if (parsed.kind !== "invocation") throw new Error("expected an invocation");

    const observed = await observeObjective(
      {
        ...parsed.invocation,
        flags: new Map<string, string | true>([
          ["--root", "/elsewhere"],
          ["--detect-root", true],
        ]),
      },
      run.ports,
    );

    expect(observed).toMatchObject({ kind: "failure" });
  });
});
