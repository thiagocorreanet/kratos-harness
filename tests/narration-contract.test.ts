import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import beatSchema from "../schemas/state/beat.v1.schema.json" with { type: "json" };
import narrationSchema from "../schemas/state/narration.v1.schema.json" with { type: "json" };
import type {
  BeatV1,
  BeatKind,
  ClockDerivedProgress,
  NarrationV1,
} from "@kratos/contracts";

describe("narration contracts and schemas", () => {
  const ajv = new Ajv2020({ strict: true });
  const validateBeat = ajv.compile(beatSchema);
  const validateNarration = ajv.compile(narrationSchema);

  it("validates a valid BeatV1 fixture", () => {
    const beat: BeatV1 = {
      contractVersion: "1.0.0",
      beatId: "beat-001",
      kind: "milestone",
      subject: "phase:spec",
      sentence: "Specification verified and locked.",
      reasonCode: "workflow.phase_completed",
      occurredAt: "2026-08-29T12:00:00.000Z",
      eventId: "event-001",
      revision: 2,
      facts: {},
      evidenceRefs: [],
    };
    expect(validateBeat(beat)).toBe(true);
  });

  it("validates a valid NarrationV1 fixture", () => {
    const narration: NarrationV1 = {
      contractVersion: "1.0.0",
      runId: "run-001",
      generatedAt: "2026-08-29T12:05:00.000Z",
      beats: [],
      pendingProgress: null,
    };
    expect(validateNarration(narration)).toBe(true);
  });

  it("validates a NarrationV1 fixture with beats and pending progress", () => {
    const progress: ClockDerivedProgress = {
      kind: "in_progress",
      eventId: "event-002",
      operation: "code",
      elapsedMs: 1250,
      startedAt: "2026-08-29T12:00:00.000Z",
      asOf: "2026-08-29T12:00:01.250Z",
    };

    const beat: BeatV1 = {
      contractVersion: "1.0.0",
      beatId: "beat-001",
      kind: "work",
      subject: "phase:code",
      sentence: "Executing implementation step.",
      reasonCode: "task.step_started",
      occurredAt: "2026-08-29T12:00:00.000Z",
      eventId: "event-001",
      revision: 1,
      facts: { step: 1 },
      evidenceRefs: ["evidence.json"],
    };

    const narration: NarrationV1 = {
      contractVersion: "1.0.0",
      runId: "run-001",
      generatedAt: "2026-08-29T12:00:01.250Z",
      beats: [beat],
      pendingProgress: progress,
    };
    expect(validateNarration(narration)).toBe(true);
  });

  it("rejects invalid beat kind", () => {
    const invalidBeat = {
      contractVersion: "1.0.0",
      beatId: "beat-001",
      kind: "invalid-kind" as BeatKind,
      subject: "phase:spec",
      sentence: "Specification verified.",
      reasonCode: "workflow.phase_completed",
      occurredAt: "2026-08-29T12:00:00.000Z",
      eventId: "event-001",
      revision: 1,
      facts: {},
      evidenceRefs: [],
    };
    expect(validateBeat(invalidBeat)).toBe(false);
  });

  it("rejects invalid narration contract version", () => {
    const invalidNarration = {
      contractVersion: "2.0.0",
      runId: "run-001",
      generatedAt: "2026-08-29T12:05:00.000Z",
      beats: [],
      pendingProgress: null,
    };
    expect(validateNarration(invalidNarration)).toBe(false);
  });
});
