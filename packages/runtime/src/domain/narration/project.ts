import type {
  BeatV1,
  ClockDerivedProgress,
  NarrationV1,
  ReadableEvent,
} from "@kratos/contracts";
import type { ProjectNarrationOptions } from "./model.js";
import {
  resolveBeatKind,
  resolveBeatSentence,
  resolveBeatSubject,
} from "./mapping.js";

export function projectNarration(
  events: readonly ReadableEvent[],
  options?: ProjectNarrationOptions,
): NarrationV1 {
  const runId =
    options?.runId ?? (events.length > 0 ? "run-default" : "run-empty");
  const beats: BeatV1[] = [];

  for (const event of events) {
    const kind = resolveBeatKind(event);
    const sentence = resolveBeatSentence(event);
    const subject = resolveBeatSubject(event);

    const beat: BeatV1 = {
      contractVersion: "1.0.0",
      beatId: `beat-${event.eventId}`,
      kind,
      subject,
      sentence,
      reasonCode: event.reasonCode,
      occurredAt: event.occurredAt,
      eventId: event.eventId,
      revision: event.resultingRevision,
      facts: {},
      evidenceRefs: [...event.evidenceRefs],
    };

    beats.push(beat);
  }

  let pendingProgress: ClockDerivedProgress | null = null;
  const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
  const lastBeat = beats.length > 0 ? beats[beats.length - 1] : undefined;
  if (options?.asOf && lastEvent && lastBeat) {
    if (lastBeat.kind === "work" || lastEvent.eventType === "operation") {
      const startedAtMs = new Date(lastEvent.occurredAt).getTime();
      const asOfMs = new Date(options.asOf).getTime();
      const elapsedMs = Math.max(0, asOfMs - startedAtMs);

      pendingProgress = {
        kind: "in_progress",
        eventId: lastEvent.eventId,
        operation: lastEvent.operation,
        elapsedMs,
        startedAt: lastEvent.occurredAt,
        asOf: options.asOf,
      };
    }
  }

  const generatedAt =
    options?.asOf ??
    (lastEvent ? lastEvent.occurredAt : "1970-01-01T00:00:00.000Z");

  return {
    contractVersion: "1.0.0",
    runId,
    generatedAt,
    beats,
    pendingProgress,
  };
}
