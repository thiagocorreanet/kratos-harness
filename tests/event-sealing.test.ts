import golden from "./fixtures/events/golden-event-v1.json" with { type: "json" };
import {
  EventIntegrityError,
  sealEvent,
  unsignedEvent,
  type EventDraftV1,
} from "@mestre-yoda/runtime/domain/events";
import { canonicalizeJson } from "@mestre-yoda/runtime/domain/schema";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import { describe, expect, it } from "vitest";

const services = {
  digests: sha256Digests(),
  schemaRegistry: createSchemaRegistry(),
};

function draft(): EventDraftV1 {
  return structuredClone(golden.draft) as EventDraftV1;
}

function seal(input: unknown, revision = 0, hash: string | null = null) {
  return sealEvent(input, { revision, hash }, services);
}

function integrityKind(
  input: unknown,
  revision = 0,
  hash: string | null = null,
) {
  try {
    seal(input, revision, hash);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(EventIntegrityError);
    return (error as EventIntegrityError).kind;
  }
  throw new Error("expected event sealing to fail");
}

describe("event sealing", () => {
  it("matches the committed first-event golden vector", () => {
    const event = seal(golden.draft);

    expect(canonicalizeJson(unsignedEvent(event))).toBe(
      golden.unsignedCanonical,
    );
    expect(event.eventHash).toBe(golden.eventHash);
    expect(event.previousHash).toBeNull();
  });

  it("uses canonical field ordering for its hash", () => {
    const value = draft();
    const reversed = Object.fromEntries(
      Object.entries(value).reverse(),
    ) as EventDraftV1;

    expect(seal(reversed).eventHash).toBe(golden.eventHash);
  });

  it("retains copied reference arrays after the caller mutates them", () => {
    const value = draft();
    const event = seal(value);
    value.artifactRefs.push(".brain/attacker-artifact.md");
    value.evidenceRefs.push(".brain/attacker-evidence.json");

    expect(event.artifactRefs).toEqual(golden.draft.artifactRefs);
    expect(event.evidenceRefs).toEqual(golden.draft.evidenceRefs);
  });

  it.each([
    ["a revision gap", { ...draft(), priorRevision: 1 }, 0, null],
    [
      "a skipped resulting revision",
      { ...draft(), resultingRevision: 2 },
      0,
      null,
    ],
    ["a non-null first predecessor", draft(), 0, "a".repeat(64)],
  ])("rejects %s", (_description, input, revision, hash) => {
    expect(integrityKind(input, revision, hash)).toBe("invalid_sequence");
  });

  it.each([
    ["extra keys", { ...draft(), rawPayload: "attacker text" }],
    [
      "accessors",
      Object.defineProperty(draft(), "eventId", {
        configurable: true,
        get: () => "attacker text",
      }),
    ],
    [
      "proxies",
      new Proxy(draft(), {
        getOwnPropertyDescriptor: () => {
          throw new Error("attacker text");
        },
      }),
    ],
    [
      "unsafe artifact references",
      { ...draft(), artifactRefs: ["../attacker"] },
    ],
    ["unsafe evidence references", { ...draft(), evidenceRefs: ["/attacker"] }],
    ["wrong primitive values", { ...draft(), reasonCode: 1 }],
    ["array holes", { ...draft(), artifactRefs: Array(1) }],
    [
      "array accessors",
      {
        ...draft(),
        artifactRefs: Object.defineProperty([".brain/safe.md"], "0", {
          configurable: true,
          get: () => "attacker text",
        }),
      },
    ],
    [
      "mutable nested shapes",
      {
        ...draft(),
        observedIdentity: { host: "codex", model: "gpt-5", extra: true },
      },
    ],
    [
      "artifact reference lists longer than 256 entries",
      {
        ...draft(),
        artifactRefs: Array.from(
          { length: 257 },
          (_, index) => `artifact-${String(index)}`,
        ),
      },
    ],
    [
      "evidence reference lists longer than 256 entries",
      {
        ...draft(),
        evidenceRefs: Array.from(
          { length: 257 },
          (_, index) => `evidence-${String(index)}`,
        ),
      },
    ],
  ])("rejects %s without exposing rejected content", (_description, input) => {
    expect(integrityKind(input)).toBe("invalid_event");
  });

  it.each([
    ["eventId", { eventId: "event-02" }, 0, null],
    ["eventType", { eventType: "decision" }, 0, null],
    ["occurredAt", { occurredAt: "2026-08-10T00:01:01Z" }, 0, null],
    ["operation", { operation: "sdd.start" }, 0, null],
    ["policyVersion", { policyVersion: "policy-02" }, 0, null],
    [
      "priorRevision",
      { priorRevision: 1, resultingRevision: 2 },
      1,
      "a".repeat(64),
    ],
    [
      "resultingRevision",
      { priorRevision: 1, resultingRevision: 2 },
      1,
      "a".repeat(64),
    ],
    ["reasonCode", { reasonCode: "different" }, 0, null],
    ["effect", { effect: "artifact" }, 0, null],
    [
      "artifactRefs",
      { artifactRefs: [".brain/features/feature-02/00-prd.md"] },
      0,
      null,
    ],
    [
      "evidenceRefs",
      { evidenceRefs: [".brain/evidence/event-02.json"] },
      0,
      null,
    ],
    [
      "observedIdentity",
      { observedIdentity: { host: "other", model: "gpt-5" } },
      0,
      null,
    ],
  ])(
    "changes the hash when protected %s changes",
    (_field, replacement, revision, hash) => {
      expect(
        seal({ ...draft(), ...replacement }, revision, hash).eventHash,
      ).not.toBe(golden.eventHash);
    },
  );

  it.each([
    ["contractVersion", { contractVersion: "1.0.1" }],
    ["stateContract", { stateContract: "1.0.1" }],
  ])("rejects changes to protected %s", (_field, replacement) => {
    expect(integrityKind({ ...draft(), ...replacement })).toBe("invalid_event");
  });
});
