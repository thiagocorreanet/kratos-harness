import type { GapRecordV1, GateFactsV1 } from "@kratos/contracts";
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
const EXPIRY = "2026-12-31T00:00:00.000Z";
const TEXT = "Ship the refund pipeline";
const FEATURE = "ship-the-refund-pipeline";
const RUN_ROOT = `.brain/02-features/${FEATURE}/runs`;
const PRD = `.brain/02-features/${FEATURE}/00-prd.md`;
const SPEC = `.brain/02-features/${FEATURE}/01-design.md`;
const PROPOSAL = `.brain/02-features/${FEATURE}/gap-proposal.json`;

function answers(policyMode: "standard" | "strict"): string {
  return JSON.stringify({
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    hosts: ["claude"],
    language: "en",
    policyMode,
    snapshots: true,
  });
}

const PROPOSED = {
  contractVersion: "1.0.0",
  hostContract: "1.0.0",
  gaps: [
    {
      gapId: "gap-refund-window",
      category: "document-contradiction",
      weight: "high",
      description: "The refund window is stated as 30 days and as 14 days.",
      recommendation: "Keep the thirty-day window and delete the other clause.",
      reasoning: "The two passages produce two different expiry checks.",
      documentRefs: [PRD],
    },
  ],
};

interface Subject {
  readonly ports: RuntimePorts;
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
}

function subject(
  files: Readonly<Record<string, string>> = {},
  directories: readonly string[] = [".brain", ".brain/transactions"],
  piped: string | null = null,
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
      standardInput: pipedInput(piped),
      workspace: memoryWorkspace({ directories: [ROOT] }),
    } as unknown as RuntimePorts,
  };
}

function settled(run: Subject): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(run.storage.snapshot().files).filter(
      ([path]) => !path.startsWith(".brain/transactions/"),
    ),
  );
}

function next(
  run: Subject,
  written: Readonly<Record<string, string>> = {},
): Subject {
  const snapshot = run.storage.snapshot();
  return subject(
    { ...settled(run), ...written },
    snapshot.directories.filter((path) => !path.includes("/transactions/")),
  );
}

/** A project initialized under one policy, given an objective, and started. */
async function startedRun(
  policyMode: "standard" | "strict" = "strict",
): Promise<Subject> {
  const initialized = subject(
    {},
    [".brain", ".brain/transactions"],
    answers(policyMode),
  );
  expect(await runCommandLine(["init"], initialized.ports)).toBe(0);
  const objective = next(initialized);
  expect(await runCommandLine(["objective", TEXT], objective.ports)).toBe(0);
  const started = next(objective);
  expect(
    await runCommandLine(["start", "--host", "claude-code"], started.ports),
  ).toBe(0);
  return started;
}

function runId(run: Subject): string {
  const path = Object.keys(settled(run)).find(
    (candidate) =>
      candidate.startsWith(RUN_ROOT) && candidate.endsWith("/state.json"),
  );
  if (path === undefined) throw new Error("the run wrote no snapshot");
  return path.slice(RUN_ROOT.length + 1, path.lastIndexOf("/"));
}

function stateOf(run: Subject): {
  readonly status: string;
  readonly currentStep: string | null;
} {
  return JSON.parse(
    settled(run)[`${RUN_ROOT}/${runId(run)}/state.json`] ?? "",
  ) as ReturnType<typeof stateOf>;
}

function gateFacts(run: Subject): GateFactsV1 | null {
  const text = settled(run)[`${RUN_ROOT}/${runId(run)}/gates.json`];
  return text === undefined ? null : (JSON.parse(text) as GateFactsV1);
}

function gapRecord(run: Subject, gapId: string): GapRecordV1 {
  const text = settled(run)[`${RUN_ROOT}/${runId(run)}/gaps/${gapId}.json`];
  if (text === undefined) throw new Error(`no record for ${gapId}`);
  return JSON.parse(text) as GapRecordV1;
}

async function handoff(run: Subject): Promise<string> {
  const view = next(run);
  expect(await runCommandLine(["handoff"], view.ports)).toBe(0);
  return view.output.structured_.join("");
}

