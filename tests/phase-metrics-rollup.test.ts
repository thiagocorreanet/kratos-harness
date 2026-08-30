import type { OperationResultV1, PhaseMeasurementV1 } from "@kratos/contracts";
import { createRuntime } from "@kratos/runtime/composition";
import { runCommandLine } from "@kratos/runtime/composition/cli";
import {
  derivePhaseDistributions,
  nearestRank,
  renderPhaseMeasurementLog,
  renderTaskMetrics,
} from "@kratos/runtime/domain/measurements";
import { sealEvent } from "@kratos/runtime/domain/events";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  fixedClock,
  fixedEnvironment,
  memoryTransactionStorage,
  memoryWorkspace,
  recordingOutput,
  sequentialIds,
} from "@kratos/runtime/infra/fake";
import type { DurableFileSystem, RuntimePorts } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

const ROOT = "/project";
const REFRESHED_AT = "2026-08-30T12:05:00.000Z";
const LOG = ".brain/03-memory/task_log.jsonl";
const ROLLUP = ".brain/03-memory/task_metrics.md";
const ASSIGNMENT_DIGEST = "a".repeat(64);

function completed(
  runId: string,
  grossTokens: number,
  durationMs: number,
  phase: PhaseMeasurementV1["phase"] = "code",
  feature = "feature-b",
): PhaseMeasurementV1 {
  const startedAt = "2026-08-30T12:00:00.000Z";
  const endedAt = new Date(Date.parse(startedAt) + durationMs).toISOString();
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    feature,
    runId,
    phase,
    sessionId: `session-${runId}`,
    correlationId: `correlation-${runId}`,
    status: "completed",
    startedAt,
    endedAt,
    durationMs,
    baselineGrossTokens: 0,
    finalGrossTokens: grossTokens,
    grossTokens,
    assignmentDigest: ASSIGNMENT_DIGEST,
    resolvedAssignment: {
      host: "codex",
      role: "implementer",
      model: "codex-implementation",
      effort: "high",
    },
    observedIdentity: { model: "codex-implementation", effort: "high" },
    closeReason: "phase_completed",
    updatedAt: endedAt,
  };
}

function interrupted(
  runId: string,
  grossTokens: number,
  durationMs: number,
): PhaseMeasurementV1 {
  const record = completed(runId, grossTokens, durationMs);
  if (record.status !== "completed") {
    throw new Error("Completed measurement fixture is invalid");
  }
  return {
    ...record,
    status: "interrupted",
    closeReason: "session_interrupted",
  };
}

function running(runId: string): PhaseMeasurementV1 {
  return {
    ...completed(runId, 0, 0),
    status: "running",
    endedAt: null,
    durationMs: null,
    finalGrossTokens: null,
    observedIdentity: { model: null, effort: null },
    closeReason: null,
    updatedAt: "2026-08-30T12:00:00.000Z",
  };
}

interface Subject {
  readonly storage: ReturnType<typeof memoryTransactionStorage>;
  readonly output: ReturnType<typeof recordingOutput>;
  readonly ports: RuntimePorts;
}

