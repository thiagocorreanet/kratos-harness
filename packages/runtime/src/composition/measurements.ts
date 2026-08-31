import type { ReadableEvent, RunUsageV1 } from "@kratos/contracts";

import type { WriteFilePrecondition } from "../domain/effects.js";
import { verifyEventStream } from "../domain/events/index.js";
import { initialRunUsage } from "../domain/hooks/index.js";
import {
  parsePhaseMeasurementLog,
  recoverPhaseMeasurements,
  renderPhaseMeasurementLog,
  type PhaseMeasurement,
} from "../domain/measurements/index.js";
import { resultFor, type Result } from "../domain/result/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import type { DurableEntry, RuntimePorts } from "../ports/index.js";

import { anchorPorts, resolveCommandRoot } from "./root.js";

export const PHASE_MEASUREMENT_LOG = ".brain/03-memory/task_log.jsonl";
export const PHASE_METRICS_ROLLUP = ".brain/03-memory/task_metrics.md";

export interface PhaseMeasurementLogObservation {
  readonly content: string;
  readonly records: readonly PhaseMeasurement[];
  readonly expected: WriteFilePrecondition;
}

export async function observePhaseMeasurementLog(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<PhaseMeasurementLogObservation | null> {
  const entry = await ports.durableFileSystem.inspect(PHASE_MEASUREMENT_LOG);
  if (entry.kind === "missing") {
    return { content: "", records: [], expected: { kind: "missing" } };
  }
  if (entry.kind !== "file") return null;
  try {
    const content = await ports.durableFileSystem.readText(
      PHASE_MEASUREMENT_LOG,
    );
    return {
      content,
      records: parsePhaseMeasurementLog(content, registry),
      expected: precondition(entry),
    };
  } catch {
    return null;
  }
}

export interface RunUsageObservation {
  readonly usage: RunUsageV1;
  /** Null means missing, corrupt, or bound to another run. */
  readonly tokenUsage: number | null;
}

export async function observeValidatedRunUsage(
  feature: string,
  runId: string,
  now: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<RunUsageObservation> {
  const path = `.brain/02-features/${feature}/runs/${runId}/usage.json`;
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind !== "file") {
    return { usage: initialRunUsage(runId, now), tokenUsage: null };
  }
  try {
    const validated = registry.validate({
      id: "state.run-usage",
      version: "1.0.0",
      value: JSON.parse(
        await ports.durableFileSystem.readText(path),
      ) as unknown,
      structuralReasonCode: "runtime.state_corrupt",
    });
    if (validated.kind !== "valid" || validated.value.runId !== runId) {
      return { usage: initialRunUsage(runId, now), tokenUsage: null };
    }
    return {
      usage: validated.value,
      tokenUsage: validated.value.totalGrossTokens,
    };
  } catch {
    return { usage: initialRunUsage(runId, now), tokenUsage: null };
  }
}

type MetricsRefreshObservation = Extract<
  CommandObservation,
  { readonly kind: "metrics-refresh" }
>;

export type ObservedMetricsRefresh =
  | { readonly kind: "failure"; readonly result: Result }
  | {
      readonly kind: "observed";
      readonly observation: MetricsRefreshObservation;
      readonly ports: RuntimePorts;
    };

type AcceptedTransitionObservation =
  | { readonly kind: "absent" }
  | { readonly kind: "accepted"; readonly event: ReadableEvent }
  | { readonly kind: "corrupt"; readonly evidenceRef: string };

export type PhaseMeasurementRecoveryObservation =
  | {
      readonly kind: "observed";
      readonly totalGrossTokens: number | null;
      readonly accepted: {
        readonly occurredAt: string;
        readonly observedIdentity: PhaseMeasurement["observedIdentity"];
      } | null;
    }
  | Extract<AcceptedTransitionObservation, { readonly kind: "corrupt" }>;

/** Observe the run-local facts needed to close one stale measurement. */
export async function observePhaseMeasurementRecovery(
  record: PhaseMeasurement,
  now: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<PhaseMeasurementRecoveryObservation> {
  const accepted = await acceptedTransition(record, ports, registry);
  if (accepted.kind === "corrupt") return accepted;
  const usage = await observeValidatedRunUsage(
    record.feature,
    record.runId,
    now,
    ports,
    registry,
  );
  return {
    kind: "observed",
    totalGrossTokens: usage.tokenUsage,
    accepted:
      accepted.kind === "absent"
        ? null
        : {
            occurredAt: accepted.event.occurredAt,
            observedIdentity: {
              model: accepted.event.observedIdentity.model,
              effort:
                "effort" in accepted.event.observedIdentity
                  ? accepted.event.observedIdentity.effort
                  : null,
            },
          },
  };
}

/** Observe and reconcile the complete local measurement set without writing. */
export async function observeMetricsRefresh(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ObservedMetricsRefresh> {
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return root;
  const anchored = anchorPorts(root.target, ports);
  const measurements = await observePhaseMeasurementLog(anchored, registry);
  if (measurements === null) return invalidMeasurementLog();
  const rollupEntry =
    await anchored.durableFileSystem.inspect(PHASE_METRICS_ROLLUP);
  if (rollupEntry.kind !== "file" && rollupEntry.kind !== "missing") {
    return {
      kind: "failure",
      result: resultFor("runtime.state_corrupt", {
        why: ["The committed task metrics destination is not a file."],
        evidence: [{ kind: "artifact", ref: PHASE_METRICS_ROLLUP }],
      }),
    };
  }
  const generatedAt = anchored.clock.now().toISOString();
  const observedRecoveries = await Promise.all(
    measurements.records.flatMap((record) =>
      record.status === "running"
        ? [
            observePhaseMeasurementRecovery(
              record,
              generatedAt,
              anchored,
              registry,
            ).then((recovery) => ({ record, recovery })),
          ]
        : [],
    ),
  );
  for (const { recovery } of observedRecoveries) {
    if (recovery.kind === "corrupt") {
      return {
        kind: "failure",
        result: corruptPhaseMeasurementEventStreamResult(recovery.evidenceRef),
      };
    }
  }
  let records: readonly PhaseMeasurement[];
  try {
    records = recoverPhaseMeasurements({
      records: measurements.records,
      recoveries: observedRecoveries.map(({ record, recovery }) => {
        if (recovery.kind !== "observed") {
          throw new Error("Phase measurement recovery is corrupt");
        }
        return {
          feature: record.feature,
          runId: record.runId,
          phase: record.phase,
          totalGrossTokens: recovery.totalGrossTokens,
          now: generatedAt,
          accepted: recovery.accepted,
        };
      }),
    });
  } catch {
    return corruptPhaseMeasurementState();
  }
  const content = renderPhaseMeasurementLog(records);
  return {
    kind: "observed",
    observation: {
      kind: "metrics-refresh",
      generatedAt,
      sourceLogSha256: anchored.digests.sha256(content),
      measurements: {
        previousContent: measurements.content,
        content,
        records,
        expected: measurements.expected,
      },
      rollupExpected: precondition(rollupEntry),
    },
    ports: anchored,
  };
}

async function acceptedTransition(
  record: PhaseMeasurement,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<AcceptedTransitionObservation> {
  const path = `.brain/02-features/${record.feature}/runs/${record.runId}/events.jsonl`;
  try {
    const entry = await ports.durableFileSystem.inspect(path);
    if (entry.kind === "missing") return { kind: "absent" };
    if (entry.kind !== "file") {
      return { kind: "corrupt", evidenceRef: path };
    }
    const verified = verifyEventStream(
      await ports.durableFileSystem.readText(path),
      {
        digests: ports.digests,
        isProxy: () => false,
        isPromise: () => false,
        schemaRegistry: registry,
      },
    );
    const event = verified.events.find(
      (candidate) =>
        (candidate.reasonCode === "run.transition.accepted" ||
          candidate.reasonCode === "run.completed") &&
        "resolvedAssignment" in candidate &&
        candidate.resolvedAssignment.phase === record.phase &&
        Date.parse(candidate.occurredAt) >= Date.parse(record.startedAt),
    );
    return event === undefined
      ? { kind: "absent" }
      : { kind: "accepted", event };
  } catch {
    return { kind: "corrupt", evidenceRef: path };
  }
}

export function corruptPhaseMeasurementEventStreamResult(
  evidenceRef: string,
): Result {
  return resultFor("runtime.state_corrupt", {
    why: [
      "A workflow event stream required to reconcile phase measurements is corrupt.",
    ],
    evidence: [{ kind: "event", ref: evidenceRef }],
  });
}

function corruptPhaseMeasurementState(): Extract<
  ObservedMetricsRefresh,
  { readonly kind: "failure" }
> {
  return {
    kind: "failure",
    result: resultFor("runtime.state_corrupt", {
      why: ["Phase measurement recovery cannot conserve validated run usage."],
      evidence: [{ kind: "artifact", ref: PHASE_MEASUREMENT_LOG }],
    }),
  };
}

function invalidMeasurementLog(): Extract<
  ObservedMetricsRefresh,
  { readonly kind: "failure" }
> {
  return {
    kind: "failure",
    result: resultFor("metrics.log_invalid", {
      why: ["The local phase measurement log could not be validated."],
      evidence: [{ kind: "artifact", ref: PHASE_MEASUREMENT_LOG }],
    }),
  };
}

function precondition(entry: DurableEntry): WriteFilePrecondition {
  return entry.kind === "file"
    ? { kind: "file", size: entry.size, sha256: entry.sha256 }
    : { kind: "missing" };
}
