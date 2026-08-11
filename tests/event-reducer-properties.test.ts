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

function generator(seedValue: number): () => number {
  let state = seedValue >>> 0;
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

function stream(count: number, random: () => number) {
  let cursor = { revision: 0, hash: null as string | null };
  const events: EventV1[] = [];
  for (let index = 1; index <= count; index += 1) {
    const event = sealEvent(draft(index, random), cursor, services);
    events.push(event);
    cursor = { revision: event.resultingRevision, hash: event.eventHash };
  }
  return verifyEventStream(
    `${events.map(canonicalizeJson).join("\n")}\n`,
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
    updatedAt: "2026-08-10T00:01:00Z",
  };
}

function registry(
  reducer: EventReducerRegistry<TestState>["reducers"][string],
) {
  return {
    seed,
    reducers: { "policy-01": reducer },
    materialize,
  } satisfies EventReducerRegistry<TestState>;
}

function invalidEvent(run: () => unknown): EventIntegrityError {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(EventIntegrityError);
    return error as EventIntegrityError;
  }
  throw new Error("expected replay to fail");
}

const replayCases = (() => {
  const random = generator(0x21_08_2026);
  const verifiedByLength = new Map<number, ReturnType<typeof stream>>();
  return Array.from({ length: 200 }, (_, index) => {
    const caseSeed = random();
    const count = (index % 32) + 1;
    let verified = verifiedByLength.get(count);
    if (verified === undefined) {
      verified = stream(count, generator(caseSeed));
      verifiedByLength.set(count, verified);
    }
    return {
      caseSeed,
      index,
      verified: structuredClone(verified),
    };
  });
})();

describe("event reducer replay properties", () => {
  it("replays 200 bounded streams three times with byte-identical snapshots", () => {
    const stableRegistry = registry((state, event) => ({
      ...state,
      status: "active",
      currentStep: event.operation,
    }));

    for (const { caseSeed, index, verified } of replayCases) {
      const canonical = Array.from(
        { length: 3 },
        () =>
          replayEventStream(
            verified,
            { ...stableRegistry, seed: structuredClone(seed) },
            services,
          ).canonical,
      );
      expect(
        canonical,
        `seed=${String(caseSeed)} case=${String(index)}`,
      ).toEqual([canonical[0], canonical[0], canonical[0]]);
    }
  });

  it.each([
    [
      "mutates reducer state",
      (state: TestState) => {
        (state as { status: TestState["status"] }).status = "active";
        return state;
      },
    ],
    [
      "mutates event",
      (state: TestState, event: EventV1) => {
        (event as { operation: string }).operation = "attacker-operation";
        return state;
      },
    ],
    [
      "returns an accessor",
      () =>
        Object.defineProperty({}, "state", {
          enumerable: true,
          get: () => "attacker",
        }) as TestState,
    ],
    ["returns NaN", () => Number.NaN as unknown as TestState],
  ])(
    "rejects a reducer that %s without exposing its details",
    (_description, reducer) => {
      const verified = stream(1, generator(7));
      const originalSeed = canonicalizeJson(seed);
      const originalEvents = canonicalizeJson(verified.events);

      const error = invalidEvent(() =>
        replayEventStream(verified, registry(reducer), services),
      );

      expect(error.kind).toBe("invalid_event");
      expect(error.message).toBe("Event stream integrity validation failed");
      expect(canonicalizeJson(seed)).toBe(originalSeed);
      expect(canonicalizeJson(verified.events)).toBe(originalEvents);
    },
  );

  it("rejects a reducer with changing hidden state", () => {
    let calls = 0;
    const error = invalidEvent(() =>
      replayEventStream(
        stream(1, generator(8)),
        registry((state) => ({
          ...state,
          currentStep: `step-${String(calls++)}`,
        })),
        services,
      ),
    );

    expect(error.kind).toBe("invalid_event");
  });

  it("rejects a materialized snapshot that omits a final-event binding", () => {
    const invalidRegistry = {
      ...registry((state) => state),
      materialize: (
        state: TestState,
        cursor: { readonly revision: number; readonly hash: string | null },
      ) => ({
        ...materialize(state, cursor),
        updatedAt: "2026-08-10T00:00:00Z",
      }),
    } satisfies EventReducerRegistry<TestState>;

    expect(
      invalidEvent(() =>
        replayEventStream(stream(1, generator(9)), invalidRegistry, services),
      ).kind,
    ).toBe("invalid_event");
  });
});
