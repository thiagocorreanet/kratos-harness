import { types } from "node:util";

import type { EventV1 } from "@mestre-yoda/contracts";
import {
  EventIntegrityError,
  parseEventLines,
  sealEvent,
  unsignedEvent,
  verifyEventStream,
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

function draft(index: number): EventDraftV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    eventId: `event-${String(index)}`,
    eventType: "transition",
    occurredAt: `2026-08-10T00:0${String(index)}:00Z`,
    operation: `sdd.step-${String(index)}`,
    policyVersion: "policy-01",
    priorRevision: index - 1,
    resultingRevision: index,
    reasonCode: "ok",
    effect: "state",
    artifactRefs: [`.brain/features/feature-01/${String(index)}.md`],
    evidenceRefs: [`.brain/evidence/event-${String(index)}.json`],
    observedIdentity: { host: "codex", model: "gpt-5" },
  };
}

function stream(): readonly [EventV1, EventV1] {
  const first = sealEvent(draft(1), { revision: 0, hash: null }, services);
  const second = sealEvent(
    draft(2),
    { revision: 1, hash: first.eventHash },
    services,
  );
  return [first, second];
}

function textOf(events: readonly EventV1[]): string {
  return `${events.map(canonicalizeJson).join("\n")}\n`;
}

function withHash(event: Omit<EventV1, "eventHash">): EventV1 {
  return {
    ...event,
    eventHash: services.digests.sha256(canonicalizeJson(event)),
  };
}

function integrityError(run: () => unknown): EventIntegrityError {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(EventIntegrityError);
    return error as EventIntegrityError;
  }
  throw new Error("expected event stream verification to fail");
}

type RejectionCase = readonly [
  description: string,
  makeText: () => string,
  expectedKind: EventIntegrityError["kind"],
];

describe("event hash-chain verification", () => {
  it("returns canonical events and the final cursor", () => {
    const [first, second] = stream();
    const text = textOf([first, second]);

    expect(verifyEventStream(text, services)).toEqual({
      events: [first, second],
      cursor: { revision: 2, hash: second.eventHash },
      canonical: text,
    });
  });

  const rejectionCases: readonly RejectionCase[] = [
    ["CRLF", () => textOf(stream()).replaceAll("\n", "\r\n"), "non_canonical"],
    [
      "a missing final LF",
      () => textOf(stream()).slice(0, -1),
      "non_canonical",
    ],
    [
      "a blank record",
      () => textOf(stream()).replace("\n", "\n\n"),
      "non_canonical",
    ],
    [
      "pretty JSON",
      () => `${JSON.stringify(stream()[0]).replace("{", "{ ")}\n`,
      "non_canonical",
    ],
    [
      "a bad hash",
      () => {
        const [first, second] = stream();
        return textOf([
          first,
          {
            ...second,
            eventHash: `${second.eventHash.slice(0, -1)}${second.eventHash.endsWith("0") ? "1" : "0"}`,
          },
        ]);
      },
      "invalid_event",
    ],
    [
      "a bad predecessor",
      () => {
        const [first, second] = stream();
        return textOf([
          first,
          withHash({ ...unsignedEvent(second), previousHash: "a".repeat(64) }),
        ]);
      },
      "invalid_sequence",
    ],
    [
      "a duplicate revision",
      () => {
        const [first, second] = stream();
        return textOf([
          first,
          withHash({
            ...unsignedEvent(second),
            priorRevision: 0,
            resultingRevision: 1,
          }),
        ]);
      },
      "invalid_sequence",
    ],
    [
      "a revision gap",
      () => {
        const [first, second] = stream();
        return textOf([
          first,
          withHash({
            ...unsignedEvent(second),
            priorRevision: 2,
            resultingRevision: 3,
          }),
        ]);
      },
      "invalid_sequence",
    ],
    [
      "swapped records",
      () => textOf([...stream()].reverse()),
      "invalid_sequence",
    ],
    ["malformed JSON", () => '{"eventId":\n', "invalid_event"],
  ];

  it.each(rejectionCases)(
    "rejects %s as %s",
    (
      _description: string,
      makeText: () => string,
      expectedKind: EventIntegrityError["kind"],
    ) => {
      expect(
        integrityError(() => verifyEventStream(makeText(), services)).kind,
      ).toBe(expectedKind);
    },
  );

  it("preserves an unsupported contract diagnostic without rejected content", () => {
    const [first] = stream();
    const text = `${canonicalizeJson({ ...first, stateContract: "2.0.0" })}\n`;

    const error = integrityError(() => verifyEventStream(text, services));

    expect(error.kind).toBe("invalid_event");
    expect(error.reasonCode).toBe("contract.state_version_unsupported");
  });

  it("returns an empty parsed stream only for empty text", () => {
    expect(parseEventLines("", services.schemaRegistry)).toEqual([]);
  });
});
