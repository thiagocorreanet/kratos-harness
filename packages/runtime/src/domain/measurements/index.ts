import type { PhaseMeasurementV1 } from "@kratos/contracts";

import type { SchemaRegistry } from "../schema/index.js";
import { RUN_PHASES, type RunPhase } from "../workflow/index.js";

export type PhaseMeasurement = PhaseMeasurementV1;

export interface StartPhaseMeasurementInput {
  readonly feature: string;
  readonly runId: string;
  readonly phase: RunPhase;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly now: string;
  readonly totalGrossTokens: number;
  readonly assignmentDigest: string;
  readonly resolvedAssignment: PhaseMeasurement["resolvedAssignment"];
}

export interface SamplePhaseMeasurementInput {
  readonly record: PhaseMeasurement;
  readonly totalGrossTokens: number;
  readonly now: string;
}

export interface CompletePhaseMeasurementInput extends SamplePhaseMeasurementInput {
  readonly observedIdentity: PhaseMeasurement["observedIdentity"];
}

export interface InterruptPhaseMeasurementInput extends SamplePhaseMeasurementInput {
  readonly closeReason: "session_interrupted" | "recovered_interrupted";
}

function grossTokens(baseline: number, total: number): number {
  return Math.max(0, total - baseline);
}

function durationMs(startedAt: string, endedAt: string): number {
  return Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
}

export function startPhaseMeasurement(
  input: StartPhaseMeasurementInput,
): PhaseMeasurement {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    feature: input.feature,
    runId: input.runId,
    phase: input.phase,
    sessionId: input.sessionId,
    correlationId: input.correlationId,
    status: "running",
    startedAt: input.now,
    endedAt: null,
    durationMs: null,
    baselineGrossTokens: input.totalGrossTokens,
    finalGrossTokens: null,
    grossTokens: 0,
    assignmentDigest: input.assignmentDigest,
    resolvedAssignment: input.resolvedAssignment,
    observedIdentity: { model: null, effort: null },
    closeReason: null,
    updatedAt: input.now,
  };
}

export function samplePhaseMeasurement(
  input: SamplePhaseMeasurementInput,
): PhaseMeasurement {
  const record = input.record;
  if (record.status !== "running") {
    const latestGrossTokens = Math.max(
      record.finalGrossTokens,
      input.totalGrossTokens,
    );
    return {
      ...record,
      finalGrossTokens: latestGrossTokens,
      grossTokens: grossTokens(record.baselineGrossTokens, latestGrossTokens),
      updatedAt: input.now,
    };
  }
  return {
    ...record,
    grossTokens: grossTokens(
      record.baselineGrossTokens,
      input.totalGrossTokens,
    ),
    updatedAt: input.now,
  };
}

export function completePhaseMeasurement(
  input: CompletePhaseMeasurementInput,
): PhaseMeasurement {
  if (input.record.status !== "running") return input.record;
  const latestGrossTokens = input.totalGrossTokens;
  return {
    ...input.record,
    status: "completed",
    endedAt: input.now,
    durationMs: durationMs(input.record.startedAt, input.now),
    finalGrossTokens: latestGrossTokens,
    grossTokens: grossTokens(
      input.record.baselineGrossTokens,
      latestGrossTokens,
    ),
    observedIdentity: input.observedIdentity,
    closeReason: "phase_completed",
    updatedAt: input.now,
  };
}

export function interruptPhaseMeasurement(
  input: InterruptPhaseMeasurementInput,
): PhaseMeasurement {
  if (input.record.status !== "running") return input.record;
  const latestGrossTokens = input.totalGrossTokens;
  return {
    ...input.record,
    status: "interrupted",
    endedAt: input.now,
    durationMs: durationMs(input.record.startedAt, input.now),
    finalGrossTokens: latestGrossTokens,
    grossTokens: grossTokens(
      input.record.baselineGrossTokens,
      latestGrossTokens,
    ),
    closeReason: input.closeReason,
    updatedAt: input.now,
  };
}

function phaseOrder(phase: RunPhase): number {
  return RUN_PHASES.indexOf(phase);
}

export function upsertPhaseMeasurement(
  records: readonly PhaseMeasurement[],
  next: PhaseMeasurement,
): readonly PhaseMeasurement[] {
  const existing = records.find(
    (record) => record.runId === next.runId && record.phase === next.phase,
  );
  if (
    existing?.status === "running" &&
    existing.assignmentDigest !== next.assignmentDigest
  ) {
    throw new Error(
      "Phase measurement assignment conflicts with the open record",
    );
  }
  return [
    ...records.filter(
      (record) => record.runId !== next.runId || record.phase !== next.phase,
    ),
    next,
  ].sort(
    (left, right) =>
      left.runId.localeCompare(right.runId) ||
      phaseOrder(left.phase) - phaseOrder(right.phase),
  );
}

function stateContract(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return (value as { readonly stateContract?: unknown }).stateContract;
}

function hasValidMeasurementSemantics(record: PhaseMeasurement): boolean {
  if (record.status === "running") return true;
  return (
    record.grossTokens ===
      grossTokens(record.baselineGrossTokens, record.finalGrossTokens) &&
    record.durationMs === durationMs(record.startedAt, record.endedAt)
  );
}

export function parsePhaseMeasurementLog(
  text: string,
  registry: SchemaRegistry,
): readonly PhaseMeasurement[] {
  if (text === "") return [];
  if (text.includes("\r") || !text.endsWith("\n")) {
    throw new Error("Phase measurement log is invalid");
  }
  const lines = text.slice(0, -1).split("\n");
  if (lines.some((line) => line === "")) {
    throw new Error("Phase measurement log is invalid");
  }
  const records = lines.map((line) => {
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      throw new Error("Phase measurement log is invalid");
    }
    const validated = registry.validate({
      id: "state.phase-measurement",
      version: stateContract(value),
      value,
      structuralReasonCode: "runtime.state_corrupt",
    });
    if (validated.kind === "invalid") {
      throw new Error("Phase measurement log is invalid");
    }
    if (!hasValidMeasurementSemantics(validated.value)) {
      throw new Error("Phase measurement log is invalid");
    }
    return validated.value;
  });
  const keys = new Set<string>();
  for (const record of records) {
    const key = `${record.runId}\u0000${record.phase}`;
    if (keys.has(key)) throw new Error("Phase measurement log is invalid");
    keys.add(key);
  }
  return records;
}
