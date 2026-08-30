import type { AgentOutputV1_2, EventV1 } from "@kratos/contracts";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import {
  AGENT_BLOCK_CLOSE,
  AGENT_BLOCK_OPEN,
} from "@kratos/runtime/domain/agent";
import { STOCK_GOTCHAS_TEMPLATE } from "@kratos/runtime/domain/memory";
import {
  fixedClock,
  fixedEnvironment,
  fixedModelRouting,
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
import { claudeCatalog } from "./support/model-routing.js";

const ROOT = "/project";
const NOW = "2026-08-14T12:00:00.000Z";
const TEXT = "Ship the export pipeline";
const FEATURE = "ship-the-export-pipeline";
const PRD = `.brain/02-features/${FEATURE}/00-prd.md`;
const SPEC = `.brain/02-features/${FEATURE}/01-design.md`;
const TASKS = `.brain/02-features/${FEATURE}/02-tasks.md`;
const CODE_SUMMARY = `.brain/02-features/${FEATURE}/code-summary.md`;
const REVIEW_SUMMARY = `.brain/02-features/${FEATURE}/review-summary.md`;
const ACCEPTANCE_EVIDENCE = `.brain/02-features/${FEATURE}/acceptance-evidence.txt`;
const AGENT_REPLY = `.brain/02-features/${FEATURE}/agent-reply.md`;
const TASK_DOCUMENT = [
  "# Tasks",
  "",
  "## Ordered work",
  "",
  "### Work unit 1: Runtime",
  "",
  "#### Task 1.1: Persist acceptance",
  "",
  "##### Files",
  "",
  "- `packages/runtime`",
  "",
  "##### Acceptance criteria",
  "",
  "- [ ] AC-1.1.1: The verdict is persisted.",
  "",
  "##### Edge cases",
  "",
  "- [ ] AC-1.1.E1: Missing evidence is refused.",
  "",
  "## Out of scope",
  "",
  "- Prompt wording.",
  "",
].join("\n");
const ANSWERS = JSON.stringify({
  contractVersion: "1.2.0",
  hostContract: "1.2.0",
  hosts: ["claude"],
  language: {
    conversation: "en",
    documentation: "en",
    comments: "en",
    identifiers: "en",
    commits: "en",
    preserveConventions: true,
    enforcement: "advisory",
  },
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
      environment: fixedEnvironment({ KRATOS_HOST: "claude-code" }, ROOT),
      git: stubGit(),
      modelRouting: fixedModelRouting([claudeCatalog()]),
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

function agentReply(output: AgentOutputV1_2): string {
  return `${AGENT_BLOCK_OPEN}\n${JSON.stringify(output, null, 2)}\n${AGENT_BLOCK_CLOSE}\n`;
}

function eventValues(run: Subject): readonly EventV1[] {
  const log =
    Object.entries(settled(run).files).find(([path]) =>
      path.endsWith("/events.jsonl"),
    )?.[1] ?? "";
  return log
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as EventV1);
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

  it("reports the invalid evidence that rejected a continue", async () => {
    const started = await startedRun();
    const run = next(started, {
      [PRD]: "# PRD\n\nShip the export pipeline.\n",
    });

    const code = await runCommandLine(
      [
        "--json",
        "continue",
        "--complete",
        "--artifact",
        PRD,
        "--evidence",
        PRD,
        "--correlation-id",
        "reject-prd",
      ],
      run.ports,
    );

    expect(code).toBe(0);
    expect(JSON.parse(run.output.structured_.join(""))).toMatchObject({
      reasonCode: "trail.ok",
      summary: "Workflow transition rejected was recorded.",
      why: ["evidence-invalid"],
    });
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

  it("freezes identified criteria in the event that completes planning", async () => {
    const started = await startedRun();
    const prd = await recordEvidence(
      next(started, { [PRD]: "# PRD\n\nShip it.\n" }),
      PRD,
      "evidence-prd",
    );
    expect(await completePhase(prd, PRD, "complete-prd")).toBe(0);
    const spec = await recordEvidence(
      next(prd, { [SPEC]: "# Design\n\nOne pipeline.\n" }),
      SPEC,
      "evidence-spec",
    );
    expect(await completePhase(spec, SPEC, "complete-spec")).toBe(0);
    const plan = await recordEvidence(
      next(spec, { [TASKS]: TASK_DOCUMENT }),
      TASKS,
      "evidence-plan",
    );

    expect(await completePhase(plan, TASKS, "complete-plan")).toBe(0);

    expect(snapshotOf(plan).currentStep).toBe("code");
    const state = settled(plan).files;
    const snapshotEntry = Object.entries(state).find(
      ([path]) =>
        path.includes("/acceptance/criteria/") && path.endsWith(".json"),
    );
    expect(snapshotEntry).toBeDefined();
    const frozen = JSON.parse(snapshotEntry?.[1] ?? "") as {
      declarations: readonly { criterionId: string }[];
    };
    expect(frozen.declarations.map(({ criterionId }) => criterionId)).toEqual([
      "AC-1.1.1",
      "AC-1.1.E1",
    ]);
    const eventLog =
      Object.entries(state).find(([path]) =>
        path.endsWith("/events.jsonl"),
      )?.[1] ?? "";
    expect(eventLog).toContain(snapshotEntry?.[0] ?? "missing-snapshot-ref");
  });

  it("does not complete planning from a malformed criterion document", async () => {
    const started = await startedRun();
    const prd = await recordEvidence(
      next(started, { [PRD]: "# PRD\n\nShip it.\n" }),
      PRD,
      "evidence-prd",
    );
    expect(await completePhase(prd, PRD, "complete-prd")).toBe(0);
    const spec = await recordEvidence(
      next(prd, { [SPEC]: "# Design\n\nOne pipeline.\n" }),
      SPEC,
      "evidence-spec",
    );
    expect(await completePhase(spec, SPEC, "complete-spec")).toBe(0);
    const invalid = TASK_DOCUMENT.replace("AC-1.1.E1", "AC-1.1.EE1");
    const plan = await recordEvidence(
      next(spec, { [TASKS]: invalid }),
      TASKS,
      "evidence-plan",
    );

    expect(await completePhase(plan, TASKS, "complete-plan")).toBe(3);

    expect(snapshotOf(plan).currentStep).toBe("plan");
    expect(
      Object.keys(settled(plan).files).some((path) =>
        path.includes("/acceptance/criteria/"),
      ),
    ).toBe(false);
  });

  it("records a partial acceptance verdict per criterion and flips only passed checkboxes", async () => {
    const started = await startedRun();
    const prd = await recordEvidence(
      next(started, { [PRD]: "# PRD\n\nShip it.\n" }),
      PRD,
      "evidence-prd",
    );
    expect(await completePhase(prd, PRD, "complete-prd")).toBe(0);
    const spec = await recordEvidence(
      next(prd, { [SPEC]: "# Design\n\nOne pipeline.\n" }),
      SPEC,
      "evidence-spec",
    );
    expect(await completePhase(spec, SPEC, "complete-spec")).toBe(0);
    const plan = await recordEvidence(
      next(spec, { [TASKS]: TASK_DOCUMENT }),
      TASKS,
      "evidence-plan",
    );
    expect(await completePhase(plan, TASKS, "complete-plan")).toBe(0);
    const code = await recordEvidence(
      next(plan, { [CODE_SUMMARY]: "Code complete.\n" }),
      CODE_SUMMARY,
      "evidence-code",
    );
    expect(await completePhase(code, CODE_SUMMARY, "complete-code")).toBe(0);
    const review = await recordEvidence(
      next(code, { [REVIEW_SUMMARY]: "Review complete.\n" }),
      REVIEW_SUMMARY,
      "evidence-review",
    );
    expect(await completePhase(review, REVIEW_SUMMARY, "complete-review")).toBe(
      0,
    );
    const appendedTaskDocument = TASK_DOCUMENT.replace(
      "- [ ] AC-1.1.E1: Missing evidence is refused.",
      "- [ ] AC-1.1.E1: Missing evidence is refused.\n- [ ] AC-1.1.E2: An acceptance-only append is recorded.",
    );
    const acceptance = await recordEvidence(
      next(review, {
        [TASKS]: appendedTaskDocument,
        [ACCEPTANCE_EVIDENCE]: "Focused tests passed.\n",
      }),
      ACCEPTANCE_EVIDENCE,
      "evidence-acceptance",
    );
    const output: AgentOutputV1_2 = {
      contractVersion: "1.2.0",
      hostContract: "1.2.0",
      agent: "acceptance",
      outcome: {
        status: "completed",
        next: "finish",
        questions: [],
        blockers: [],
      },
      artifacts: [],
      changedFiles: [],
      memory: null,
      payload: {
        verdict: "rejected",
        criteria: [
          {
            criterionId: "AC-1.1.E1",
            outcome: "failed",
            evidenceRef: ACCEPTANCE_EVIDENCE,
          },
          {
            criterionId: "AC-1.1.1",
            outcome: "passed",
            evidenceRef: ACCEPTANCE_EVIDENCE,
          },
          {
            criterionId: "AC-1.1.E2",
            outcome: "not-run",
            evidenceRef: ACCEPTANCE_EVIDENCE,
          },
        ],
      },
    };
    const recording = next(acceptance, { [AGENT_REPLY]: agentReply(output) });

    expect(
      await runCommandLine(
        [
          "agent",
          "record",
          AGENT_REPLY,
          "--correlation-id",
          "acceptance-verdict",
        ],
        recording.ports,
      ),
    ).toBe(0);

    const files = settled(recording).files;
    expect(files[TASKS]).toContain("- [x] AC-1.1.1: The verdict is persisted.");
    expect(files[TASKS]).toContain(
      "- [ ] AC-1.1.E1: Missing evidence is refused.",
    );
    expect(files[TASKS]).toContain(
      "- [ ] AC-1.1.E2: An acceptance-only append is recorded.",
    );
    const recordedEvent = eventValues(recording).at(-1);
    const verdictAnchors =
      recordedEvent?.artifactRefs.filter(
        (ref) =>
          ref.includes("/acceptance/verdicts/") &&
          ref.includes(".json#sha256="),
      ) ?? [];
    expect(verdictAnchors).toHaveLength(3);
    expect(verdictAnchors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/AC-1.1.1.json#sha256="),
        expect.stringContaining("/AC-1.1.E1.json#sha256="),
        expect.stringContaining("/AC-1.1.E2.json#sha256="),
      ]),
    );
    const verdictRefs = verdictAnchors.map((ref) =>
      ref.slice(0, ref.indexOf("#sha256=")),
    );
    const appendedSnapshotRef = Object.keys(files).find((ref) => {
      if (!ref.includes("/acceptance/criteria/") || !ref.endsWith(".json")) {
        return false;
      }
      const candidate = JSON.parse(files[ref] ?? "{}") as {
        previousSnapshotRef?: unknown;
      };
      return candidate.previousSnapshotRef !== null;
    });
    expect(appendedSnapshotRef).toBeDefined();
    const appendedSnapshot = JSON.parse(
      files[appendedSnapshotRef ?? ""] ?? "",
    ) as { previousSnapshotRef: string | null };
    expect(appendedSnapshot.previousSnapshotRef).toContain(
      "/acceptance/criteria/",
    );

    const replayed = next(recording);
    expect(await runCommandLine(["status"], replayed.ports)).toBe(0);
    expect(eventValues(replayed).at(-1)?.artifactRefs).toEqual(
      recordedEvent?.artifactRefs,
    );

    const verdictToTamper = verdictRefs[0];
    if (verdictToTamper === undefined) throw new Error("no verdict to tamper");
    const tamperedValue = JSON.parse(files[verdictToTamper] ?? "") as {
      outcome: string;
    };
    const tampered = next(recording, {
      [verdictToTamper]: `${JSON.stringify({ ...tamperedValue, outcome: "passed" }, null, 2)}\n`,
      [AGENT_REPLY]: agentReply(output),
    });
    expect(
      await runCommandLine(
        [
          "--json",
          "agent",
          "record",
          AGENT_REPLY,
          "--correlation-id",
          "tampered-verdict",
        ],
        tampered.ports,
      ),
    ).toBe(3);
    expect(
      JSON.parse(tampered.output.structured_.join("")) as {
        reasonCode: string;
      },
    ).toMatchObject({ reasonCode: "gate.ac_baseline_unverifiable" });
  });

  it("records the 126-criterion maximum within the EventV1 envelope", async () => {
    const criterionIds = Array.from(
      { length: 126 },
      (_, index) => `AC-1.1.${String(index + 1)}`,
    );
    const taskDocument = (ids: readonly string[]) =>
      [
        "# Tasks",
        "",
        "## Ordered work",
        "",
        "### Work unit 1: Runtime",
        "",
        "#### Task 1.1: Persist acceptance",
        "",
        "##### Acceptance criteria",
        "",
        ...ids.map(
          (criterionId) => `- [ ] ${criterionId}: Criterion ${criterionId}.`,
        ),
        "",
        "## Out of scope",
        "",
        "- Prompt wording.",
        "",
      ].join("\n");
    const started = await startedRun();
    const prd = await recordEvidence(
      next(started, { [PRD]: "# PRD\n\nShip it.\n" }),
      PRD,
      "max-evidence-prd",
    );
    expect(await completePhase(prd, PRD, "max-complete-prd")).toBe(0);
    const spec = await recordEvidence(
      next(prd, { [SPEC]: "# Design\n\nOne pipeline.\n" }),
      SPEC,
      "max-evidence-spec",
    );
    expect(await completePhase(spec, SPEC, "max-complete-spec")).toBe(0);
    const plan = await recordEvidence(
      next(spec, { [TASKS]: taskDocument(criterionIds.slice(0, -1)) }),
      TASKS,
      "max-evidence-plan",
    );
    expect(await completePhase(plan, TASKS, "max-complete-plan")).toBe(0);
    const code = await recordEvidence(
      next(plan, { [CODE_SUMMARY]: "Code complete.\n" }),
      CODE_SUMMARY,
      "max-evidence-code",
    );
    expect(await completePhase(code, CODE_SUMMARY, "max-complete-code")).toBe(
      0,
    );
    const review = await recordEvidence(
      next(code, { [REVIEW_SUMMARY]: "Review complete.\n" }),
      REVIEW_SUMMARY,
      "max-evidence-review",
    );
    expect(
      await completePhase(review, REVIEW_SUMMARY, "max-complete-review"),
    ).toBe(0);
    const acceptance = await recordEvidence(
      next(review, {
        [TASKS]: taskDocument(criterionIds),
        [ACCEPTANCE_EVIDENCE]: "All focused tests passed.\n",
      }),
      ACCEPTANCE_EVIDENCE,
      "max-evidence-acceptance",
    );
    const criterionReports = criterionIds.map((criterionId) => ({
      criterionId,
      outcome: "passed" as const,
      evidenceRef: ACCEPTANCE_EVIDENCE,
    }));
    const firstCriterionReport = criterionReports[0];
    if (firstCriterionReport === undefined) throw new Error("no criteria");
    const output: AgentOutputV1_2 = {
      contractVersion: "1.2.0",
      hostContract: "1.2.0",
      agent: "acceptance",
      outcome: {
        status: "completed",
        next: "finish",
        questions: [],
        blockers: [],
      },
      artifacts: [],
      changedFiles: [],
      memory: null,
      payload: {
        verdict: "accepted",
        criteria: [firstCriterionReport, ...criterionReports.slice(1)],
      },
    };
    const recording = next(acceptance, {
      [AGENT_REPLY]: agentReply(output),
    });

    expect(
      await runCommandLine(
        [
          "agent",
          "record",
          AGENT_REPLY,
          "--correlation-id",
          "max-acceptance-verdict",
        ],
        recording.ports,
      ),
    ).toBe(0);
    const refs = eventValues(recording).at(-1)?.artifactRefs ?? [];
    expect(refs).toHaveLength(256);
    expect(refs).toContainEqual(expect.stringContaining("/AC-1.1.1.json"));
    expect(refs).toContainEqual(
      expect.stringContaining("/AC-1.1.126.json#sha256="),
    );
  });

  it("refuses an implementing-phase checkbox flip", async () => {
    const started = await startedRun();
    const prd = await recordEvidence(
      next(started, { [PRD]: "# PRD\n\nShip it.\n" }),
      PRD,
      "evidence-prd",
    );
    expect(await completePhase(prd, PRD, "complete-prd")).toBe(0);
    const spec = await recordEvidence(
      next(prd, { [SPEC]: "# Design\n\nOne pipeline.\n" }),
      SPEC,
      "evidence-spec",
    );
    expect(await completePhase(spec, SPEC, "complete-spec")).toBe(0);
    const plan = await recordEvidence(
      next(spec, { [TASKS]: TASK_DOCUMENT }),
      TASKS,
      "evidence-plan",
    );
    expect(await completePhase(plan, TASKS, "complete-plan")).toBe(0);
    const codeEvidence = await recordEvidence(
      next(plan, { [CODE_SUMMARY]: "Code complete.\n" }),
      CODE_SUMMARY,
      "evidence-code",
    );
    const changed = next(codeEvidence, {
      [TASKS]: TASK_DOCUMENT.replace("- [ ] AC-1.1.1", "- [x] AC-1.1.1"),
    });
    expect(
      await completePhase(changed, CODE_SUMMARY, "complete-code-with-flip"),
    ).toBe(3);
    expect(snapshotOf(changed).currentStep).toBe("code");
    const codeOutput: AgentOutputV1_2 = {
      contractVersion: "1.2.0",
      hostContract: "1.2.0",
      agent: "code",
      outcome: {
        status: "completed",
        next: "proceed",
        questions: [],
        blockers: [],
      },
      artifacts: [],
      changedFiles: [],
      memory: {
        ref: ".brain/03-memory/gotchas.md",
        sha256: changed.ports.digests.sha256(STOCK_GOTCHAS_TEMPLATE),
        lessonIds: [],
      },
      payload: { stepId: "step-1", testsAdded: 1, testsPassed: true },
    };
    const recording = next(changed, {
      [AGENT_REPLY]: agentReply(codeOutput),
    });

    expect(
      await runCommandLine(
        ["--json", "agent", "record", AGENT_REPLY],
        recording.ports,
      ),
    ).toBe(3);
    const result = JSON.parse(recording.output.structured_.join("")) as {
      reasonCode: string;
      why: readonly string[];
    };
    expect(result.reasonCode).toBe("gate.ac_checkbox_forbidden");
    expect(
      Object.keys(settled(recording).files).some((path) =>
        path.endsWith("/agent-output/code.json"),
      ),
    ).toBe(false);
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
