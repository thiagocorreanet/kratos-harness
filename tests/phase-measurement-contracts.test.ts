import { ajvSchemaRegistry } from "@kratos/runtime/infra/schema";
import { describe, expect, it } from "vitest";

const measurement = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  feature: "feature-144",
  runId: "run-144",
  phase: "code",
  sessionId: "session-144",
  correlationId: "correlation-144",
  status: "completed",
  startedAt: "2026-08-30T12:00:00.000Z",
  endedAt: "2026-08-30T12:03:00.000Z",
  durationMs: 180000,
  baselineGrossTokens: 100,
  finalGrossTokens: 160,
  grossTokens: 60,
  assignmentDigest: "a".repeat(64),
  resolvedAssignment: {
    host: "codex",
    role: "implementer",
    model: "codex-implementation",
    effort: "high",
  },
  observedIdentity: { model: "gpt-5", effort: "medium" },
  closeReason: "phase_completed",
  updatedAt: "2026-08-30T12:03:00.000Z",
} as const;

describe("phase measurement contract", () => {
  it("accepts a closed measurement with every authoritative field", () => {
    const result = ajvSchemaRegistry().validate({
      id: "state.phase-measurement",
      version: measurement.stateContract,
      value: measurement,
      structuralReasonCode: "runtime.state_corrupt",
    });

    expect(result).toEqual({ kind: "valid", value: measurement });
  });

  it("rejects closed-state nullability that conflicts with completed status", () => {
    const result = ajvSchemaRegistry().validate({
      id: "state.phase-measurement",
      version: measurement.stateContract,
      value: { ...measurement, endedAt: null },
      structuralReasonCode: "runtime.state_corrupt",
    });

    expect(result.kind).toBe("invalid");
  });

  it("rejects a running measurement that supplies final lifecycle fields", () => {
    const result = ajvSchemaRegistry().validate({
      id: "state.phase-measurement",
      version: measurement.stateContract,
      value: {
        ...measurement,
        status: "running",
        closeReason: null,
      },
      structuralReasonCode: "runtime.state_corrupt",
    });

    expect(result.kind).toBe("invalid");
  });
});
