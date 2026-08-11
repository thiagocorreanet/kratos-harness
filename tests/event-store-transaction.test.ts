import type { SnapshotV1 } from "@mestre-yoda/contracts";
import { types } from "node:util";
import {
  applyPlan,
  createRuntime,
  TransactionFailure,
} from "@mestre-yoda/runtime/composition";
import { planOf } from "@mestre-yoda/runtime/domain/effects";
import type {
  EventDraftV1,
  EventReducerRegistry,
} from "@mestre-yoda/runtime/domain/events";
import { EventIntegrityError } from "@mestre-yoda/runtime/domain/events";
import {
  fixedClock,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import type {
  DurableEntry,
  DurableFileSystem,
} from "@mestre-yoda/runtime/ports";
import { describe, expect, it, vi } from "vitest";

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

const reducers: EventReducerRegistry<{ readonly step: string | null }> = {
  seed: { step: null },
  reducers: {
    "policy-01": (state, event) => ({ ...state, step: event.operation }),
  },
  materialize: (state, cursor): SnapshotV1 => {
    if (cursor.hash === null) throw new Error("missing hash");
    return {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      projectId: "project-01",
      runId: "run-01",
      status: "active",
      currentStep: state.step,
      eventCursor: cursor.revision,
      eventHash: cursor.hash,
      policyVersion: "policy-01",
      lineage: { prdDigest: "a".repeat(64), specDigest: "b".repeat(64) },
      createdAt: "2026-08-10T00:00:00Z",
      updatedAt: `2026-08-10T00:0${String(cursor.revision)}:00Z`,
    };
  },
};

function materializerProxy(): EventReducerRegistry<{
  readonly step: string | null;
}>["materialize"] {
  const target: EventReducerRegistry<{
    readonly step: string | null;
  }>["materialize"] = (state, cursor) => reducers.materialize(state, cursor);
  return new Proxy(target, {});
}

function fakeRuntime(
  seed: Parameters<typeof memoryTransactionStorage>[0] = {
    directories: [".brain", ".brain/transactions"],
  },
) {
  const storage = memoryTransactionStorage(seed);
  const output = recordingOutput();
  return {
    storage,
    output,
    ports: createRuntime({
      clock: fixedClock("2026-08-10T00:00:00.000Z"),
      ids: sequentialIds("transaction"),
      fileSystem: storage.fileSystem,
      durableFileSystem: storage.durableFileSystem,
      digests: storage.digests,
      output,
    }),
  };
}

function eventPlan(index: number) {
  return planOf({ kind: "append_event", runId: "run-01", event: draft(index) });
}

function manifestPaths(storage: ReturnType<typeof memoryTransactionStorage>) {
  const manifest = JSON.parse(
    storage.snapshot().files[
      ".brain/transactions/transaction-1/manifest.json"
    ] ?? "",
  ) as { readonly operations: readonly { readonly path: string }[] };
  return manifest.operations.map(({ path }) => path);
}

describe("event-store transaction integration", () => {
  it("creates parent directories explicitly and commits the prepared pair in order", async () => {
    const { storage, ports } = fakeRuntime();

    await applyPlan(eventPlan(1), ports, {
      rootMode: "existing",
      eventReducers: reducers,
    });

    expect(manifestPaths(storage)).toEqual([
      ".brain/runs",
      ".brain/runs/run-01",
      ".brain/runs/run-01/events.jsonl",
      ".brain/runs/run-01/state.json",
    ]);
    expect(storage.snapshot().directories).toEqual(
      expect.arrayContaining([".brain/runs", ".brain/runs/run-01"]),
    );
  });

  it("extends the exact stream prefix and snapshot on a successor append", async () => {
    const { storage, ports } = fakeRuntime();
    await applyPlan(eventPlan(1), ports, {
      rootMode: "existing",
      eventReducers: reducers,
    });
    const first = storage.snapshot();

    await applyPlan(eventPlan(2), ports, {
      rootMode: "existing",
      eventReducers: reducers,
    });

    const second = storage.snapshot();
    expect(
      second.files[".brain/runs/run-01/events.jsonl"]?.startsWith(
        first.files[".brain/runs/run-01/events.jsonl"] ?? "",
      ),
    ).toBe(true);
    const state = JSON.parse(
      second.files[".brain/runs/run-01/state.json"] ?? "",
    ) as SnapshotV1;
    expect(state.eventCursor).toBe(2);
  });

  it("rejects duplicate appends before preflight I/O", async () => {
    const { storage, ports } = fakeRuntime();

    await expect(
      applyPlan(
        planOf(
          { kind: "append_event", runId: "run-01", event: draft(1) },
          { kind: "append_event", runId: "run-01", event: draft(2) },
        ),
        ports,
        { rootMode: "existing", eventReducers: reducers },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.calls()).toEqual([]);
  });

  it("rejects an append without reducers before preflight I/O", async () => {
    const { storage, ports } = fakeRuntime();

    await expect(
      applyPlan(eventPlan(1), ports, { rootMode: "existing" }),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.calls()).toEqual([]);
  });

  it.each([
    {
      label: "registry proxy",
      make: () => new Proxy(reducers, {}),
    },
    {
      label: "registry accessor",
      make: () => {
        const registry = { ...reducers } as Record<string, unknown>;
        Object.defineProperty(registry, "seed", {
          enumerable: true,
          get() {
            throw new Error("registry accessor must not run");
          },
        });
        return registry;
      },
    },
    {
      label: "reducer map proxy",
      make: () => ({ ...reducers, reducers: new Proxy(reducers.reducers, {}) }),
    },
    {
      label: "reducer reference proxy",
      make: () => ({
        ...reducers,
        reducers: {
          "policy-01": new Proxy(
            reducers.reducers["policy-01"] ?? (() => ({ step: null })),
            {},
          ),
        },
      }),
    },
    {
      label: "materializer proxy",
      make: () => ({
        ...reducers,
        materialize: materializerProxy(),
      }),
    },
  ])(
    "classifies a hostile $label as paired state corruption before I/O",
    async ({ make }) => {
      const { storage, ports } = fakeRuntime();

      await expect(
        applyPlan(eventPlan(1), ports, {
          rootMode: "existing",
          eventReducers: make() as EventReducerRegistry<{
            readonly step: string | null;
          }>,
        }),
      ).rejects.toEqual(
        new TransactionFailure("runtime.state_corrupt", [
          { kind: "event", ref: ".brain/runs/run-01/events.jsonl" },
          { kind: "artifact", ref: ".brain/runs/run-01/state.json" },
        ]),
      );
      expect(storage.calls()).toEqual([]);
      expect(storage.snapshot().files).toEqual({});
    },
  );

  it.each([
    {
      label: "proxy-detector failure",
      make: () => ({ ...reducers }),
      inject: (value: object, target: object, native: typeof types.isProxy) => {
        if (value === target) throw new Error("/private/proxy-detector");
        return native(value);
      },
    },
    {
      label: "forged integrity error",
      make: () =>
        new Proxy(reducers, {
          ownKeys() {
            throw new EventIntegrityError("invalid_event");
          },
        }),
      inject: (value: object, target: object, native: typeof types.isProxy) => {
        return value === target ? false : native(value);
      },
    },
    {
      label: "private trap failure",
      make: () =>
        new Proxy(reducers, {
          ownKeys() {
            throw new Error("/private/reducer-registry");
          },
        }),
      inject: (value: object, target: object, native: typeof types.isProxy) => {
        return value === target ? false : native(value);
      },
    },
  ])(
    "sanitizes $label at the reducer boundary before I/O",
    async ({ make, inject }) => {
      const { storage, ports } = fakeRuntime();
      const registry = make();
      const native = types.isProxy.bind(types);
      const detector = vi
        .spyOn(types, "isProxy")
        .mockImplementation((value) => {
          if (typeof value !== "object" || value === null) return false;
          return inject(value, registry, native);
        });
      try {
        await expect(
          applyPlan(eventPlan(1), ports, {
            rootMode: "existing",
            eventReducers: registry,
          }),
        ).rejects.toEqual(
          new TransactionFailure("runtime.internal_failure", []),
        );
      } finally {
        detector.mockRestore();
      }
      expect(storage.calls()).toEqual([]);
      expect(storage.snapshot().files).toEqual({});
    },
  );

  it("prepares event-store writes from the registry snapshot before preflight awaits", async () => {
    interface MutableState {
      step: string | null;
      tag: string;
    }
    const originalReducer = (state: MutableState, event: EventDraftV1) => ({
      ...state,
      step: event.operation,
    });
    const originalMaterialize: EventReducerRegistry<MutableState>["materialize"] =
      (state, cursor) => ({
        ...reducers.materialize(
          { step: `${state.tag}:${state.step ?? "missing"}` },
          cursor,
        ),
      });
    const mutable: {
      seed: MutableState;
      reducers: Record<
        string,
        (state: MutableState, event: EventDraftV1) => MutableState
      >;
      materialize: EventReducerRegistry<MutableState>["materialize"];
    } = {
      seed: { step: null, tag: "seed-original" },
      reducers: { "policy-01": originalReducer },
      materialize: originalMaterialize,
    };
    const { storage, ports } = fakeRuntime();
    let mutated = false;
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      async inspect(path) {
        if (!mutated && path === ".brain") {
          mutated = true;
          await Promise.resolve();
          mutable.seed.tag = "seed-mutated";
          mutable.reducers["policy-02"] = () => ({
            step: "map-mutated",
            tag: "map-mutated",
          });
          mutable.reducers["policy-01"] = () => ({
            step: "reducer-mutated",
            tag: "reducer-mutated",
          });
          mutable.materialize = (state, cursor) => ({
            ...originalMaterialize(state, cursor),
            currentStep: "materializer-mutated",
          });
        }
        return storage.durableFileSystem.inspect(path);
      },
    };

    await applyPlan(
      eventPlan(1),
      { ...ports, durableFileSystem },
      {
        rootMode: "existing",
        eventReducers: mutable,
      },
    );

    const events =
      storage.snapshot().files[".brain/runs/run-01/events.jsonl"] ?? "";
    const snapshot = JSON.parse(
      storage.snapshot().files[".brain/runs/run-01/state.json"] ?? "",
    ) as SnapshotV1;
    expect(mutated).toBe(true);
    expect(events).toContain('"operation":"sdd.step-1"');
    expect(snapshot.currentStep).toBe("seed-original:sdd.step-1");
  });

  it("classifies an invalid draft as paired event-store corruption before I/O", async () => {
    const { storage, ports } = fakeRuntime();
    const event = new Proxy(draft(1), {});

    await expect(
      applyPlan(
        planOf({ kind: "append_event", runId: "run-01", event }),
        ports,
        { rootMode: "existing", eventReducers: reducers },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "event", ref: ".brain/runs/run-01/events.jsonl" },
        { kind: "artifact", ref: ".brain/runs/run-01/state.json" },
      ]),
    );
    expect(storage.calls()).toEqual([]);
  });

  it.each([
    {
      kind: "write_file" as const,
      path: ".brain/runs/run-01/events.jsonl",
      content: "forged",
    },
    { kind: "delete_file" as const, path: ".brain/runs/run-01/state.json" },
  ])(
    "rejects direct $kind targeting the selected event-store paths before I/O",
    async (effect) => {
      const { storage, ports } = fakeRuntime();

      await expect(
        applyPlan(
          planOf(
            { kind: "append_event", runId: "run-01", event: draft(1) },
            effect,
          ),
          ports,
          { rootMode: "existing", eventReducers: reducers },
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      expect(storage.calls()).toEqual([]);
    },
  );

  it.each([".brain/runs/run-01/EVENTS.JSONL", ".brain/runs/RUN-01/state.json"])(
    "rejects a case-colliding direct destination %s before I/O",
    async (path) => {
      const { storage, ports } = fakeRuntime();

      await expect(
        applyPlan(
          planOf(
            { kind: "append_event", runId: "run-01", event: draft(1) },
            { kind: "write_file", path, content: "forged" },
          ),
          ports,
          { rootMode: "existing", eventReducers: reducers },
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      expect(storage.calls()).toEqual([]);
    },
  );

  it("keeps an ordinary write and append in one manifest in plan order", async () => {
    const { storage, ports } = fakeRuntime();
    await applyPlan(
      planOf(
        {
          kind: "write_file",
          path: ".brain/ordinary.json",
          content: "ordinary",
        },
        { kind: "append_event", runId: "run-01", event: draft(1) },
      ),
      ports,
      { rootMode: "existing", eventReducers: reducers },
    );

    expect(manifestPaths(storage)).toEqual([
      ".brain/ordinary.json",
      ".brain/runs",
      ".brain/runs/run-01",
      ".brain/runs/run-01/events.jsonl",
      ".brain/runs/run-01/state.json",
    ]);
  });

  it.each([".brain/runs/run-01/events.jsonl", ".brain/runs/run-01/state.json"])(
    "fails a stale %s observation before transaction creation",
    async (changedPath) => {
      const { storage, ports } = fakeRuntime();
      let preparationReads = 0;
      const durableFileSystem: DurableFileSystem = {
        ...storage.durableFileSystem,
        async inspect(path): Promise<DurableEntry> {
          const entry = await storage.durableFileSystem.inspect(path);
          if (path === changedPath && ++preparationReads === 2) {
            return {
              kind: "file",
              size: 6,
              sha256: storage.digests.sha256("stale!"),
            };
          }
          return entry;
        },
      };

      await expect(
        applyPlan(
          eventPlan(1),
          { ...ports, durableFileSystem },
          { rootMode: "existing", eventReducers: reducers },
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.revision_conflict" });
      expect(storage.calls()).not.toContain("create_directory_exclusive");
    },
  );

  it("sanitizes a rejected fresh event-store inspection before a marker exists", async () => {
    const { storage, ports } = fakeRuntime();
    let reads = 0;
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect(path): Promise<DurableEntry> {
        if (path === ".brain/runs/run-01/events.jsonl" && ++reads === 2) {
          return Promise.reject(new Error("/private/fresh-inspection"));
        }
        return storage.durableFileSystem.inspect(path);
      },
    };

    await expect(
      applyPlan(
        eventPlan(1),
        { ...ports, durableFileSystem },
        { rootMode: "existing", eventReducers: reducers },
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it("blocks a stream mutation at the declarative pre-marker gate", async () => {
    const { storage, ports } = fakeRuntime();
    const events = ".brain/runs/run-01/events.jsonl";
    const snapshot = ".brain/runs/run-01/state.json";
    let reads = 0;
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect(path) {
        if (path === events && ++reads === 3) {
          return Promise.resolve({
            kind: "special" as const,
          });
        }
        return storage.durableFileSystem.inspect(path);
      },
    };
    await expect(
      applyPlan(
        eventPlan(1),
        { ...ports, durableFileSystem },
        { rootMode: "existing", eventReducers: reducers },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.revision_conflict", [
        { kind: "event", ref: events },
      ]),
    );
    expect(storage.calls()).not.toContain("create_directory_exclusive");
    expect(storage.snapshot().files).not.toHaveProperty(events);
    expect(storage.snapshot().files).not.toHaveProperty(snapshot);
  });

  it("emits only after the event transaction commits", async () => {
    const { storage, ports } = fakeRuntime();
    const phases: string[] = [];
    const output = {
      structured(text: string) {
        const progress = JSON.parse(
          storage.snapshot().files[
            ".brain/transactions/transaction-1/progress.json"
          ] ?? "",
        ) as { readonly phase: string };
        phases.push(progress.phase);
        ports.output.structured(text);
      },
      human(text: string) {
        ports.output.human(text);
      },
    };

    await applyPlan(
      planOf(
        { kind: "append_event", runId: "run-01", event: draft(1) },
        { kind: "emit", channel: "structured", text: "committed\n" },
      ),
      { ...ports, output },
      { rootMode: "existing", eventReducers: reducers },
    );

    expect(phases).toEqual(["committed"]);
  });

  it("rejects an unsupported reducer without writing", async () => {
    const { storage, ports } = fakeRuntime();
    const unsupported = { ...reducers, reducers: {} };

    await expect(
      applyPlan(eventPlan(1), ports, {
        rootMode: "existing",
        eventReducers: unsupported,
      }),
    ).rejects.toEqual(expect.any(TransactionFailure));
    expect(storage.snapshot().files).toEqual({});
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });
});
