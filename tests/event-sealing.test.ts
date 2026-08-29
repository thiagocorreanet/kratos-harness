import { types } from "node:util";

import legacyGolden from "./fixtures/events/golden-event-v1.json" with { type: "json" };
import golden from "./fixtures/events/golden-event-v1.1.json" with { type: "json" };
import {
  EventIntegrityError,
  sealEvent,
  unsignedEvent,
  type CurrentEventDraft,
} from "@kratos/runtime/domain/events";
import type { EventV1, EventV1_1 } from "@kratos/contracts";
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

function draft(): CurrentEventDraft {
  return structuredClone(golden.draft) as CurrentEventDraft;
}

function unassignedDraft(): Omit<CurrentEventDraft, "resolvedAssignment"> {
  const { resolvedAssignment, ...unassigned } = draft();
  void resolvedAssignment;
  return unassigned;
}

function goldenUnsigned(): Omit<EventV1_1, "eventHash"> {
  return JSON.parse(golden.unsignedCanonical) as Omit<EventV1_1, "eventHash">;
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
  it.each([
    {
      name: "continue with an unknown reason and forged tuple",
      event: {
        ...unassignedDraft(),
        operation: "sdd.continue:unknown-01",
        reasonCode: "run.future_transition",
        eventType: "operation",
        effect: "state",
      },
      valid: false,
    },
    {
      name: "continue with an agent reason and effect",
      event: {
        ...draft(),
        operation: "sdd.continue:swapped-01",
        reasonCode: "run.agent.recorded",
        eventType: "decision",
        effect: "state-and-artifact",
      },
      valid: false,
    },
    {
      name: "agent.record with an unknown reason and forged tuple",
      event: {
        ...unassignedDraft(),
        operation: "sdd.agent.record:unknown-01",
        reasonCode: "run.future_output",
        eventType: "operation",
        effect: "state",
      },
      valid: false,
    },
    {
      name: "agent.record with a transition reason and effect",
      event: {
        ...draft(),
        operation: "sdd.agent.record:swapped-01",
        reasonCode: "run.transition.accepted",
        eventType: "transition",
        effect: "state",
      },
      valid: false,
    },
    {
      name: "gaps.record with an unknown reason and forged tuple",
      event: {
        ...unassignedDraft(),
        operation: "sdd.gaps.record:unknown-01",
        reasonCode: "run.future_gap",
        eventType: "operation",
        effect: "state",
      },
      valid: false,
    },
    {
      name: "gates.record with a gap reason and wrong effect",
      event: {
        ...unassignedDraft(),
        operation: "sdd.gates.record:swapped-01",
        reasonCode: "run.gap.recorded",
        eventType: "decision",
        effect: "state",
      },
      valid: false,
    },
    {
      name: "lock family with malformed operation and unknown tuple",
      event: {
        ...unassignedDraft(),
        operation: "lock.acquire:not-canonical",
        policyVersion: "locks-v1",
        reasonCode: "runtime.future_lock",
        eventType: "operation",
        effect: "state",
      },
      valid: false,
    },
    {
      name: "lock acquire with a swapped reason and effect",
      event: {
        ...unassignedDraft(),
        operation: `lock.acquire.t1.d${"a".repeat(64)}`,
        policyVersion: "locks-v1",
        reasonCode: "runtime.cache_refreshed",
        eventType: "operation",
        effect: "artifact",
      },
      valid: false,
    },
    {
      name: "unreserved infrastructure fallback",
      event: {
        ...unassignedDraft(),
        operation: "runtime.cache:refresh-01",
        policyVersion: "runtime-v1",
        reasonCode: "runtime.cache_refreshed",
        eventType: "operation",
        effect: "state",
      },
      valid: true,
    },
    {
      name: "unreserved fallback with a forged tuple",
      event: {
        ...unassignedDraft(),
        operation: "runtime.cache:refresh-02",
        policyVersion: "runtime-v1",
        reasonCode: "runtime.cache_refreshed",
        eventType: "transition",
        effect: "artifact",
      },
      valid: false,
    },
    {
      name: "unreserved infrastructure with assignment",
      event: {
        ...draft(),
        operation: "runtime.cache:refresh-03",
        policyVersion: "runtime-v1",
        reasonCode: "runtime.cache_refreshed",
        eventType: "operation",
        effect: "state",
      },
      valid: false,
    },
    {
      name: "unreserved infrastructure borrowing a workflow reason",
      event: {
        ...unassignedDraft(),
        operation: "runtime.cache:refresh-04",
        policyVersion: "runtime-v1",
        reasonCode: "run.started",
        eventType: "operation",
        effect: "state",
      },
      valid: false,
    },
    {
      name: "unreserved infrastructure borrowing lock reason trail.ok",
      event: {
        ...unassignedDraft(),
        operation: "runtime.cache:refresh-05",
        policyVersion: "runtime-v1",
        reasonCode: "trail.ok",
        eventType: "operation",
        effect: "state",
      },
      valid: false,
    },
    {
      name: "unreserved infrastructure borrowing lock reason trail.accepted",
      event: {
        ...unassignedDraft(),
        operation: "runtime.cache:refresh-06",
        policyVersion: "runtime-v1",
        reasonCode: "trail.accepted",
        eventType: "operation",
        effect: "state",
      },
      valid: false,
    },
    {
      name: "real lock acquire tuple",
      event: {
        ...unassignedDraft(),
        operation: `lock.acquire.t1.d${"b".repeat(64)}`,
        policyVersion: "locks-v1",
        reasonCode: "trail.ok",
        eventType: "operation",
        effect: "state",
      },
      valid: true,
    },
    {
      name: "real lock takeover tuple",
      event: {
        ...unassignedDraft(),
        operation: `lock.takeover.t2.d${"c".repeat(64)}`,
        policyVersion: "locks-v1",
        reasonCode: "trail.ok",
        eventType: "recovery",
        effect: "state",
      },
      valid: true,
    },
  ] satisfies readonly {
    readonly name: string;
    readonly event: CurrentEventDraft;
    readonly valid: boolean;
  }[])("enforces the literal semantic matrix: $name", ({ event, valid }) => {
    if (valid) {
      expect(() => seal(event)).not.toThrow();
      return;
    }
    expect(integrityKind(event)).toBe("invalid_event");
  });

  it("preserves the committed legacy canonical bytes and hash", () => {
    const unsigned = JSON.parse(legacyGolden.unsignedCanonical) as Omit<
      EventV1,
      "eventHash"
    >;

    expect(canonicalizeJson(unsigned)).toBe(legacyGolden.unsignedCanonical);
    expect(services.digests.sha256(legacyGolden.unsignedCanonical)).toBe(
      "c6f58e1d3427cfee3331856b509b0bbbc67b5d4d8cc3549ed026029fb47826b1",
    );
    expect(legacyGolden.eventHash).toBe(
      "c6f58e1d3427cfee3331856b509b0bbbc67b5d4d8cc3549ed026029fb47826b1",
    );
  });

  it("rejects a resolved assignment on an infrastructure event", () => {
    const input: Omit<EventV1_1, "previousHash" | "eventHash"> = {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "lease-event-01",
      eventType: "operation",
      occurredAt: "2026-08-10T00:01:00Z",
      operation: "lock.acquire:lease-01",
      policyVersion: "lease-v1",
      priorRevision: 0,
      resultingRevision: 1,
      reasonCode: "runtime.lease_acquired",
      effect: "state",
      artifactRefs: [],
      evidenceRefs: [],
      observedIdentity: { host: "codex", model: null, effort: null },
      resolvedAssignment: {
        phase: "code",
        role: "implementer",
        model: "gpt-5",
        effort: "medium",
      },
    };

    expect(integrityKind(input)).toBe("invalid_event");
  });

  it("requires an assignment for a phase transition fact", () => {
    const { resolvedAssignment, ...withoutAssignment } = draft();
    void resolvedAssignment;

    expect(integrityKind(withoutAssignment)).toBe("invalid_event");
  });

  it("requires an assignment for a phase-output fact", () => {
    const { resolvedAssignment, ...withoutAssignment } = draft();
    void resolvedAssignment;

    expect(
      integrityKind({
        ...withoutAssignment,
        eventType: "decision",
        operation: "sdd.agent.record:record-01",
        reasonCode: "run.agent.recorded",
      }),
    ).toBe("invalid_event");
  });

  it("rejects an assignment whose role does not match its phase", () => {
    expect(
      integrityKind({
        ...draft(),
        resolvedAssignment: {
          phase: "review",
          role: "implementer",
          model: "gpt-5",
          effort: "medium",
        },
      }),
    ).toBe("invalid_event");
  });

  it.each([
    ["sdd.continue:continue-01", "run.agent.recorded"],
    ["sdd.agent.record:record-01", "run.transition.accepted"],
  ])(
    "rejects assignment on mismatched phase operation %s and reason %s",
    (operation, reasonCode) => {
      expect(integrityKind({ ...draft(), operation, reasonCode })).toBe(
        "invalid_event",
      );
    },
  );

  it.each([
    ["eventType", { eventType: "decision" }],
    ["effect", { effect: "artifact" }],
  ])(
    "rejects a forged phase semantic %s before hashing",
    (_field, replacement) => {
      expect(integrityKind({ ...draft(), ...replacement })).toBe(
        "invalid_event",
      );
    },
  );

  it.each([
    ["eventType", { eventType: "recovery" }],
    ["effect", { effect: "artifact" }],
  ])(
    "rejects a forged infrastructure semantic %s before hashing",
    (_field, replacement) => {
      const { resolvedAssignment, ...base } = draft();
      void resolvedAssignment;
      expect(
        integrityKind({
          ...base,
          eventType: "operation",
          operation: `lock.acquire.t1.d${"a".repeat(64)}`,
          policyVersion: "locks-v1",
          reasonCode: "trail.ok",
          effect: "state",
          ...replacement,
        }),
      ).toBe("invalid_event");
    },
  );

  it("does not fabricate an assignment for a start event", () => {
    const { resolvedAssignment, ...base } = draft();
    void resolvedAssignment;
    const event = seal({
      ...base,
      eventType: "transition",
      operation: "sdd.start:start-01",
      reasonCode: "run.started",
      observedIdentity: { host: "codex", model: null, effort: null },
    });

    expect(event.resolvedAssignment).toBeUndefined();
    expect(event.observedIdentity).toEqual({
      host: "codex",
      model: null,
      effort: null,
    });
  });

  it("requires nullable observed effort on every current draft", () => {
    expect(
      integrityKind({
        ...draft(),
        observedIdentity: { host: "codex", model: "gpt-5" },
      }),
    ).toBe("invalid_event");
  });

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
    ) as CurrentEventDraft;

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
        observedIdentity: {
          host: "codex",
          model: "gpt-5",
          effort: "medium",
          extra: true,
        },
      },
    ],
    [
      "a non-string identity model",
      {
        ...draft(),
        observedIdentity: { host: "codex", model: 1, effort: "medium" },
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
      {
        observedIdentity: {
          host: "other",
          model: "gpt-5",
          effort: "medium",
        },
      },
    ],
    [
      "resolvedAssignment",
      {
        resolvedAssignment: {
          phase: "prd",
          role: "planner",
          model: "other-model",
          effort: "medium",
        },
      },
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