/** Record the proposal against a run sitting in a gap-detecting phase. */
async function recordProposal(
  run: Subject,
  correlationId = "gaps-first",
): Promise<Subject> {
  const proposing = next(run, {
    [PROPOSAL]: JSON.stringify(PROPOSED, null, 2),
  });
  expect(
    await runCommandLine(
      ["gaps", "record", PROPOSAL, "--correlation-id", correlationId],
      proposing.ports,
    ),
  ).toBe(0);
  return next(proposing);
}

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

/** Carry a run through the prd phase so it sits in `spec`. */
async function throughPrd(run: Subject): Promise<Subject> {
  const written = await recordEvidence(
    next(run, { [PRD]: "# PRD\n\nRefunds within thirty days.\n" }),
    PRD,
    "evidence-prd",
  );
  expect(await completePhase(written, PRD, "complete-prd")).toBe(0);
  return next(written);
}

describe("a run whose model proposed a gap", () => {
  it("records the gap and derives the facts the gates read", async () => {
    const run = await recordProposal(await startedRun());

    expect(gateFacts(run)).toMatchObject({
      contractVersion: "1.0.0",
      openGaps: 1,
      openGapIds: ["gap-refund-window"],
      stopLoss: { tripped: false, exhausted: false },
      partitionRequired: false,
      partitionApproved: true,
    });
    expect(gapRecord(run, "gap-refund-window")).toMatchObject({
      category: "document-contradiction",
      weight: "high",
      phase: "prd",
      policyMode: "enforce",
      resolution: null,
      waiver: null,
    });
  });

  it("stops the run under enforce and names the gate", async () => {
    const run = await recordProposal(await startedRun("strict"));

    const view = await handoff(run);
    expect(view).toContain("Gate outcome: block");
    expect(view).toContain("gaps-closed");
    expect(view).toContain("Open gaps: 1");

    const written = await recordEvidence(
      next(run, { [PRD]: "# PRD\n\nRefunds within thirty days.\n" }),
      PRD,
      "evidence-prd",
    );
    expect(await completePhase(written, PRD, "complete-prd")).toBe(0);

    // The phase does not advance while the gap is open.
    expect(stateOf(written)).toMatchObject({
      status: "blocked",
      currentStep: "prd",
    });
  });

  it("publishes the blocking reason code in the evidence bundle", async () => {
    const run = await recordProposal(await startedRun("strict"));
    const bundling = next(run);

    expect(await runCommandLine(["evidence", "bundle"], bundling.ports)).toBe(
      0,
    );

    const bundle = Object.entries(settled(bundling)).find(([path]) =>
      path.startsWith(".brain/evidence/"),
    );
    expect(bundle?.[0]).toBeDefined();
    expect(bundle?.[1]).toContain("gate.gaps_abertos");
  });

  it("records and reports the same gap under a non-enforcing policy", async () => {
    const run = await recordProposal(await startedRun("standard"));

    expect(gateFacts(run)?.openGaps).toBe(1);
    const view = await handoff(run);
    expect(view).toContain("Gate outcome: warn");
    expect(view).toContain("gaps-closed");
    expect(view).toContain("Open gaps: 1");

    const written = await recordEvidence(
      next(run, { [PRD]: "# PRD\n\nRefunds within thirty days.\n" }),
      PRD,
      "evidence-prd",
    );
    expect(await completePhase(written, PRD, "complete-prd")).toBe(0);

    // Reported, and the run continues.
    expect(stateOf(written)).toMatchObject({
      status: "active",
      currentStep: "spec",
    });
  });

  it("clears the count when the owner answers the gap", async () => {
    const recorded = await recordProposal(await startedRun("strict"));

    expect(
      await runCommandLine(
        [
          "gaps",
          "resolve",
          "gap-refund-window",
          "--decision",
          "accepted",
          "--document-changed",
          "--decided-by",
          "human:owner",
          "--observation",
          "Adopted the thirty-day window and revised the PRD.",
          "--correlation-id",
          "gaps-resolve",
        ],
        recorded.ports,
      ),
    ).toBe(0);
    const run = next(recorded);

    expect(gateFacts(run)).toMatchObject({ openGaps: 0, openGapIds: [] });
    expect(gapRecord(run, "gap-refund-window").resolution).toMatchObject({
      decision: "accepted",
      documentChanged: true,
      decidedBy: "human:owner",
    });
    expect(await handoff(run)).toContain("Open gaps: 0");
  });

  it("keeps a waived gap in the history and lets the run proceed", async () => {
    const recorded = await recordProposal(await startedRun("strict"));

    expect(
      await runCommandLine(
        [
          "gaps",
          "waive",
          "gap-refund-window",
          "--acknowledged-by",
          "human:owner",
          "--observation",
          "Proceeding with the question still open.",
          "--correlation-id",
          "gaps-waive",
        ],
        recorded.ports,
      ),
    ).toBe(0);
    const run = next(recorded);

    expect(gateFacts(run)?.openGaps).toBe(0);
    // Unanswered, on record, and no longer blocking.
    expect(gapRecord(run, "gap-refund-window")).toMatchObject({
      resolution: null,
      waiver: {
        acknowledgedBy: "human:owner",
        observation: "Proceeding with the question still open.",
      },
    });
    expect(await handoff(run)).not.toContain("gaps-closed");
  });

  it("refuses a proposal outside the closed set of categories", async () => {
    const started = await startedRun("strict");
    const run = next(started, {
      [PROPOSAL]: JSON.stringify({
        ...PROPOSED,
        gaps: [{ ...PROPOSED.gaps[0], category: "missing-test-coverage" }],
      }),
    });

    const code = await runCommandLine(
      ["gaps", "record", PROPOSAL, "--correlation-id", "gaps-invalid"],
      run.ports,
    );

    expect(code).toBe(2);
    expect(run.output.human_.join("")).toContain("gaps.0.category");
    expect(gateFacts(next(run))).toBeNull();
  });

  it("refuses a proposal that cannot be read", async () => {
    const run = await startedRun("strict");

    expect(
      await runCommandLine(
        ["gaps", "record", PROPOSAL, "--correlation-id", "gaps-absent"],
        run.ports,
      ),
    ).toBe(2);
  });
});

