import { types } from "node:util";

import type { EventV1, SnapshotV1 } from "@mestre-yoda/contracts";
import {
  EventIntegrityError,
  replayEventStream,
  sealEvent,
  verifyEventStream,
  type EventDraftV1,
  type EventReducerRegistry,
} from "@mestre-yoda/runtime/domain/events";
import { canonicalizeJson } from "@mestre-yoda/runtime/domain/schema";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
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
    artifactRefs: [`.brain/features/feature-${String(index)}.md`],
    evidenceRefs: [`.brain/evidence/event-${String(index)}.json`],
    observedIdentity: { host: "codex", model: "gpt-5" },
  };
}

function stream(events = 2) {
  let cursor = { revision: 0, hash: null as string | null };
  const sealed: EventV1[] = [];
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
  it("replays verified events into a snapshot bound to the final cursor", () => {
    const verified = stream();

    const replay = replayEventStream(
      verified,
      registry,
      createSchemaRegistry(),
    );

    expect(replay.snapshot.eventCursor).toBe(verified.cursor.revision);
    expect(replay.snapshot.eventHash).toBe(verified.cursor.hash);
    expect(replay.snapshot.policyVersion).toBe("policy-01");
    expect(replay.snapshot.updatedAt).toBe(verified.events.at(-1)?.occurredAt);
    expect(JSON.parse(replay.canonical)).toEqual(replay.snapshot);
  });

  it("does not accept a persisted snapshot with a changed bound field", () => {
    const replay = replayEventStream(
      stream(),
      registry,
      createSchemaRegistry(),
    );
    const persisted = { ...replay.snapshot, eventCursor: 99 };

    expect(canonicalizeJson(persisted)).not.toBe(replay.canonical);
  });

  it("rejects an empty verified stream", () => {
    expect(
      errorKind(() =>
        replayEventStream(
          verifyEventStream("", services),
          registry,
          services.schemaRegistry,
        ),
      ),
    ).toBe("invalid_event");
  });

  it("rejects an event whose policy has no registered reducer", () => {
    const verified = stream(1);
    const event = verified.events.at(0);
    if (event === undefined) throw new Error("missing verified event");
    const unsupported = {
      ...verified,
      events: [{ ...event, policyVersion: "policy-02" }],
    };

    expect(
      errorKind(() =>
        replayEventStream(unsupported, registry, services.schemaRegistry),
      ),
    ).toBe("unsupported_policy");
  });
});
