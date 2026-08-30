import type {
  OperationResultV1,
  PhaseHandoffV1_1,
  PhaseMeasurementV1,
  RunUsageV1,
} from "@kratos/contracts";
import { runCommandLine } from "@kratos/runtime/composition/cli";
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
): Promise<PhaseHandoffV1_1> {
  clearOutput(run);
  expect(await runCommandLine(["--json", "handoff"], ports)).toBe(0);
  return JSON.parse(run.output.structured_.join("")) as PhaseHandoffV1_1;
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
    now,
  );
}

function records(run: RuntimeSubject): readonly PhaseMeasurementV1[] {
  const text = run.storage.snapshot().files[LOG] ?? "";
  return text === ""
    ? []
    : text
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line) as PhaseMeasurementV1);
}

function usage(run: RuntimeSubject): RunUsageV1 {
  const path = ".brain/02-features/measure-phase-usage/runs/run-01/usage.json";
  return JSON.parse(run.storage.snapshot().files[path] ?? "") as RunUsageV1;
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
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    agent: "code",
    outcome: {
      status: "completed",
      next: "proceed",
      questions: [],
      blockers: [],
    },
    artifacts: [],
    changedFiles: [],
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
    payloadContract: "host.agent-output@1.0.0",
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
