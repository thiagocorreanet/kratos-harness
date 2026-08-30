import { describe, expect, it, vi } from "vitest";
import { projectNarration } from "@kratos/runtime/domain/narration";
import type { ReadableEvent } from "@kratos/contracts";

describe("narration purity", () => {
  const sampleEvents: readonly ReadableEvent[] = [
    {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "evt-purity-1",
      eventType: "operation",
      occurredAt: "2026-08-29T10:00:00.000Z",
      operation: "spec",
      policyVersion: "workflow-v1",
      priorRevision: 1,
      resultingRevision: 2,
      reasonCode: "workflow.phase_started",
      effect: "state",
      artifactRefs: [],
      evidenceRefs: [],
      observedIdentity: { host: "cli", model: null, effort: null },
      previousHash: null,
      eventHash: "a".repeat(64),
    },
    {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "evt-purity-2",
      eventType: "transition",
      occurredAt: "2026-08-29T10:02:00.000Z",
      operation: "spec",
      policyVersion: "workflow-v1",
      priorRevision: 2,
      resultingRevision: 3,
      reasonCode: "workflow.phase_completed",
      effect: "state",
      artifactRefs: ["docs/specs/spec.md"],
      evidenceRefs: ["docs/specs/spec.md"],
      observedIdentity: { host: "cli", model: null, effort: null },
      previousHash: "a".repeat(64),
      eventHash: "b".repeat(64),
    },
  ];

  it("does not access system clock during projection", () => {
    const dateNowSpy = vi.spyOn(Date, "now");
    const hrtimeSpy = vi.spyOn(process, "hrtime");

    projectNarration(sampleEvents, { runId: "purity-run" });

    expect(dateNowSpy).not.toHaveBeenCalled();
    expect(hrtimeSpy).not.toHaveBeenCalled();

    dateNowSpy.mockRestore();
    hrtimeSpy.mockRestore();
  });

  it("is deterministic and produces byte-identical output across repeated runs", () => {
    const run1 = projectNarration(sampleEvents, {
      runId: "run-deterministic",
      asOf: "2026-08-29T10:05:00.000Z",
    });
    const run2 = projectNarration(sampleEvents, {
      runId: "run-deterministic",
      asOf: "2026-08-29T10:05:00.000Z",
    });

    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });

  it("does not mutate the input event log", () => {
    const frozenEvents: readonly ReadableEvent[] = Object.freeze(
      sampleEvents.map((e) => Object.freeze({ ...e })),
    );

    expect(() => {
      projectNarration(frozenEvents, { runId: "frozen-run" });
    }).not.toThrow();
  });

  it("produces fresh objects without leaking input references", () => {
    const narration = projectNarration(sampleEvents, { runId: "fresh-run" });
    expect(narration.beats).not.toBe(sampleEvents);
    for (let i = 0; i < sampleEvents.length; i++) {
      const beat = narration.beats[i];
      const event = sampleEvents[i];
      expect(beat).toBeDefined();
      expect(event).toBeDefined();
      expect(beat?.evidenceRefs).not.toBe(event?.evidenceRefs);
      expect(beat?.evidenceRefs).toEqual(event?.evidenceRefs);
    }
  });
});
