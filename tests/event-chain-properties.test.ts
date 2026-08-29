import { types } from "node:util";

import type { EventV1, EventV1_1, ReadableEvent } from "@kratos/contracts";
import {
  EventIntegrityError,
  verifyEventStream,
  sealEvent,
  type CurrentEventDraft,
} from "@kratos/runtime/domain/events";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import { describe, expect, it } from "vitest";

const services = {
  digests: sha256Digests(),
  isProxy: types.isProxy,
  isPromise: types.isPromise,
  schemaRegistry: createSchemaRegistry(),
};

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

function draft(index: number, random: () => number): CurrentEventDraft {
  const suffix = String(random());
  return {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    eventId: `event-${String(index)}-${suffix}`,
    eventType: "transition",
    occurredAt: "2026-08-10T00:01:00Z",
    operation: `sdd.continue:${suffix}`,
    policyVersion: "policy-01",
    priorRevision: index - 1,
    resultingRevision: index,
    reasonCode: "run.transition.accepted",
    effect: "state",
    artifactRefs: [`.brain/features/${suffix}.md`],
    evidenceRefs: [`.brain/evidence/${suffix}.json`],
    observedIdentity: { host: "codex", model: "gpt-5", effort: "medium" },
    resolvedAssignment: {
      phase: "code",
      role: "implementer",
      model: "gpt-5",
      effort: "medium",
    },
  };
}

function makeStream(count: number, random: () => number): readonly EventV1_1[] {
  const events: EventV1_1[] = [];
  let cursor = { revision: 0, hash: null as string | null };
  for (let index = 1; index <= count; index += 1) {
    const event = sealEvent(draft(index, random), cursor, services);
    events.push(event);
    cursor = { revision: event.resultingRevision, hash: event.eventHash };
  }
  return events;
}

function textOf(events: readonly ReadableEvent[]): string {
  return `${events.map(canonicalizeJson).join("\n")}\n`;
}

interface ProtectedScalar {
  readonly field: string;
  readonly token: string;
  readonly start: number;
}

interface Scenario {
  readonly streamIndex: number;
  readonly count: number;
  readonly events: readonly ReadableEvent[];
  readonly lines: readonly string[];
  readonly text: string;
}

interface RecordScenario {
  readonly scenario: Scenario;
  readonly recordIndex: number;
  readonly line: string;
  readonly before: string;
  readonly after: string;
  readonly scalars: readonly ProtectedScalar[];
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing generated value");
  return value;
}

function requiredEventIntegrityError(run: () => unknown): EventIntegrityError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof EventIntegrityError) return error;
    throw error;
  }
  throw new Error("expected event stream verification to fail");
}

function protectedScalars(
  event: ReadableEvent,
  line: string,
): readonly ProtectedScalar[] {
  const values: [string, string | number | null, string][] = [
    ["artifactRefs[0]", required(event.artifactRefs[0]), "artifactRefs"],
    ["contractVersion", event.contractVersion, "contractVersion"],
    ["effect", event.effect, "effect"],
    ["eventHash", event.eventHash, "eventHash"],
    ["eventId", event.eventId, "eventId"],
    ["eventType", event.eventType, "eventType"],
    ["evidenceRefs[0]", required(event.evidenceRefs[0]), "evidenceRefs"],
    ["observedIdentity.host", event.observedIdentity.host, "host"],
    ["observedIdentity.model", event.observedIdentity.model, "model"],
    ["occurredAt", event.occurredAt, "occurredAt"],
    ["operation", event.operation, "operation"],
    ["policyVersion", event.policyVersion, "policyVersion"],
    ["previousHash", event.previousHash, "previousHash"],
    ["priorRevision", event.priorRevision, "priorRevision"],
    ["reasonCode", event.reasonCode, "reasonCode"],
    ["resultingRevision", event.resultingRevision, "resultingRevision"],
    ["stateContract", event.stateContract, "stateContract"],
  ];

  if (event.stateContract === "1.1.0") {
    values.push([
      "observedIdentity.effort",
      event.observedIdentity.effort,
      "observedIdentity",
    ]);
    if (event.resolvedAssignment !== undefined) {
      values.push(
        [
          "resolvedAssignment.phase",
          event.resolvedAssignment.phase,
          "resolvedAssignment",
        ],
        [
          "resolvedAssignment.role",
          event.resolvedAssignment.role,
          "resolvedAssignment",
        ],
        [
          "resolvedAssignment.model",
          event.resolvedAssignment.model,
          "resolvedAssignment",
        ],
        [
          "resolvedAssignment.effort",
          event.resolvedAssignment.effort,
          "resolvedAssignment",
        ],
      );
    }
  }

  return values.map(([field, value, container]) => {
    const containerStart = line.indexOf(`"${container}":`);
    if (containerStart === -1) throw new Error("missing protected container");
    const token = JSON.stringify(value);
    const start = line.indexOf(token, containerStart);
    if (start === -1) throw new Error("missing protected scalar");
    return { field, token, start };
  });
}

