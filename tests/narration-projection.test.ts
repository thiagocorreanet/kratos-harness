import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import beatSchema from "../schemas/state/beat.v1.schema.json" with { type: "json" };
import narrationSchema from "../schemas/state/narration.v1.schema.json" with { type: "json" };
import { projectNarration } from "@kratos/runtime/domain/narration";
import type { ReadableEvent } from "@kratos/contracts";

describe("projectNarration", () => {
  const ajv = new Ajv2020({ strict: true });
  const validateBeat = ajv.compile(beatSchema);
  const validateNarration = ajv.compile(narrationSchema);

  it("projects milestone beats from workflow phase completed events", () => {
    const events: readonly ReadableEvent[] = [
      {
        contractVersion: "1.2.0",
        stateContract: "1.2.0",
        eventId: "evt-1",
        eventType: "transition",
        occurredAt: "2026-08-29T10:00:00.000Z",
        operation: "spec",
        policyVersion: "workflow-v1",
        priorRevision: 1,
        resultingRevision: 2,
        reasonCode: "workflow.phase_completed",
        effect: "state",
        artifactRefs: [],
        evidenceRefs: ["docs/specs/spec.md"],
        gateFailures: [],
        observedIdentity: { host: "cli", model: null, effort: null },
        previousHash: null,
        eventHash: "a".repeat(64),
      },
    ];

    const narration = projectNarration(events, { runId: "test-run" });
    expect(narration.beats).toHaveLength(1);
    const beat = narration.beats[0];
    expect(beat).toBeDefined();
    if (!beat) throw new Error("expected beat");
    expect(beat.kind).toBe("milestone");
    expect(beat.eventId).toBe("evt-1");
    expect(validateBeat(beat)).toBe(true);
    expect(validateNarration(narration)).toBe(true);
  });

  it("handles unrecognized reason codes gracefully without throwing", () => {
    const events: readonly ReadableEvent[] = [
      {
        contractVersion: "1.2.0",
        stateContract: "1.2.0",
        eventId: "evt-2",
        eventType: "decision",
        occurredAt: "2026-08-29T10:05:00.000Z",
        operation: "code",
        policyVersion: "workflow-v1",
        priorRevision: 2,
        resultingRevision: 2,
        reasonCode: "unknown.custom_failure",
        effect: "none",
        artifactRefs: [],
        evidenceRefs: ["evidence.json"],
        gateFailures: [],
        observedIdentity: { host: "cli", model: null, effort: null },
        previousHash: "a".repeat(64),
        eventHash: "b".repeat(64),
      },
    ];

    const narration = projectNarration(events, { runId: "test-run" });
    expect(narration.beats).toHaveLength(1);
    const beat = narration.beats[0];
    expect(beat).toBeDefined();
    if (!beat) throw new Error("expected beat");
    expect(beat.kind).toBe("stop");
    expect(beat.sentence).toContain("unknown.custom_failure");
    expect(beat.evidenceRefs).toEqual(["evidence.json"]);
    expect(validateBeat(beat)).toBe(true);
    expect(validateNarration(narration)).toBe(true);
  });

  it("projects clock-derived progress for in-flight operations with asOf", () => {
    const events: readonly ReadableEvent[] = [
      {
        contractVersion: "1.2.0",
        stateContract: "1.2.0",
        eventId: "evt-work-1",
        eventType: "operation",
        occurredAt: "2026-08-29T10:00:00.000Z",
        operation: "code",
        policyVersion: "workflow-v1",
        priorRevision: 1,
        resultingRevision: 2,
        reasonCode: "workflow.phase_started",
        effect: "state",
        artifactRefs: [],
        evidenceRefs: [],
        gateFailures: [],
        observedIdentity: { host: "cli", model: null, effort: null },
        previousHash: null,
        eventHash: "c".repeat(64),
      },
    ];

    const narration = projectNarration(events, {
      runId: "test-run",
      asOf: "2026-08-29T10:02:30.000Z",
    });

    expect(narration.beats).toHaveLength(1);
    const beat = narration.beats[0];
    expect(beat).toBeDefined();
    if (!beat) throw new Error("expected beat");
    expect(beat.kind).toBe("work");
    expect(narration.pendingProgress).toEqual({
      kind: "in_progress",
      eventId: "evt-work-1",
      operation: "code",
      elapsedMs: 150000,
      startedAt: "2026-08-29T10:00:00.000Z",
      asOf: "2026-08-29T10:02:30.000Z",
    });
    expect(validateNarration(narration)).toBe(true);
  });

  it("attaches evidenceRefs on waiting and stop beats", () => {
    const events: readonly ReadableEvent[] = [
      {
        contractVersion: "1.2.0",
        stateContract: "1.2.0",
        eventId: "evt-wait-1",
        eventType: "decision",
        occurredAt: "2026-08-29T10:10:00.000Z",
        operation: "review",
        policyVersion: "workflow-v1",
        priorRevision: 2,
        resultingRevision: 2,
        reasonCode: "gate.approval_required",
        effect: "none",
        artifactRefs: [],
        evidenceRefs: ["evidence/approval-prompt.json"],
        gateFailures: [],
        observedIdentity: { host: "cli", model: null, effort: null },
        previousHash: null,
        eventHash: "d".repeat(64),
      },
    ];

    const narration = projectNarration(events, { runId: "test-run" });
    expect(narration.beats).toHaveLength(1);
    const beat = narration.beats[0];
    expect(beat).toBeDefined();
    if (!beat) throw new Error("expected beat");
    expect(beat.kind).toBe("waiting");
    expect(beat.evidenceRefs).toEqual(["evidence/approval-prompt.json"]);
    expect(validateBeat(beat)).toBe(true);
  });

  it("projects empty narration for empty event log", () => {
    const narration = projectNarration([]);
    expect(narration.beats).toHaveLength(0);
    expect(narration.pendingProgress).toBeNull();
    expect(validateNarration(narration)).toBe(true);
  });
});
