import { types } from "node:util";

import type { EventV1 } from "@mestre-yoda/contracts";
import {
  verifyEventStream,
  sealEvent,
  type EventDraftV1,
} from "@mestre-yoda/runtime/domain/events";
import { canonicalizeJson } from "@mestre-yoda/runtime/domain/schema";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import { describe, expect, it } from "vitest";

const services = {
  digests: sha256Digests(),
  isProxy: types.isProxy,
  schemaRegistry: createSchemaRegistry(),
};

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

function draft(index: number, random: () => number): EventDraftV1 {
  const suffix = String(random());
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    eventId: `event-${String(index)}-${suffix}`,
    eventType: "transition",
    occurredAt: "2026-08-10T00:01:00Z",
    operation: `sdd.step-${suffix}`,
    policyVersion: "policy-01",
    priorRevision: index - 1,
    resultingRevision: index,
    reasonCode: "ok",
    effect: "state",
    artifactRefs: [`.brain/features/${suffix}.md`],
    evidenceRefs: [`.brain/evidence/${suffix}.json`],
    observedIdentity: { host: "codex", model: "gpt-5" },
  };
}

function makeStream(count: number, random: () => number): readonly EventV1[] {
  const events: EventV1[] = [];
  let cursor = { revision: 0, hash: null as string | null };
  for (let index = 1; index <= count; index += 1) {
    const event = sealEvent(draft(index, random), cursor, services);
    events.push(event);
    cursor = { revision: event.resultingRevision, hash: event.eventHash };
  }
  return events;
}

function textOf(events: readonly EventV1[]): string {
  return `${events.map(canonicalizeJson).join("\n")}\n`;
}

function replaceByte(text: string, position: number): string {
  const character = text[position];
  if (character === undefined) throw new Error("missing protected byte");
  return `${text.slice(0, position)}${character === "x" ? "y" : "x"}${text.slice(position + 1)}`;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("missing generated value");
  return value;
}

function protectedScalarPositions(
  event: EventV1,
  line: string,
): readonly number[] {
  const values: readonly (string | number | null)[] = [
    required(event.artifactRefs[0]),
    event.contractVersion,
    event.effect,
    event.eventHash,
    event.eventId,
    event.eventType,
    required(event.evidenceRefs[0]),
    event.observedIdentity.host,
    event.observedIdentity.model,
    event.occurredAt,
    event.operation,
    event.policyVersion,
    event.previousHash,
    event.priorRevision,
    event.reasonCode,
    event.resultingRevision,
    event.stateContract,
  ];

  let searchStart = 0;
  return values.map((value) => {
    const spelling = JSON.stringify(value);
    const position = line.indexOf(spelling, searchStart);
    if (position === -1) throw new Error("missing protected scalar");
    searchStart = position + spelling.length;
    return position + (value === null ? 1 : 1);
  });
}

const seed = 0x21_08_2026;
const cases = (() => {
  const random = generator(seed);
  return Array.from({ length: 200 }, (_, streamIndex) => ({
    streamIndex,
    streamSeed: random(),
    count: (random() % 32) + 1,
  }));
})();

describe("event hash-chain generated corruption cases", () => {
  it.each(cases)(
    "rejects deterministic corruption for stream $streamIndex",
    ({ streamIndex, streamSeed, count }) => {
      const events = makeStream(count, generator(streamSeed));
      const text = textOf(events);
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

      const firstEvent = required(events[0]);
      const firstLine = canonicalizeJson(firstEvent);
      for (const [scalarIndex, position] of protectedScalarPositions(
        firstEvent,
        firstLine,
      ).entries()) {
        const corrupted = `${replaceByte(firstLine, position)}\n${text.slice(firstLine.length + 1)}`;
        expect(
          () => verifyEventStream(corrupted, services),
          `seed=${String(seed)} case=protected-scalar scalar=${String(scalarIndex)} record=0 stream=${String(streamIndex)}`,
        ).toThrow();
      }

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
            () => verifyEventStream(shortened, services),
            `seed=${String(seed)} case=delete record=${String(recordIndex)} stream=${String(streamIndex)}`,
          ).toThrow();
        }
        expect(
          () =>
            verifyEventStream(
              textOf([
                ...events.slice(0, recordIndex),
                required(events[recordIndex]),
                ...events.slice(recordIndex),
              ]),
              services,
            ),
          `seed=${String(seed)} case=duplicate record=${String(recordIndex)} stream=${String(streamIndex)}`,
        ).toThrow();
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
          () => verifyEventStream(textOf(swapped), services),
          `seed=${String(seed)} case=swap record=${String(recordIndex)} stream=${String(streamIndex)}`,
        ).toThrow();
      }
    },
  );
});
