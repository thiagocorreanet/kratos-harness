import type {
  CurrentPhaseHandoff,
  ReadableEvent,
  ReadableAgentOutput,
} from "@kratos/contracts";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import {
  AGENT_BLOCK_CLOSE,
  AGENT_BLOCK_OPEN,
} from "@kratos/runtime/domain/agent";
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
const NOW = "2026-08-30T12:00:00.000Z";
const FEATURE = "bound-acceptance-repairs";
const FEATURE_ROOT = `.brain/02-features/${FEATURE}`;
const PRD = `${FEATURE_ROOT}/00-prd.md`;
const SPEC = `${FEATURE_ROOT}/01-design.md`;
const TASKS = `${FEATURE_ROOT}/02-tasks.md`;
const CODE = `${FEATURE_ROOT}/code.md`;
const REVIEW = `${FEATURE_ROOT}/review.md`;
const REPAIR_CODE = `${FEATURE_ROOT}/repair-code.md`;
const REPAIR_REVIEW = `${FEATURE_ROOT}/repair-review.md`;
const ACCEPTANCE_EVIDENCE = `${FEATURE_ROOT}/acceptance.txt`;
const AGENT_REPLY = `${FEATURE_ROOT}/agent-reply.md`;

const TASK_DOCUMENT = [
  "# Tasks",
  "",
  "## Ordered work",
  "",
  "### Work unit 1: Runtime",
  "",
  "#### Task 1.1: Bound acceptance repairs",
  "",
  "##### Acceptance criteria",
  "",
  "- [ ] AC-1.1.1: A rejected verdict returns to repair.",
  "",
  "##### Edge cases",
  "",
  "- [ ] AC-1.1.E1: A repeated rejection stops the run.",
  "",
  "## Out of scope",
  "",
  "- Repair resolution.",
  "",
].join("\n");
const TASK_DOCUMENT_REUSING_ONLY_CODE_STOP = TASK_DOCUMENT.replaceAll(
  "AC-1.1.E1",
  "AC-1.1.E2",
);

const ANSWERS = JSON.stringify({
  contractVersion: "1.4.0",
  hostContract: "1.4.0",
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
  acceptanceAttemptCeiling: 2,
});

interface Subject {
  readonly ports: RuntimePorts;
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
  readonly generation: number;
}

