import type {
  GateFactsV1,
  OperationResultV1,
  PhaseHandoffV1_2,
  RunUsageV1,
} from "@kratos/contracts";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import type { PhaseMeasurement } from "@kratos/runtime/domain/measurements";
import { STOCK_GOTCHAS_TEMPLATE } from "@kratos/runtime/domain/memory";
import {
  fixedClock,
  fixedEnvironment,
  fixedModelRouting,
  memoryTransactionStorage,
  memoryWorkspace,
  pipedInput,
  recordingOutput,
  sequentialIds,
  stubGit,
} from "@kratos/runtime/infra/fake";
import type { RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

import { codexCatalog, roleConfig } from "./support/model-routing.js";

const ROOT = "/project";
const START = "2026-08-30T12:00:00.000Z";
const SAMPLE = "2026-08-30T12:01:00.000Z";
const END = "2026-08-30T12:03:00.000Z";
const LATER = "2026-08-30T12:04:00.000Z";
const AFTER = "2026-08-30T12:05:00.000Z";
const DELAYED = "2026-08-30T12:06:00.000Z";
const REFRESH = "2026-08-30T12:07:00.000Z";
const FINAL = "2026-08-30T12:08:00.000Z";
const COMPLETED = "2026-08-30T12:09:00.000Z";
const ROLLUP = "2026-08-30T12:10:00.000Z";
const LOG = ".brain/03-memory/task_log.jsonl";
const COMPLETE_PRD = `# Requirements

## Problem

Completed Problem.

## Affected users

Completed Affected users.

## Goals

Completed Goals.

## Non-goals

Completed Non-goals.

## Scope boundary

Completed Scope boundary.

## Success metrics

Completed Success metrics.

## Open questions

None.

## Problem discovery (5 Whys)

Completed Problem discovery.

## Action framing (5W2H)

Completed Action framing.
`;
const TASKS = [
  "# Tasks",
  "",
  "## Ordered work",
  "",
  "### Work unit 1: Runtime",
  "",
  "#### Task 1.1: Measure phases",
  "",
  "##### Files",
  "",
  "- `packages/runtime`",
  "",
  "##### Acceptance criteria",
  "",
  "- [ ] AC-1.1.1: Phase usage is measured.",
  "",
  "##### Edge cases",
  "",
  "- [ ] AC-1.1.E1: Repeated samples are deduplicated.",
  "",
  "## Out of scope",
  "",
  "- Pricing.",
].join("\n");

interface RuntimeSubject {
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
  readonly ports: RuntimePorts;
}

function clearOutput(subject: RuntimeSubject): void {
  (subject.output.structured_ as string[]).splice(0);
  (subject.output.human_ as string[]).splice(0);
}

function subject(): RuntimeSubject {
  const baseCatalog = codexCatalog();
  const catalog = {
    ...baseCatalog,
    defaults: {
      ...baseCatalog.defaults,
      implementer: { model: "codex-implementation", effort: "high" },
    },
    models: baseCatalog.models.map((entry) =>
      entry.canonicalModel === "implementer-canonical"
        ? { ...entry, canonicalModel: "codex-implementation" }
        : entry,
    ),
  };
  const storage = memoryTransactionStorage({
    files: {
      ".brain/03-memory/gotchas.md": STOCK_GOTCHAS_TEMPLATE,
      ".brain/config.json": JSON.stringify({
        ...roleConfig("codex", {
          planner: "planner-alias",
          implementer: { model: "impl-alias", effort: "high" },
          judge: "judge-alias",
        }),
        policyMode: "standard",
      }),
    },
    directories: [".brain", ".brain/transactions"],
  });
  const output = recordingOutput();
  const ports: RuntimePorts = {
    clock: fixedClock(START),
    ids: sequentialIds("measurement"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    fileSystem: storage.fileSystem,
    git: stubGit(),
    locks: {} as RuntimePorts["locks"],
    modelRouting: fixedModelRouting([catalog]),
    environment: fixedEnvironment({ KRATOS_HOST: "codex" }, ROOT),
    output,
    standardInput: pipedInput(null),
    targetInspector: {
      capture: () =>
        Promise.resolve({
          inspect: (path) =>
            Promise.resolve({
              kind: "inside",
              lexicalPath: path,
              canonicalPath: path,
            }),
        }),
    },
    workspace: memoryWorkspace({ directories: [ROOT] }),
  };
  return { storage, output, ports };
}

function portsAt(
  run: RuntimeSubject,
  now: string,
  standardInput: string | null = null,
  base: RuntimePorts = run.ports,
): RuntimePorts {
  return {
    ...base,
    clock: fixedClock(now),
    standardInput: pipedInput(standardInput),
  };
}

async function result(
  run: RuntimeSubject,
  argv: readonly string[],
  ports: RuntimePorts = run.ports,
): Promise<OperationResultV1> {
  clearOutput(run);
  await runCommandLine(["--json", ...argv], ports);
  return JSON.parse(run.output.structured_.join("")) as OperationResultV1;
}

async function started(): Promise<RuntimeSubject> {
  const run = subject();
  expect(await result(run, ["objective", "Measure phase usage"])).toMatchObject(
    { reasonCode: "trail.ok" },
  );
  expect(
    await result(run, [
      "start",
      "--run-id",
      "run-01",
      "--correlation-id",
      "run-start-01",
    ]),
  ).toMatchObject({ reasonCode: "trail.ok" });
  return run;
}

async function handoff(
  run: RuntimeSubject,
  ports: RuntimePorts = run.ports,
): Promise<PhaseHandoffV1_2> {
  clearOutput(run);
  expect(
    await runCommandLine(["--json", "handoff"], ports),
    `${run.output.human_.join("")} ${run.output.structured_.join("")}`,
  ).toBe(0);
  return JSON.parse(run.output.structured_.join("")) as PhaseHandoffV1_2;
}

async function relay(
  run: RuntimeSubject,
  observation: Readonly<Record<string, unknown>>,
  suffix: string,
  now: string,
  ports: RuntimePorts = run.ports,
): Promise<OperationResultV1> {
  const sessionId =
    typeof observation.sessionId === "string"
      ? observation.sessionId
      : "session-code";
  const artifact = `.brain/03-memory/.cache/hooks/${sessionId}/${suffix}.json`;
  const content = `${JSON.stringify(observation, null, 2)}\n`;
  await run.ports.fileSystem.write(artifact, content);
  const hook = String(observation.kind);
  const message = {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    messageId: `message-${suffix}`,
    correlationId:
      typeof observation.correlationId === "string"
        ? observation.correlationId
        : `relay-${suffix}`,
    operationId: `operation-${suffix}`,
    sequence: 1,
    occurredAt: now,
    kind: "hook",
    payload: {
      host: "codex",
      hook,
      phase:
        hook === "phase.start" || hook === "tool.before" ? "before" : "after",
      artifact: { ref: artifact, sha256: run.ports.digests.sha256(content) },
    },
  };
  return result(
    run,
    ["hook", "--host", "codex"],
    portsAt(run, now, JSON.stringify(message), ports),
  );
}

async function startPhase(
  run: RuntimeSubject,
  sessionId: string,
  now = START,
  ports: RuntimePorts = run.ports,
): Promise<OperationResultV1> {
  const current = await handoff(run, ports);
  return relay(
    run,
    {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind: "phase.start",
      sessionId,
      correlationId: `start-${sessionId}`,
      occurredAt: now,
      assignmentDigest: current.assignmentDigest,
    },
    `start-${sessionId}`,
    now,
    ports,
  );
}

async function samplePhase(
  run: RuntimeSubject,
  sessionId: string,
  cumulativeGrossTokens: number,
  suffix: string,
  now: string,
  kind: "session.sample" | "session.end" = "session.sample",
  deliveredAt = now,
): Promise<OperationResultV1> {
  return relay(
    run,
    {
      contractVersion: "1.0.0",
      hostContract: "1.0.0",
      kind,
      sessionId,
      occurredAt: now,
      usage: { cumulativeGrossTokens },
    },
    suffix,
    deliveredAt,
  );
}

function records(run: RuntimeSubject): readonly PhaseMeasurement[] {
  const text = run.storage.snapshot().files[LOG] ?? "";
  return text === ""
    ? []
    : text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as PhaseMeasurement);
}

function usage(run: RuntimeSubject): RunUsageV1 {
  return usageFor(run, "run-01");
}

function usageFor(run: RuntimeSubject, runId: string): RunUsageV1 {
  const path = `.brain/02-features/measure-phase-usage/runs/${runId}/usage.json`;
  return JSON.parse(run.storage.snapshot().files[path] ?? "") as RunUsageV1;
}

function gatesFor(run: RuntimeSubject, runId: string): GateFactsV1 {
  const path = `.brain/02-features/measure-phase-usage/runs/${runId}/gates.json`;
  return JSON.parse(run.storage.snapshot().files[path] ?? "") as GateFactsV1;
}

function stopLossFor(
  run: RuntimeSubject,
  runId: string,
): GateFactsV1["stopLoss"] {
  const path = `.brain/02-features/measure-phase-usage/runs/${runId}/gates.json`;
  const content = run.storage.snapshot().files[path];
  return content === undefined
    ? { tripped: false, exhausted: false }
    : (JSON.parse(content) as GateFactsV1).stopLoss;
}

async function switchToEmptyRun(
  run: RuntimeSubject,
  runId: string,
): Promise<void> {
  const previousUsage = usage(run);
  const previousGatesPath =
    ".brain/02-features/measure-phase-usage/runs/run-01/gates.json";
  const previousGatesContent = run.storage.snapshot().files[previousGatesPath];
  const previousGates: GateFactsV1 =
    previousGatesContent === undefined
      ? {
          contractVersion: "1.0.0",
          stateContract: "1.0.0",
          runId: "run-01",
          openGaps: 0,
          openGapIds: [],
          stopLoss: { tripped: false, exhausted: false },
          partitionRequired: false,
          partitionApproved: true,
          derivedAt: LATER,
        }
      : (JSON.parse(previousGatesContent) as GateFactsV1);
  await run.ports.fileSystem.write(
    `.brain/02-features/measure-phase-usage/runs/${runId}/usage.json`,
    `${JSON.stringify(
      {
        ...previousUsage,
        runId,
        totalGrossTokens: 0,
        epoch: {
          number: 1,
          baselineGrossTokens: 0,
          exhaustedAt: null,
        },
        sessions: [],
        measurementFaultAt: null,
        updatedAt: LATER,
      } satisfies RunUsageV1,
      null,
      2,
    )}\n`,
  );
  await run.ports.fileSystem.write(
    `.brain/02-features/measure-phase-usage/runs/${runId}/gates.json`,
    `${JSON.stringify(
      {
        ...previousGates,
        runId,
        stopLoss: { tripped: false, exhausted: false },
        derivedAt: LATER,
      } satisfies GateFactsV1,
      null,
      2,
    )}\n`,
  );
  await run.ports.fileSystem.write(
    ".brain/02-features/measure-phase-usage/active-run",
    `${runId}\n`,
  );
}

async function setTokenBudget(
  run: RuntimeSubject,
  tokens: number,
): Promise<void> {
  const path = ".brain/02-features/measure-phase-usage/state.json";
  const state = JSON.parse(
    run.storage.snapshot().files[path] ?? "",
  ) as Readonly<Record<string, unknown>> & {
    readonly objective: Readonly<Record<string, unknown>>;
  };
  await run.ports.fileSystem.write(
    path,
    `${JSON.stringify(
      { ...state, objective: { ...state.objective, budget: { tokens } } },
      null,
      2,
    )}\n`,
  );
}

async function completeCurrentPhase(
  run: RuntimeSubject,
  index: number,
  now = END,
): Promise<OperationResultV1> {
  const artifacts = [
    [".brain/02-features/measure-phase-usage/00-prd.md", COMPLETE_PRD],
    [".brain/02-features/measure-phase-usage/01-design.md", "# Design\n"],
    [".brain/02-features/measure-phase-usage/02-tasks.md", TASKS],
    [
      ".brain/02-features/measure-phase-usage/code-summary.md",
      "Code complete.\n",
    ],
  ] as const;
  const selected = artifacts[index];
  if (selected === undefined) throw new Error("Missing phase artifact fixture");
  const [ref, content] = selected;
  await run.ports.fileSystem.write(ref, content);
  expect(
    await result(
      run,
      [
        "evidence",
        "record",
        ref,
        "--correlation-id",
        `evidence-${String(index)}`,
      ],
      portsAt(run, now),
    ),
  ).toMatchObject({ reasonCode: "trail.ok" });
  return result(
    run,
    [
      "continue",
      "--complete",
      "--artifact",
      ref,
      "--evidence",
      ref,
      "--correlation-id",
      `complete-${String(index)}`,
    ],
    portsAt(run, now),
  );
}

async function prepareCheckpointedRunningSecondPhase(
  run: RuntimeSubject,
): Promise<string> {
  await setTokenBudget(run, 100);
  await startPhase(run, "session-shared");
  await samplePhase(run, "session-shared", 40, "shared-a", SAMPLE);
  await completeCurrentPhase(run, 0);
  await startPhase(run, "session-shared", LATER);
  await samplePhase(run, "session-shared", 75, "shared-b", AFTER);
  await samplePhase(
    run,
    "session-shared",
    45,
    "shared-delayed-a",
    "2026-08-30T12:02:00.000Z",
    "session.sample",
    REFRESH,
  );
  const raw = run.storage.snapshot().files[LOG];
  if (raw === undefined) throw new Error("Missing checkpointed measurements");
  return raw;
}

async function recordForgedCodeReply(
  run: RuntimeSubject,
): Promise<OperationResultV1> {
  const current = await handoff(run);
  const ref = ".brain/agent-replies/code.md";
  const reply = `role: judge
model: forged-model
effort: low

===KRATOS-AGENT-OUTPUT-V1===
${JSON.stringify(
  {
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
    memory: current.memory,
    payload: { stepId: "measure-phases", testsAdded: 7, testsPassed: true },
  },
  null,
  2,
)}
===END-KRATOS-AGENT-OUTPUT-V1===
`;
  await run.ports.fileSystem.write(ref, reply);
  const correlationId = "agent-code-01";
  const message = {
    contractVersion: "1.1.0",
    hostContract: "1.1.0",
    messageId: "agent-code-message-01",
    messageType: "request",
    host: "codex",
    operation: `sdd.agent.record:${correlationId}`,
    capabilities: [],
    observedIdentity: {
      adapterVersion: "1.1.0",
      model: "codex-implementation",
      effort: "high",
    },
    payloadContract: "host.agent-output@1.2.0",
    payload: { ref, sha256: run.ports.digests.sha256(reply) },
    phaseExecution: {
      assignmentDigest: current.assignmentDigest,
      model: "codex-implementation",
      effort: "high",
    },
    correlationId,
  };
  return result(
    run,
    ["agent", "record", ref, "--correlation-id", correlationId],
    portsAt(run, LATER, JSON.stringify(message)),
  );
}

async function enterCodePhase(run: RuntimeSubject): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await startPhase(run, `session-${String(index)}`, START);
    expect(await completeCurrentPhase(run, index)).toMatchObject({
      reasonCode: "trail.ok",
    });
  }
  await startPhase(run, "session-code", LATER);
}

