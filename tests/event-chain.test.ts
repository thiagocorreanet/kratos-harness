import { types } from "node:util";

import type { EventV1, EventV1_2 } from "@kratos/contracts";
import goldenV1 from "./fixtures/events/golden-event-v1.json" with { type: "json" };
import goldenV1_2 from "./fixtures/events/golden-event-v1.2.json" with { type: "json" };
import {
  EVENT_RECORD_BYTES,
  EVENT_STREAM_BYTES,
  EVENT_STREAM_COUNT,
  EventIntegrityError,
  parseEventLines,
  sealEvent,
  unsignedEvent,
  verifyEventStream,
  type ReadableEvent,
} from "@kratos/runtime/domain/events";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import type { SchemaRegistry } from "@kratos/runtime/domain/schema";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import { describe, expect, it } from "vitest";

const services = {
  digests: sha256Digests(),
  isProxy: types.isProxy,
  isPromise: types.isPromise,
  schemaRegistry: createSchemaRegistry(),
};

type CurrentEventDraft = Omit<EventV1_2, "previousHash" | "eventHash">;

function sealedV1Event(): EventV1 {
  return {
    ...(JSON.parse(goldenV1.unsignedCanonical) as Omit<EventV1, "eventHash">),
    eventHash: goldenV1.eventHash,
  };
}

function currentDraft(revision: number): CurrentEventDraft {
  return {
    ...(structuredClone(goldenV1_2.draft) as CurrentEventDraft),
    eventId: `event-${String(revision).padStart(2, "0")}`,
    priorRevision: revision - 1,
    resultingRevision: revision,
  };
}

function draft(index: number): CurrentEventDraft {
  return {
    contractVersion: "1.2.0",
    stateContract: "1.2.0",
    eventId: `event-${String(index)}`,
    eventType: "transition",
    occurredAt: `2026-08-10T00:0${String(index)}:00Z`,
    operation: `sdd.continue:step-${String(index)}`,
    policyVersion: "policy-01",
    priorRevision: index - 1,
    resultingRevision: index,
    reasonCode: "run.transition.accepted",
    effect: "state",
    artifactRefs: [`.brain/features/feature-01/${String(index)}.md`],
    evidenceRefs: [`.brain/evidence/event-${String(index)}.json`],
    gateFailures: [],
    observedIdentity: { host: "codex", model: "gpt-5", effort: "medium" },
    resolvedAssignment: {
      phase: "code",
      role: "implementer",
      model: "gpt-5",
      effort: "medium",
    },
  };
}

function stream(): readonly [EventV1_2, EventV1_2] {
  const first = sealEvent(
    draft(1),
    {
      revision: 0,
      hash: null,
    },
    services,
  ) as EventV1_2;
  const second = sealEvent(
    draft(2),
    { revision: 1, hash: first.eventHash },
    services,
  ) as EventV1_2;
  return [first, second];
}

function textOf(events: readonly ReadableEvent[]): string {
  return `${events.map(canonicalizeJson).join("\n")}\n`;
}

