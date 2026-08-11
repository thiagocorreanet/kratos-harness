import { types } from "node:util";
import { readFileSync } from "node:fs";

import type { EventV1, SnapshotV1 } from "@mestre-yoda/contracts";
import {
  EventIntegrityError,
  isRecognizedReducerRegistryFailure,
  replayEventStream,
  sealEvent,
  snapshotEventReducerRegistry,
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
  readonly lineage: { readonly prdDigest: string; readonly specDigest: string };
  readonly createdAt: string;
}

const schemaRegistry = createSchemaRegistry();
const eventServices = {
  digests: sha256Digests(),
  isProxy: types.isProxy,
  schemaRegistry,
};

/** Compatible with both the reviewed and corrected third-argument shapes. */
const replayServices = {
  isProxy: types.isProxy,
  schemaRegistry,
  validate: schemaRegistry.validate.bind(schemaRegistry),
};

const seed: TestState = {
  projectId: "project-01",
  runId: "run-01",
  status: "idle",
  currentStep: null,
  lineage: { prdDigest: "a".repeat(64), specDigest: "b".repeat(64) },
  createdAt: "2026-08-10T00:00:00Z",
};

it("snapshots a closed deeply frozen reducer registry without retaining source mutation", () => {
  const mutable = { ...seed, lineage: { ...seed.lineage } };
  const registry: EventReducerRegistry<TestState> = {
    seed: mutable,
    reducers: { "policy-01": (state) => ({ ...state }) },
    materialize: snapshot,
  };
  const frozen = snapshotEventReducerRegistry(registry, replayServices);
  mutable.lineage.prdDigest = "c".repeat(64);

  expect(Object.isFrozen(frozen)).toBe(true);
  expect(Object.isFrozen(frozen.seed)).toBe(true);
  expect(Object.isFrozen(frozen.seed.lineage)).toBe(true);
  expect(Object.isFrozen(frozen.reducers)).toBe(true);
  expect(frozen.seed.lineage.prdDigest).toBe("a".repeat(64));
  expect(Object.keys(frozen.reducers)).toEqual(["policy-01"]);
});

function draft(): EventDraftV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    eventId: "event-01",
    eventType: "transition",
    occurredAt: "2026-08-10T00:01:00Z",
    operation: "sdd.continue",
    policyVersion: "policy-01",
    priorRevision: 0,
    resultingRevision: 1,
    reasonCode: "ok",
    effect: "state",
    artifactRefs: [".brain/features/feature-01.md"],
    evidenceRefs: [".brain/evidence/event-01.json"],
    observedIdentity: { host: "codex", model: "gpt-5" },
  };
}

function stream() {
  const event = sealEvent(draft(), { revision: 0, hash: null }, eventServices);
  return verifyEventStream(`${canonicalizeJson(event)}\n`, eventServices);
}

function snapshot(
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
  reducer: (state: TestState, event: EventV1) => TestState = (state) => state,
  materialize: EventReducerRegistry<TestState>["materialize"] = snapshot,
): EventReducerRegistry<TestState> {
  return { seed, reducers: { "policy-01": reducer }, materialize };
}

function replay<State>(
  value: EventReducerRegistry<State>,
  verified = stream(),
) {
  return replayEventStream(verified, value, replayServices);
}

function invalidEvent(run: () => unknown): EventIntegrityError {
  try {
    run();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(EventIntegrityError);
    const integrity = error as EventIntegrityError;
    expect(integrity.kind).toBe("invalid_event");
    expect(integrity.message).toBe("Event stream integrity validation failed");
    return integrity;
  }
  throw new Error("expected replay refusal");
}