function corruptScalar(line: string, scalar: ProtectedScalar): string {
  const tokenOffset = scalar.token.startsWith('"') ? 1 : 0;
  const position = scalar.start + tokenOffset;
  if (position >= scalar.start + scalar.token.length) {
    throw new Error("missing protected token byte");
  }
  const replacement = scalar.token.startsWith('"') ? "\u0000" : "x";
  return `${line.slice(0, position)}${replacement}${line.slice(position + 1)}`;
}

const seed = 0x21_08_2026;

// Stream lengths cycle 1 through 32, so 32 streams cover every length exactly
// once and the "covers every generated length" assertion below still holds.
//
// The corpus used to be 200 streams, repeating each length about six times
// with different content. The per-stream cost is quadratic — every record is
// deleted in turn and the whole chain re-verified — so that repetition cost
// roughly 6.25x the work for redundant length coverage. It took this file to
// ~9 minutes on its own and pushed the CI job past its 15-minute limit.
//
// The wider sweep is still available on demand:
//
//   KRATOS_TEST_EXHAUSTIVE_EVENT_CHAIN=1 npx vitest run tests/event-chain-properties.test.ts
const exhaustiveStreamCount = 200;
const cycleStreamCount = 32;

// Corpus size and per-case duration are separate problems. Trimming the corpus
// fixes the suite's total runtime, but the longest streams stay individually
// expensive: one case deletes every record of a 32-event stream and re-verifies
// the whole chain each time, which is quadratic in the stream's length. Under
// v8 coverage instrumentation that tips past vitest's 5-second default, so the
// heavy case gets an explicit budget rather than a shrinking stream length that
// would weaken what it proves. Same remedy as `28d1c3a` for the fault campaign.
const sequenceCorruptionTimeoutMilliseconds = 30_000;
const streamCount =
  process.env.KRATOS_TEST_EXHAUSTIVE_EVENT_CHAIN === "1"
    ? exhaustiveStreamCount
    : cycleStreamCount;

const cases = (() => {
  const random = generator(seed);
  return Array.from({ length: streamCount }, (_, streamIndex) => ({
    streamIndex,
    streamSeed: random(),
    count: (streamIndex % 32) + 1,
  }));
})();

const scenarios: readonly Scenario[] = cases.map(
  ({ streamIndex, streamSeed, count }) => {
    const events = makeStream(count, generator(streamSeed));
    const lines = events.map(canonicalizeJson);
    return { streamIndex, count, events, lines, text: `${lines.join("\n")}\n` };
  },
);

const recordScenarios: readonly RecordScenario[] = scenarios.flatMap(
  (scenario) =>
    scenario.events.map((event, recordIndex) => {
      const line = required(scenario.lines[recordIndex]);
      return {
        scenario,
        recordIndex,
        line,
        before:
          recordIndex === 0
            ? ""
            : `${scenario.lines.slice(0, recordIndex).join("\n")}\n`,
        after:
          recordIndex === scenario.lines.length - 1
            ? "\n"
            : `\n${scenario.lines.slice(recordIndex + 1).join("\n")}\n`,
        scalars: protectedScalars(event, line),
      };
    }),
);

