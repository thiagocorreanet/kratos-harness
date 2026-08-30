import { ajvSchemaRegistry } from "@kratos/runtime/infra/schema";
import {
  completePhaseMeasurement,
  interruptPhaseMeasurement,
  parsePhaseMeasurementLog,
  samplePhaseMeasurement,
  startPhaseMeasurement,
  upsertPhaseMeasurement,
} from "@kratos/runtime/domain/measurements";
import { describe, expect, it } from "vitest";

const assignmentDigest = "a".repeat(64);

const start = {
  feature: "feature-144",
  runId: "run-144",
  phase: "code" as const,
  sessionId: "session-144",
  correlationId: "correlation-144",
  now: "2026-08-30T12:00:00.000Z",
  totalGrossTokens: 100,
  assignmentDigest,
  resolvedAssignment: {
    host: "codex" as const,
    role: "implementer" as const,
    model: "codex-implementation",
    effort: "high",
  },
};

const running = startPhaseMeasurement(start);

describe("phase measurement domain", () => {
  it("replaces the same run and phase instead of appending a duplicate", () => {
    const updated = upsertPhaseMeasurement([running], {
      ...running,
      grossTokens: 42,
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]?.grossTokens).toBe(42);
  });

  it("accepts changed provenance for the same resolved assignment", () => {
    const updated = upsertPhaseMeasurement([running], {
      ...running,
      assignmentDigest: "b".repeat(64),
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]?.assignmentDigest).toBe("b".repeat(64));
  });

  it("refuses a different resolved assignment for an open phase", () => {
    expect(() =>
      upsertPhaseMeasurement([running], {
        ...running,
        resolvedAssignment: {
          ...running.resolvedAssignment,
          model: "different-model",
        },
      }),
    ).toThrow("Phase measurement assignment conflicts with the open record");
  });

  it("measures non-negative token deltas from the start baseline", () => {
    const sampled = samplePhaseMeasurement({
      record: running,
      totalGrossTokens: 84,
      now: "2026-08-30T12:01:00.000Z",
    });

    expect(sampled).toMatchObject({
      baselineGrossTokens: 100,
      finalGrossTokens: null,
      grossTokens: 0,
      updatedAt: "2026-08-30T12:01:00.000Z",
    });
  });

  it("closes a completed phase with its final usage and runtime duration", () => {
    const completed = completePhaseMeasurement({
      record: samplePhaseMeasurement({
        record: running,
        totalGrossTokens: 125,
        now: "2026-08-30T12:01:00.000Z",
      }),
      totalGrossTokens: 160,
      now: "2026-08-30T12:03:00.000Z",
      observedIdentity: { model: "gpt-5", effort: "medium" },
    });

    expect(completed).toMatchObject({
      status: "completed",
      endedAt: "2026-08-30T12:03:00.000Z",
      durationMs: 180_000,
      finalGrossTokens: 160,
      grossTokens: 60,
      closeReason: "phase_completed",
      observedIdentity: { model: "gpt-5", effort: "medium" },
    });
  });

  it("raises a closed phase usage sample without changing its completion", () => {
    const completed = completePhaseMeasurement({
      record: running,
      totalGrossTokens: 160,
      now: "2026-08-30T12:03:00.000Z",
      observedIdentity: { model: null, effort: null },
    });

    const sampled = samplePhaseMeasurement({
      record: completed,
      totalGrossTokens: 180,
      now: "2026-08-30T12:04:00.000Z",
    });

    expect(sampled).toMatchObject({
      endedAt: "2026-08-30T12:03:00.000Z",
      durationMs: 180_000,
      finalGrossTokens: 180,
      grossTokens: 80,
      updatedAt: "2026-08-30T12:04:00.000Z",
    });
  });

  it("closes an open phase as interrupted only with an interrupted reason", () => {
    const interrupted = interruptPhaseMeasurement({
      record: running,
      totalGrossTokens: 120,
      now: "2026-08-30T12:02:00.000Z",
      closeReason: "session_interrupted",
    });

    expect(interrupted).toMatchObject({
      status: "interrupted",
      durationMs: 120_000,
      finalGrossTokens: 120,
      grossTokens: 20,
      closeReason: "session_interrupted",
    });
  });

  it("refuses lifecycle closure before the phase start", () => {
    expect(() =>
      completePhaseMeasurement({
        record: running,
        totalGrossTokens: 120,
        now: "2026-08-30T11:59:59.000Z",
        observedIdentity: { model: null, effort: null },
      }),
    ).toThrow("Phase measurement chronology is invalid");
  });

  it("parses only lines accepted by the registered measurement contract", () => {
    const record = completePhaseMeasurement({
      record: running,
      totalGrossTokens: 150,
      now: "2026-08-30T12:01:30.000Z",
      observedIdentity: { model: null, effort: null },
    });
    const parsed = parsePhaseMeasurementLog(
      `${JSON.stringify(record)}\n`,
      ajvSchemaRegistry(),
    );

    expect(parsed).toEqual([record]);
  });

  it("refuses a log record whose gross tokens do not equal its usage delta", () => {
    const record = completePhaseMeasurement({
      record: running,
      totalGrossTokens: 150,
      now: "2026-08-30T12:01:30.000Z",
      observedIdentity: { model: null, effort: null },
    });

    expect(() =>
      parsePhaseMeasurementLog(
        `${JSON.stringify({ ...record, grossTokens: 51 })}\n`,
        ajvSchemaRegistry(),
      ),
    ).toThrow("Phase measurement log is invalid");
  });

  it("refuses duplicate run and phase keys in a raw measurement log", () => {
    const record = completePhaseMeasurement({
      record: running,
      totalGrossTokens: 150,
      now: "2026-08-30T12:01:30.000Z",
      observedIdentity: { model: null, effort: null },
    });

    expect(() =>
      parsePhaseMeasurementLog(
        `${JSON.stringify(record)}\n${JSON.stringify(record)}\n`,
        ajvSchemaRegistry(),
      ),
    ).toThrow("Phase measurement log is invalid");
  });

  it("refuses a parsed closed record ending before its phase start", () => {
    const record = completePhaseMeasurement({
      record: running,
      totalGrossTokens: 150,
      now: "2026-08-30T12:01:30.000Z",
      observedIdentity: { model: null, effort: null },
    });

    expect(() =>
      parsePhaseMeasurementLog(
        `${JSON.stringify({
          ...record,
          endedAt: "2026-08-30T11:59:59.000Z",
          durationMs: 0,
        })}\n`,
        ajvSchemaRegistry(),
      ),
    ).toThrow("Phase measurement log is invalid");
  });
});