describe("event reducer replay boundary", () => {
  it("identifies only reducer-registry failures created by this boundary", () => {
    const forged = new EventIntegrityError("invalid_event");
    expect(isRecognizedReducerRegistryFailure(forged)).toBe(false);

    let recognized: unknown;
    try {
      snapshotEventReducerRegistry(null as never, replayServices);
    } catch (error) {
      recognized = error;
    }
    expect(isRecognizedReducerRegistryFailure(recognized)).toBe(true);
  });

  it("sanitizes a proxy-detector exception", () => {
    invalidEvent(() =>
      replayEventStream(stream(), registry(), {
        ...replayServices,
        isProxy: () => {
          throw new Error("private proxy detector failure");
        },
      }),
    );
  });

  it("sanitizes a native Promise whose rejection handler cannot attach", () => {
    const original = Object.getOwnPropertyDescriptor(Promise.prototype, "then");
    if (original === undefined) throw new Error("missing native Promise.then");
    void Object.defineProperty(Promise.prototype, "then", {
      configurable: true,
      value: () => {
        throw new Error("private promise handler failure");
      },
      writable: true,
    });
    try {
      invalidEvent(() => {
        void replay(registry(() => new Promise(() => undefined) as never));
      });
    } finally {
      void Object.defineProperty(Promise.prototype, "then", original);
    }
  });

  it.each(["reducer", "materializer"] as const)(
    "rejects a rejected native Promise from a %s without an unhandled rejection",
    async (kind) => {
      const rejected = Promise.reject(new Error("private rejection"));
      const value =
        kind === "reducer"
          ? registry(() => rejected as unknown as TestState)
          : registry(undefined, () => rejected as unknown as SnapshotV1);

      invalidEvent(() => replay(value));
      await Promise.resolve();
    },
  );

  it("normalizes seed, callback inputs, outputs, and materializer inputs", () => {
    interface OrderedState extends TestState {
      readonly values: { readonly alpha: number; readonly zero: number };
    }
    const left: OrderedState = {
      ...seed,
      values: { zero: -0, alpha: 1 },
    };
    const right: OrderedState = {
      ...seed,
      values: { alpha: 1, zero: 0 },
    };
    const seenNegativeZero: boolean[] = [];
    const orderedRegistry = (
      value: OrderedState,
    ): EventReducerRegistry<OrderedState> => ({
      seed: value,
      reducers: {
        "policy-01": (state) => {
          seenNegativeZero.push(Object.is(state.values.zero, -0));
          return { ...state, values: { zero: -0, alpha: state.values.alpha } };
        },
      },
      materialize: (state, cursor) => {
        seenNegativeZero.push(Object.is(state.values.zero, -0));
        return snapshot(state, cursor);
      },
    });

    const first = replay(orderedRegistry(left));
    const second = replay(orderedRegistry(right));

    expect(first.canonical).toBe(second.canonical);
    expect(Object.is(first.state.values.zero, -0)).toBe(false);
    expect(seenNegativeZero).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("rejects a custom array prototype before inspecting its properties", () => {
    const values = ["value"];
    Object.setPrototypeOf(values, {});

    invalidEvent(() =>
      replay({ ...registry(), seed: { ...seed, values } as TestState }),
    );
  });

  it("rejects hostile arrays without executing an accessor", () => {
    let reads = 0;
    const accessor = Object.defineProperty(["value"], "0", {
      enumerable: true,
      get: () => {
        reads += 1;
        throw new Error("private array getter");
      },
    });
    const hole = Array(1);
    const extra = ["value"] as string[] & { extra?: string };
    extra.extra = "private";
    const symbol = ["value"];
    Object.defineProperty(symbol, Symbol("private"), {
      configurable: true,
      enumerable: true,
      value: "private",
      writable: true,
    });

    for (const values of [accessor, hole, extra, symbol]) {
      invalidEvent(() =>
        replay({ ...registry(), seed: { ...seed, values } as TestState }),
      );
    }
    expect(reads).toBe(0);
  });

  it("rejects cyclic, executable, and non-finite JSON seed values", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    for (const hostile of [cyclic, () => "private", Infinity, Number.NaN]) {
      invalidEvent(() =>
        replay({ ...registry(), seed: { ...seed, hostile } as TestState }),
      );
    }
  });

  it("preserves a prototype-pollution key as inert JSON data", () => {
    const polluted = Object.defineProperty({ ...seed }, "__proto__", {
      configurable: true,
      enumerable: true,
      value: { polluted: true },
      writable: true,
    });

    const replayed = replay({ ...registry(), seed: polluted });

    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(replayed.state).toHaveProperty("__proto__", { polluted: true });
  });

  it("copies a 100,000-entry array with linear replay work", () => {
    const values = Array.from({ length: 100_000 }, (_, index) => index);
    const replayed = replay({
      ...registry(),
      seed: { ...seed, values } as TestState,
    });

    expect(
      (replayed.state as TestState & { values: readonly number[] }).values,
    ).toHaveLength(100_000);
  });

  it("uses a linear membership check while snapshotting arrays", () => {
    const source = readFileSync(
      new URL(
        "../packages/runtime/src/domain/events/reduce.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).not.toContain("entries.includes");
  });

  it("accepts replay services instead of a bare schema registry", () => {
    expect(replay(registry()).snapshot.eventCursor).toBe(1);
  });

  it("rejects a cursor that does not match the final verified event", () => {
    const verified = stream();
    const materializeCalls = { value: 0 };
    const divergent = {
      ...verified,
      cursor: { revision: 0, hash: verified.cursor.hash },
    };

    invalidEvent(() =>
      replay(
        registry(undefined, (state, cursor) => {
          materializeCalls.value += 1;
          return snapshot(state, cursor);
        }),
        divergent,
      ),
    );
    expect(materializeCalls.value).toBe(0);
  });

  it("rejects a cursor hash that does not match the final verified event", () => {
    const verified = stream();

    invalidEvent(() =>
      replay(registry(), {
        ...verified,
        cursor: { revision: verified.cursor.revision, hash: "c".repeat(64) },
      }),
    );
  });

  const bindingChanges: readonly [string, (value: SnapshotV1) => SnapshotV1][] =
    [
      ["event cursor", (value: SnapshotV1) => ({ ...value, eventCursor: 0 })],
      [
        "event hash",
        (value: SnapshotV1) => ({ ...value, eventHash: "c".repeat(64) }),
      ],
      [
        "policy version",
        (value: SnapshotV1) => ({ ...value, policyVersion: "policy-02" }),
      ],
      [
        "updated time",
        (value: SnapshotV1) => ({
          ...value,
          updatedAt: "2026-08-10T00:00:00Z",
        }),
      ],
    ];
  it.each(bindingChanges)(
    "rejects an isolated invalid %s binding",
    (_name, change) => {
      invalidEvent(() =>
        replay(
          registry(undefined, (state, cursor) =>
            change(snapshot(state, cursor)),
          ),
        ),
      );
    },
  );

  it("rejects a root registry Proxy before any trap", () => {
    let traps = 0;
    const value = new Proxy(registry(), {
      get: () => {
        traps += 1;
        throw new Error("private root trap");
      },
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error("private root trap");
      },
    });

    invalidEvent(() => replay(value));
    expect(traps).toBe(0);
  });

  const rootFactories: readonly [
    string,
    () => { readonly reads: () => number; readonly value: object },
  ][] = [
    [
      "an accessor root descriptor",
      () => {
        let reads = 0;
        const value = { ...registry() };
        Object.defineProperty(value, "seed", {
          enumerable: true,
          get: () => {
            reads += 1;
            throw new Error("private seed getter");
          },
        });
        return { value, reads: () => reads };
      },
    ],
    [
      "an inherited root field",
      () => ({ value: Object.create(registry()) as object, reads: () => 0 }),
    ],
    [
      "an unexpected root field",
      () => ({ value: { ...registry(), extra: true }, reads: () => 0 }),
    ],
  ];
  it.each(rootFactories)("rejects %s without reading it", (_name, make) => {
    const { value, reads } = make();
    invalidEvent(() => replay(value as EventReducerRegistry<TestState>));
    expect(reads()).toBe(0);
  });

  const hostileFactories: readonly [string, () => unknown][] = [
    ["a Proxy seed", () => new Proxy(structuredClone(seed), {})],
    [
      "an accessor seed",
      () =>
        Object.defineProperty({}, "value", {
          enumerable: true,
          get: () => "private",
        }),
    ],
    [
      "a Proxy reducer map",
      () => new Proxy({ "policy-01": (state: TestState) => state }, {}),
    ],
    [
      "an inherited reducer",
      () =>
        Object.create({ "policy-01": (state: TestState) => state }) as object,
    ],
    [
      "an accessor reducer",
      () =>
        Object.defineProperty({}, "policy-01", {
          enumerable: true,
          get: () => (state: TestState) => state,
        }),
    ],
    [
      "an unexpected reducer descriptor",
      () => ({ "policy-01": "not-callable" }),
    ],
  ];
  it.each(hostileFactories)(
    "rejects %s at the inert registry boundary",
    (_name, hostile) => {
      const value = registry();
      if (_name.includes("seed")) {
        (value as { seed: unknown }).seed = hostile();
      } else {
        (value as { reducers: unknown }).reducers = hostile();
      }
      invalidEvent(() => replay(value));
    },
  );

  it("rejects seed and reducer accessors without invoking them", () => {
    let reads = 0;
    const seedAccessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => {
        reads += 1;
        throw new Error("private seed getter");
      },
    });
    const reducerAccessor = Object.defineProperty({}, "policy-01", {
      enumerable: true,
      get: () => {
        reads += 1;
        throw new Error("private reducer getter");
      },
    });

    invalidEvent(() =>
      replay({ ...registry(), seed: seedAccessor as unknown as TestState }),
    );
    invalidEvent(() => replay({ ...registry(), reducers: reducerAccessor }));
    expect(reads).toBe(0);
  });

  it("rejects a Proxy seed before any trap", () => {
    let traps = 0;
    const seedProxy = new Proxy(structuredClone(seed), {
      getOwnPropertyDescriptor: () => {
        traps += 1;
        throw new Error("private seed trap");
      },
    });

    invalidEvent(() => replay({ ...registry(), seed: seedProxy }));
    expect(traps).toBe(0);
  });

  it.each(["reducer", "materializer"] as const)(
    "rejects a callable Proxy %s before invocation",
    (kind) => {
      let calls = 0;
      const callable = new Proxy(
        () => {
          calls += 1;
          throw new Error("private callable");
        },
        {
          apply: () => {
            calls += 1;
            throw new Error("private callable");
          },
        },
      );
      const value =
        kind === "reducer" ? registry(callable) : registry(undefined, callable);

      invalidEvent(() => replay(value));
      expect(calls).toBe(0);
    },
  );

  it.each([
    [
      "reducer",
      (state: TestState) => {
        try {
          (state as { status: TestState["status"] }).status = "active";
          (state as { status: TestState["status"] }).status = "idle";
        } catch {
          void 0;
        }
        return state;
      },
    ],
    [
      "event",
      (state: TestState, event: EventV1) => {
        try {
          (event as { operation: string }).operation = "private";
        } catch {
          void 0;
        }
        return state;
      },
    ],
  ])(
    "rejects a %s mutation attempt even when caught or reverted",
    (_name, reducer) => {
      invalidEvent(() => replay(registry(reducer)));
    },
  );

  it.each([
    [
      "define a property",
      (state: object) => Object.defineProperty(state, "x", { value: 1 }),
    ],
    [
      "delete a property",
      (state: object) => Reflect.deleteProperty(state, "status"),
    ],
    ["prevent extensions", (state: object) => Object.preventExtensions(state)],
    [
      "change a prototype",
      (state: object) => {
        Object.setPrototypeOf(state, null);
      },
    ],
  ] as const)("rejects a reducer that tries to %s", (_name, mutate) => {
    invalidEvent(() =>
      replay(
        registry((state) => {
          try {
            mutate(state);
          } catch {
            void 0;
          }
          return state;
        }),
      ),
    );
  });

  it.each([
    [
      "state",
      (
        state: TestState,
        cursor: { readonly revision: number; readonly hash: string | null },
      ) => {
        try {
          (state as { status: TestState["status"] }).status = "active";
        } catch {
          void 0;
        }
        return snapshot(state, cursor);
      },
    ],
    [
      "cursor",
      (
        state: TestState,
        cursor: { readonly revision: number; readonly hash: string | null },
      ) => {
        try {
          (cursor as { revision: number }).revision = 0;
          (cursor as { revision: number }).revision = 1;
        } catch {
          void 0;
        }
        return snapshot(state, cursor);
      },
    ],
  ])("rejects a materializer %s mutation attempt", (_name, materialize) => {
    invalidEvent(() => replay(registry(undefined, materialize)));
  });

  it.each(["reducer", "materializer", "registry getter"] as const)(
    "sanitizes forged EventIntegrityError from a %s",
    (kind) => {
      const forged = new EventIntegrityError("unsupported_policy");
      const value =
        kind === "reducer"
          ? registry(() => {
              throw forged;
            })
          : kind === "materializer"
            ? registry(undefined, () => {
                throw forged;
              })
            : Object.defineProperty({ ...registry() }, "seed", {
                enumerable: true,
                get: () => {
                  throw forged;
                },
              });

      expect(invalidEvent(() => replay(value))).not.toBe(forged);
    },
  );

  it.each(["reducer", "materializer"] as const)(
    "sanitizes private exceptions from a %s",
    (kind) => {
      const value =
        kind === "reducer"
          ? registry(() => {
              throw new Error("private callback detail");
            })
          : registry(undefined, () => {
              throw new Error("private callback detail");
            });

      invalidEvent(() => replay(value));
    },
  );

  it.each([
    [
      "an accessor result",
      () =>
        Object.defineProperty({}, "state", {
          enumerable: true,
          get: () => "private",
        }),
    ],
    ["NaN", () => Number.NaN],
    ["an external Proxy", () => new Proxy({}, {})],
  ])("rejects a reducer result containing %s", (_name, result) => {
    invalidEvent(() =>
      replay(registry(() => result() as unknown as TestState)),
    );
  });

  it.each([
    [
      "an accessor result",
      () =>
        Object.defineProperty({}, "state", {
          enumerable: true,
          get: () => "private",
        }),
    ],
    ["NaN", () => Number.NaN],
    ["an external Proxy", () => new Proxy({}, {})],
  ])("rejects a materializer result containing %s", (_name, result) => {
    invalidEvent(() =>
      replay(registry(undefined, () => result() as unknown as SnapshotV1)),
    );
  });

  it("rejects a nondeterministic materializer", () => {
    let calls = 0;

    invalidEvent(() =>
      replay(
        registry(undefined, (state, cursor) => ({
          ...snapshot(state, cursor),
          currentStep: `step-${String(calls++)}`,
        })),
      ),
    );
  });

  it("rejects a deterministic snapshot with incorrect final bindings", () => {
    invalidEvent(() =>
      replay(
        registry(undefined, (state, cursor) => ({
          ...snapshot(state, cursor),
          updatedAt: "2026-08-10T00:02:00Z",
        })),
      ),
    );
  });

  it("rejects a bound snapshot that fails its schema", () => {
    invalidEvent(() =>
      replay(
        registry(undefined, (state, cursor) => ({
          ...snapshot(state, cursor),
          currentStep: 1 as unknown as string,
        })),
      ),
    );
  });

  it.each([
    [
      "an array with a non-index key",
      () => {
        const values = [] as string[] & { "00"?: string };
        values.length = 1;
        values["00"] = "private";
        return values;
      },
    ],
    [
      "a non-enumerable array entry",
      () => Object.defineProperty(["private"], "0", { enumerable: false }),
    ],
  ] as const)("rejects a seed containing %s", (_name, values) => {
    invalidEvent(() =>
      replay({
        ...registry(),
        seed: { ...seed, values: values() } as TestState,
      }),
    );
  });

  it.each([
    [
      "a symbol state key",
      () =>
        Object.defineProperty({ ...seed }, Symbol("private"), {
          enumerable: true,
          value: 1,
        }),
    ],
    [
      "a non-enumerable state key",
      () =>
        Object.defineProperty({ ...seed }, "private", {
          enumerable: false,
          value: 1,
        }),
    ],
  ] as const)("rejects a seed with %s", (_name, create) => {
    invalidEvent(() => replay({ ...registry(), seed: create() }));
  });

  it.each([
    ["a non-object registry", null],
    [
      "a non-enumerable registry field",
      Object.defineProperty({ ...registry() }, "seed", {
        enumerable: false,
        value: seed,
      }),
    ],
    ["a non-object reducer map", { ...registry(), reducers: null }],
    [
      "a symbol reducer key",
      {
        ...registry(),
        reducers: Object.defineProperty({}, Symbol("private"), {
          enumerable: true,
          value: () => seed,
        }),
      },
    ],
  ] as const)("rejects %s before replay", (_name, value) => {
    invalidEvent(() =>
      replay(value as unknown as EventReducerRegistry<TestState>),
    );
  });

  it.each([
    [
      "an invalid cursor",
      (verified: ReturnType<typeof stream>) => ({ ...verified, cursor: null }),
    ],
    [
      "an invalid tail event",
      (verified: ReturnType<typeof stream>) => ({
        ...verified,
        events: [null],
      }),
    ],
  ] as const)("rejects a stream with %s before replay", (_name, corrupt) => {
    invalidEvent(() =>
      replay(
        registry(),
        corrupt(stream()) as unknown as ReturnType<typeof stream>,
      ),
    );
  });

  it("accepts a reducer returning its callback input without output aliasing", () => {
    const replayed = replay(registry((state) => state));

    expect(replayed.state).not.toBe(seed);
    expect(replayed.state).toEqual(seed);
  });

  it("allows inert reads of absent tracked properties", () => {
    const replayed = replay(
      registry((state) => {
        expect(
          (state as unknown as Record<string, unknown>).missing,
        ).toBeUndefined();
        expect(
          Object.getOwnPropertyDescriptor(state, "missing"),
        ).toBeUndefined();
        return state;
      }),
    );

    expect(replayed.state).toEqual(seed);
  });

  it("keeps shared reducer and materializer results detached from replay output", () => {
    const sharedState = structuredClone(seed);
    const sharedSnapshot = snapshot(seed, stream().cursor);
    const replayed = replay(
      registry(
        () => sharedState,
        () => sharedSnapshot,
      ),
    );

    (sharedState as { status: TestState["status"] }).status = "active";
    sharedSnapshot.status = "active";
    expect(replayed.state).not.toBe(sharedState);
    expect(replayed.snapshot).not.toBe(sharedSnapshot);
    expect(replayed.state.status).toBe("idle");
    expect(replayed.snapshot.status).toBe("idle");
  });
});