describe("phase measurement runtime lifecycle", () => {
  it("closes an over-budget measured phase and latches stop-loss in the same lifecycle", async () => {
    const run = await started();
    await setTokenBudget(run, 100);
    await startPhase(run, "session-budgeted");

    expect(
      await samplePhase(
        run,
        "session-budgeted",
        125,
        "over-budget-end",
        END,
        "session.end",
      ),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });

    expect(records(run)).toEqual([
      expect.objectContaining({
        status: "interrupted",
        endedAt: END,
        finalGrossTokens: 125,
        grossTokens: 125,
        closeReason: "session_interrupted",
        resolvedAssignment: {
          host: "codex",
          role: "planner",
          model: "planner-canonical",
          effort: "medium",
        },
      }),
    ]);
    expect(usage(run)).toMatchObject({
      totalGrossTokens: 125,
      epoch: { exhaustedAt: END },
    });
    const gates = JSON.parse(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/gates.json"
      ] ?? "",
    ) as GateFactsV1;
    expect(gates.stopLoss).toEqual({ tripped: false, exhausted: true });
  });

  it("reports validated measured usage numerically without inventing legacy zero", async () => {
    const unmeasured = await started();
    expect((await result(unmeasured, ["budgets"])).why).toContain(
      "Used: unknown",
    );
    await unmeasured.ports.fileSystem.write(
      ".brain/02-features/measure-phase-usage/runs/run-01/usage.json",
      "{not-json}\n",
    );
    expect((await result(unmeasured, ["budgets"])).why).toContain(
      "Used: unknown",
    );

    const run = await started();
    await startPhase(run, "session-prd");
    await samplePhase(run, "session-prd", 40, "numeric-usage", SAMPLE);
    await completeCurrentPhase(run, 0);

    expect((await result(run, ["budgets"])).why).toContain("Used: 40");
    expect(await result(run, ["evidence", "bundle"])).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });
    const bundle = JSON.parse(
      run.storage.snapshot().files[".brain/evidence/run-01-bundle.json"] ?? "",
    ) as { readonly budget: { readonly used: number | null } };
    expect(bundle.budget.used).toBe(40);
  });

  it("starts one runtime-resolved record and physically deduplicates its retry", async () => {
    const run = await started();

    expect(await startPhase(run, "session-prd")).toMatchObject({
      reasonCode: "trail.ok",
    });
    const firstBytes = run.storage.snapshot().files[LOG];
    expect(await startPhase(run, "session-prd")).toMatchObject({
      exitCode: 0,
    });

    expect(run.storage.snapshot().files[LOG]).toBe(firstBytes);
    expect(records(run)).toHaveLength(1);
    expect(records(run)[0]).toMatchObject({
      feature: "measure-phase-usage",
      runId: "run-01",
      phase: "prd",
      status: "running",
      contributorCheckpoints: [],
      resolvedAssignment: {
        host: "codex",
        role: "planner",
        model: "planner-canonical",
        effort: "medium",
      },
    });
    expect(
      run.storage.snapshot().files[".brain/03-memory/task_metrics.md"],
    ).toBeUndefined();
  });

  it("refuses a phase start bound to a different assignment", async () => {
    const run = await started();

    expect(
      await relay(
        run,
        {
          contractVersion: "1.0.0",
          hostContract: "1.0.0",
          kind: "phase.start",
          sessionId: "session-conflict",
          correlationId: "start-session-conflict",
          occurredAt: START,
          assignmentDigest: "f".repeat(64),
        },
        "assignment-conflict",
        START,
      ),
    ).toMatchObject({
      reasonCode: "metrics.phase_assignment_conflict",
      stateChanged: false,
    });
    expect(records(run)).toEqual([]);
  });

  it("samples usage into the same physical record and no-ops a repeated total", async () => {
    const run = await started();
    await startPhase(run, "session-prd");

    expect(
      await samplePhase(run, "session-prd", 40, "sample-one", SAMPLE),
    ).toMatchObject({ reasonCode: "trail.ok" });
    const firstBytes = run.storage.snapshot().files[LOG];
    expect(
      await samplePhase(run, "session-prd", 40, "sample-retry", SAMPLE),
    ).toMatchObject({ exitCode: 0 });
    const sampledBytes = run.storage.snapshot().files[LOG];

    expect(await startPhase(run, "session-prd")).toMatchObject({ exitCode: 0 });

    expect(firstBytes).toBe(sampledBytes);
    expect(run.storage.snapshot().files[LOG]).toBe(sampledBytes);
    expect(records(run)).toHaveLength(1);
    expect(records(run)[0]).toMatchObject({
      status: "running",
      baselineGrossTokens: 0,
      grossTokens: 40,
      updatedAt: SAMPLE,
    });
    expect(usage(run).totalGrossTokens).toBe(40);
  });

  it("completes from a claimed subagent without a direct launcher hook and retains it through refresh", async () => {
    const run = await started();
    await setTokenBudget(run, 100);
    await startPhase(run, "session-principal");

    expect(
      await samplePhase(run, "session-subagent", 20, "subagent-first", SAMPLE),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });
    expect(records(run)[0]).toMatchObject({
      status: "running",
      grossTokens: 20,
      contributingSessionIds: ["session-principal", "session-subagent"],
      contributorCheckpoints: [
        {
          sessionId: "session-subagent",
          cumulativeGrossTokens: 20,
          occurredAt: SAMPLE,
        },
      ],
    });
    expect(usage(run)).toMatchObject({
      totalGrossTokens: 20,
      sessions: [{ sessionId: "session-subagent", cumulativeGrossTokens: 20 }],
    });
    const claimedRaw = run.storage.snapshot().files[LOG];

    await samplePhase(run, "session-subagent", 20, "subagent-repeated", END);
    await samplePhase(run, "session-subagent", 10, "subagent-regressed", LATER);
    expect(run.storage.snapshot().files[LOG]).toBe(claimedRaw);
    expect(usage(run).totalGrossTokens).toBe(20);

    expect(await completeCurrentPhase(run, 0, AFTER)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });
    expect(
      await result(run, ["metrics", "refresh"], portsAt(run, DELAYED)),
    ).toMatchObject({ reasonCode: "metrics.calibration_insufficient" });
    expect(records(run)[0]).toMatchObject({
      status: "completed",
      finalGrossTokens: 20,
      grossTokens: 20,
      contributingSessionIds: ["session-principal", "session-subagent"],
      contributorCheckpoints: [
        {
          sessionId: "session-subagent",
          cumulativeGrossTokens: 20,
          occurredAt: SAMPLE,
        },
      ],
    });
    expect(
      run.storage.snapshot().files[".brain/03-memory/task_metrics.md"],
    ).toContain(
      "| prd | 1 | 0 | measure-phase-usage/run-01 | 20 | 20 | 20 | 20 |",
    );
  });

  it("refuses a 257th contributor before publishing usage, gates, measurements, or telemetry", async () => {
    const run = await started();
    await startPhase(run, "session-principal");
    const open = records(run)[0];
    if (open === undefined) throw new Error("Missing running measurement");
    const fullContributors = [
      open.sessionId,
      ...Array.from(
        { length: 255 },
        (_, index) => `session-capacity-${String(index).padStart(3, "0")}`,
      ),
    ].sort((left, right) => left.localeCompare(right, "en-US"));
    const fullRaw = `${JSON.stringify({
      ...open,
      contributingSessionIds: fullContributors,
    })}\n`;
    await run.ports.fileSystem.write(LOG, fullRaw);
    const usagePath =
      ".brain/02-features/measure-phase-usage/runs/run-01/usage.json";
    const gatesPath =
      ".brain/02-features/measure-phase-usage/runs/run-01/gates.json";

    expect(
      await samplePhase(
        run,
        "session-capacity-overflow",
        20,
        "capacity-overflow",
        SAMPLE,
      ),
    ).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
      evidence: [{ ref: LOG }],
    });
    expect(run.storage.snapshot().files[LOG]).toBe(fullRaw);
    expect(run.storage.snapshot().files[usagePath]).toBeUndefined();
    expect(run.storage.snapshot().files[gatesPath]).toBeUndefined();
    expect(
      run.storage.snapshot().files[
        ".brain/03-memory/.cache/hooks/session-capacity-overflow/telemetry.json"
      ],
    ).toBeUndefined();
    expect(
      run.storage.snapshot().files[
        ".brain/03-memory/telemetry/session-capacity-overflow.json"
      ],
    ).toBeUndefined();
  });

  it("refuses a 257th phase-start contributor without throwing or publishing state", async () => {
    const run = await started();
    await startPhase(run, "session-principal");
    const open = records(run)[0];
    if (open === undefined) throw new Error("Missing running measurement");
    const fullContributors = [
      open.sessionId,
      ...Array.from(
        { length: 255 },
        (_, index) => `session-capacity-${String(index).padStart(3, "0")}`,
      ),
    ].sort((left, right) => left.localeCompare(right, "en-US"));
    const fullRaw = `${JSON.stringify({
      ...open,
      contributingSessionIds: fullContributors,
    })}\n`;
    await run.ports.fileSystem.write(LOG, fullRaw);

    expect(
      await startPhase(run, "session-capacity-overflow", SAMPLE),
    ).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
      evidence: [{ ref: LOG }],
    });
    expect(run.storage.snapshot().files[LOG]).toBe(fullRaw);
  });

  it("reallocates an out-of-order launcher checkpoint across completed phases", async () => {
    const run = await started();
    await setTokenBudget(run, 100);
    await startPhase(run, "session-shared");
    await samplePhase(run, "session-shared", 40, "shared-a", SAMPLE);
    await completeCurrentPhase(run, 0);
    expect(await startPhase(run, "session-shared", LATER)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });

    expect(
      await samplePhase(run, "session-shared", 75, "shared-current-b", AFTER),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });
    expect(
      await samplePhase(
        run,
        "session-shared",
        45,
        "shared-delayed-a",
        "2026-08-30T12:02:00.000Z",
        "session.sample",
        REFRESH,
      ),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });
    const reallocatedRaw = run.storage.snapshot().files[LOG];
    await samplePhase(
      run,
      "session-shared",
      45,
      "shared-delayed-a-repeated",
      "2026-08-30T12:02:30.000Z",
      "session.sample",
      FINAL,
    );
    await samplePhase(
      run,
      "session-shared",
      35,
      "shared-delayed-a-regressed",
      "2026-08-30T12:02:40.000Z",
      "session.sample",
      FINAL,
    );
    expect(run.storage.snapshot().files[LOG]).toBe(reallocatedRaw);
    expect(await completeCurrentPhase(run, 1, COMPLETED)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });

    expect(records(run).find(({ phase }) => phase === "prd")).toMatchObject({
      status: "completed",
      grossTokens: 45,
      finalGrossTokens: 45,
      endedAt: END,
      contributorCheckpoints: [
        {
          sessionId: "session-shared",
          cumulativeGrossTokens: 45,
          occurredAt: "2026-08-30T12:02:00.000Z",
        },
      ],
    });
    expect(records(run).find(({ phase }) => phase === "spec")).toMatchObject({
      status: "completed",
      grossTokens: 30,
      finalGrossTokens: 70,
      endedAt: COMPLETED,
      contributorCheckpoints: [
        {
          sessionId: "session-shared",
          cumulativeGrossTokens: 75,
          occurredAt: AFTER,
        },
      ],
    });
    expect(usage(run).totalGrossTokens).toBe(75);
    expect(
      records(run).reduce((sum, record) => sum + record.grossTokens, 0),
    ).toBe(75);
    expect(
      await result(run, ["metrics", "refresh"], portsAt(run, ROLLUP)),
    ).toMatchObject({ reasonCode: "metrics.calibration_insufficient" });
    expect(
      run.storage.snapshot().files[".brain/03-memory/task_metrics.md"],
    ).toContain(
      "| spec | 1 | 0 | measure-phase-usage/run-01 | 30 | 30 | 30 | 30 |",
    );
  });

  it("next phase start recovers accepted checkpointed work without inflating its phase", async () => {
    const run = await started();
    const stale = await prepareCheckpointedRunningSecondPhase(run);
    await completeCurrentPhase(run, 1, COMPLETED);
    await run.ports.fileSystem.write(LOG, stale);

    expect(await startPhase(run, "session-plan", ROLLUP)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });

    expect(records(run).find(({ phase }) => phase === "spec")).toMatchObject({
      status: "completed",
      endedAt: COMPLETED,
      finalGrossTokens: 70,
      grossTokens: 30,
      closeReason: "recovered_completed",
      updatedAt: ROLLUP,
    });
    expect(records(run).find(({ phase }) => phase === "plan")).toMatchObject({
      status: "running",
      baselineGrossTokens: 75,
      grossTokens: 0,
    });
    expect(
      records(run)
        .filter(({ runId }) => runId === "run-01")
        .reduce((sum, record) => sum + record.grossTokens, 0),
    ).toBe(75);
  });

  it("next phase start interrupts checkpointed work from another run without inflation", async () => {
    const run = await started();
    await prepareCheckpointedRunningSecondPhase(run);
    const previous = records(run).map((record) => ({
      ...record,
      feature: "previous-feature",
      runId: "run-previous",
    }));
    const priorRaw = previous
      .map((record) => JSON.stringify(record))
      .join("\n");
    await run.ports.fileSystem.write(LOG, `${priorRaw}\n`);
    await run.ports.fileSystem.write(
      ".brain/02-features/previous-feature/runs/run-previous/usage.json",
      `${JSON.stringify({
        ...usage(run),
        runId: "run-previous",
      })}\n`,
    );

    expect(await startPhase(run, "session-current", ROLLUP)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });

    const previousRecords = records(run).filter(
      ({ runId }) => runId === "run-previous",
    );
    expect(previousRecords.find(({ phase }) => phase === "spec")).toMatchObject(
      {
        status: "interrupted",
        endedAt: ROLLUP,
        finalGrossTokens: 70,
        grossTokens: 30,
        closeReason: "recovered_interrupted",
      },
    );
    expect(
      previousRecords.reduce((sum, record) => sum + record.grossTokens, 0),
    ).toBe(75);
  });

  it("refuses next-start recovery atomically when run usage is below attributed work", async () => {
    const run = await started();
    await prepareCheckpointedRunningSecondPhase(run);
    const previous = records(run).map((record) => ({
      ...record,
      feature: "previous-feature",
      runId: "run-previous",
    }));
    const priorRaw = `${previous.map((record) => JSON.stringify(record)).join("\n")}\n`;
    await run.ports.fileSystem.write(LOG, priorRaw);
    await run.ports.fileSystem.write(
      ".brain/02-features/previous-feature/runs/run-previous/usage.json",
      `${JSON.stringify({
        ...usage(run),
        runId: "run-previous",
        totalGrossTokens: 74,
        sessions: [{ sessionId: "session-shared", cumulativeGrossTokens: 74 }],
      })}\n`,
    );
    const priorCurrentEvents =
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/events.jsonl"
      ];

    expect(await startPhase(run, "session-current", ROLLUP)).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
    });
    expect(run.storage.snapshot().files[LOG]).toBe(priorRaw);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/events.jsonl"
      ],
    ).toBe(priorCurrentEvents);
  });

  it("selects and claims an active-run phase ahead of a historical non-launcher owner", async () => {
    const run = await started();
    await setTokenBudget(run, 100);
    await startPhase(run, "session-a");
    await samplePhase(run, "session-subagent", 20, "subagent-a", SAMPLE);
    await completeCurrentPhase(run, 0);
    const first = records(run)[0];
    if (first === undefined) throw new Error("Missing first measurement");
    await switchToEmptyRun(run, "run-02");
    const second = {
      ...first,
      runId: "run-02",
      phase: "spec" as const,
      sessionId: "session-b",
      contributingSessionIds: ["session-b"],
      contributorCheckpoints: [],
      correlationId: "start-session-b",
      status: "running" as const,
      startedAt: LATER,
      endedAt: null,
      durationMs: null,
      baselineGrossTokens: 0,
      finalGrossTokens: null,
      grossTokens: 0,
      observedIdentity: { model: null, effort: null },
      closeReason: null,
      updatedAt: LATER,
    };
    await run.ports.fileSystem.write(
      LOG,
      `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`,
    );

    expect(
      await samplePhase(
        run,
        "session-subagent",
        30,
        "subagent-active-b",
        AFTER,
        "session.sample",
        REFRESH,
      ),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });
    const runTwoUsage =
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/usage.json"
      ];
    const runTwoGates =
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/gates.json"
      ];
    expect(
      await samplePhase(
        run,
        "session-subagent",
        25,
        "subagent-historical-a",
        "2026-08-30T12:02:00.000Z",
        "session.sample",
        FINAL,
      ),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });

    expect(records(run).find(({ runId }) => runId === "run-01")).toMatchObject({
      status: "completed",
      grossTokens: 25,
      finalGrossTokens: 25,
      contributorCheckpoints: [
        {
          sessionId: "session-subagent",
          cumulativeGrossTokens: 25,
          occurredAt: "2026-08-30T12:02:00.000Z",
        },
      ],
    });
    expect(records(run).find(({ runId }) => runId === "run-02")).toMatchObject({
      status: "running",
      grossTokens: 30,
      contributingSessionIds: ["session-b", "session-subagent"],
      contributorCheckpoints: [
        {
          sessionId: "session-subagent",
          cumulativeGrossTokens: 30,
          occurredAt: AFTER,
        },
      ],
    });
    expect(usageFor(run, "run-01").totalGrossTokens).toBe(25);
    expect(usageFor(run, "run-02").totalGrossTokens).toBe(30);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/usage.json"
      ],
    ).toBe(runTwoUsage);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/gates.json"
      ],
    ).toBe(runTwoGates);
  });

  it("reallocates only an out-of-order subagent while preserving principal contributions", async () => {
    const run = await started();
    await setTokenBudget(run, 100);
    await startPhase(run, "session-a");
    await samplePhase(
      run,
      "session-a",
      10,
      "principal-a",
      "2026-08-30T12:00:30.000Z",
    );
    await samplePhase(run, "session-subagent", 20, "subagent-a", SAMPLE);
    await completeCurrentPhase(run, 0);
    await startPhase(run, "session-b", LATER);
    await samplePhase(run, "session-b", 15, "principal-b", AFTER);
    await samplePhase(run, "session-subagent", 50, "subagent-b", DELAYED);

    expect(
      await samplePhase(
        run,
        "session-subagent",
        25,
        "subagent-delayed-a",
        "2026-08-30T12:02:00.000Z",
        "session.sample",
        REFRESH,
      ),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });
    const reallocatedRaw = run.storage.snapshot().files[LOG];
    await samplePhase(
      run,
      "session-subagent",
      25,
      "subagent-delayed-a-repeated",
      "2026-08-30T12:02:30.000Z",
      "session.sample",
      FINAL,
    );
    await samplePhase(
      run,
      "session-subagent",
      15,
      "subagent-delayed-a-regressed",
      "2026-08-30T12:02:40.000Z",
      "session.sample",
      FINAL,
    );
    expect(run.storage.snapshot().files[LOG]).toBe(reallocatedRaw);
    await completeCurrentPhase(run, 1, COMPLETED);

    expect(records(run).find(({ phase }) => phase === "prd")).toMatchObject({
      grossTokens: 35,
      contributorCheckpoints: [
        {
          sessionId: "session-a",
          cumulativeGrossTokens: 10,
          occurredAt: "2026-08-30T12:00:30.000Z",
        },
        {
          sessionId: "session-subagent",
          cumulativeGrossTokens: 25,
          occurredAt: "2026-08-30T12:02:00.000Z",
        },
      ],
    });
    expect(records(run).find(({ phase }) => phase === "spec")).toMatchObject({
      grossTokens: 40,
      contributorCheckpoints: [
        {
          sessionId: "session-b",
          cumulativeGrossTokens: 15,
          occurredAt: AFTER,
        },
        {
          sessionId: "session-subagent",
          cumulativeGrossTokens: 50,
          occurredAt: DELAYED,
        },
      ],
    });
    expect(usage(run)).toMatchObject({
      totalGrossTokens: 75,
      sessions: [
        { sessionId: "session-a", cumulativeGrossTokens: 10 },
        { sessionId: "session-b", cumulativeGrossTokens: 15 },
        { sessionId: "session-subagent", cumulativeGrossTokens: 50 },
      ],
    });
    expect(
      records(run).reduce((sum, record) => sum + record.grossTokens, 0),
    ).toBe(75);
  });

  it("fails closed when a later phase checkpoint contradicts chronological cumulative usage", async () => {
    const run = await started();
    await setTokenBudget(run, 200);
    await startPhase(run, "session-shared");
    await samplePhase(run, "session-shared", 80, "shared-a", SAMPLE);
    await completeCurrentPhase(run, 0);
    await startPhase(run, "session-shared", LATER);
    const priorRaw = run.storage.snapshot().files[LOG];
    const usagePath =
      ".brain/02-features/measure-phase-usage/runs/run-01/usage.json";
    const gatesPath =
      ".brain/02-features/measure-phase-usage/runs/run-01/gates.json";
    const cachePath =
      ".brain/03-memory/.cache/hooks/session-shared/telemetry.json";
    const priorUsage = run.storage.snapshot().files[usagePath];
    const priorGates = run.storage.snapshot().files[gatesPath];
    const priorCache = run.storage.snapshot().files[cachePath];

    expect(
      await samplePhase(run, "session-shared", 75, "contradictory-b", AFTER),
    ).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
      evidence: [{ ref: LOG }],
    });
    expect(run.storage.snapshot().files[LOG]).toBe(priorRaw);
    expect(run.storage.snapshot().files[usagePath]).toBe(priorUsage);
    expect(run.storage.snapshot().files[gatesPath]).toBe(priorGates);
    expect(run.storage.snapshot().files[cachePath]).toBe(priorCache);
    expect(
      run.storage.snapshot().files[
        ".brain/03-memory/telemetry/session-shared.json"
      ],
    ).toBeUndefined();
  });

  it("routes a delayed contributing subagent final to its old phase and run", async () => {
    const run = await started();
    await setTokenBudget(run, 55);
    await startPhase(run, "session-a");
    await samplePhase(run, "session-subagent", 20, "subagent-first", SAMPLE);
    await completeCurrentPhase(run, 0);
    await startPhase(run, "session-b", LATER);
    await samplePhase(run, "session-b", 30, "session-b-sample", AFTER);
    await switchToEmptyRun(run, "run-02");
    const newUsage =
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/usage.json"
      ];
    const newGates =
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/gates.json"
      ];

    expect(
      await samplePhase(
        run,
        "session-subagent",
        25,
        "subagent-delayed-final",
        FINAL,
        "session.end",
      ),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });

    expect(usageFor(run, "run-01")).toMatchObject({
      totalGrossTokens: 55,
      sessions: [
        { sessionId: "session-b", cumulativeGrossTokens: 30 },
        { sessionId: "session-subagent", cumulativeGrossTokens: 25 },
      ],
      epoch: { exhaustedAt: FINAL },
    });
    expect(records(run).find(({ phase }) => phase === "prd")).toMatchObject({
      status: "completed",
      grossTokens: 25,
      finalGrossTokens: 25,
      contributingSessionIds: ["session-a", "session-subagent"],
    });
    expect(records(run).find(({ phase }) => phase === "spec")).toMatchObject({
      status: "running",
      grossTokens: 30,
      contributingSessionIds: ["session-b"],
    });
    expect(
      records(run).reduce((sum, record) => sum + record.grossTokens, 0),
    ).toBe(55);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/usage.json"
      ],
    ).toBe(newUsage);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/gates.json"
      ],
    ).toBe(newGates);
    expect(
      JSON.parse(
        run.storage.snapshot().files[
          ".brain/03-memory/telemetry/session-subagent.json"
        ] ?? "",
      ),
    ).toMatchObject({ runId: "run-01", grossTokens: 25 });
  });

  it("fails closed when one contributor belongs to genuinely overlapping phase records", async () => {
    const run = await started();
    await startPhase(run, "session-a");
    await samplePhase(run, "session-subagent", 20, "subagent-first", SAMPLE);
    const first = records(run)[0];
    if (first === undefined) throw new Error("Missing running measurement");
    const firstOwner = { ...first, contributorCheckpoints: [] };
    const ambiguousRaw = `${JSON.stringify(firstOwner)}\n${JSON.stringify({
      ...first,
      phase: "spec",
      sessionId: "session-b",
      contributingSessionIds: ["session-b", "session-subagent"],
      contributorCheckpoints: [],
    })}\n`;
    await run.ports.fileSystem.write(LOG, ambiguousRaw);
    const priorUsage =
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/usage.json"
      ];
    const priorGates =
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/gates.json"
      ];

    expect(
      await samplePhase(
        run,
        "session-subagent",
        25,
        "ambiguous-contributor",
        AFTER,
        "session.end",
      ),
    ).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
      evidence: [{ ref: LOG }],
    });
    expect(run.storage.snapshot().files[LOG]).toBe(ambiguousRaw);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/usage.json"
      ],
    ).toBe(priorUsage);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/gates.json"
      ],
    ).toBe(priorGates);
    expect(
      run.storage.snapshot().files[
        ".brain/03-memory/telemetry/session-subagent.json"
      ],
    ).toBeUndefined();
  });

  it("fails closed when an unowned sample has multiple eligible running phases", async () => {
    const run = await started();
    await startPhase(run, "session-a");
    const first = records(run)[0];
    if (first === undefined) throw new Error("Missing running measurement");
    const ambiguousRaw = `${JSON.stringify(first)}\n${JSON.stringify({
      ...first,
      phase: "spec",
      sessionId: "session-b",
      contributingSessionIds: ["session-b"],
    })}\n`;
    await run.ports.fileSystem.write(LOG, ambiguousRaw);
    const priorUsage =
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/usage.json"
      ];

    expect(
      await samplePhase(
        run,
        "session-unowned",
        20,
        "ambiguous-running",
        SAMPLE,
      ),
    ).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
      evidence: [{ ref: LOG }],
    });
    expect(run.storage.snapshot().files[LOG]).toBe(ambiguousRaw);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/usage.json"
      ],
    ).toBe(priorUsage);
  });

  it("fails closed when an accepted sample has no contributor or running phase owner", async () => {
    const run = await started();
    const priorRaw = run.storage.snapshot().files[LOG];

    expect(
      await samplePhase(run, "session-unowned", 20, "missing-owner", SAMPLE),
    ).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
      evidence: [{ ref: LOG }],
    });
    expect(run.storage.snapshot().files[LOG]).toBe(priorRaw);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/usage.json"
      ],
    ).toBeUndefined();
  });

  it("fails closed when prior run usage has no durable contributor owner", async () => {
    const run = await started();
    await startPhase(run, "session-principal");
    const usagePath =
      ".brain/02-features/measure-phase-usage/runs/run-01/usage.json";
    const orphanedUsage: RunUsageV1 = {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      runId: "run-01",
      totalGrossTokens: 20,
      epoch: { number: 1, baselineGrossTokens: 0, exhaustedAt: null },
      sessions: [{ sessionId: "session-subagent", cumulativeGrossTokens: 20 }],
      measurementFaultAt: null,
      updatedAt: SAMPLE,
    };
    await run.ports.fileSystem.write(
      usagePath,
      `${JSON.stringify(orphanedUsage, null, 2)}\n`,
    );
    const priorRaw = run.storage.snapshot().files[LOG];
    const priorUsage = run.storage.snapshot().files[usagePath];

    expect(
      await samplePhase(run, "session-subagent", 25, "orphaned-usage", AFTER),
    ).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
      evidence: [{ ref: LOG }],
    });
    expect(run.storage.snapshot().files[LOG]).toBe(priorRaw);
    expect(run.storage.snapshot().files[usagePath]).toBe(priorUsage);
  });

  it("closes only an accepted phase transition and refuses a missing start", async () => {
    const missing = await started();
    const before = missing.storage.snapshot();

    expect(await completeCurrentPhase(missing, 0)).toMatchObject({
      reasonCode: "metrics.phase_not_started",
      stateChanged: false,
    });
    expect(missing.storage.snapshot().files[LOG]).toBe(before.files[LOG]);
    expect(
      missing.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-01/events.jsonl"
      ],
    ).toBe(
      before.files[
        ".brain/02-features/measure-phase-usage/runs/run-01/events.jsonl"
      ],
    );

    const run = await started();
    await startPhase(run, "session-prd");
    await samplePhase(run, "session-prd", 55, "sample-before-close", SAMPLE);
    expect(await completeCurrentPhase(run, 0)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });
    expect(records(run)).toHaveLength(1);
    expect(records(run)[0]).toMatchObject({
      status: "completed",
      endedAt: END,
      durationMs: 180_000,
      finalGrossTokens: 55,
      grossTokens: 55,
      closeReason: "phase_completed",
    });
  });

  it("interrupts the matching running record on session end", async () => {
    const run = await started();
    await startPhase(run, "session-prd");
    await samplePhase(run, "session-prd", 25, "sample", SAMPLE);

    expect(
      await samplePhase(run, "session-prd", 30, "end", END, "session.end"),
    ).toMatchObject({ reasonCode: "trail.ok" });

    expect(records(run)[0]).toMatchObject({
      status: "interrupted",
      endedAt: END,
      durationMs: 180_000,
      finalGrossTokens: 30,
      grossTokens: 30,
      closeReason: "session_interrupted",
    });
  });

  it("raises closed token totals from a later sample without changing duration", async () => {
    const run = await started();
    await startPhase(run, "session-prd");
    await samplePhase(run, "session-prd", 40, "sample", SAMPLE);
    await completeCurrentPhase(run, 0);
    const closed = records(run)[0];

    await samplePhase(run, "session-prd", 60, "late-sample", LATER);

    expect(records(run)[0]).toMatchObject({
      status: "completed",
      endedAt: closed?.endedAt,
      durationMs: closed?.durationMs,
      finalGrossTokens: 60,
      grossTokens: 60,
      updatedAt: LATER,
    });
  });

  it("keeps every repeated, regressing, and final increment in its owning phase through completion and refresh", async () => {
    const run = await started();
    await setTokenBudget(run, 100);
    await startPhase(run, "session-a");
    await samplePhase(run, "session-a", 40, "session-a-sample", SAMPLE);
    await completeCurrentPhase(run, 0);
    await startPhase(run, "session-b", LATER);
    await samplePhase(run, "session-b", 30, "session-b-sample", AFTER);
    const beforeDelayedSamples = run.storage.snapshot().files[LOG];

    await samplePhase(
      run,
      "session-a",
      40,
      "session-a-repeated",
      "2026-08-30T12:02:00.000Z",
      "session.sample",
      DELAYED,
    );
    await samplePhase(
      run,
      "session-a",
      35,
      "session-a-regressing",
      "2026-08-30T12:02:15.000Z",
      "session.sample",
      REFRESH,
    );
    expect(run.storage.snapshot().files[LOG]).toBe(beforeDelayedSamples);
    expect(usage(run).totalGrossTokens).toBe(70);

    expect(
      await samplePhase(
        run,
        "session-a",
        45,
        "session-a-delayed-final",
        "2026-08-30T12:02:30.000Z",
        "session.end",
        FINAL,
      ),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });

    expect(await completeCurrentPhase(run, 1, COMPLETED)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });

    const prd = records(run).find(({ phase }) => phase === "prd");
    const spec = records(run).find(({ phase }) => phase === "spec");
    expect(prd).toMatchObject({
      status: "completed",
      baselineGrossTokens: 0,
      finalGrossTokens: 45,
      grossTokens: 45,
      endedAt: END,
      updatedAt: END,
    });
    expect(spec).toMatchObject({
      status: "completed",
      baselineGrossTokens: 40,
      finalGrossTokens: 70,
      grossTokens: 30,
      endedAt: COMPLETED,
      closeReason: "phase_completed",
    });
    expect(
      records(run).reduce((sum, record) => sum + record.grossTokens, 0),
    ).toBe(75);
    expect(usage(run)).toMatchObject({
      totalGrossTokens: 75,
      sessions: [
        { sessionId: "session-a", cumulativeGrossTokens: 45 },
        { sessionId: "session-b", cumulativeGrossTokens: 30 },
      ],
      epoch: { exhaustedAt: null },
    });
    expect(stopLossFor(run, "run-01")).toEqual({
      tripped: false,
      exhausted: false,
    });

    expect(
      await result(run, ["metrics", "refresh"], portsAt(run, ROLLUP)),
    ).toMatchObject({ reasonCode: "metrics.calibration_insufficient" });
    const rollup =
      run.storage.snapshot().files[".brain/03-memory/task_metrics.md"] ?? "";
    expect(rollup).toContain(
      "| prd | 1 | 0 | measure-phase-usage/run-01 | 45 | 45 | 45 | 45 |",
    );
    expect(rollup).toContain(
      "| spec | 1 | 0 | measure-phase-usage/run-01 | 30 | 30 | 30 | 30 |",
    );
  });

  it("completes a phase with no hook samples without claiming another session's delayed increment", async () => {
    const run = await started();
    await setTokenBudget(run, 100);
    await startPhase(run, "session-a");
    await samplePhase(run, "session-a", 40, "session-a-sample", SAMPLE);
    await completeCurrentPhase(run, 0);
    await startPhase(run, "session-b", LATER);

    await samplePhase(
      run,
      "session-a",
      45,
      "session-a-delayed-final",
      "2026-08-30T12:02:00.000Z",
      "session.end",
      AFTER,
    );
    expect(await completeCurrentPhase(run, 1, DELAYED)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });

    expect(records(run).find(({ phase }) => phase === "prd")).toMatchObject({
      status: "completed",
      finalGrossTokens: 45,
      grossTokens: 45,
    });
    expect(records(run).find(({ phase }) => phase === "spec")).toMatchObject({
      status: "completed",
      baselineGrossTokens: 40,
      finalGrossTokens: 40,
      grossTokens: 0,
    });
    expect(
      records(run).reduce((sum, record) => sum + record.grossTokens, 0),
    ).toBe(45);
    expect(usage(run).totalGrossTokens).toBe(45);
  });

  it("routes a delayed measured session to its owning run after the active run changes", async () => {
    const run = await started();
    await setTokenBudget(run, 45);
    await startPhase(run, "session-old");
    await samplePhase(run, "session-old", 40, "old-sample", SAMPLE);
    await completeCurrentPhase(run, 0);
    await switchToEmptyRun(run, "run-02");
    const newUsage =
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/usage.json"
      ];
    const newGates =
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/gates.json"
      ];

    expect(
      await samplePhase(
        run,
        "session-old",
        45,
        "old-delayed-final",
        AFTER,
        "session.end",
      ),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });

    expect(usageFor(run, "run-01")).toMatchObject({
      totalGrossTokens: 45,
      sessions: [{ sessionId: "session-old", cumulativeGrossTokens: 45 }],
      epoch: { exhaustedAt: AFTER },
    });
    expect(gatesFor(run, "run-01").stopLoss).toEqual({
      tripped: false,
      exhausted: true,
    });
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/usage.json"
      ],
    ).toBe(newUsage);
    expect(
      run.storage.snapshot().files[
        ".brain/02-features/measure-phase-usage/runs/run-02/gates.json"
      ],
    ).toBe(newGates);
    expect(records(run)[0]).toMatchObject({
      runId: "run-01",
      status: "completed",
      finalGrossTokens: 45,
      grossTokens: 45,
    });
    expect(
      JSON.parse(
        run.storage.snapshot().files[
          ".brain/03-memory/telemetry/session-old.json"
        ] ?? "",
      ),
    ).toMatchObject({ runId: "run-01", grossTokens: 45 });
  });

  it.each([
    {
      label: "missing usage",
      path: ".brain/02-features/measure-phase-usage/runs/run-01/usage.json",
      damage: async (run: RuntimeSubject, path: string) =>
        run.ports.fileSystem.remove(path),
    },
    {
      label: "malformed gates",
      path: ".brain/02-features/measure-phase-usage/runs/run-01/gates.json",
      damage: async (run: RuntimeSubject, path: string) =>
        run.ports.fileSystem.write(path, "{not-json}\n"),
    },
  ])(
    "fails closed when the cross-run measurement owner has $label",
    async ({ path, damage }) => {
      const run = await started();
      await startPhase(run, "session-old");
      await samplePhase(run, "session-old", 40, "old-sample", SAMPLE);
      await completeCurrentPhase(run, 0);
      await switchToEmptyRun(run, "run-02");
      await damage(run, path);
      const priorRaw = run.storage.snapshot().files[LOG];
      const priorOldUsage =
        run.storage.snapshot().files[
          ".brain/02-features/measure-phase-usage/runs/run-01/usage.json"
        ];
      const priorOldGates =
        run.storage.snapshot().files[
          ".brain/02-features/measure-phase-usage/runs/run-01/gates.json"
        ];
      const priorNewUsage =
        run.storage.snapshot().files[
          ".brain/02-features/measure-phase-usage/runs/run-02/usage.json"
        ];
      const priorNewGates =
        run.storage.snapshot().files[
          ".brain/02-features/measure-phase-usage/runs/run-02/gates.json"
        ];

      expect(
        await samplePhase(
          run,
          "session-old",
          45,
          "old-delayed-invalid-owner",
          AFTER,
          "session.end",
        ),
      ).toMatchObject({
        exitCode: 4,
        reasonCode: "runtime.state_corrupt",
        stateChanged: false,
        evidence: [{ ref: path }],
      });
      expect(run.storage.snapshot().files[LOG]).toBe(priorRaw);
      expect(
        run.storage.snapshot().files[
          ".brain/02-features/measure-phase-usage/runs/run-01/usage.json"
        ],
      ).toBe(priorOldUsage);
      expect(
        run.storage.snapshot().files[
          ".brain/02-features/measure-phase-usage/runs/run-01/gates.json"
        ],
      ).toBe(priorOldGates);
      expect(
        run.storage.snapshot().files[
          ".brain/02-features/measure-phase-usage/runs/run-02/usage.json"
        ],
      ).toBe(priorNewUsage);
      expect(
        run.storage.snapshot().files[
          ".brain/02-features/measure-phase-usage/runs/run-02/gates.json"
        ],
      ).toBe(priorNewGates);
      expect(
        run.storage.snapshot().files[
          ".brain/03-memory/telemetry/session-old.json"
        ],
      ).toBeUndefined();
    },
  );

  it("fails closed on an exact timestamp tie across measured runs", async () => {
    const run = await started();
    await startPhase(run, "session-shared");
    await samplePhase(run, "session-shared", 40, "shared-sample", SAMPLE);
    await completeCurrentPhase(run, 0);
    await switchToEmptyRun(run, "run-02");
    const first = records(run)[0];
    if (first === undefined) throw new Error("Missing measured session");
    const firstOwner = { ...first, contributorCheckpoints: [] };
    const ambiguousRaw = `${JSON.stringify(firstOwner)}\n${JSON.stringify({
      ...first,
      runId: "run-02",
      phase: "spec",
      contributorCheckpoints: [],
    })}\n`;
    await run.ports.fileSystem.write(LOG, ambiguousRaw);
    const priorOldUsage = JSON.stringify(usageFor(run, "run-01"));
    const priorNewUsage = JSON.stringify(usageFor(run, "run-02"));

    expect(
      await samplePhase(
        run,
        "session-shared",
        45,
        "shared-delayed-final",
        START,
        "session.end",
        AFTER,
      ),
    ).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
      evidence: [{ ref: LOG }],
    });
    expect(run.storage.snapshot().files[LOG]).toBe(ambiguousRaw);
    expect(JSON.stringify(usageFor(run, "run-01"))).toBe(priorOldUsage);
    expect(JSON.stringify(usageFor(run, "run-02"))).toBe(priorNewUsage);
    expect(
      run.storage.snapshot().files[
        ".brain/03-memory/telemetry/session-shared.json"
      ],
    ).toBeUndefined();
  });

  it("recovers an accepted stale running phase before starting the next phase", async () => {
    const run = await started();
    await startPhase(run, "session-prd");
    await samplePhase(run, "session-prd", 35, "sample", SAMPLE);
    const stale = run.storage.snapshot().files[LOG] ?? "";
    await completeCurrentPhase(run, 0);
    await run.ports.fileSystem.write(LOG, stale);

    expect(await startPhase(run, "session-spec", LATER)).toMatchObject({
      reasonCode: "trail.ok",
    });

    expect(records(run)).toHaveLength(2);
    expect(records(run).find(({ phase }) => phase === "prd")).toMatchObject({
      status: "completed",
      endedAt: END,
      durationMs: 180_000,
      closeReason: "recovered_completed",
    });
    expect(records(run).find(({ phase }) => phase === "spec")).toMatchObject({
      status: "running",
      startedAt: LATER,
      baselineGrossTokens: 35,
    });
  });

  it("recovers unrelated stale running work as interrupted on the next phase start", async () => {
    const run = await started();
    await startPhase(run, "stale-session");
    const stale = records(run)[0];
    if (stale === undefined)
      throw new Error("Missing stale measurement fixture");
    await run.ports.fileSystem.write(
      LOG,
      `${JSON.stringify({
        ...stale,
        feature: "previous-feature",
        runId: "run-previous",
        phase: "code",
      })}\n`,
    );

    await startPhase(run, "session-prd", LATER);

    expect(records(run)).toHaveLength(2);
    expect(
      records(run).find(({ runId }) => runId === "run-previous"),
    ).toMatchObject({
      status: "interrupted",
      endedAt: LATER,
      closeReason: "recovered_interrupted",
    });
  });

  it("recovers another run from its own accepted transition and retains it through refresh", async () => {
    const run = await started();
    await startPhase(run, "previous-session");
    await samplePhase(run, "previous-session", 35, "previous-sample", SAMPLE);
    const stale = records(run)[0];
    if (stale === undefined) throw new Error("Missing stale measurement");
    await completeCurrentPhase(run, 0);
    const currentEventsPath =
      ".brain/02-features/measure-phase-usage/runs/run-01/events.jsonl";
    const acceptedEvents =
      run.storage.snapshot().files[currentEventsPath] ?? "";
    const previousEventsPath =
      ".brain/02-features/previous-feature/runs/run-previous/events.jsonl";
    const previousUsagePath =
      ".brain/02-features/previous-feature/runs/run-previous/usage.json";
    const previousUsage: RunUsageV1 = {
      ...usage(run),
      runId: "run-previous",
      totalGrossTokens: 45,
      sessions: [{ sessionId: "previous-session", cumulativeGrossTokens: 45 }],
      updatedAt: END,
    };
    await run.ports.fileSystem.write(
      LOG,
      `${JSON.stringify({
        ...stale,
        feature: "previous-feature",
        runId: "run-previous",
      })}\n`,
    );
    await run.ports.fileSystem.write(previousEventsPath, acceptedEvents);
    await run.ports.fileSystem.write(
      previousUsagePath,
      `${JSON.stringify(previousUsage, null, 2)}\n`,
    );

    expect(await startPhase(run, "session-spec", LATER)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });
    expect(
      records(run).find(({ runId }) => runId === "run-previous"),
    ).toMatchObject({
      status: "completed",
      endedAt: END,
      finalGrossTokens: 45,
      grossTokens: 45,
      closeReason: "recovered_completed",
    });

    expect(
      await result(run, ["metrics", "refresh"], portsAt(run, REFRESH)),
    ).toMatchObject({ reasonCode: "metrics.calibration_insufficient" });
    expect(
      records(run).find(({ runId }) => runId === "run-previous"),
    ).toMatchObject({
      status: "completed",
      endedAt: END,
      finalGrossTokens: 45,
      grossTokens: 45,
      closeReason: "recovered_completed",
    });
    expect(
      run.storage.snapshot().files[".brain/03-memory/task_metrics.md"],
    ).toContain("| prd | 1 | 0 | previous-feature/run-previous |");
  });

  it("refuses a new phase when another running record has corrupt events", async () => {
    const run = await started();
    await startPhase(run, "previous-session");
    await samplePhase(run, "previous-session", 10, "previous-sample", SAMPLE);
    const stale = records(run)[0];
    if (stale === undefined) throw new Error("Missing stale measurement");
    const previousEventsPath =
      ".brain/02-features/previous-feature/runs/run-previous/events.jsonl";
    const priorRaw = `${JSON.stringify({
      ...stale,
      feature: "previous-feature",
      runId: "run-previous",
      phase: "code",
    })}\n`;
    await run.ports.fileSystem.write(LOG, priorRaw);
    await run.ports.fileSystem.write(previousEventsPath, "{not-json}\n");
    const currentEventsPath =
      ".brain/02-features/measure-phase-usage/runs/run-01/events.jsonl";
    const priorCurrentEvents =
      run.storage.snapshot().files[currentEventsPath] ?? "";
    const priorUsage = JSON.stringify(usage(run));

    expect(await startPhase(run, "session-prd", LATER)).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
      evidence: [{ ref: previousEventsPath }],
    });
    expect(run.storage.snapshot().files[LOG]).toBe(priorRaw);
    expect(run.storage.snapshot().files[currentEventsPath]).toBe(
      priorCurrentEvents,
    );
    expect(JSON.stringify(usage(run))).toBe(priorUsage);
    expect(records(run)).toHaveLength(1);
    expect(records(run)[0]).toMatchObject({
      feature: "previous-feature",
      runId: "run-previous",
      status: "running",
    });
  });

  it("records the code assignment from runtime resolution, never agent text", async () => {
    const run = await started();
    await enterCodePhase(run);
    expect(await recordForgedCodeReply(run)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });
    const record = records(run).find(({ phase }) => phase === "code");
    expect(record?.resolvedAssignment).toEqual({
      host: "codex",
      role: "implementer",
      model: "codex-implementation",
      effort: "high",
    });
    expect(record?.observedIdentity).toEqual({
      model: "codex-implementation",
      effort: "high",
    });
    expect(run.storage.snapshot().files[LOG]).not.toContain("forged-model");
  });

  it("completes one keyed record after an agent fact changes the revision", async () => {
    const run = await started();
    await enterCodePhase(run);

    expect(await recordForgedCodeReply(run)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });
    expect(await completeCurrentPhase(run, 3, AFTER)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });

    const codeRecords = records(run).filter(({ phase }) => phase === "code");
    expect(codeRecords).toHaveLength(1);
    expect(codeRecords[0]).toMatchObject({
      status: "completed",
      startedAt: LATER,
      endedAt: AFTER,
      durationMs: 60_000,
      baselineGrossTokens: 0,
      closeReason: "phase_completed",
    });
  });

  it("reassociates a same-phase start after a fact without resetting usage", async () => {
    const run = await started();
    await enterCodePhase(run);
    await samplePhase(run, "session-code", 40, "sample-before-fact", LATER);
    const before = records(run).find(({ phase }) => phase === "code");
    if (before === undefined) throw new Error("Missing running measurement");
    expect(await recordForgedCodeReply(run)).toMatchObject({
      reasonCode: "trail.ok",
      stateChanged: true,
    });

    expect(
      await startPhase(run, "session-code-reassociated", AFTER),
    ).toMatchObject({ reasonCode: "trail.ok", stateChanged: true });

    const after = records(run).filter(({ phase }) => phase === "code");
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      status: "running",
      sessionId: "session-code-reassociated",
      correlationId: "start-session-code-reassociated",
      startedAt: before.startedAt,
      baselineGrossTokens: before.baselineGrossTokens,
      grossTokens: 40,
    });
    expect(after[0]?.assignmentDigest).not.toBe(before.assignmentDigest);
  });

  it("refuses a same-phase start whose resolved assignment genuinely changed", async () => {
    const run = await started();
    await startPhase(run, "session-prd");
    const before = run.storage.snapshot().files[LOG];
    const base = codexCatalog();
    const changedCatalog = {
      ...base,
      defaults: {
        ...base.defaults,
        planner: { model: "planner-reassigned", effort: "medium" as const },
      },
      models: base.models.map((entry) =>
        entry.canonicalModel === "planner-canonical"
          ? { ...entry, canonicalModel: "planner-reassigned" }
          : entry,
      ),
    };
    const changedPorts = {
      ...run.ports,
      modelRouting: fixedModelRouting([changedCatalog]),
    };

    expect(
      await startPhase(run, "session-prd-reassigned", SAMPLE, changedPorts),
    ).toMatchObject({
      reasonCode: "metrics.phase_assignment_conflict",
      stateChanged: false,
    });
    expect(run.storage.snapshot().files[LOG]).toBe(before);
  });
});
