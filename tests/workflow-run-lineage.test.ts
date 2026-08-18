import { runCommandLine } from "@kratos/runtime/composition/cli";
import {
  fixedClock,
  fixedEnvironment,
  memoryFileSystem,
  memoryTransactionStorage,
  memoryWorkspace,
  pipedInput,
  recordingOutput,
  sequentialIds,
  stubGit,
} from "@kratos/runtime/infra/fake";
import type { RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

const ROOT = "/project";
const NOW = "2026-08-14T12:00:00.000Z";
const TEXT = "Ship the export pipeline";
const FEATURE = "ship-the-export-pipeline";
const PRD = `.brain/02-features/${FEATURE}/00-prd.md`;
const SPEC = `.brain/02-features/${FEATURE}/01-design.md`;
const ANSWERS = JSON.stringify({
  contractVersion: "1.0.0",
  hostContract: "1.0.0",
  hosts: ["claude"],
  language: "en",
  policyMode: "standard",
  snapshots: true,
});
const EMPTY_DIGEST =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

interface Subject {
  readonly ports: RuntimePorts;
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
}

function subject(
  files: Readonly<Record<string, string>> = {},
  directories: readonly string[] = [".brain", ".brain/transactions"],
  answers: string | null = null,
): Subject {
  const storage = memoryTransactionStorage({ files, directories });
  const output = recordingOutput();
  return {
    storage,
    output,
    ports: {
      clock: fixedClock(NOW),
      ids: sequentialIds("id"),
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
      fileSystem: memoryFileSystem({}),
      environment: fixedEnvironment({}, ROOT),
      git: stubGit(),
      output,
      standardInput: pipedInput(answers),
      workspace: memoryWorkspace({ directories: [ROOT] }),
    } as unknown as RuntimePorts,
  };
}

/** The settled project, with the transaction scratch space left behind. */
function settled(run: Subject): {
  readonly files: Readonly<Record<string, string>>;
  readonly directories: readonly string[];
} {
  const snapshot = run.storage.snapshot();
  return {
    files: Object.fromEntries(
      Object.entries(snapshot.files).filter(
        ([path]) => !path.startsWith(".brain/transactions/"),
      ),
    ),
    directories: snapshot.directories.filter(
      (path) => !path.includes("/transactions/"),
    ),
  };
}

/** Carry the settled project forward, optionally writing phase artifacts. */
function next(
  run: Subject,
  written: Readonly<Record<string, string>> = {},
): Subject {
  const state = settled(run);
  return subject({ ...state.files, ...written }, state.directories);
}

/** A project initialized, given an objective, and started on the `prd` phase. */
async function startedRun(): Promise<Subject> {
  const initialized = subject({}, [".brain", ".brain/transactions"], ANSWERS);
  expect(await runCommandLine(["init"], initialized.ports)).toBe(0);
  const objective = next(initialized);
  expect(await runCommandLine(["objective", TEXT], objective.ports)).toBe(0);
  const started = next(objective);
  expect(
    await runCommandLine(["start", "--host", "claude-code"], started.ports),
  ).toBe(0);
  return started;
}

/**
 * Record digest-bound evidence for one file, as `continue` requires.
 *
 * Every step names its own correlation identifier. Each step runs on a fresh
 * subject, so the deterministic identifier sequence restarts, and two steps
 * that shared one would read as a duplicate delivery of the first.
 */
async function recordEvidence(
  run: Subject,
  ref: string,
  correlationId: string,
): Promise<Subject> {
  expect(
    await runCommandLine(
      ["evidence", "record", ref, "--correlation-id", correlationId],
      run.ports,
    ),
  ).toBe(0);
  return next(run);
}

/** Complete the current phase against one artifact and its recorded evidence. */
function completePhase(
  run: Subject,
  ref: string,
  correlationId: string,
): Promise<number> {
  return runCommandLine(
    [
      "continue",
      "--complete",
      "--artifact",
      ref,
      "--evidence",
      ref,
      "--correlation-id",
      correlationId,
    ],
    run.ports,
  );
}

function snapshotOf(run: Subject): {
  readonly lineage: { readonly prdDigest: string; readonly specDigest: string };
  readonly currentStep: string | null;
  readonly status: string;
  readonly eventCursor: number;
} {
  const path = Object.keys(settled(run).files).find(
    (candidate) =>
      candidate.includes("/runs/") && candidate.endsWith("/state.json"),
  );
  if (path === undefined) throw new Error("the run wrote no snapshot");
  return JSON.parse(settled(run).files[path] ?? "") as ReturnType<
    typeof snapshotOf
  >;
}

/**
 * Regression coverage for the run lineage the reducer is seeded with.
 *
 * Producing `00-prd.md` and `01-design.md` is the whole point of the `prd` and
 * `spec` phases. When the reducer seed was re-observed from disk on every
 * command, writing either file made the replay disagree with the snapshot the
 * run had already committed, and every later transaction refused with
 * `runtime.state_corrupt` before it could write the correction. The lineage a
 * run records is a fact of that run, so replay reads it back rather than
 * re-deriving it from a working tree the run itself is there to change.
 */
describe("a run whose phases write the lineage files", () => {
  it("records the digests observed when the run started", async () => {
    const run = await startedRun();

    // Neither file exists yet, which is exactly what the `prd` phase is for.
    expect(snapshotOf(run).lineage).toEqual({
      prdDigest: EMPTY_DIGEST,
      specDigest: EMPTY_DIGEST,
    });
    expect(snapshotOf(run).currentStep).toBe("prd");
  });

  it("advances to spec after the prd phase writes the PRD", async () => {
    const started = await startedRun();
    const run = await recordEvidence(
      next(started, { [PRD]: "# PRD\n\nShip the export pipeline.\n" }),
      PRD,
      "evidence-prd",
    );

    const code = await completePhase(run, PRD, "complete-prd");

    expect(run.output.human_.join("")).not.toContain("runtime.state_corrupt");
    expect(code).toBe(0);
    expect(snapshotOf(run).currentStep).toBe("spec");
  });

  it("advances to plan after the spec phase writes the design", async () => {
    const started = await startedRun();
    const prd = await recordEvidence(
      next(started, { [PRD]: "# PRD\n\nShip the export pipeline.\n" }),
      PRD,
      "evidence-prd",
    );
    expect(await completePhase(prd, PRD, "complete-prd")).toBe(0);
    const run = await recordEvidence(
      next(prd, { [SPEC]: "# Design\n\nOne pipeline.\n" }),
      SPEC,
      "evidence-spec",
    );

    const code = await completePhase(run, SPEC, "complete-spec");

    expect(run.output.human_.join("")).not.toContain("runtime.state_corrupt");
    expect(code).toBe(0);
    expect(snapshotOf(run).currentStep).toBe("plan");
  });

  it("keeps the recorded lineage when a phase artifact is edited later", async () => {
    const started = await startedRun();
    const first = await recordEvidence(
      next(started, { [PRD]: "# PRD\n\nFirst draft.\n" }),
      PRD,
      "evidence-prd",
    );
    expect(await completePhase(first, PRD, "complete-prd")).toBe(0);
    const recorded = snapshotOf(first).lineage;
    const run = next(first, { [PRD]: "# PRD\n\nSecond draft, revised.\n" });

    const code = await runCommandLine(["status"], run.ports);

    expect(code).toBe(0);
    // The edit is visible to gates and approvals, and it never rewrites the
    // fact the run committed.
    expect(snapshotOf(run).lineage).toEqual(recorded);
  });

  it("resumes a run whose working tree gained the PRD", async () => {
    const started = await startedRun();
    const run = next(started, {
      [PRD]: "# PRD\n\nShip the export pipeline.\n",
    });

    const code = await runCommandLine(
      ["start", "--host", "claude-code"],
      run.ports,
    );

    expect(run.output.human_.join("")).not.toContain("runtime.state_corrupt");
    expect(code).toBe(0);
    expect(snapshotOf(run).status).toBe("active");
  });

  it("audits a run whose working tree gained the PRD", async () => {
    const started = await startedRun();
    const run = next(started, {
      [PRD]: "# PRD\n\nShip the export pipeline.\n",
    });

    expect(await runCommandLine(["audit"], run.ports)).toBe(0);
    expect(
      `${run.output.structured_.join("")}${run.output.human_.join("")}`,
    ).toContain("Replay verified revision 1");
  });
});