function subject(
  files: Readonly<Record<string, string>> = {},
  directories: readonly string[] = [".brain", ".brain/transactions"],
  answers: string | null = null,
  generation = 0,
): Subject {
  const storage = memoryTransactionStorage({ files, directories });
  const output = recordingOutput();
  return {
    generation,
    storage,
    output,
    ports: {
      clock: fixedClock(NOW),
      ids: sequentialIds(`id-${String(generation)}`),
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

function next(
  run: Subject,
  written: Readonly<Record<string, string>> = {},
): Subject {
  const state = settled(run);
  return subject(
    { ...state.files, ...written },
    state.directories,
    null,
    run.generation + 1,
  );
}

function withoutFile(run: Subject, path: string): Subject {
  const state = settled(run);
  const files = Object.fromEntries(
    Object.entries(state.files).filter(([candidate]) => candidate !== path),
  );
  return subject(files, state.directories, null, run.generation + 1);
}

function state(run: Subject): {
  readonly currentStep: string | null;
  readonly status: string;
} {
  const value = Object.entries(settled(run).files).find(
    ([path]) => path.includes("/runs/") && path.endsWith("/state.json"),
  )?.[1];
  if (value === undefined) throw new Error("missing state");
  return JSON.parse(value) as ReturnType<typeof state>;
}

function events(run: Subject): readonly ReadableEvent[] {
  const value = Object.entries(settled(run).files).find(([path]) =>
    path.endsWith("/events.jsonl"),
  )?.[1];
  return (value ?? "")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReadableEvent);
}

function activeRunId(run: Subject): string {
  return settled(run).files[`${FEATURE_ROOT}/active-run`]?.trim() ?? "";
}

function stateFor(run: Subject, runId: string): Record<string, unknown> {
  const value = settled(run).files[`${FEATURE_ROOT}/runs/${runId}/state.json`];
  if (value === undefined) throw new Error(`missing state for ${runId}`);
  return JSON.parse(value) as Record<string, unknown>;
}

function eventsFor(run: Subject, runId: string): readonly ReadableEvent[] {
  const value =
    settled(run).files[`${FEATURE_ROOT}/runs/${runId}/events.jsonl`] ?? "";
  return value
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ReadableEvent);
}

async function evidence(
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

async function complete(
  run: Subject,
  ref: string,
  correlationId: string,
): Promise<Subject> {
  expect(
    await runCommandLine(
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
    ),
  ).toBe(0);
  return next(run);
}

async function advance(
  run: Subject,
  ref: string,
  content: string,
  correlationId: string,
): Promise<Subject> {
  const recorded = await evidence(
    next(run, { [ref]: content }),
    ref,
    `evidence-${correlationId}`,
  );
  return complete(recorded, ref, `complete-${correlationId}`);
}

async function acceptanceReady(): Promise<Subject> {
  const initialized = subject({}, [".brain", ".brain/transactions"], ANSWERS);
  expect(await runCommandLine(["init"], initialized.ports)).toBe(0);
  const objective = next(initialized);
  expect(
    await runCommandLine(
      ["objective", "Bound acceptance repairs"],
      objective.ports,
    ),
  ).toBe(0);
  const started = next(objective);
  expect(
    await runCommandLine(["start", "--host", "claude-code"], started.ports),
  ).toBe(0);
  const prd = await advance(
    started,
    PRD,
    "# PRD\n\nBound acceptance repair attempts.\n",
    "prd",
  );
  const spec = await advance(
    prd,
    SPEC,
    "# Design\n\nUse the runtime decision boundary.\n",
    "spec",
  );
  const plan = await advance(spec, TASKS, TASK_DOCUMENT, "plan");
  const code = await advance(plan, CODE, "Implementation evidence.\n", "code");
  const review = await advance(
    code,
    REVIEW,
    "Independent review evidence.\n",
    "review",
  );
  return evidence(
    next(review, { [ACCEPTANCE_EVIDENCE]: "Acceptance tests failed.\n" }),
    ACCEPTANCE_EVIDENCE,
    "evidence-acceptance",
  );
}

function rejection(
  faults?: readonly {
    readonly criterionId: string;
    readonly classification: "code" | "specification";
    readonly diagnosis: string;
  }[],
): Extract<ReadableAgentOutput, { readonly agent: "acceptance" }> {
  return {
    contractVersion: "1.3.0",
    hostContract: "1.3.0",
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
          criterionId: "AC-1.1.1",
          outcome: "failed",
          evidenceRef: ACCEPTANCE_EVIDENCE,
        },
        {
          criterionId: "AC-1.1.E1",
          outcome: "failed",
          evidenceRef: ACCEPTANCE_EVIDENCE,
        },
      ],
      ...(faults === undefined ? {} : { faults: [...faults] }),
    },
  };
}

function acceptance(): Extract<
  ReadableAgentOutput,
  { readonly agent: "acceptance" }
> {
  return {
    contractVersion: "1.3.0",
    hostContract: "1.3.0",
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
      criteria: [
        {
          criterionId: "AC-1.1.1",
          outcome: "passed",
          evidenceRef: ACCEPTANCE_EVIDENCE,
        },
        {
          criterionId: "AC-1.1.E1",
          outcome: "passed",
          evidenceRef: ACCEPTANCE_EVIDENCE,
        },
      ],
    },
  };
}

function reply(output: ReadableAgentOutput): string {
  return `${AGENT_BLOCK_OPEN}\n${JSON.stringify(output, null, 2)}\n${AGENT_BLOCK_CLOSE}\n`;
}