describe("a run with no recorded gate facts", () => {
  it("keeps the declared defaults when the file is missing", async () => {
    const run = await startedRun("strict");

    expect(gateFacts(run)).toBeNull();
    const view = await handoff(run);
    expect(view).toContain("Open gaps: 0");
    expect(view).not.toContain("gaps-closed");
  });

  it("fails closed when the file cannot be read as its contract", async () => {
    const started = await startedRun("strict");
    const run = next(started, {
      [`${RUN_ROOT}/${runId(started)}/gates.json`]: "{ not json at all",
    });

    const view = await handoff(run);

    // Unreadable facts block; they never read as zero open gaps.
    expect(view).toContain("Gate outcome: block");
    expect(view).toContain("context-readable");
  });

  it("fails closed when the file contradicts its own count", async () => {
    const started = await startedRun("strict");
    const run = next(started, {
      [`${RUN_ROOT}/${runId(started)}/gates.json`]: JSON.stringify({
        contractVersion: "1.0.0",
        stateContract: "1.0.0",
        runId: runId(started),
        openGaps: 0,
        openGapIds: ["gap-refund-window"],
        stopLoss: { tripped: false, exhausted: false },
        partitionRequired: false,
        partitionApproved: true,
        derivedAt: NOW,
      }),
    });

    expect(await handoff(run)).toContain("context-readable");
  });
});