describe("event hash-chain generated corruption cases", () => {
  it("verifies deterministic chains that randomly alternate readable versions", () => {
    for (const streamSeed of [0x10, 0x11, 0x12, 0x13]) {
      const random = generator(streamSeed);
      const events: ReadableEvent[] = [];
      let cursor = { revision: 0, hash: null as string | null };
      for (let revision = 1; revision <= 16; revision += 1) {
        const common = {
          eventId: `mixed-${String(streamSeed)}-${String(revision)}`,
          eventType: "transition" as const,
          occurredAt: "2026-08-10T00:01:00Z",
          operation: `sdd.continue:mixed-${String(revision)}`,
          policyVersion: "policy-01",
          priorRevision: revision - 1,
          resultingRevision: revision,
          reasonCode: "run.transition.accepted",
          effect: "state" as const,
          artifactRefs: [`.brain/features/mixed-${String(revision)}.md`],
          evidenceRefs: [`.brain/evidence/mixed-${String(revision)}.json`],
        };
        let event: ReadableEvent;
        if ((random() & 1) === 0) {
          const unsigned: Omit<EventV1, "eventHash"> = {
            ...common,
            contractVersion: "1.0.0",
            stateContract: "1.0.0",
            observedIdentity: { host: "codex", model: "gpt-5" },
            previousHash: cursor.hash,
          };
          event = {
            ...unsigned,
            eventHash: services.digests.sha256(canonicalizeJson(unsigned)),
          };
        } else {
          const draft: Omit<EventV1_1, "previousHash" | "eventHash"> = {
            ...common,
            contractVersion: "1.1.0",
            stateContract: "1.1.0",
            observedIdentity: {
              host: "codex",
              model: "gpt-5",
              effort: "medium",
            },
            resolvedAssignment: {
              phase: "code",
              role: "implementer",
              model: "gpt-5",
              effort: "medium",
            },
          };
          event = sealEvent(draft, cursor, services);
        }
        events.push(event);
        cursor = { revision: event.resultingRevision, hash: event.eventHash };
      }

      expect(verifyEventStream(textOf(events), services).events).toEqual(
        events,
      );
      expect(new Set(events.map((event) => event.stateContract))).toEqual(
        new Set(["1.0.0", "1.1.0"]),
      );
    }
  });

  it("covers every generated length from one through 32", () => {
    expect(new Set(scenarios.map(({ count }) => count))).toEqual(
      new Set(Array.from({ length: 32 }, (_, index) => index + 1)),
    );
  });

  it.each(scenarios)(
    "rejects deterministic corruption for stream $streamIndex",
    ({ streamIndex, events, text }) => {
      const first = verifyEventStream(text, services);
      const second = verifyEventStream(text, services);
      expect(
        first,
        `seed=${String(seed)} case=repeat stream=${String(streamIndex)}`,
      ).toEqual(second);
      expect(first.canonical).toBe(text);
      expect(first.cursor).toEqual({
        revision: events.length,
        hash: events.at(-1)?.eventHash ?? null,
      });
    },
  );

  it.each(recordScenarios)(
    "rejects protected scalar corruption for stream $scenario.streamIndex record $recordIndex",
    ({ scenario, recordIndex, line, before, after, scalars }) => {
      for (const scalar of scalars) {
        const error = requiredEventIntegrityError(() =>
          verifyEventStream(
            `${before}${corruptScalar(line, scalar)}${after}`,
            services,
          ),
        );
        expect(
          error.kind,
          `seed=${String(seed)} case=protected-scalar record=${String(recordIndex)} field=${scalar.field} stream=${String(scenario.streamIndex)}`,
        ).toBe("invalid_event");
      }
    },
  );

  it.each(scenarios)(
    "rejects sequence corruption for stream $streamIndex",
    ({ streamIndex, events }) => {
      for (let recordIndex = 0; recordIndex < events.length; recordIndex += 1) {
        const remaining = events.filter((_, index) => index !== recordIndex);
        const shortened = remaining.length === 0 ? "" : textOf(remaining);
        if (recordIndex === events.length - 1) {
          expect(
            verifyEventStream(shortened, services),
            `seed=${String(seed)} case=delete-tail record=${String(recordIndex)} stream=${String(streamIndex)}`,
          ).toMatchObject({
            cursor:
              remaining.length === 0
                ? { revision: 0, hash: null }
                : {
                    revision: remaining.length,
                    hash: required(remaining.at(-1)).eventHash,
                  },
          });
        } else {
          expect(
            requiredEventIntegrityError(() =>
              verifyEventStream(shortened, services),
            ).kind,
            `seed=${String(seed)} case=delete record=${String(recordIndex)} stream=${String(streamIndex)}`,
          ).toBe("invalid_sequence");
        }
        expect(
          requiredEventIntegrityError(() =>
            verifyEventStream(
              textOf([
                ...events.slice(0, recordIndex),
                required(events[recordIndex]),
                ...events.slice(recordIndex),
              ]),
              services,
            ),
          ).kind,
          `seed=${String(seed)} case=duplicate record=${String(recordIndex)} stream=${String(streamIndex)}`,
        ).toBe("invalid_sequence");
      }

      for (
        let recordIndex = 0;
        recordIndex < events.length - 1;
        recordIndex += 1
      ) {
        const swapped = [...events];
        const next = required(swapped[recordIndex + 1]);
        swapped[recordIndex + 1] = required(swapped[recordIndex]);
        swapped[recordIndex] = next;
        expect(
          requiredEventIntegrityError(() =>
            verifyEventStream(textOf(swapped), services),
          ).kind,
          `seed=${String(seed)} case=swap record=${String(recordIndex)} stream=${String(streamIndex)}`,
        ).toBe("invalid_sequence");
      }
    },
    sequenceCorruptionTimeoutMilliseconds,
  );
});
