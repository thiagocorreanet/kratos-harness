import { types } from "node:util";

import golden from "./fixtures/events/golden-event-v1.json" with { type: "json" };
import {
  EventIntegrityError,
  sealEvent,
  unsignedEvent,
  type EventDraftV1,
} from "@kratos/runtime/domain/events";
import type { EventV1 } from "@kratos/contracts";
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

function draft(): EventDraftV1 {
  return structuredClone(golden.draft) as EventDraftV1;
}

function goldenUnsigned(): Omit<EventV1, "eventHash"> {
  return JSON.parse(golden.unsignedCanonical) as Omit<EventV1, "eventHash">;
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

  it("accepts only canonical dense reference-array keys before copying", () => {
    const references = [".brain/features/feature-01/00-prd.md"];
    expect(Object.getOwnPropertyNames(references)).toEqual(["0", "length"]);
    expect(seal({ ...draft(), artifactRefs: references }).artifactRefs).toEqual(
      references,
    );

    const nonIndex = [".brain/features/feature-01/00-prd.md"] as string[] & {
      "01"?: string;
    };
    nonIndex["01"] = "private";
    expect(integrityKind({ ...draft(), artifactRefs: nonIndex })).toBe(
      "invalid_event",
    );
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
    ["a non-object draft", null],
    ["a null-prototype draft", Object.create(null)],
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
    [
      "a primitive artifact reference list",
      { ...draft(), artifactRefs: "private" },
    ],
    ["an object artifact reference list", { ...draft(), artifactRefs: {} }],
    ["unsafe evidence references", { ...draft(), evidenceRefs: ["/attacker"] }],
    ["wrong primitive values", { ...draft(), reasonCode: 1 }],
    [
      "a non-finite revision",
      { ...draft(), priorRevision: Number.POSITIVE_INFINITY },
    ],
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
      "a non-string identity model",
      { ...draft(), observedIdentity: { host: "codex", model: 1 } },
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
    ["the root draft", new Proxy(draft(), {})],
    [
      "artifact references",
      { ...draft(), artifactRefs: new Proxy([...draft().artifactRefs], {}) },
    ],
    [
      "evidence references",
      { ...draft(), evidenceRefs: new Proxy([...draft().evidenceRefs], {}) },
    ],
    [
      "observed identity",
      {
        ...draft(),
        observedIdentity: new Proxy({ ...draft().observedIdentity }, {}),
      },
    ],
  ])("rejects transparent Proxies at %s", (_description, input) => {
    expect(integrityKind(input)).toBe("invalid_event");
  });

  it("binds a non-null predecessor hash to a successor", () => {
    const first = seal(draft());
    const successor = seal(
      {
        ...draft(),
        eventId: "event-02",
        priorRevision: 1,
        resultingRevision: 2,
      },
      1,
      first.eventHash,
    );

    expect(successor.previousHash).toBe(first.eventHash);
    expect(successor.previousHash).not.toBeNull();
  });

  it.each([
    ["contractVersion", { contractVersion: "1.0.1" }],
    ["stateContract", { stateContract: "1.0.1" }],
    ["eventId", { eventId: "event-02" }],
    ["eventType", { eventType: "decision" }],
    ["occurredAt", { occurredAt: "2026-08-10T00:01:01Z" }],
    ["operation", { operation: "sdd.start" }],
    ["policyVersion", { policyVersion: "policy-02" }],
    ["priorRevision", { priorRevision: 1 }],
    ["resultingRevision", { resultingRevision: 2 }],
    ["reasonCode", { reasonCode: "different" }],
    ["effect", { effect: "artifact" }],
    [
      "artifactRefs",
      { artifactRefs: [".brain/features/feature-02/00-prd.md"] },
    ],
    ["evidenceRefs", { evidenceRefs: [".brain/evidence/event-02.json"] }],
    [
      "observedIdentity",
      { observedIdentity: { host: "other", model: "gpt-5" } },
    ],
    ["previousHash", { previousHash: "a".repeat(64) }],
  ])(
    "changes the canonical unsigned digest when protected %s changes in isolation",
    (_field, replacement) => {
      const changed = { ...goldenUnsigned(), ...replacement };

      expect(services.digests.sha256(canonicalizeJson(changed))).not.toBe(
        golden.eventHash,
      );
    },
  );

  it.each([
    ["contractVersion", { contractVersion: "1.0.1" }],
    ["stateContract", { stateContract: "1.0.1" }],
  ])("rejects changes to protected %s", (_field, replacement) => {
    expect(integrityKind({ ...draft(), ...replacement })).toBe("invalid_event");
  });
});