async function record(
  run: Subject,
  output: ReadableAgentOutput,
  correlationId: string,
): Promise<{ readonly code: number; readonly run: Subject }> {
  const recording = next(run, { [AGENT_REPLY]: reply(output) });
  const code = await runCommandLine(
    [
      "--json",
      "agent",
      "record",
      AGENT_REPLY,
      "--correlation-id",
      correlationId,
    ],
    recording.ports,
  );
  return { code, run: recording };
}

async function currentHandoff(run: Subject): Promise<CurrentPhaseHandoff> {
  const viewing = next(run);
  expect(await runCommandLine(["--json", "handoff"], viewing.ports)).toBe(0);
  return JSON.parse(viewing.output.structured_.join("")) as CurrentPhaseHandoff;
}

async function repairedAcceptance(run: Subject): Promise<Subject> {
  const code = await advance(
    run,
    REPAIR_CODE,
    "Repaired implementation evidence.\n",
    "repair-code",
  );
  return advance(
    code,
    REPAIR_REVIEW,
    "Repaired review evidence.\n",
    "repair-review",
  );
}

describe("atomic acceptance recording", () => {
  it("records an accepted verdict without resetting existing attempt state", async () => {
    const ready = await acceptanceReady();
    const rejected = await record(ready, rejection(), "acceptance-1");
    const secondReady = await repairedAcceptance(next(rejected.run));
    const accepted = await record(secondReady, acceptance(), "acceptance-2");

    expect(accepted.code).toBe(0);
    expect(state(accepted.run)).toMatchObject({
      currentStep: "acceptance",
      status: "active",
    });
    expect(events(accepted.run).at(-1)).toMatchObject({
      operation: "sdd.acceptance.record:acceptance-2",
      reasonCode: "run.acceptance.passed",
      acceptanceDecision: {
        outcome: "passed",
        attempts: [],
        repairStops: [],
      },
    });
    expect((await currentHandoff(accepted.run)).acceptance.attempts).toEqual([
      { criterionId: "AC-1.1.1", attempt: 1 },
      { criterionId: "AC-1.1.E1", attempt: 1 },
    ]);
  });

  it("records a below-ceiling rejection as the event that returns the run to code", async () => {
    const ready = await acceptanceReady();
    const recorded = await record(ready, rejection(), "acceptance-1");

    expect(recorded.code).toBe(0);
    expect(state(recorded.run)).toMatchObject({
      currentStep: "code",
      status: "active",
    });
    expect(events(recorded.run).at(-1)).toMatchObject({
      operation: "sdd.acceptance.record:acceptance-1",
      reasonCode: "run.acceptance.repair_required",
      acceptanceDecision: {
        outcome: "repair",
        attempts: [
          { criterionId: "AC-1.1.1", attempt: 1 },
          { criterionId: "AC-1.1.E1", attempt: 1 },
        ],
        repairStops: [],
      },
    });
  });

  it("refuses a ceiling verdict with missing diagnoses without any effect", async () => {
    const ready = await acceptanceReady();
    const first = await record(ready, rejection(), "acceptance-1");
    expect(first.code).toBe(0);
    const secondReady = await repairedAcceptance(next(first.run));
    const before = settled(secondReady);
    const refused = await record(secondReady, rejection(), "acceptance-2");

    const refusalResult: unknown = JSON.parse(
      refused.run.output.structured_.join(""),
    );
    expect(refusalResult).toMatchObject({
      reasonCode: "trail.output_invalido",
      stateChanged: false,
      why: [expect.stringContaining("classification and diagnosis")],
    });
    expect(refused.code).toBe(3);
    expect(settled(refused.run)).toEqual({
      files: { ...before.files, [AGENT_REPLY]: reply(rejection()) },
      directories: before.directories,
    });
  });

  it("records every simultaneous ceiling stop in task-document order", async () => {
    const ready = await acceptanceReady();
    const first = await record(ready, rejection(), "acceptance-1");
    expect(first.code).toBe(0);
    const secondReady = await repairedAcceptance(next(first.run));
    expect(state(secondReady)).toMatchObject({
      currentStep: "acceptance",
      status: "active",
    });
    expect((await currentHandoff(secondReady)).acceptance).toEqual({
      attemptCeiling: 2,
      attempts: [
        { criterionId: "AC-1.1.1", attempt: 1 },
        { criterionId: "AC-1.1.E1", attempt: 1 },
      ],
      faultsRequiredFor: ["AC-1.1.1", "AC-1.1.E1"],
      faults: [],
    });
    const stopped = await record(
      secondReady,
      rejection([
        {
          criterionId: "AC-1.1.1",
          classification: "code",
          diagnosis: "The implementation still returns the wrong status.",
        },
        {
          criterionId: "AC-1.1.E1",
          classification: "specification",
          diagnosis: "The edge-case requirement contradicts the design.",
        },
      ]),
      "acceptance-2",
    );

    expect(stopped.code).toBe(0);
    expect(state(stopped.run)).toMatchObject({
      currentStep: "acceptance",
      status: "blocked",
    });
    const last = events(stopped.run).at(-1);
    expect(last).toMatchObject({
      operation: "sdd.acceptance.record:acceptance-2",
      reasonCode: "run.stop_loss.repeated_rejection",
      acceptanceDecision: {
        outcome: "stopped",
        attempts: [
          { criterionId: "AC-1.1.1", attempt: 2 },
          { criterionId: "AC-1.1.E1", attempt: 2 },
        ],
        repairStops: [
          {
            criterionId: "AC-1.1.1",
            attempt: 2,
            classification: "code",
          },
          {
            criterionId: "AC-1.1.E1",
            attempt: 2,
            classification: "specification",
          },
        ],
      },
    });
    const files = settled(stopped.run).files;
    const repairStops =
      last?.stateContract === "1.2.0" ||
      last?.stateContract === "1.3.0" ||
      last?.stateContract === "1.4.0"
        ? (last.acceptanceDecision?.repairStops ?? [])
        : [];
    for (const stop of repairStops) {
      const artifact = JSON.parse(files[stop.artifactRef] ?? "") as {
        readonly criterionId: string;
        readonly diagnosis: string;
      };
      expect(artifact.criterionId).toBe(stop.criterionId);
      expect(artifact.diagnosis.length).toBeGreaterThan(0);
    }
    expect((await currentHandoff(stopped.run)).acceptance).toEqual({
      attemptCeiling: 2,
      attempts: [
        { criterionId: "AC-1.1.1", attempt: 2 },
        { criterionId: "AC-1.1.E1", attempt: 2 },
      ],
      faultsRequiredFor: [],
      faults: [
        expect.objectContaining({
          criterionId: "AC-1.1.1",
          attempt: 2,
          classification: "code",
          diagnosis: "The implementation still returns the wrong status.",
        }),
        expect.objectContaining({
          criterionId: "AC-1.1.E1",
          attempt: 2,
          classification: "specification",
          diagnosis: "The edge-case requirement contradicts the design.",
        }),
      ],
    });
  });

  it("resolves code stops selectively and idempotently before returning the same run to code", async () => {
    const ready = await acceptanceReady();
    const first = await record(ready, rejection(), "acceptance-1");
    const secondReady = await repairedAcceptance(next(first.run));
    const stopped = await record(
      secondReady,
      rejection([
        {
          criterionId: "AC-1.1.1",
          classification: "code",
          diagnosis: "The implementation still returns the wrong status.",
        },
        {
          criterionId: "AC-1.1.E1",
          classification: "code",
          diagnosis: "The implementation omits the required edge-case guard.",
        },
      ]),
      "acceptance-2",
    );
    expect(stopped.code).toBe(0);
    const runId = activeRunId(stopped.run);
    const resolvingFirst = next(stopped.run);
    const firstResolutionArgv = [
      "repair",
      "resolve",
      "AC-1.1.1",
      "--run",
      runId,
      "--resolved-by",
      "human-01",
      "--observation",
      "The implementation was corrected and independently verified.",
      "--correlation-id",
      "resolve-code-one",
    ] as const;
    const firstResolutionCode = await runCommandLine(
      firstResolutionArgv,
      resolvingFirst.ports,
    );
    expect(firstResolutionCode).toBe(0);
    const once = next(resolvingFirst);
    expect(state(once)).toMatchObject({
      currentStep: "acceptance",
      status: "blocked",
    });
    expect((await currentHandoff(once)).acceptance).toMatchObject({
      attempts: [{ criterionId: "AC-1.1.E1", attempt: 2 }],
      faults: [expect.objectContaining({ criterionId: "AC-1.1.E1" })],
    });
    const eventCount = events(once).length;
    const firstResolution = events(once).at(-1);
    const firstResolutionRef =
      firstResolution?.stateContract === "1.3.0" ||
      firstResolution?.stateContract === "1.4.0"
        ? firstResolution.repairResolution?.resolutionRef
        : undefined;
    if (firstResolutionRef === undefined) {
      throw new Error("missing first resolution reference");
    }

    const duplicate = next(once);
    const duplicateArgv = [
      "repair.resolve",
      "AC-1.1.1",
      "--run",
      runId,
      "--resolved-by",
      "human-01",
      "--observation",
      "The implementation was corrected and independently verified.",
      "--correlation-id",
      "resolve-code-one",
    ] as const;
    const duplicateCode = await runCommandLine(duplicateArgv, duplicate.ports);
    expect(duplicateCode).toBe(0);
    expect(events(duplicate)).toHaveLength(eventCount);

    const deletedResolution = withoutFile(once, firstResolutionRef);
    expect(
      await runCommandLine(duplicateArgv, deletedResolution.ports),
    ).not.toBe(0);
    expect(events(deletedResolution)).toHaveLength(eventCount);

    const originalResolution = settled(once).files[firstResolutionRef];
    if (originalResolution === undefined) {
      throw new Error("missing first resolution artifact");
    }
    const tamperedResolution = next(once, {
      [firstResolutionRef]: originalResolution.replace(
        "independently verified",
        "silently tampered",
      ),
    });
    expect(
      await runCommandLine(duplicateArgv, tamperedResolution.ports),
    ).not.toBe(0);
    expect(events(tamperedResolution)).toHaveLength(eventCount);

    const divergentDuplicate = next(duplicate);
    expect(
      await runCommandLine(
        [...duplicateArgv, "--next-run", "divergent-run"],
        divergentDuplicate.ports,
      ),
    ).not.toBe(0);
    expect(events(divergentDuplicate)).toHaveLength(eventCount);

    const divergentObservation = next(duplicate);
    expect(
      await runCommandLine(
        duplicateArgv.map((argument) =>
          argument ===
          "The implementation was corrected and independently verified."
            ? "A different human observation was supplied on retry."
            : argument,
        ),
        divergentObservation.ports,
      ),
    ).not.toBe(0);
    expect(events(divergentObservation)).toHaveLength(eventCount);

    const invalidNextRun = next(duplicate);
    expect(
      await runCommandLine(
        [
          "repair",
          "resolve",
          "AC-1.1.E1",
          "--run",
          runId,
          "--resolved-by",
          "human-01",
          "--observation",
          "The implementation was corrected and independently verified.",
          "--next-run",
          "run-not-allowed",
        ],
        invalidNextRun.ports,
      ),
    ).toBe(2);
    expect(events(invalidNextRun)).toHaveLength(eventCount);

    const resolvingSecond = next(invalidNextRun);
    expect(
      await runCommandLine(
        [
          "repair",
          "resolve",
          "AC-1.1.E1",
          "--run",
          runId,
          "--resolved-by",
          "human-01",
          "--observation",
          "The edge-case implementation was corrected and reverified.",
          "--correlation-id",
          "resolve-code-two",
        ],
        resolvingSecond.ports,
      ),
    ).toBe(0);
    const resolved = next(resolvingSecond);
    expect(activeRunId(resolved)).toBe(runId);
    expect(state(resolved)).toMatchObject({
      currentStep: "code",
      status: "active",
    });
    expect((await currentHandoff(resolved)).acceptance).toMatchObject({
      attempts: [],
      faults: [],
    });
    expect(events(resolved).slice(-2)).toMatchObject([
      {
        stateContract: "1.3.0",
        operation: "sdd.repair.resolve:resolve-code-one",
        repairResolution: {
          criterionId: "AC-1.1.1",
          classification: "code",
          nextRunId: null,
        },
      },
      {
        stateContract: "1.3.0",
        operation: "sdd.repair.resolve:resolve-code-two",
        repairResolution: {
          criterionId: "AC-1.1.E1",
          classification: "code",
          nextRunId: null,
        },
      },
    ]);
  });

  it("retires code-resolved and active specification stop IDs in one fresh spec run", async () => {
    const ready = await acceptanceReady();
    const first = await record(ready, rejection(), "acceptance-1");
    const secondReady = await repairedAcceptance(next(first.run));
    const stopped = await record(
      secondReady,
      rejection([
        {
          criterionId: "AC-1.1.1",
          classification: "code",
          diagnosis: "The implementation still returns the wrong status.",
        },
        {
          criterionId: "AC-1.1.E1",
          classification: "specification",
          diagnosis: "The acceptance statement cannot be satisfied as written.",
        },
      ]),
      "acceptance-2",
    );
    expect(stopped.code).toBe(0);
    const sourceRunId = activeRunId(stopped.run);
    const sourceBefore = stateFor(stopped.run, sourceRunId);
    const sourceEventCount = eventsFor(stopped.run, sourceRunId).length;
    const specificationFirst = next(stopped.run);
    expect(
      await runCommandLine(
        [
          "repair",
          "resolve",
          "AC-1.1.E1",
          "--run",
          sourceRunId,
          "--next-run",
          "restart-spec-refused",
          "--resolved-by",
          "human-01",
          "--observation",
          "The specification must be rewritten and approved under a fresh run.",
          "--correlation-id",
          "resolve-spec-before-code",
        ],
        specificationFirst.ports,
      ),
    ).toBe(2);
    expect(activeRunId(specificationFirst)).toBe(sourceRunId);
    expect(eventsFor(specificationFirst, sourceRunId)).toHaveLength(
      sourceEventCount,
    );
    expect(stateFor(specificationFirst, sourceRunId)).toEqual(sourceBefore);

    const resolvingCode = next(specificationFirst);
    expect(
      await runCommandLine(
        [
          "repair",
          "resolve",
          "AC-1.1.1",
          "--run",
          sourceRunId,
          "--resolved-by",
          "human-01",
          "--observation",
          "The implementation was corrected and independently verified.",
          "--correlation-id",
          "resolve-code-before-spec",
        ],
        resolvingCode.ports,
      ),
    ).toBe(0);
    const resolving = next(resolvingCode);
    const argv = [
      "repair",
      "resolve",
      "AC-1.1.E1",
      "--run",
      sourceRunId,
      "--next-run",
      "restart-spec-01",
      "--resolved-by",
      "human-01",
      "--observation",
      "The specification must be rewritten and approved under a fresh run.",
      "--correlation-id",
      "resolve-spec-one",
    ] as const;
    expect(await runCommandLine(argv, resolving.ports)).toBe(0);
    const restarted = next(resolving);

    expect(activeRunId(restarted)).toBe("restart-spec-01");
    expect(stateFor(restarted, sourceRunId)).toMatchObject({
      status: "blocked",
      currentStep: "acceptance",
      eventCursor: (sourceBefore.eventCursor as number) + 2,
    });
    expect(stateFor(restarted, "restart-spec-01")).toMatchObject({
      runId: "restart-spec-01",
      status: "active",
      currentStep: "spec",
      eventCursor: 1,
    });
    expect(eventsFor(restarted, sourceRunId).slice(-2)).toMatchObject([
      {
        stateContract: "1.3.0",
        operation: "sdd.repair.resolve:resolve-code-before-spec",
        repairResolution: {
          criterionId: "AC-1.1.1",
          classification: "code",
          nextRunId: null,
        },
      },
      {
        stateContract: "1.3.0",
        operation: "sdd.repair.resolve:resolve-spec-one",
        repairResolution: {
          criterionId: "AC-1.1.E1",
          classification: "specification",
          nextRunId: "restart-spec-01",
        },
      },
    ]);
    expect(eventsFor(restarted, "restart-spec-01")).toMatchObject([
      {
        stateContract: "1.3.0",
        operation: "sdd.repair.restart:resolve-spec-one",
        reasonCode: "run.started_from_spec",
        startedFromSpec: {
          sourceRunId,
          retiredCriterionIds: ["AC-1.1.1", "AC-1.1.E1"],
        },
        runLimits: { acceptanceAttemptCeiling: 2, tokenCeiling: null },
      },
    ]);
    const files = settled(restarted).files;
    expect(
      Object.keys(files).filter((path) => path.includes("repair-resolutions")),
    ).toHaveLength(2);
    expect(
      Object.keys(files).filter((path) => path.includes("repair-restarts")),
    ).toHaveLength(1);

    const restartRef = Object.keys(files).find((path) =>
      path.includes("repair-restarts"),
    );
    if (restartRef === undefined) throw new Error("missing restart artifact");
    const deletedRestart = withoutFile(restarted, restartRef);
    expect(await runCommandLine(argv, deletedRestart.ports)).not.toBe(0);

    const restartArtifact = files[restartRef];
    if (restartArtifact === undefined) throw new Error("missing restart bytes");
    const tamperedRestart = next(restarted, {
      [restartRef]: restartArtifact.replace(
        '"startPhase": "spec"',
        '"startPhase": "code"',
      ),
    });
    expect(await runCommandLine(argv, tamperedRestart.ports)).not.toBe(0);

    const missingSuccessor = withoutFile(
      restarted,
      `${FEATURE_ROOT}/runs/restart-spec-01/events.jsonl`,
    );
    expect(await runCommandLine(argv, missingSuccessor.ports)).not.toBe(0);

    const targetSnapshotRef = `${FEATURE_ROOT}/runs/restart-spec-01/state.json`;
    const targetSnapshot = JSON.parse(files[targetSnapshotRef] ?? "") as Record<
      string,
      unknown
    >;
    const divergentSuccessorSnapshot = next(restarted, {
      [targetSnapshotRef]: `${JSON.stringify(
        { ...targetSnapshot, status: "blocked" },
        null,
        2,
      )}\n`,
    });
    expect(
      await runCommandLine(argv, divergentSuccessorSnapshot.ports),
    ).not.toBe(0);

    const divergentRestart = next(restarted);
    expect(
      await runCommandLine(
        argv.map((argument) =>
          argument === "restart-spec-01" ? "restart-spec-divergent" : argument,
        ),
        divergentRestart.ports,
      ),
    ).not.toBe(0);

    const duplicate = next(restarted);
    expect(await runCommandLine(argv, duplicate.ports)).toBe(0);
    expect(settled(duplicate).files).toEqual(files);

    const atPlan = await advance(
      next(duplicate, {
        [SPEC]:
          "# Design\n\nCorrected specification with fresh acceptance semantics.\n",
      }),
      SPEC,
      "# Design\n\nCorrected specification with fresh acceptance semantics.\n",
      "restart-spec",
    );
    const oldCriteriaRecorded = await evidence(
      next(atPlan, { [TASKS]: TASK_DOCUMENT_REUSING_ONLY_CODE_STOP }),
      TASKS,
      "restart-old-criteria",
    );
    const beforeRefusal = settled(oldCriteriaRecorded).files;
    expect(
      await runCommandLine(
        [
          "continue",
          "--complete",
          "--artifact",
          TASKS,
          "--evidence",
          TASKS,
          "--correlation-id",
          "reuse-retired-criteria",
        ],
        oldCriteriaRecorded.ports,
      ),
    ).toBe(3);
    expect(settled(oldCriteriaRecorded).files).toEqual(beforeRefusal);
    expect(oldCriteriaRecorded.output.human_.join(" ")).toContain(
      "gate.ac_identifier_duplicate",
    );
  });
});
