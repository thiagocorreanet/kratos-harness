import { types } from "node:util";
import goldenV1 from "./fixtures/events/golden-event-v1.json" with { type: "json" };

import type { EventV1, EventV1_1, SnapshotV1 } from "@kratos/contracts";
import {
  EventIntegrityError,
  replayEventStream,
  sealEvent,
  verifyEventStream,
  type CurrentEventDraft,
  type EventReducerRegistry,
} from "@kratos/runtime/domain/events";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import { describe, expect, it } from "vitest";

interface TestState {
  readonly projectId: string;
  readonly runId: string;
  readonly status: "idle" | "active";
  readonly currentStep: string | null;
  readonly lineage: {
    readonly prdDigest: string;
    readonly specDigest: string;
  };
  readonly createdAt: string;
}

const services = {
  digests: sha256Digests(),
  isProxy: types.isProxy,
  isPromise: types.isPromise,
  schemaRegistry: createSchemaRegistry(),
};

const seed: TestState = {
  projectId: "project-01",
  runId: "run-01",
  status: "idle",
  currentStep: null,
  lineage: {
    prdDigest: "a".repeat(64),
    specDigest: "b".repeat(64),
  },
  createdAt: "2026-08-10T00:00:00Z",
};

function draft(index: number): CurrentEventDraft {
  return {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    eventId: `event-${String(index)}`,
    eventType: "transition",
    occurredAt: `2026-08-10T00:0${String(index)}:00Z`,
    operation: `sdd.continue:step-${String(index)}`,
    policyVersion: "policy-01",
    priorRevision: index - 1,
    resultingRevision: index,
    reasonCode: "run.transition.accepted",
    effect: "state",
    artifactRefs: [`.brain/features/feature-${String(index)}.md`],
    evidenceRefs: [`.brain/evidence/event-${String(index)}.json`],
    observedIdentity: { host: "codex", model: "gpt-5", effort: "medium" },
    resolvedAssignment: {
      phase: "code",
      role: "implementer",
      model: "gpt-5",
      effort: "medium",
    },
  };
}

function stream(events = 2) {
  let cursor = { revision: 0, hash: null as string | null };
  const sealed: EventV1_1[] = [];
  for (let index = 1; index <= events; index += 1) {
    const event = sealEvent(draft(index), cursor, services);
    sealed.push(event);
    cursor = { revision: event.resultingRevision, hash: event.eventHash };
  }
  return verifyEventStream(
    `${sealed.map(canonicalizeJson).join("\n")}\n`,
    services,
  );
}

function materialize(
  state: TestState,
  cursor: { readonly revision: number; readonly hash: string | null },
): SnapshotV1 {
  if (cursor.hash === null) throw new Error("missing event hash");
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    projectId: state.projectId,
    runId: state.runId,
    status: state.status,
    currentStep: state.currentStep,
    eventCursor: cursor.revision,
    eventHash: cursor.hash,
    policyVersion: "policy-01",
    lineage: state.lineage,
    createdAt: state.createdAt,
    updatedAt: "2026-08-10T00:02:00Z",
  };
}

const registry: EventReducerRegistry<TestState> = {
  seed,
  reducers: {
    "policy-01": (state, event) => ({
      ...state,
      status: "active",
      currentStep: event.operation,
    }),
  },
  materialize,
};

function errorKind(run: () => unknown): EventIntegrityError["kind"] {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(EventIntegrityError);
    return (error as EventIntegrityError).kind;
  }
  throw new Error("expected replay to fail");
}

describe("event reducer replay", () => {
  it("replays mixed event revisions through the existing reducer policy", () => {
    const oldEvent = {
      ...(JSON.parse(goldenV1.unsignedCanonical) as Omit<EventV1, "eventHash">),
      eventHash: goldenV1.eventHash,
    };
    const current = sealEvent(
      draft(2),
      { revision: 1, hash: oldEvent.eventHash },
      services,
    );
    const verified = verifyEventStream(
      `${canonicalizeJson(oldEvent)}\n${canonicalizeJson(current)}\n`,
      services,
    );

    const replay = replayEventStream(verified, registry, services);

    expect(replay.state.currentStep).toBe(current.operation);
    expect(replay.snapshot.eventHash).toBe(current.eventHash);
  });

  it("replays verified events into a snapshot bound to the final cursor", () => {
    const verified = stream();

    const replay = replayEventStream(verified, registry, services);

    expect(replay.snapshot.eventCursor).toBe(verified.cursor.revision);
    expect(replay.snapshot.eventHash).toBe(verified.cursor.hash);
    expect(replay.snapshot.policyVersion).toBe("policy-01");
    expect(replay.snapshot.updatedAt).toBe(verified.events.at(-1)?.occurredAt);
    expect(JSON.parse(replay.canonical)).toEqual(replay.snapshot);
  });

  it("accepts only the opaque deeply frozen stream returned by verification", () => {
    const verified = stream();
    const event = verified.events.at(0);
    if (event === undefined) throw new Error("missing verified event");

    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.events)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(verified.cursor)).toBe(true);
    expect(Reflect.set(event, "operation", "tampered")).toBe(false);
    expect(Reflect.set(verified.cursor, "revision", 99)).toBe(false);

    const forgeries = [
      { ...verified },
      { ...verified, canonical: "tampered" },
      { ...verified, events: [{ ...event, operation: "tampered" }] },
      { ...verified, cursor: { ...verified.cursor, revision: 99 } },
    ];
    for (const forged of forgeries) {
      expect(
        errorKind(() => replayEventStream(forged, registry, services)),
      ).toBe("invalid_event");
    }

    expect(replayEventStream(verified, registry, services).snapshot.runId).toBe(
      "run-01",
    );
  });

  it("does not accept a persisted snapshot with a changed bound field", () => {
    const replay = replayEventStream(stream(), registry, services);
    const persisted = { ...replay.snapshot, eventCursor: 99 };

    expect(canonicalizeJson(persisted)).not.toBe(replay.canonical);
  });

  it("rejects an empty verified stream", () => {
    expect(
      errorKind(() =>
        replayEventStream(verifyEventStream("", services), registry, services),
      ),
    ).toBe("invalid_event");
  });

  it("rejects an event whose policy has no registered reducer", () => {
    const event = sealEvent(
      { ...draft(1), policyVersion: "policy-02" },
      { revision: 0, hash: null },
      services,
    );
    const unsupported = verifyEventStream(
      `${canonicalizeJson(event)}\n`,
      services,
    );

    expect(
      errorKind(() => replayEventStream(unsupported, registry, services)),
    ).toBe("unsupported_policy");
  });
});
