import { types } from "node:util";

import type { EventV1, EventV1_1 } from "@kratos/contracts";
import {
  EventIntegrityError,
  sealEvent,
  verifyEventStream,
} from "@kratos/runtime/domain/events";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import { describe, expect, it } from "vitest";
import legacyGolden from "./fixtures/events/golden-event-v1.json" with { type: "json" };

const services = {
  digests: sha256Digests(),
  isProxy: types.isProxy,
  isPromise: types.isPromise,
  schemaRegistry: createSchemaRegistry(),
};

const gateFailures = [
  {
    gateId: "stop-loss",
    reasonCode: "blocked.stop_loss_flag",
    mode: "enforce",
    priority: 20,
    evidenceRefs: [".brain/03-memory/task_metrics.md"],
    detail: null,
  },
  {
    gateId: "gaps-closed",
    reasonCode: "gate.gaps_abertos",
    mode: "shadow",
    priority: 50,
    evidenceRefs: [".brain/02-features/active"],
    detail: null,
  },
] as const;

function draft(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contractVersion: "1.2.0",
    stateContract: "1.2.0",
    eventId: "event-gate-failures-01",
    eventType: "transition",
    occurredAt: "2026-08-30T00:00:00Z",
    operation: "sdd.continue:gate-failures-01",
    policyVersion: "policy-01",
    priorRevision: 0,
    resultingRevision: 1,
    reasonCode: "run.transition.accepted",
    effect: "state",
    artifactRefs: [],
    evidenceRefs: [],
    observedIdentity: { host: "codex", model: "gpt-5", effort: "medium" },
    resolvedAssignment: {
      phase: "code",
      role: "implementer",
      model: "gpt-5",
      effort: "medium",
    },
    gateFailures,
    ...overrides,
  };
}

function kind(input: unknown): EventIntegrityError["kind"] {
  try {
    sealEvent(input, { revision: 0, hash: null }, services);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(EventIntegrityError);
    return (error as EventIntegrityError).kind;
  }
  throw new Error("expected gate-failure event to be rejected");
}

describe("event gate-failure traces", () => {
  it("seals a valid ordered current trace", () => {
    const event = sealEvent(draft(), { revision: 0, hash: null }, services);

    expect(event.contractVersion).toBe("1.2.0");
    if (event.contractVersion !== "1.2.0")
      throw new Error("wrong event version");
    expect(event.gateFailures).toEqual(gateFailures);
  });

  it.each([
    ["unsafe detail", [{ ...gateFailures[0], detail: "\u0000" }]],
    ["oversized detail", [{ ...gateFailures[0], detail: "x".repeat(4097) }]],
    ["duplicate IDs", [gateFailures[0], { ...gateFailures[0], mode: "warn" }]],
    ["wrong priority", [{ ...gateFailures[0], priority: 21 }]],
    [
      "invalid reason pairing",
      [{ ...gateFailures[0], reasonCode: "gate.gaps_abertos" }],
    ],
    ["wrong ordering", [...gateFailures].reverse()],
  ] as const)("rejects %s", (_name, failures) => {
    expect(kind(draft({ gateFailures: failures }))).toBe("invalid_event");
  });

  it("reads a stream mixed with 1.0, 1.1, and 1.2 events", () => {
    const legacy: EventV1 = {
      ...(JSON.parse(legacyGolden.unsignedCanonical) as Omit<
        EventV1,
        "eventHash"
      >),
      eventHash: legacyGolden.eventHash,
    };
    const intermediateUnsigned: Omit<EventV1_1, "eventHash"> = {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "event-gate-failures-1.1",
      eventType: "transition",
      occurredAt: "2026-08-30T00:00:01Z",
      operation: "sdd.continue:legacy-1.1",
      policyVersion: "policy-01",
      priorRevision: 1,
      resultingRevision: 2,
      reasonCode: "run.transition.accepted",
      effect: "state",
      artifactRefs: [],
      evidenceRefs: [],
      observedIdentity: { host: "codex", model: "gpt-5", effort: "medium" },
      resolvedAssignment: {
        phase: "code",
        role: "implementer",
        model: "gpt-5",
        effort: "medium",
      },
      previousHash: legacy.eventHash,
    };
    const intermediate: EventV1_1 = {
      ...intermediateUnsigned,
      eventHash: services.digests.sha256(
        canonicalizeJson(intermediateUnsigned),
      ),
    };
    const current = sealEvent(
      draft({ priorRevision: 2, resultingRevision: 3 }),
      { revision: 2, hash: intermediate.eventHash },
      services,
    );
    const text = `${canonicalizeJson(legacy)}\n${canonicalizeJson(intermediate)}\n${canonicalizeJson(current)}\n`;

    expect(verifyEventStream(text, services).events).toEqual([
      legacy,
      intermediate,
      current,
    ]);
  });
});
