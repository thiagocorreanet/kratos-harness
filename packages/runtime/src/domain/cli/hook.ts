import type { Effect } from "../effects.js";
import { planOf } from "../effects.js";
import { recordUsageSample } from "../hooks/index.js";
import {
  addPhaseMeasurementContributor,
  interruptPhaseMeasurement,
  reconcileContributorCheckpoint,
  recoverPhaseMeasurements,
  renderPhaseMeasurementLog,
  samePhaseMeasurementAssignment,
  startPhaseMeasurement,
  upsertPhaseMeasurement,
  type PhaseMeasurement,
} from "../measurements/index.js";
import { resultFor, usageFailure } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Observation = Extract<
  CommandObservation,
  { readonly kind: "host-operation" }
>;
type Measurements = NonNullable<Observation["context"]>["measurements"];

export const hookCommand: CommandSpec = observingCommand(
  "host-operation",
  {
    path: ["hook"],
    summary: "Accept one versioned host hook message from standard input.",
    flags: [
      {
        name: "--host",
        kind: "value",
        valueLabel: "<id>",
        summary: "Require the hook to name this host.",
      },
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Operate on the project rooted at this path.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) =>
    decide(invocation.flags.get("--host"), observation),
);

function decide(
  requestedHost: string | true | undefined,
  observation: Observation,
): Decision {
  if (typeof requestedHost !== "string") {
    return refusal("The hook host must be supplied explicitly.");
  }
  if (observation.message.kind !== "hook") {
    return refusal("The hook command accepts only hook lifecycle messages.");
  }
  if (observation.message.payload.host !== requestedHost) {
    return refusal("The supplied host differs from the hook payload host.");
  }
  if (observation.lifecycle !== null) {
    return decidePhaseStart(observation);
  }
  if (observation.hook === null) {
    return refusal("The normalized hook artifact is absent or invalid.");
  }
  const context = observation.context;
  if (context === null || observation.hook.kind === "tool.before") {
    return unchanged("The hook had no active run state to update.");
  }

  const hook = observation.hook;
  if (
    context.measurementTarget?.claimSession === true &&
    context.usage.sessions.some(
      ({ sessionId }) => sessionId === hook.sessionId,
    ) &&
    !context.measurements.records.some(
      (record) =>
        record.feature === context.feature &&
        record.runId === context.runId &&
        record.contributingSessionIds.includes(hook.sessionId),
    )
  ) {
    return refusedMetric(
      "runtime.state_corrupt",
      "Recorded run usage has no durable phase contributor owner.",
    );
  }
  const cumulativeGrossTokens = hook.usage?.cumulativeGrossTokens ?? null;
  const sampled = recordUsageSample(context.usage, {
    sessionId: hook.sessionId,
    cumulativeGrossTokens,
    budget: context.budget,
    now: hook.occurredAt,
  });
  const runRoot = `.brain/02-features/${context.feature}/runs/${context.runId}`;
  const usagePath = `${runRoot}/usage.json`;
  const gatesPath = `${runRoot}/gates.json`;
  const gates = {
    ...context.gates,
    stopLoss: {
      tripped: context.gates.stopLoss.tripped || sampled.stopLoss.tripped,
      exhausted: context.gates.stopLoss.exhausted || sampled.stopLoss.exhausted,
    },
    derivedAt: hook.occurredAt,
  };
  const effects: Effect[] = [];
  if (JSON.stringify(sampled.usage) !== JSON.stringify(context.usage)) {
    effects.push(write(usagePath, sampled.usage, context.usageExpected));
  }
  if (JSON.stringify(gates) !== JSON.stringify(context.gates)) {
    effects.push(write(gatesPath, gates, context.gatesExpected));
  }

  const measured = measurementForTarget(
    context.measurements.records,
    context.feature,
    context.runId,
    context.measurementTarget?.phase ?? null,
  );
  if (context.measurementTarget !== null && measured === null) {
    return refusedMetric(
      "runtime.state_corrupt",
      "The selected phase measurement owner is unavailable.",
    );
  }
  if (measured !== null) {
    let nextRecords = context.measurements.records;
    if (cumulativeGrossTokens !== null) {
      try {
        nextRecords = reconcileContributorCheckpoint({
          records: nextRecords,
          feature: context.feature,
          runId: context.runId,
          phase: measured.phase,
          sessionId: hook.sessionId,
          cumulativeGrossTokens,
          occurredAt: hook.occurredAt,
          claimContributor: context.measurementTarget?.claimSession === true,
          expectedRunGrossTokens: sampled.usage.totalGrossTokens,
        });
      } catch {
        return refusedMetric(
          "runtime.state_corrupt",
          "The phase checkpoint cannot be reconciled without inventing usage.",
        );
      }
    }
    const sampledMeasurement = measurementForTarget(
      nextRecords,
      context.feature,
      context.runId,
      measured.phase,
    );
    if (sampledMeasurement === null) {
      return refusedMetric(
        "runtime.state_corrupt",
        "The reconciled phase measurement owner is unavailable.",
      );
    }
    const nextMeasurement =
      hook.kind === "session.end" &&
      hook.sessionId === sampledMeasurement.sessionId &&
      sampledMeasurement.status === "running"
        ? interruptPhaseMeasurement({
            record: sampledMeasurement,
            totalGrossTokens:
              sampledMeasurement.baselineGrossTokens +
              sampledMeasurement.grossTokens,
            now: hook.occurredAt,
            closeReason: "session_interrupted",
          })
        : sampledMeasurement;
    nextRecords = upsertPhaseMeasurement(nextRecords, nextMeasurement);
    const measurementEffect = writeMeasurements(
      context.measurements,
      nextRecords,
    );
    if (measurementEffect !== null) effects.push(measurementEffect);
  }

  const cachePath = `.brain/03-memory/.cache/hooks/${hook.sessionId}/telemetry.json`;
  const cache = {
    startedAt: context.cache?.startedAt ?? hook.occurredAt,
    grossTokens: Math.max(
      context.cache?.grossTokens ?? 0,
      cumulativeGrossTokens ?? 0,
    ),
    toolFailures:
      (context.cache?.toolFailures ?? 0) +
      (hook.kind === "tool.failed" ? 1 : 0),
  };

  if (hook.kind === "tool.failed") {
    if (context.capture?.write === true) {
      effects.push(
        write(
          `.brain/03-memory/candidates/${context.capture.candidate.candidateId}.json`,
          context.capture.candidate,
          { kind: "missing" },
        ),
      );
    }
    effects.push(write(cachePath, cache));
  } else if (hook.kind === "session.sample") {
    effects.push(write(cachePath, cache));
  } else {
    if (!context.telemetryExists) {
      effects.push(
        write(
          `.brain/03-memory/telemetry/${hook.sessionId}.json`,
          {
            contractVersion: "1.0.0",
            stateContract: "1.0.0",
            sessionId: hook.sessionId,
            runId: context.runId,
            startedAt: cache.startedAt,
            endedAt: hook.occurredAt,
            grossTokens: cache.grossTokens,
            toolFailures: cache.toolFailures,
          },
          { kind: "missing" },
        ),
      );
    }
    for (const path of context.transientFiles) {
      effects.push({ kind: "delete_file", path });
    }
  }

  if (effects.length === 0)
    return unchanged("The hook was already reflected in state.");
  return {
    result: resultFor("trail.ok", {
      summary: "The normalized host observation was recorded.",
      evidence: [
        {
          kind: "artifact",
          ref: observation.message.payload.artifact.ref,
          sha256: observation.message.payload.artifact.sha256,
        },
      ],
    }),
    plan: planOf(...effects),
    humanStdout: null,
    payload: null,
  };
}

function decidePhaseStart(observation: Observation): Decision {
  const lifecycle = observation.lifecycle;
  const context = observation.phaseStart;
  if (lifecycle === null || context === null) {
    return refusal("The normalized phase lifecycle context is unavailable.");
  }
  if (observation.message.kind !== "hook") {
    return refusal("The phase lifecycle requires a hook envelope.");
  }
  if (lifecycle.assignmentDigest !== context.assignment.assignmentDigest) {
    return refusedMetric(
      "metrics.phase_assignment_conflict",
      "The phase start does not match the runtime-resolved assignment.",
    );
  }
  const resolvedAssignment = {
    host: context.assignment.host,
    role: context.assignment.assignment.role,
    model: context.assignment.assignment.model,
    effort: context.assignment.assignment.effort,
  };
  const openPhase = context.measurements.records.find(
    (record) =>
      record.feature === context.feature &&
      record.runId === context.runId &&
      record.phase === context.phase &&
      record.status === "running",
  );
  if (
    openPhase !== undefined &&
    !samePhaseMeasurementAssignment(
      openPhase.resolvedAssignment,
      resolvedAssignment,
    )
  ) {
    return refusedMetric(
      "metrics.phase_assignment_conflict",
      "The open phase measurement belongs to another assignment.",
    );
  }
  let continued: PhaseMeasurement | undefined;
  try {
    continued =
      openPhase === undefined ||
      (openPhase.sessionId === lifecycle.sessionId &&
        openPhase.correlationId === lifecycle.correlationId &&
        openPhase.assignmentDigest === lifecycle.assignmentDigest)
        ? openPhase
        : {
            ...addPhaseMeasurementContributor(openPhase, lifecycle.sessionId),
            sessionId: lifecycle.sessionId,
            correlationId: lifecycle.correlationId,
            assignmentDigest: lifecycle.assignmentDigest,
            updatedAt: lifecycle.occurredAt,
          };
  } catch {
    return refusedMetric(
      "runtime.state_corrupt",
      "The open phase measurement cannot accept another contributor.",
    );
  }
  let recovered: readonly PhaseMeasurement[];
  try {
    const expectedRecoveries = context.measurements.records.filter(
      (record) => record.status === "running" && record !== openPhase,
    );
    if (expectedRecoveries.length !== context.recoveries.length) {
      throw new Error("A stale phase measurement has no recovery fact");
    }
    recovered = recoverPhaseMeasurements({
      records: context.measurements.records,
      recoveries: context.recoveries.map((recovery) => ({
        ...recovery,
        now: lifecycle.occurredAt,
      })),
    });
  } catch {
    return refusedMetric(
      "runtime.state_corrupt",
      "A stale phase measurement cannot be recovered without inventing usage.",
    );
  }
  const started =
    continued ??
    startPhaseMeasurement({
      feature: context.feature,
      runId: context.runId,
      phase: context.phase,
      sessionId: lifecycle.sessionId,
      correlationId: lifecycle.correlationId,
      now: lifecycle.occurredAt,
      totalGrossTokens: context.usage.totalGrossTokens,
      assignmentDigest: lifecycle.assignmentDigest,
      resolvedAssignment,
    });
  let nextRecords: readonly PhaseMeasurement[];
  try {
    nextRecords = upsertPhaseMeasurement(recovered, started);
  } catch {
    return refusedMetric(
      "runtime.state_corrupt",
      "The phase measurement state cannot accept the phase start.",
    );
  }
  const effect = writeMeasurements(context.measurements, nextRecords);
  if (effect === null) {
    return unchanged("The phase start was already reflected in state.");
  }
  return {
    result: resultFor("trail.ok", {
      summary: "The phase measurement was started.",
      stateChanged: true,
      evidence: [
        {
          kind: "artifact",
          ref: observation.message.payload.artifact.ref,
          sha256: observation.message.payload.artifact.sha256,
        },
      ],
    }),
    plan: planOf(effect),
    humanStdout: null,
    payload: null,
  };
}

function measurementForTarget(
  records: readonly PhaseMeasurement[],
  feature: string,
  runId: string,
  phase: PhaseMeasurement["phase"] | null,
): PhaseMeasurement | null {
  if (phase === null) return null;
  return (
    records.find(
      (record) =>
        record.feature === feature &&
        record.runId === runId &&
        record.phase === phase,
    ) ?? null
  );
}

function writeMeasurements(
  observation: Measurements,
  records: readonly PhaseMeasurement[],
): Extract<Effect, { kind: "write_file" }> | null {
  const content = renderPhaseMeasurementLog(records);
  return content === observation.content
    ? null
    : {
        kind: "write_file",
        path: ".brain/03-memory/task_log.jsonl",
        content,
        expected: observation.expected,
      };
}

function refusedMetric(code: string, why: string): Decision {
  return {
    result: resultFor(code, {
      why: [why],
      evidence: [{ kind: "artifact", ref: ".brain/03-memory/task_log.jsonl" }],
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function write(
  path: string,
  value: unknown,
  expected?: Extract<Effect, { kind: "write_file" }>["expected"],
): Extract<Effect, { kind: "write_file" }> {
  return expected === undefined
    ? {
        kind: "write_file",
        path,
        content: `${JSON.stringify(value, null, 2)}\n`,
      }
    : {
        kind: "write_file",
        path,
        content: `${JSON.stringify(value, null, 2)}\n`,
        expected,
      };
}

function unchanged(summary: string): Decision {
  return {
    result: resultFor("runtime.orientation_ok", { summary }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function refusal(why: string): Decision {
  return {
    result: usageFailure(why),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
