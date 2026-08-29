import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import beatSchema from "../schemas/state/beat.v1.schema.json" with { type: "json" };
import narrationSchema from "../schemas/state/narration.v1.schema.json" with { type: "json" };
import eventSchema from "../schemas/state/event.v1.1.schema.json" with { type: "json" };
import type { NarrationV1, ReadableEvent } from "@kratos/contracts";
import { projectNarration } from "@kratos/runtime/domain/narration";

describe("narration golden replay", () => {
  const ajv = new Ajv2020({ strict: true });
  const validateBeat = ajv.compile(beatSchema);
  const validateNarration = ajv.compile(narrationSchema);
  const validateEvent = ajv.compile(eventSchema);

  const eventsPath = resolve(
    __dirname,
    "../fixtures/narration/sample-run-events.jsonl",
  );
  const goldenBeatsPath = resolve(
    __dirname,
    "../fixtures/narration/sample-run-beats.json",
  );

  const rawEventsContent = readFileSync(eventsPath, "utf-8");
  const rawGoldenContent = readFileSync(goldenBeatsPath, "utf-8");

  const events: readonly ReadableEvent[] = rawEventsContent
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ReadableEvent);

  const goldenNarration = JSON.parse(rawGoldenContent) as NarrationV1;

  it("validates all recorded events against the event schema", () => {
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      const valid = validateEvent(event);
      expect(valid).toBe(true);
    }
  });

  it("validates golden beats fixture against narration and beat schemas", () => {
    expect(validateNarration(goldenNarration)).toBe(true);
    for (const beat of goldenNarration.beats) {
      expect(validateBeat(beat)).toBe(true);
    }
  });

  it("replays recorded run producing exact golden beat output", () => {
    const projected = projectNarration(events, { runId: "sample-run-001" });

    expect(projected).toEqual(goldenNarration);
    expect(JSON.stringify(projected)).toBe(JSON.stringify(goldenNarration));
    expect(JSON.stringify(projected, null, 2)).toBe(
      JSON.stringify(goldenNarration, null, 2),
    );
    expect(validateNarration(projected)).toBe(true);
  });

  it("produces byte-identical output across multiple replay passes", () => {
    const serializedRuns: string[] = [];

    for (let pass = 0; pass < 5; pass++) {
      const projected = projectNarration(events, { runId: "sample-run-001" });
      const serialized = JSON.stringify(projected);
      serializedRuns.push(serialized);
    }

    const firstRun = serializedRuns[0];
    expect(firstRun).toBeDefined();
    for (const run of serializedRuns) {
      expect(run).toBe(firstRun);
      expect(run).toBe(JSON.stringify(goldenNarration));
    }
  });

  it("projects deterministic clock-derived progress with asOf on in-flight events", () => {
    const inFlightEvents: readonly ReadableEvent[] = [
      ...events,
      {
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        eventId: "evt-inflight-006",
        eventType: "operation",
        occurredAt: "2026-08-29T10:30:00.000Z",
        operation: "code",
        policyVersion: "policy-v1",
        priorRevision: 4,
        resultingRevision: 5,
        reasonCode: "workflow.phase_started",
        effect: "state",
        artifactRefs: [],
        evidenceRefs: [],
        observedIdentity: { host: "cli", model: null, effort: null },
        previousHash: "5".repeat(64),
        eventHash: "6".repeat(64),
      },
    ];

    const projected1 = projectNarration(inFlightEvents, {
      runId: "sample-run-001",
      asOf: "2026-08-29T10:35:00.000Z",
    });

    const projected2 = projectNarration(inFlightEvents, {
      runId: "sample-run-001",
      asOf: "2026-08-29T10:35:00.000Z",
    });

    expect(JSON.stringify(projected1)).toBe(JSON.stringify(projected2));
    expect(projected1.pendingProgress).toEqual({
      kind: "in_progress",
      eventId: "evt-inflight-006",
      operation: "code",
      elapsedMs: 300000,
      startedAt: "2026-08-29T10:30:00.000Z",
      asOf: "2026-08-29T10:35:00.000Z",
    });
    expect(validateNarration(projected1)).toBe(true);
  });
});