describe("recorded stop-loss and partition facts", () => {
  it("trips the stop-loss gate on the host-observed flag", async () => {
    const started = await startedRun("strict");

    expect(
      await runCommandLine(
        [
          "gates",
          "record",
          "--stop-loss",
          "tripped",
          "--correlation-id",
          "gates-stop",
        ],
        started.ports,
      ),
    ).toBe(0);
    const run = next(started);

    expect(gateFacts(run)?.stopLoss).toEqual({
      tripped: true,
      exhausted: false,
    });
    expect(await handoff(run)).toContain("stop-loss");
  });

  it("records the partition facts the partition gate reads", async () => {
    const started = await startedRun("strict");

    expect(
      await runCommandLine(
        [
          "gates",
          "record",
          "--partition",
          "required",
          "--partition-approval",
          "pending",
          "--correlation-id",
          "gates-partition",
        ],
        started.ports,
      ),
    ).toBe(0);
    const run = next(started);

    expect(gateFacts(run)).toMatchObject({
      partitionRequired: true,
      partitionApproved: false,
    });
    expect(await handoff(run)).toContain("partition-approved");
  });

  it("refuses a value outside the recorded vocabulary", async () => {
    const run = await startedRun("strict");

    expect(
      await runCommandLine(
        ["gates", "record", "--stop-loss", "maybe"],
        run.ports,
      ),
    ).toBe(2);
    expect(
      await runCommandLine(
        ["gates", "record", "--tokens-used", "-1"],
        run.ports,
      ),
    ).toBe(2);
  });
});

describe("the boundary gap detection stops at", () => {
  /** Carry a run to the spec phase and approve the specification there. */
  async function approvedSpec(): Promise<Subject> {
    const spec = await recordEvidence(
      next(await throughPrd(await startedRun("strict")), {
        [SPEC]: "# Design\n\nOne refund service.\n",
      }),
      SPEC,
      "evidence-spec",
    );
    expect(
      await runCommandLine(
        [
          "approve",
          "spec",
          "--approver",
          "human:owner",
          "--expires-at",
          EXPIRY,
          "--observation",
          "Reviewed the exact PRD and design digests.",
          "--correlation-id",
          "approve-spec",
        ],
        spec.ports,
      ),
    ).toBe(0);
    return next(spec);
  }

  /**
   * Proving the boundary rather than assuming it: the specification is
   * approved, a gap record is planted past that point, and the run is not
   * stopped by it.
   */
  it("ignores a gap recorded after the specification is approved", async () => {
    const approved = await approvedSpec();
    const identifier = runId(approved);

    // Planted directly, because the command itself refuses to record one here.
    const late = next(approved, {
      [`${RUN_ROOT}/${identifier}/gaps/gap-late.json`]: JSON.stringify({
        contractVersion: "1.0.0",
        stateContract: "1.0.0",
        gapId: "gap-late",
        runId: identifier,
        phase: "spec",
        category: "owner-decision",
        weight: "high",
        description: "A question raised after the design was approved.",
        recommendation: "Decide who owns the refund ledger.",
        reasoning: "Only the owner can choose between the two teams.",
        documentRefs: [SPEC],
        prdDigest: "a".repeat(64),
        specDigest: "b".repeat(64),
        policyMode: "enforce",
        recordedAt: NOW,
        resolution: null,
        waiver: null,
      }),
      [`${RUN_ROOT}/${identifier}/gates.json`]: JSON.stringify({
        contractVersion: "1.0.0",
        stateContract: "1.0.0",
        runId: identifier,
        openGaps: 1,
        openGapIds: ["gap-late"],
        stopLoss: { tripped: false, exhausted: false },
        partitionRequired: false,
        partitionApproved: true,
        derivedAt: NOW,
      }),
    });

    const view = await handoff(late);
    expect(view).toContain("Open gaps: 0");
    expect(view).not.toContain("gaps-closed");
  });

  it("refuses to record a proposal once the specification is approved", async () => {
    const planning = next(await approvedSpec(), {
      [PROPOSAL]: JSON.stringify(PROPOSED, null, 2),
    });

    const code = await runCommandLine(
      ["gaps", "record", PROPOSAL, "--correlation-id", "gaps-late"],
      planning.ports,
    );

    expect(code).toBe(2);
    expect(planning.output.human_.join("")).toContain(
      "before specification approval",
    );
  });
});