function withHash(event: Omit<EventV1_2, "eventHash">): EventV1_2 {
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

interface RejectionCase {
  readonly description: string;
  readonly makeText: () => string;
  readonly expectedKind: EventIntegrityError["kind"];
}

interface VersionCase {
  readonly description: string;
  readonly value: unknown;
  readonly reasonCode: EventIntegrityError["reasonCode"];
  readonly rejectedValue: string | null;
  readonly diagnosticWording: string;
}

describe("event hash-chain verification", () => {
  it("verifies one hash chain across 1.0.0 and 1.2.0 events", () => {
    const oldEvent = sealedV1Event();
    const currentEvent = sealEvent(
      currentDraft(2),
      { revision: 1, hash: oldEvent.eventHash },
      services,
    );

    expect(
      verifyEventStream(
        `${canonicalizeJson(oldEvent)}\n${canonicalizeJson(currentEvent)}\n`,
        services,
      ).cursor.revision,
    ).toBe(2);
  });

  it("covers resolved and observed execution in the current event hash", () => {
    const event = sealEvent(
      currentDraft(1),
      { revision: 0, hash: null },
      services,
    ) as EventV1_2;
    if (event.resolvedAssignment === undefined) {
      throw new Error("missing resolved assignment");
    }
    const tampered: EventV1_2 = {
      ...event,
      resolvedAssignment: {
        ...event.resolvedAssignment,
        model: "tampered-model",
      },
    };

    expect(() =>
      verifyEventStream(`${canonicalizeJson(tampered)}\n`, services),
    ).toThrow("Event stream integrity validation failed");
  });

  it("rejects a correctly rehashed history with a mismatched phase role", () => {
    const event = sealEvent(
      currentDraft(1),
      { revision: 0, hash: null },
      services,
    ) as EventV1_2;
    if (event.resolvedAssignment === undefined) {
      throw new Error("missing resolved assignment");
    }
    const invalid = withHash({
      ...unsignedEvent(event),
      resolvedAssignment: {
        ...event.resolvedAssignment,
        phase: "review",
        role: "implementer",
      },
    });

    expect(
      integrityError(() => verifyEventStream(textOf([invalid]), services)).kind,
    ).toBe("invalid_event");
  });

  it("parses the exact current revision declared by a record", () => {
    const [event] = stream();
    expect(
      parseEventLines(`${canonicalizeJson(event)}\n`, services.schemaRegistry),
    ).toEqual([event]);
  });

  it("dispatches each mixed record by its own declared revision", () => {
    const oldEvent = sealedV1Event();
    const currentEvent = sealEvent(
      currentDraft(2),
      { revision: 1, hash: oldEvent.eventHash },
      services,
    );
    const versions: unknown[] = [];
    const schemaRegistry: SchemaRegistry = {
      validate: ((request: { readonly version: unknown }) => {
        versions.push(request.version);
        return (
          services.schemaRegistry.validate as (request: unknown) => unknown
        )(request);
      }) as SchemaRegistry["validate"],
    };

    parseEventLines(
      `${canonicalizeJson(oldEvent)}\n${canonicalizeJson(currentEvent)}\n`,
      schemaRegistry,
    );

    expect(versions).toEqual(["1.0.0", "1.2.0"]);
  });

  it.each([
    [
      "a 1.0 declaration carrying 1.1-only fields",
      {
        ...sealedV1Event(),
        observedIdentity: { host: "codex", model: "gpt-5", effort: "medium" },
      },
    ],
    [
      "a 1.2 declaration carrying a legacy observed identity",
      (() => {
        const event = sealEvent(
          currentDraft(1),
          { revision: 0, hash: null },
          services,
        );
        return {
          ...event,
          observedIdentity: { host: "codex", model: "gpt-5" },
        };
      })(),
    ],
    [
      "a structural version object",
      { ...sealedV1Event(), stateContract: { major: 1, minor: 0 } },
    ],
  ])("rejects hostile per-line version input: %s", (_description, value) => {
    expect(
      integrityError(() =>
        parseEventLines(
          `${canonicalizeJson(value)}\n`,
          services.schemaRegistry,
        ),
      ).kind,
    ).toBe("invalid_event");
  });

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
    {
      description: "CRLF",
      makeText: () => textOf(stream()).replaceAll("\n", "\r\n"),
      expectedKind: "non_canonical",
    },
    {
      description: "a missing final LF",
      makeText: () => textOf(stream()).slice(0, -1),
      expectedKind: "non_canonical",
    },
    {
      description: "a blank record",
      makeText: () => textOf(stream()).replace("\n", "\n\n"),
      expectedKind: "non_canonical",
    },
    {
      description: "pretty JSON",
      makeText: () => `${JSON.stringify(stream()[0]).replace("{", "{ ")}\n`,
      expectedKind: "non_canonical",
    },
    {
      description: "a bad hash",
      makeText: () => {
        const [first, second] = stream();
        return textOf([
          first,
          {
            ...second,
            eventHash: `${second.eventHash.slice(0, -1)}${second.eventHash.endsWith("0") ? "1" : "0"}`,
          },
        ]);
      },
      expectedKind: "invalid_event",
    },
    {
      description: "a bad predecessor",
      makeText: () => {
        const [first, second] = stream();
        return textOf([
          first,
          withHash({ ...unsignedEvent(second), previousHash: "a".repeat(64) }),
        ]);
      },
      expectedKind: "invalid_sequence",
    },
    {
      description: "a duplicate revision",
      makeText: () => {
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
      expectedKind: "invalid_sequence",
    },
    {
      description: "a revision gap",
      makeText: () => {
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
      expectedKind: "invalid_sequence",
    },
    {
      description: "swapped records",
      makeText: () => textOf([...stream()].reverse()),
      expectedKind: "invalid_sequence",
    },
    {
      description: "malformed JSON",
      makeText: () => '{"eventId":\n',
      expectedKind: "invalid_event",
    },
  ];

  it.each(rejectionCases)(
    "rejects $description as $expectedKind",
    ({ makeText, expectedKind }) => {
      expect(
        integrityError(() => verifyEventStream(makeText(), services)).kind,
      ).toBe(expectedKind);
    },
  );

  it.each<VersionCase>([
    {
      description: "a missing version",
      value: (() => {
        const [first] = stream();
        return Object.fromEntries(
          Object.entries(first).filter(([key]) => key !== "stateContract"),
        );
      })(),
      reasonCode: "contract.state_version_invalid",
      rejectedValue: null,
      diagnosticWording: "contract.state_version_invalid",
    },
    {
      description: "a malformed version",
      value: { ...stream()[0], stateContract: "not-a-contract-version" },
      reasonCode: "contract.state_version_invalid",
      rejectedValue: "not-a-contract-version",
      diagnosticWording: "contract.state_version_invalid",
    },
    {
      description: "an unsupported version",
      value: { ...stream()[0], stateContract: "2.0.0" },
      reasonCode: "contract.state_version_unsupported",
      rejectedValue: "2.0.0",
      diagnosticWording: "contract.state_version_unsupported",
    },
  ])(
    "preserves the allowlisted reason code for $description",
    ({ value, reasonCode, rejectedValue, diagnosticWording }) => {
      const error = integrityError(() =>
        verifyEventStream(`${canonicalizeJson(value)}\n`, services),
      );

      expect(error.kind).toBe("invalid_event");
      expect(error.reasonCode).toBe(reasonCode);
      expect(error.message).toBe("Event stream integrity validation failed");
      expect(error.message).not.toContain(diagnosticWording);
      if (rejectedValue !== null) {
        expect(error.message).not.toContain(rejectedValue);
      }
    },
  );

  it("does not copy rejected content or structural diagnostic wording", () => {
    const [first] = stream();
    const rejected = "attacker payload with spaces";
    const diagnosticWording = "must match pattern";
    const error = integrityError(() =>
      verifyEventStream(
        `${canonicalizeJson({ ...first, eventId: rejected })}\n`,
        services,
      ),
    );

    expect(error.kind).toBe("invalid_event");
    expect(error.reasonCode).toBeNull();
    expect(error.message).toBe("Event stream integrity validation failed");
    expect(error.message).not.toContain(rejected);
    expect(error.message).not.toContain(diagnosticWording);
  });

  it("returns an empty parsed stream only for empty text", () => {
    expect(parseEventLines("", services.schemaRegistry)).toEqual([]);
  });

  it("sanitizes an unrecognized version diagnostic for a non-record input", () => {
    let observedVersion: unknown = "not called";
    const registry: SchemaRegistry = {
      validate: (request) => {
        observedVersion = request.version;
        return {
          kind: "invalid",
          diagnostics: [
            {
              contract: "state.event",
              version: null,
              pointer: "",
              keyword: "version",
              reasonCode: "private.version.detail",
              recovery: "private",
            },
          ],
        } as never;
      },
    };

    const error = integrityError(() => parseEventLines("[]\n", registry));
    expect(observedVersion).toBeUndefined();
    expect(error).toMatchObject({ kind: "invalid_event", reasonCode: null });
  });

  it("does not read an inherited stateContract accessor", () => {
    let getterCalls = 0;
    let observedVersion: unknown = "not called";
    Object.defineProperty(Object.prototype, "stateContract", {
      configurable: true,
      get: () => {
        getterCalls += 1;
        return "1.1.0";
      },
    });
    const registry: SchemaRegistry = {
      validate: (request) => {
        observedVersion = request.version;
        return {
          kind: "invalid",
          diagnostics: [],
        } as never;
      },
    };

    try {
      expect(() => parseEventLines("{}\n", registry)).toThrow(
        "Event stream integrity validation failed",
      );
    } finally {
      Reflect.deleteProperty(Object.prototype, "stateContract");
    }

    expect(getterCalls).toBe(0);
    expect(observedVersion).toBeUndefined();
  });

  it("sanitizes a canonicalizer failure after a registry claims validity", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const registry: SchemaRegistry = {
      validate: () => ({ kind: "valid", value: circular }) as never,
    };

    expect(integrityError(() => parseEventLines("{}\n", registry)).kind).toBe(
      "invalid_event",
    );
  });

  it("enforces exact record byte limits", () => {
    const exact = "a".repeat(EVENT_RECORD_BYTES);
    const overflow = `${exact}a`;

    expect(new TextEncoder().encode(exact).byteLength).toBe(65_536);
    expect(new TextEncoder().encode(overflow).byteLength).toBe(65_537);
    expect(
      integrityError(() =>
        parseEventLines(`${exact}\n`, services.schemaRegistry),
      ).kind,
    ).toBe("invalid_event");
    expect(
      integrityError(() =>
        parseEventLines(`${overflow}\n`, services.schemaRegistry),
      ).kind,
    ).toBe("resource_limit");
  });

  it("measures multibyte record limits with UTF-8 bytes", () => {
    const exact = `${"€".repeat(Math.floor((EVENT_RECORD_BYTES - 1) / 3))}a`;
    const overflow = `${exact}a`;

    expect(new TextEncoder().encode(exact).byteLength).toBe(65_536);
    expect(new TextEncoder().encode(overflow).byteLength).toBe(65_537);
    expect(
      integrityError(() =>
        parseEventLines(`${exact}\n`, services.schemaRegistry),
      ).kind,
    ).toBe("invalid_event");
    expect(
      integrityError(() =>
        parseEventLines(`${overflow}\n`, services.schemaRegistry),
      ).kind,
    ).toBe("resource_limit");
  });

  it("enforces stream byte limits before JSON Lines spelling validation", () => {
    expect(
      integrityError(() =>
        parseEventLines(
          "a".repeat(EVENT_STREAM_BYTES),
          services.schemaRegistry,
        ),
      ).kind,
    ).toBe("non_canonical");
    expect(
      integrityError(() =>
        parseEventLines(
          "a".repeat(EVENT_STREAM_BYTES + 1),
          services.schemaRegistry,
        ),
      ).kind,
    ).toBe("resource_limit");
  });

  it("enforces event counts before parsing records", () => {
    expect(
      integrityError(() =>
        parseEventLines(
          "x\n".repeat(EVENT_STREAM_COUNT),
          services.schemaRegistry,
        ),
      ).kind,
    ).toBe("invalid_event");
    expect(
      integrityError(() =>
        parseEventLines(
          "x\n".repeat(EVENT_STREAM_COUNT + 1),
          services.schemaRegistry,
        ),
      ).kind,
    ).toBe("resource_limit");
  });
});
