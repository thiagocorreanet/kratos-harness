import { ajvSchemaRegistry } from "@kratos/runtime/infra/schema";
import { describe, expect, it } from "vitest";

const measurement = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  feature: "feature-144",
  runId: "run-144",
  phase: "code",
  sessionId: "session-144",
  contributingSessionIds: ["session-144", "session-worker"],
  contributorCheckpoints: [],
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

  it("accepts an Antigravity phase measurement assignment", () => {
    const antigravityMeasurement = {
      ...measurement,
      resolvedAssignment: {
        ...measurement.resolvedAssignment,
        host: "antigravity",
      },
    } as const;
    const result = ajvSchemaRegistry().validate({
      id: "state.phase-measurement",
      version: antigravityMeasurement.stateContract,
      value: antigravityMeasurement,
      structuralReasonCode: "runtime.state_corrupt",
    });

    expect(result).toEqual({
      kind: "valid",
      value: antigravityMeasurement,
    });
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

  it("accepts the exact pre-ownership v1 measurement shape", () => {
    const missingContributors: Record<string, unknown> = { ...measurement };
    delete missingContributors.contributingSessionIds;
    const result = ajvSchemaRegistry().validate({
      id: "state.phase-measurement",
      version: measurement.stateContract,
      value: missingContributors,
      structuralReasonCode: "runtime.state_corrupt",
    });

    expect(result).toEqual({
      kind: "valid",
      value: missingContributors,
    });
  });

  it("accepts a legacy v1 measurement without contributor checkpoints", () => {
    const legacy: Record<string, unknown> = { ...measurement };
    delete legacy.contributorCheckpoints;
    const result = ajvSchemaRegistry().validate({
      id: "state.phase-measurement",
      version: measurement.stateContract,
      value: legacy,
      structuralReasonCode: "runtime.state_corrupt",
    });

    expect(result).toEqual({ kind: "valid", value: legacy });
  });

  it.each([
    {
      label: "an invalid session id",
      checkpoints: [
        {
          sessionId: "invalid session",
          cumulativeGrossTokens: 20,
          occurredAt: "2026-08-30T12:01:00.000Z",
        },
      ],
    },
    {
      label: "an invalid timestamp",
      checkpoints: [
        {
          sessionId: "session-144",
          cumulativeGrossTokens: 20,
          occurredAt: "not-a-timestamp",
        },
      ],
    },
    {
      label: "an exact duplicate",
      checkpoints: [
        {
          sessionId: "session-144",
          cumulativeGrossTokens: 20,
          occurredAt: "2026-08-30T12:01:00.000Z",
        },
        {
          sessionId: "session-144",
          cumulativeGrossTokens: 20,
          occurredAt: "2026-08-30T12:01:00.000Z",
        },
      ],
    },
    {
      label: "more than 256 entries",
      checkpoints: Array.from({ length: 257 }, (_, index) => ({
        sessionId: `session-${String(index).padStart(3, "0")}`,
        cumulativeGrossTokens: index,
        occurredAt: "2026-08-30T12:01:00.000Z",
      })),
    },
  ])("rejects contributor checkpoints with $label", ({ checkpoints }) => {
    const result = ajvSchemaRegistry().validate({
      id: "state.phase-measurement",
      version: measurement.stateContract,
      value: { ...measurement, contributorCheckpoints: checkpoints },
      structuralReasonCode: "runtime.state_corrupt",
    });

    expect(result.kind).toBe("invalid");
  });

  it("rejects duplicate contributor ownership", () => {
    const result = ajvSchemaRegistry().validate({
      id: "state.phase-measurement",
      version: measurement.stateContract,
      value: {
        ...measurement,
        contributingSessionIds: ["session-144", "session-144"],
      },
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
