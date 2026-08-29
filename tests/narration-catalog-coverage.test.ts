import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import beatSchema from "../schemas/state/beat.v1.schema.json" with { type: "json" };
import narrationSchema from "../schemas/state/narration.v1.schema.json" with { type: "json" };
import { REASON_CATALOG } from "@kratos/contracts";
import { projectNarration } from "@kratos/runtime/domain/narration";
import type { ReadableEvent } from "@kratos/contracts";

describe("narration reason catalog coverage", () => {
  const ajv = new Ajv2020({ strict: true });
  const validateBeat = ajv.compile(beatSchema);
  const validateNarration = ajv.compile(narrationSchema);

  it("covers every reason code in REASON_CATALOG without unhandled errors", () => {
    expect(REASON_CATALOG.length).toBeGreaterThan(0);

    for (const entry of REASON_CATALOG) {
      const event: ReadableEvent = {
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        eventId: `evt-${entry.code.replaceAll(".", "-")}`,
        eventType:
          entry.status === "failure" || entry.status === "blocked"
            ? "decision"
            : "operation",
        occurredAt: "2026-08-29T12:00:00.000Z",
        operation: "test",
        policyVersion: "workflow-v1",
        priorRevision: 0,
        resultingRevision: 1,
        reasonCode: entry.code,
        effect: "none",
        artifactRefs: [],
        evidenceRefs: ["ref.json"],
        observedIdentity: { host: "cli", model: null, effort: null },
        previousHash: null,
        eventHash: "0".repeat(64),
      };

      const result = projectNarration([event], { runId: `run-${entry.code}` });
      expect(result).toBeDefined();
      expect(result.beats).toHaveLength(1);
      const beat = result.beats[0];
      expect(beat).toBeDefined();
      if (!beat) throw new Error("expected beat");

      expect(beat.sentence.length).toBeGreaterThan(0);
      expect(beat.sentence).toBe(entry.description);
      expect(beat.reasonCode).toBe(entry.code);
      expect(validateBeat(beat)).toBe(true);
      expect(validateNarration(result)).toBe(true);
    }
  });

  it("projects full batch of all catalog reason codes in chronological sequence", () => {
    const allEvents: ReadableEvent[] = REASON_CATALOG.map((entry, index) => ({
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: `evt-batch-${String(index)}`,
      eventType:
        entry.status === "failure" || entry.status === "blocked"
          ? "decision"
          : "operation",
      occurredAt: `2026-08-29T12:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
      operation: "batch",
      policyVersion: "workflow-v1",
      priorRevision: index,
      resultingRevision: index + 1,
      reasonCode: entry.code,
      effect: "none",
      artifactRefs: [],
      evidenceRefs: ["ref.json"],
      observedIdentity: { host: "cli", model: null, effort: null },
      previousHash: null,
      eventHash: "0".repeat(64),
    }));

    const narration = projectNarration(allEvents, {
      runId: "catalog-batch-run",
    });
    expect(narration.beats).toHaveLength(REASON_CATALOG.length);
    expect(validateNarration(narration)).toBe(true);

    narration.beats.forEach((beat, index) => {
      const entry = REASON_CATALOG[index];
      expect(entry).toBeDefined();
      if (!entry) return;
      expect(beat.reasonCode).toBe(entry.code);
      expect(beat.sentence).toBe(entry.description);
      expect(validateBeat(beat)).toBe(true);
    });
  });
});
