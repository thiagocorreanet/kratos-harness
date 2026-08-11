import { planOf } from "@mestre-yoda/runtime/domain/effects";
import type { SnapshotV1 } from "@mestre-yoda/contracts";
import { types } from "node:util";
import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import {
  applyPlan,
  configurationValidator,
  createRuntime,
  createSchemaRegistry,
  preflightManagedTransactions,
  TransactionFailure,
} from "@mestre-yoda/runtime/composition";
import {
  fixedClock,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import type {
  EventDraftV1,
  EventReducerRegistry,
} from "@mestre-yoda/runtime/domain/events";
import {
  replayEventStream,
  verifyEventStream,
} from "@mestre-yoda/runtime/domain/events";
import type {
  DurableEntry,
  DurableFileSystem,
  FileSystem,
} from "@mestre-yoda/runtime/ports";
import { describe, expect, it } from "vitest";

function eventDraft(index: number): EventDraftV1 {
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

const eventReducers: EventReducerRegistry<{ readonly step: string | null }> = {
  seed: { step: null },
  reducers: {
    "policy-01": (state, event) => ({ ...state, step: event.operation }),
  },
  materialize: (state, cursor): SnapshotV1 => {
    if (cursor.hash === null) throw new Error("missing event hash");
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

describe("composition root", () => {
  it("exposes production schema composition", () => {
    expect(
      configurationValidator(createSchemaRegistry())(projectConfig),
    ).toEqual({
      kind: "valid",
      value: projectConfig,
    });
  });

  it("uses Node implementations when nothing is overridden", () => {
    const ports = createRuntime();

    expect(ports.environment.workingDirectory()).toBe(process.cwd());
    expect(Number.isNaN(ports.clock.now().getTime())).toBe(false);
  });

  it("replaces exactly the overridden ports and nothing else", () => {
    const clock = fixedClock("2026-08-07T00:00:00.000Z");
    const storage = memoryTransactionStorage();
    const ports = createRuntime({
      clock,
      digests: storage.digests,
      durableFileSystem: storage.durableFileSystem,
    });

    expect(ports.clock).toBe(clock);
    expect(ports.digests).toBe(storage.digests);
    expect(ports.durableFileSystem).toBe(storage.durableFileSystem);
    // An override must not quietly swap its neighbours for fakes.
    expect(ports.environment.workingDirectory()).toBe(process.cwd());
  });

  it("exposes every port named by the contract", () => {
    expect(Object.keys(createRuntime()).sort()).toEqual([
      "clock",
      "digests",
      "durableFileSystem",
      "environment",
      "fileSystem",
      "git",
      "ids",
      "locks",
      "output",
    ]);
  });
});

describe("effect plan application", () => {
  function fakeRuntime(
    seed: Parameters<typeof memoryTransactionStorage>[0] = {
      directories: [".brain", ".brain/transactions"],
    },
  ) {
    const output = recordingOutput();
    const storage = memoryTransactionStorage(seed);
    return {
      output,
      storage,
      ports: createRuntime({
        clock: fixedClock("2026-08-09T00:00:00.000Z"),
        ids: sequentialIds("transaction"),
        fileSystem: storage.fileSystem,
        durableFileSystem: storage.durableFileSystem,
        digests: storage.digests,
        output,
      }),
    };
  }

  it("exposes a preflight that sanitizes unexpected storage failures", async () => {
    const { storage, ports } = fakeRuntime();
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect() {
        return Promise.reject(new Error("/absolute/private-preflight"));
      },
    };

    await expect(
      preflightManagedTransactions(
        { rootMode: "existing" },
        {
          clock: ports.clock,
          ids: ports.ids,
          digests: ports.digests,
          durableFileSystem,
          schemaRegistry: createSchemaRegistry(),
        },
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
  });

  it("commits managed effects in their declared order", async () => {
    const { storage, ports } = fakeRuntime({
      directories: [".brain", ".brain/transactions"],
      files: { ".brain/delete.json": "old" },
    });

    await applyPlan(
      planOf(
        { kind: "create_directory", path: ".brain/nested" },
        {
          kind: "write_file",
          path: ".brain/nested/first.json",
          content: "one",
        },
        {
          kind: "write_file",
          path: ".brain/second.json",
          content: "two",
        },
        { kind: "delete_file", path: ".brain/delete.json" },
      ),
      ports,
    );

    const snapshot = storage.snapshot();
    expect(snapshot.files[".brain/nested/first.json"]).toBe("one");
    expect(snapshot.files[".brain/second.json"]).toBe("two");
    expect(snapshot.files).not.toHaveProperty(".brain/delete.json");
    const manifest = JSON.parse(
      snapshot.files[".brain/transactions/transaction-1/manifest.json"] ?? "",
    ) as { operations: readonly { path: string }[] };
    expect(manifest.operations.map(({ path }) => path)).toEqual([
      ".brain/nested",
      ".brain/nested/first.json",
      ".brain/second.json",
      ".brain/delete.json",
    ]);
  });

  it("does not apply a valid prefix when a later destination is forbidden", async () => {
    const { storage, ports } = fakeRuntime();

    await expect(
      applyPlan(
        planOf(
          {
            kind: "write_file",
            path: ".brain/first.json",
            content: "one",
          },
          {
            kind: "write_file",
            path: ".brain/transactions/forbidden",
            content: "two",
          },
        ),
        ports,
      ),
    ).rejects.toMatchObject({ reasonCode: "guard.outside_allow" });
    expect(storage.snapshot().files).not.toHaveProperty(".brain/first.json");
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it("emits in declared output order only after the transaction commits", async () => {
    const output = recordingOutput();
    const storage = memoryTransactionStorage({
      directories: [".brain", ".brain/transactions"],
    });
    const phasesAtOutput: string[] = [];
    const observeCommitted = (): void => {
      const progress = JSON.parse(
        storage.snapshot().files[
          ".brain/transactions/transaction-1/progress.json"
        ] ?? "",
      ) as { phase: string };
      phasesAtOutput.push(progress.phase);
    };
    const ports = createRuntime({
      clock: fixedClock("2026-08-09T00:00:00.000Z"),
      ids: sequentialIds("transaction"),
      fileSystem: storage.fileSystem,
      durableFileSystem: storage.durableFileSystem,
      digests: storage.digests,
      output: {
        structured(text) {
          observeCommitted();
          output.structured(text);
        },
        human(text) {
          observeCommitted();
          output.human(text);
        },
      },
    });

    await applyPlan(
      planOf(
        {
          kind: "emit",
          channel: "structured",
          text: "first\n",
        },
        {
          kind: "write_file",
          path: ".brain/state.json",
          content: "state",
        },
        { kind: "emit", channel: "human", text: "second\n" },
        { kind: "emit", channel: "structured", text: "third\n" },
      ),
      ports,
    );

    expect(phasesAtOutput).toEqual(["committed", "committed", "committed"]);
    expect(output.structured_).toEqual(["first\n", "third\n"]);
    expect(output.human_).toEqual(["second\n"]);
  });

  it("snapshots plan effects and root mode before the first await", async () => {
    const { storage, output, ports } = fakeRuntime({});
    const write = {
      kind: "write_file" as const,
      path: ".brain/original.json",
      content: "original",
    };
    const emit = {
      kind: "emit" as const,
      channel: "human" as const,
      text: "original output\n",
    };
    const options: { rootMode: "existing" | "initialize" } = {
      rootMode: "initialize",
    };
    let releaseFirstInspection: (() => void) | undefined;
    let signalFirstInspection: (() => void) | undefined;
    const firstInspection = new Promise<void>((resolve) => {
      signalFirstInspection = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseFirstInspection = resolve;
    });
    let hasBlocked = false;
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      async inspect(path): Promise<DurableEntry> {
        if (!hasBlocked && path === ".brain") {
          hasBlocked = true;
          signalFirstInspection?.();
          await blocked;
        }
        return storage.durableFileSystem.inspect(path);
      },
    };

    const applying = applyPlan(
      planOf(write, emit),
      { ...ports, durableFileSystem },
      options,
    );
    await firstInspection;
    options.rootMode = "existing";
    write.path = ".brain/mutated.json";
    write.content = "mutated";
    emit.text = "mutated output\n";
    releaseFirstInspection?.();

    await expect(applying).resolves.toEqual({ kind: "committed" });
    expect(storage.snapshot().files[".brain/original.json"]).toBe("original");
    expect(storage.snapshot().files).not.toHaveProperty(".brain/mutated.json");
    expect(output.human_).toEqual(["original output\n"]);
  });

  it("rejects non-primitive apply input without crossing a runtime boundary", async () => {
    const { storage, ports } = fakeRuntime();

    await expect(
      applyPlan(
        {
          effects: [
            {
              kind: "write_file",
              path: ".brain/state.json",
              content: 42,
            },
          ],
        } as unknown as Parameters<typeof applyPlan>[0],
        ports,
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: ".brain" },
      ]),
    );
    await expect(
      applyPlan(planOf(), ports, {
        rootMode: "unexpected",
      } as unknown as Parameters<typeof applyPlan>[2]),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: ".brain" },
      ]),
    );
    const invalidInputs = [
      () =>
        applyPlan(null as unknown as Parameters<typeof applyPlan>[0], ports),
      () =>
        applyPlan(
          { effects: "not-an-array" } as unknown as Parameters<
            typeof applyPlan
          >[0],
          ports,
        ),
      () =>
        applyPlan(
          planOf(),
          ports,
          null as unknown as Parameters<typeof applyPlan>[2],
        ),
      () =>
        applyPlan(
          { effects: [null] } as unknown as Parameters<typeof applyPlan>[0],
          ports,
        ),
      () =>
        applyPlan(
          { effects: [{ kind: 7 }] } as unknown as Parameters<
            typeof applyPlan
          >[0],
          ports,
        ),
      () =>
        applyPlan(
          {
            effects: [{ kind: "write_file", path: 7, content: "content" }],
          } as unknown as Parameters<typeof applyPlan>[0],
          ports,
        ),
      () =>
        applyPlan(
          {
            effects: [{ kind: "delete_file", path: 7 }],
          } as unknown as Parameters<typeof applyPlan>[0],
          ports,
        ),
      () =>
        applyPlan(
          {
            effects: [{ kind: "append_event", event: 7 }],
          } as unknown as Parameters<typeof applyPlan>[0],
          ports,
        ),
      () =>
        applyPlan(
          {
            effects: [{ kind: "emit", channel: "private", text: "text" }],
          } as unknown as Parameters<typeof applyPlan>[0],
          ports,
        ),
      () =>
        applyPlan(
          {
            effects: [{ kind: "emit", channel: "human", text: 7 }],
          } as unknown as Parameters<typeof applyPlan>[0],
          ports,
        ),
      () =>
        applyPlan(
          { effects: [{ kind: "unknown" }] } as unknown as Parameters<
            typeof applyPlan
          >[0],
          ports,
        ),
    ];
    for (const invalidInput of invalidInputs) {
      await expect(invalidInput()).rejects.toMatchObject({
        reasonCode: "runtime.state_corrupt",
        evidence: [{ kind: "artifact", ref: ".brain" }],
      });
    }
    expect(storage.calls()).toEqual([]);
  });

  it("sanitizes a throwing apply-input accessor", async () => {
    const { storage, ports } = fakeRuntime();
    const plan = Object.defineProperty({}, "effects", {
      get() {
        throw new Error("/absolute/private-input");
      },
    });

    await expect(
      applyPlan(plan as Parameters<typeof applyPlan>[0], ports),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
    expect(storage.calls()).toEqual([]);
  });

  it("emits nothing when publication does not commit", async () => {
    const { storage, output, ports } = fakeRuntime();
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      replaceFile(stagedPath, targetPath) {
        if (targetPath === ".brain/state.json") {
          return Promise.reject(new Error("publication stopped"));
        }
        return storage.durableFileSystem.replaceFile(stagedPath, targetPath);
      },
    };

    await expect(
      applyPlan(
        planOf(
          { kind: "emit", channel: "human", text: "not yet\n" },
          {
            kind: "write_file",
            path: ".brain/state.json",
            content: "state",
          },
        ),
        { ...ports, durableFileSystem },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    expect(output.human_).toEqual([]);
    expect(output.structured_).toEqual([]);
  });

  it("commits an event stream and snapshot through one managed transaction", async () => {
    const { storage, ports } = fakeRuntime({
      directories: [
        ".brain",
        ".brain/transactions",
        ".brain/runs",
        ".brain/runs/run-01",
      ],
    });

    await expect(
      applyPlan(
        planOf({ kind: "append_event", runId: "run-01", event: eventDraft(1) }),
        ports,
        { rootMode: "existing", eventReducers },
      ),
    ).resolves.toEqual({ kind: "committed" });
    const snapshot = storage.snapshot();
    const manifest = JSON.parse(
      snapshot.files[".brain/transactions/transaction-1/manifest.json"] ?? "",
    ) as { readonly operations: readonly { readonly path: string }[] };
    expect(manifest.operations.map(({ path }) => path)).toEqual([
      ".brain/runs/run-01/events.jsonl",
      ".brain/runs/run-01/state.json",
    ]);
    const events = snapshot.files[".brain/runs/run-01/events.jsonl"] ?? "";
    const state = JSON.parse(
      snapshot.files[".brain/runs/run-01/state.json"] ?? "",
    ) as SnapshotV1;
    const sealed = JSON.parse(events) as { readonly eventHash: string };
    const schemaRegistry = createSchemaRegistry();
    const verified = verifyEventStream(events, {
      digests: ports.digests,
      isProxy: types.isProxy,
      schemaRegistry,
    });
    const replayed = replayEventStream(verified, eventReducers, {
      isProxy: types.isProxy,
      schemaRegistry,
    });
    expect(state.eventCursor).toBe(1);
    expect(state.eventHash).toBe(sealed.eventHash);
    expect(replayed.snapshot).toEqual(state);
    expect(events).toMatch(/\n$/u);
    expect(snapshot.files[".brain/runs/run-01/state.json"]).toMatch(/\n$/u);
  });

  it.each(["special", "symlink"] as const)(
    "rejects a %s managed-path observation before creating a transaction",
    async (kind) => {
      const { storage, ports } = fakeRuntime();
      const durableFileSystem: DurableFileSystem = {
        ...storage.durableFileSystem,
        inspect(path): Promise<DurableEntry> {
          if (path === ".brain/state.json") return Promise.resolve({ kind });
          return storage.durableFileSystem.inspect(path);
        },
      };

      await expect(
        applyPlan(
          planOf({
            kind: "write_file",
            path: ".brain/state.json",
            content: "state",
          }),
          { ...ports, durableFileSystem },
        ),
      ).rejects.toEqual(
        new TransactionFailure("runtime.state_corrupt", [
          { kind: "artifact", ref: ".brain/state.json" },
        ]),
      );
      expect(storage.calls()).not.toContain("create_directory_exclusive");
    },
  );

  it("rejects a managed root changed after transaction preflight", async () => {
    const { storage, ports } = fakeRuntime();
    let brainInspections = 0;
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect(path): Promise<DurableEntry> {
        if (path === ".brain" && ++brainInspections === 4) {
          return Promise.resolve({
            kind: "file",
            size: 0,
            sha256: storage.digests.sha256(""),
          });
        }
        return storage.durableFileSystem.inspect(path);
      },
    };

    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "state",
        }),
        { ...ports, durableFileSystem },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: ".brain" },
      ]),
    );
    expect(brainInspections).toBe(4);
  });

  it.each(["file", "special", "symlink"] as const)(
    "observes and rejects a %s managed root before descendant paths",
    async (kind) => {
      const { storage, ports } = fakeRuntime();
      const inspected: string[] = [];
      const durableFileSystem: DurableFileSystem = {
        ...storage.durableFileSystem,
        inspect(path): Promise<DurableEntry> {
          inspected.push(path);
          if (path === ".brain") {
            return Promise.resolve(
              kind === "file"
                ? { kind, size: 0, sha256: storage.digests.sha256("") }
                : { kind },
            );
          }
          return Promise.reject(new Error("descendant must not be observed"));
        },
      };

      await expect(
        applyPlan(
          planOf({
            kind: "write_file",
            path: ".brain/state.json",
            content: "state",
          }),
          { ...ports, durableFileSystem },
        ),
      ).rejects.toEqual(
        new TransactionFailure("runtime.state_corrupt", [
          { kind: "artifact", ref: ".brain" },
        ]),
      );
      expect(inspected).toEqual([".brain", ".brain"]);
    },
  );

  it("sanitizes an unexpected durable observation failure", async () => {
    const { storage, ports } = fakeRuntime();
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect(path) {
        if (path === ".brain/state.json") {
          return Promise.reject(new Error("/absolute/private-payload"));
        }
        return storage.durableFileSystem.inspect(path);
      },
    };

    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "state",
        }),
        { ...ports, durableFileSystem },
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
  });

  it("sanitizes an unexpected no-op marker inspection failure", async () => {
    const { storage, ports } = fakeRuntime({
      directories: [".brain", ".brain/transactions"],
      files: { ".brain/state.json": "same" },
    });
    let brainInspections = 0;
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect(path) {
        if (path === ".brain" && ++brainInspections === 2) {
          return Promise.reject(new Error("/absolute/private-marker"));
        }
        return storage.durableFileSystem.inspect(path);
      },
    };

    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "same",
        }),
        { ...ports, durableFileSystem },
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
  });

  it("sanitizes an unexpected no-op transaction-list failure", async () => {
    const { storage, ports } = fakeRuntime({
      directories: [".brain", ".brain/transactions"],
      files: { ".brain/state.json": "same" },
    });
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      list(path) {
        if (path === ".brain/transactions") {
          return Promise.reject(new Error("/absolute/private-marker"));
        }
        return storage.durableFileSystem.list(path);
      },
    };

    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "same",
        }),
        { ...ports, durableFileSystem },
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
  });

  it("sanitizes an unexpected digest failure during normalization", async () => {
    const { ports } = fakeRuntime();

    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "private-payload",
        }),
        {
          ...ports,
          digests: {
            sha256() {
              throw new Error("/absolute/private-payload");
            },
          },
        },
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
  });

  it("rejects malformed managed relationships before mutation", async () => {
    const { storage, ports } = fakeRuntime();

    await expect(
      applyPlan(
        planOf(
          { kind: "delete_file", path: ".brain/parent" },
          {
            kind: "write_file",
            path: ".brain/parent/child.json",
            content: "child",
          },
        ),
        ports,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it.each([
    "",
    ".brain\\state.json",
    "C:/state.json",
    ".brain/state.json\n",
    ".brain",
    "outside/state.json",
    ".brain//state.json",
    ".brain/./state.json",
    ".brain/../state.json",
  ])(
    "rejects malformed destination spelling %j before mutation",
    async (path) => {
      const { storage, ports } = fakeRuntime();

      await expect(
        applyPlan(
          planOf({ kind: "write_file", path, content: "state" }),
          ports,
        ),
      ).rejects.toMatchObject({ reasonCode: "guard.outside_allow" });
      expect(storage.calls()).not.toContain("create_directory_exclusive");
    },
  );

  it("does not create a marker for a satisfied no-op plan", async () => {
    const { storage, ports } = fakeRuntime({
      directories: [".brain", ".brain/transactions"],
      files: { ".brain/state.json": "same" },
    });

    await applyPlan(
      planOf({
        kind: "write_file",
        path: ".brain/state.json",
        content: "same",
      }),
      ports,
    );

    expect(storage.snapshot().directories).toEqual([
      ".brain",
      ".brain/transactions",
    ]);
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it("reports whether managed state committed", async () => {
    const { ports } = fakeRuntime();
    const plan = planOf({
      kind: "write_file",
      path: ".brain/state.json",
      content: "state",
    });

    await expect(applyPlan(plan, ports)).resolves.toEqual({
      kind: "committed",
    });
    await expect(applyPlan(plan, ports)).resolves.toEqual({ kind: "noop" });
  });

  it("reports emit-only application as a no-op", async () => {
    const { ports } = fakeRuntime();

    await expect(
      applyPlan(
        planOf({ kind: "emit", channel: "human", text: "message\n" }),
        ports,
      ),
    ).resolves.toEqual({ kind: "noop" });
  });

  it("observes an already-satisfied managed directory as a no-op", async () => {
    const { storage, ports } = fakeRuntime({
      directories: [".brain", ".brain/transactions", ".brain/existing"],
    });

    await applyPlan(
      planOf({ kind: "create_directory", path: ".brain/existing" }),
      ports,
    );

    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it("refuses a no-op mutation while an incomplete marker exists", async () => {
    const { storage, output, ports } = fakeRuntime();
    const interrupted: DurableFileSystem = {
      ...storage.durableFileSystem,
      replaceFile(stagedPath, targetPath) {
        if (targetPath === ".brain/state.json") {
          return Promise.reject(new Error("publication stopped"));
        }
        return storage.durableFileSystem.replaceFile(stagedPath, targetPath);
      },
    };
    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "state",
        }),
        { ...ports, durableFileSystem: interrupted },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });

    await expect(
      applyPlan(
        planOf(
          { kind: "delete_file", path: ".brain/state.json" },
          { kind: "emit", channel: "human", text: "not available\n" },
        ),
        ports,
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.recovery_required", [
        {
          kind: "artifact",
          ref: ".brain/transactions/transaction-1/progress.json",
        },
      ]),
    );
    expect(output.human_).toEqual([]);
  });

  it("rejects a publishing marker before inspecting a managed target", async () => {
    const { storage, ports } = fakeRuntime();
    const interrupted: DurableFileSystem = {
      ...storage.durableFileSystem,
      replaceFile(stagedPath, targetPath) {
        if (targetPath === ".brain/state.json") {
          return Promise.reject(new Error("publication stopped"));
        }
        return storage.durableFileSystem.replaceFile(stagedPath, targetPath);
      },
    };
    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "state",
        }),
        { ...ports, durableFileSystem: interrupted },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });

    const inspected: string[] = [];
    const specialTarget: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect(path): Promise<DurableEntry> {
        inspected.push(path);
        if (path === ".brain/state.json") {
          return Promise.resolve({ kind: "special" });
        }
        return storage.durableFileSystem.inspect(path);
      },
    };

    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "state",
        }),
        { ...ports, durableFileSystem: specialTarget },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.recovery_required", [
        {
          kind: "artifact",
          ref: ".brain/transactions/transaction-1/progress.json",
        },
      ]),
    );
    expect(inspected).not.toContain(".brain/state.json");
  });

  it.each([
    { label: "empty", files: {} },
    {
      label: "progress scratch",
      files: {
        ".brain/transactions/orphan/progress.next": "partial",
      },
    },
  ])(
    "reconciles a safe $label unmarked transaction for a no-op",
    async ({ files }) => {
      const { storage, ports } = fakeRuntime({
        directories: [
          ".brain",
          ".brain/transactions",
          ".brain/transactions/orphan",
        ],
        files: {
          ".brain/state.json": "same",
          ...files,
        },
      });

      await expect(
        applyPlan(
          planOf({
            kind: "write_file",
            path: ".brain/state.json",
            content: "same",
          }),
          ports,
        ),
      ).resolves.toEqual({ kind: "noop" });

      expect(storage.snapshot().directories).not.toContain(
        ".brain/transactions/orphan",
      );
      expect(storage.calls()).not.toContain("create_directory_exclusive");
    },
  );

  it("preserves unknown unmarked content when a no-op fails closed", async () => {
    const unknown = ".brain/transactions/orphan/unknown";
    const { storage, ports } = fakeRuntime({
      directories: [
        ".brain",
        ".brain/transactions",
        ".brain/transactions/orphan",
      ],
      files: {
        ".brain/state.json": "same",
        [unknown]: "preserve",
      },
    });

    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "same",
        }),
        ports,
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: ".brain/transactions/orphan" },
      ]),
    );
    expect(storage.snapshot().files[unknown]).toBe("preserve");
    expect(storage.calls()).not.toContain("remove_file");
    expect(storage.calls()).not.toContain("remove_empty_directory");
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it("lets the transaction driver reconcile a safe unmarked crash directory", async () => {
    const { storage, ports } = fakeRuntime({
      directories: [
        ".brain",
        ".brain/transactions",
        ".brain/transactions/orphan",
      ],
    });

    await applyPlan(
      planOf({
        kind: "write_file",
        path: ".brain/state.json",
        content: "state",
      }),
      ports,
    );

    expect(storage.snapshot().directories).not.toContain(
      ".brain/transactions/orphan",
    );
    expect(storage.snapshot().files[".brain/state.json"]).toBe("state");
  });

  it("defaults to an existing root and bootstraps only when explicit", async () => {
    const refused = fakeRuntime({});
    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "state",
        }),
        refused.ports,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(refused.storage.snapshot().directories).toEqual([]);

    const initialized = fakeRuntime({});
    await applyPlan(
      planOf({
        kind: "write_file",
        path: ".brain/state.json",
        content: "state",
      }),
      initialized.ports,
      { rootMode: "initialize" },
    );
    expect(initialized.storage.snapshot().files[".brain/state.json"]).toBe(
      "state",
    );
  });

  it.each([
    { directories: [] as readonly string[], evidenceRef: ".brain" },
    {
      directories: [".brain"] as readonly string[],
      evidenceRef: ".brain/transactions",
    },
  ])(
    "applies existing-root policy to a no-op when $evidenceRef is missing",
    async ({ directories, evidenceRef }) => {
      const { storage, ports } = fakeRuntime({ directories });

      await expect(
        applyPlan(
          planOf({ kind: "delete_file", path: ".brain/missing.json" }),
          ports,
        ),
      ).rejects.toEqual(
        new TransactionFailure("runtime.state_corrupt", [
          { kind: "artifact", ref: evidenceRef },
        ]),
      );
      expect(storage.snapshot().directories).toEqual(directories);
    },
  );

  it.each([
    { label: "a missing root", directories: [] as readonly string[] },
    { label: "an empty root", directories: [".brain"] as readonly string[] },
  ])(
    "keeps an explicit initialize no-op free of bootstrap metadata from $label",
    async ({ directories }) => {
      const { storage, ports } = fakeRuntime({ directories });

      await expect(
        applyPlan(
          planOf({ kind: "delete_file", path: ".brain/missing.json" }),
          ports,
          { rootMode: "initialize" },
        ),
      ).resolves.toEqual({ kind: "noop" });

      expect(storage.snapshot()).toEqual({ files: {}, directories });
      expect(storage.calls()).not.toContain("create_directory");
      expect(storage.calls()).not.toContain("create_directory_exclusive");
    },
  );

  it("bootstraps a ready initialize plan beneath an empty root", async () => {
    const { storage, ports } = fakeRuntime({ directories: [".brain"] });

    await expect(
      applyPlan(
        planOf({
          kind: "write_file",
          path: ".brain/state.json",
          content: "state",
        }),
        ports,
        { rootMode: "initialize" },
      ),
    ).resolves.toEqual({ kind: "committed" });

    expect(storage.snapshot().directories).toContain(".brain/transactions");
    expect(storage.snapshot().files[".brain/state.json"]).toBe("state");
  });

  it.each([
    {
      label: "delete is already satisfied",
      plan: planOf({ kind: "delete_file", path: ".brain/missing.json" }),
    },
    {
      label: "write is already satisfied",
      plan: planOf({
        kind: "write_file",
        path: ".brain/existing.json",
        content: "existing",
      }),
    },
  ])(
    "rejects initialize when transactions are absent from a non-empty root and $label",
    async ({ plan }) => {
      const { storage, ports } = fakeRuntime({
        directories: [".brain"],
        files: { ".brain/existing.json": "existing" },
      });
      const before = storage.snapshot();

      await expect(
        applyPlan(plan, ports, { rootMode: "initialize" }),
      ).rejects.toEqual(
        new TransactionFailure("runtime.state_corrupt", [
          { kind: "artifact", ref: ".brain" },
        ]),
      );
      expect(storage.snapshot()).toEqual(before);
      expect(storage.calls()).not.toContain("create_directory");
      expect(storage.calls()).not.toContain("create_directory_exclusive");
    },
  );

  it("never uses the ordinary filesystem for managed mutations", async () => {
    const { storage, ports } = fakeRuntime();
    const used: (keyof FileSystem)[] = [];
    const fileSystem: FileSystem = {
      read(path) {
        used.push("read");
        return storage.fileSystem.read(path);
      },
      write(path, content) {
        used.push("write");
        return storage.fileSystem.write(path, content);
      },
      remove(path) {
        used.push("remove");
        return storage.fileSystem.remove(path);
      },
      makeDirectory(path) {
        used.push("makeDirectory");
        return storage.fileSystem.makeDirectory(path);
      },
      list(path) {
        used.push("list");
        return storage.fileSystem.list(path);
      },
      stat(path) {
        used.push("stat");
        return storage.fileSystem.stat(path);
      },
    };

    await applyPlan(
      planOf({
        kind: "write_file",
        path: ".brain/state.json",
        content: "state",
      }),
      { ...ports, fileSystem },
    );

    expect(used).toEqual([]);
    expect(storage.snapshot().files[".brain/state.json"]).toBe("state");
  });

  it("produces byte-identical output across two fixed emit-only runs", async () => {
    const run = async (): Promise<string> => {
      const { output, ports } = fakeRuntime();
      await applyPlan(
        planOf(
          {
            kind: "emit",
            channel: "structured",
            text: ports.clock.now().toISOString(),
          },
          { kind: "emit", channel: "structured", text: ports.ids.next() },
        ),
        ports,
      );
      return output.structured_.join("|");
    };

    expect(await run()).toBe(await run());
  });
});