function subject(files: Readonly<Record<string, string>>): Subject {
  const storage = memoryTransactionStorage({
    files,
    directories: [".brain", ".brain/03-memory", ".brain/transactions"],
  });
  const output = recordingOutput();
  const ports = createRuntime({
    clock: fixedClock(REFRESHED_AT),
    ids: sequentialIds("metrics"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    fileSystem: storage.fileSystem,
    environment: fixedEnvironment({}, ROOT),
    output,
    workspace: memoryWorkspace({ directories: [ROOT] }),
  });
  return { storage, output, ports };
}

async function result(
  run: Subject,
  argv: readonly string[],
  ports: RuntimePorts = run.ports,
): Promise<OperationResultV1> {
  (run.output.structured_ as string[]).splice(0);
  (run.output.human_ as string[]).splice(0);
  await runCommandLine(["--json", ...argv], ports);
  return JSON.parse(run.output.structured_.join("")) as OperationResultV1;
}

describe("phase metric distributions", () => {
  it("uses literal nearest-rank positions over ascending integers", () => {
    expect(nearestRank([50, 10, 40, 20, 30], 0.5)).toBe(30);
    expect(nearestRank([10, 20, 30, 40, 50], 0.95)).toBe(50);
  });

  it("excludes interrupted records from distributions and completed sources", () => {
    const report = derivePhaseDistributions(
      [
        completed("run-02", 20, 200, "code", "feature-b"),
        completed("run-01", 10, 100, "code", "feature-a"),
        interrupted("run-03", 9_999, 99_999),
      ],
      5,
    );

    expect(report.phases.code).toMatchObject({
      completed: 2,
      interrupted: 1,
      completedSources: ["feature-a/run-01", "feature-b/run-02"],
      tokens: { min: 10, p50: 10, p95: 20, max: 20 },
      durationMs: { min: 100, p50: 100, p95: 200, max: 200 },
    });
  });

  it("refuses calibration at four samples and recommends nearest-rank p95 at five", () => {
    const four = derivePhaseDistributions(
      [10, 20, 30, 40].map((tokens, index) =>
        completed(`run-${String(index + 1)}`, tokens, tokens * 10),
      ),
      5,
    );
    const five = derivePhaseDistributions(
      [10, 20, 30, 40, 50].map((tokens, index) =>
        completed(`run-${String(index + 1)}`, tokens, tokens * 10),
      ),
      5,
    );

    expect(four.phases.code.recommendedTokens).toBeNull();
    expect(four.phases.code.calibration).toEqual({ required: 5, observed: 4 });
    expect(five.phases.code.recommendedTokens).toBe(50);
    expect(five.phases.code.calibration).toEqual({ required: 5, observed: 5 });
  });

  it("renders all six phases in canonical order with deterministic absence markers", () => {
    const distributions = derivePhaseDistributions(
      [completed("run-01", 50, 500, "code", "feature-a")],
      5,
    );
    const markdown = renderTaskMetrics({
      ...distributions,
      generatedAt: REFRESHED_AT,
      sourceLogSha256: "b".repeat(64),
    });

    expect(markdown).toBe(
      [
        "# Task metrics",
        "",
        `Generated at: ${REFRESHED_AT}`,
        `Raw-log SHA-256: ${"b".repeat(64)}`,
        "Calibration policy: nearest-rank p95, minimum 5 completed samples per phase.",
        "",
        "| Phase | Completed | Interrupted | Completed sources | token min | token p50 | token p95 | token max | duration-ms min | duration-ms p50 | duration-ms p95 | duration-ms max | Recommended tokens |",
        "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
        "| prd | 0 | 0 | none | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Unavailable (0/5; metrics.calibration_insufficient) |",
        "| spec | 0 | 0 | none | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Unavailable (0/5; metrics.calibration_insufficient) |",
        "| plan | 0 | 0 | none | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Unavailable (0/5; metrics.calibration_insufficient) |",
        "| code | 1 | 0 | feature-a/run-01 | 50 | 50 | 50 | 50 | 500 | 500 | 500 | 500 | Unavailable (1/5; metrics.calibration_insufficient) |",
        "| review | 0 | 0 | none | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Unavailable (0/5; metrics.calibration_insufficient) |",
        "| acceptance | 0 | 0 | none | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | Unavailable (0/5; metrics.calibration_insufficient) |",
        "",
      ].join("\n"),
    );
  });
});

describe("metrics refresh", () => {
  it("writes the rollup while returning the six-phase calibration advisory", async () => {
    const raw = renderPhaseMeasurementLog([
      completed("run-01", 50, 500, "code", "feature-a"),
    ]);
    const run = subject({ [LOG]: raw });

    expect(await result(run, ["metrics", "refresh"])).toMatchObject({
      reasonCode: "metrics.calibration_insufficient",
      stateChanged: true,
    });
    expect(run.storage.snapshot().files[ROLLUP]).toContain(
      `Raw-log SHA-256: ${run.storage.digests.sha256(raw)}`,
    );
  });

  it("returns refresh success only when all six phases have five completed samples", async () => {
    const phases = [
      "prd",
      "spec",
      "plan",
      "code",
      "review",
      "acceptance",
    ] as const;
    const records = phases.flatMap((phase, phaseIndex) =>
      [1, 2, 3, 4, 5].map((sample) =>
        completed(
          `run-${String(phaseIndex + 1)}-${String(sample)}`,
          phaseIndex * 100 + sample,
          phaseIndex * 1_000 + sample,
          phase,
        ),
      ),
    );
    const run = subject({ [LOG]: renderPhaseMeasurementLog(records) });

    expect(await result(run, ["metrics", "refresh"])).toMatchObject({
      reasonCode: "metrics.refresh_ok",
      stateChanged: true,
    });
    expect(run.storage.snapshot().files[ROLLUP]).toContain(
      "| acceptance | 5 | 0 |",
    );
  });

  it("recovers every unaccepted running record as interrupted using valid run usage", async () => {
    const record = running("run-open");
    const usagePath = ".brain/02-features/feature-b/runs/run-open/usage.json";
    const run = subject({
      [LOG]: renderPhaseMeasurementLog([record]),
      [usagePath]: `${JSON.stringify({
        contractVersion: "1.0.0",
        stateContract: "1.0.0",
        runId: "run-open",
        totalGrossTokens: 77,
        epoch: { number: 1, baselineGrossTokens: 0, exhaustedAt: null },
        sessions: [
          { sessionId: "session-run-open", cumulativeGrossTokens: 77 },
        ],
        measurementFaultAt: null,
        updatedAt: REFRESHED_AT,
      })}\n`,
    });

    await result(run, ["metrics", "refresh"]);

    const recovered = JSON.parse(
      run.storage.snapshot().files[LOG] ?? "",
    ) as PhaseMeasurementV1;
    expect(recovered).toMatchObject({
      status: "interrupted",
      endedAt: REFRESHED_AT,
      durationMs: 300_000,
      finalGrossTokens: 77,
      grossTokens: 77,
      closeReason: "recovered_interrupted",
    });
  });

  it("recovers a running record as completed at its canonical accepted transition", async () => {
    const record = running("run-accepted");
    const run = subject({ [LOG]: renderPhaseMeasurementLog([record]) });
    const accepted = sealEvent(
      {
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        eventId: "event-accepted",
        eventType: "transition",
        occurredAt: "2026-08-30T12:03:00.000Z",
        operation: "sdd.continue:accepted",
        policyVersion: "workflow-v1",
        priorRevision: 0,
        resultingRevision: 1,
        reasonCode: "run.transition.accepted",
        effect: "state",
        artifactRefs: [".brain/02-features/feature-b/code-summary.md"],
        evidenceRefs: [".brain/evidence/code.json"],
        observedIdentity: {
          host: "codex",
          model: "codex-implementation",
          effort: "high",
        },
        resolvedAssignment: {
          phase: "code",
          role: "implementer",
          model: "codex-implementation",
          effort: "high",
        },
      },
      { revision: 0, hash: null },
      {
        digests: run.storage.digests,
        isProxy: () => false,
        isPromise: () => false,
        schemaRegistry: createSchemaRegistry(),
      },
    );
    await run.storage.fileSystem.write(
      ".brain/02-features/feature-b/runs/run-accepted/events.jsonl",
      `${canonicalizeJson(accepted)}\n`,
    );

    await result(run, ["metrics", "refresh"]);

    const recovered = JSON.parse(
      run.storage.snapshot().files[LOG] ?? "",
    ) as PhaseMeasurementV1;
    expect(recovered).toMatchObject({
      status: "completed",
      endedAt: "2026-08-30T12:03:00.000Z",
      durationMs: 180_000,
      finalGrossTokens: 0,
      grossTokens: 0,
      observedIdentity: {
        model: "codex-implementation",
        effort: "high",
      },
      closeReason: "recovered_completed",
      updatedAt: REFRESHED_AT,
    });
  });

  it("preserves prior raw and rollup bytes when the raw log is malformed", async () => {
    const priorRollup = "# Task metrics\n\nPrior committed bytes.\n";
    const malformed = "{not-json}\n";
    const run = subject({ [LOG]: malformed, [ROLLUP]: priorRollup });

    expect(await result(run, ["metrics", "refresh"])).toMatchObject({
      reasonCode: "metrics.log_invalid",
      stateChanged: false,
    });
    expect(run.storage.snapshot().files[LOG]).toBe(malformed);
    expect(run.storage.snapshot().files[ROLLUP]).toBe(priorRollup);
  });

  it("preserves raw and rollup bytes when a running record event stream is corrupt", async () => {
    const priorRaw = renderPhaseMeasurementLog([running("run-corrupt-events")]);
    const priorRollup = "# Task metrics\n\nPrior committed bytes.\n";
    const eventsPath =
      ".brain/02-features/feature-b/runs/run-corrupt-events/events.jsonl";
    const run = subject({
      [LOG]: priorRaw,
      [ROLLUP]: priorRollup,
      [eventsPath]: "{not-json}\n",
    });

    expect(await result(run, ["metrics", "refresh"])).toMatchObject({
      exitCode: 4,
      reasonCode: "runtime.state_corrupt",
      stateChanged: false,
    });
    expect(run.storage.snapshot().files[LOG]).toBe(priorRaw);
    expect(run.storage.snapshot().files[ROLLUP]).toBe(priorRollup);
  });

  it("leaves the committed rollup unchanged for non-refresh diagnostics", async () => {
    const priorRollup = "# Task metrics\n\nPrior committed bytes.\n";
    const run = subject({ [LOG]: "", [ROLLUP]: priorRollup });

    await result(run, ["stats"]);
    await result(run, ["budgets"]);

    expect(run.storage.snapshot().files[ROLLUP]).toBe(priorRollup);
  });

  it("publishes neither recovered raw data nor a rollup after a stale precondition", async () => {
    const originalRaw = renderPhaseMeasurementLog([running("run-open")]);
    const competingRaw = renderPhaseMeasurementLog([
      interrupted("run-competing", 8, 8),
    ]);
    const priorRollup = "# Task metrics\n\nPrior committed bytes.\n";
    const run = subject({ [LOG]: originalRaw, [ROLLUP]: priorRollup });
    let rawInspections = 0;
    const durableFileSystem: DurableFileSystem = {
      ...run.ports.durableFileSystem,
      inspect: async (path) => {
        if (path === LOG) {
          rawInspections += 1;
          if (rawInspections === 2) {
            await run.storage.fileSystem.write(LOG, competingRaw);
          }
        }
        return run.storage.durableFileSystem.inspect(path);
      },
    };

    expect(
      await result(run, ["metrics", "refresh"], {
        ...run.ports,
        durableFileSystem,
      }),
    ).toMatchObject({
      reasonCode: "runtime.revision_conflict",
      stateChanged: false,
    });
    expect(run.storage.snapshot().files[LOG]).toBe(competingRaw);
    expect(run.storage.snapshot().files[ROLLUP]).toBe(priorRollup);
  });
});
