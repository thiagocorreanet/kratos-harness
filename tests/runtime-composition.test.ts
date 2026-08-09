import { planOf } from "@mestre-yoda/runtime/domain/effects";
import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import {
  applyPlan,
  configurationValidator,
  createRuntime,
  createSchemaRegistry,
  TransactionFailure,
} from "@mestre-yoda/runtime/composition";
import {
  fixedClock,
  memoryTransactionStorage,
  recordingOutput,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import type {
  DurableEntry,
  DurableFileSystem,
  FileSystem,
} from "@mestre-yoda/runtime/ports";
import { describe, expect, it } from "vitest";

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

  it("refuses append_event until the canonical append operation exists", async () => {
    const { storage, ports } = fakeRuntime();

    await expect(
      applyPlan(
        planOf(
          {
            kind: "write_file",
            path: ".brain/state.json",
            content: "state",
          },
          { kind: "append_event", event: "payload-must-not-appear" },
        ),
        ports,
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: ".brain/events.jsonl" },
      ]),
    );
    expect(storage.snapshot().files).not.toHaveProperty(".brain/state.json");
    expect(storage.snapshot().files).not.toHaveProperty(".brain/events.jsonl");
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
      expect(inspected).toEqual([".brain"]);
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

  it("keeps an explicit initialize no-op free of bootstrap metadata", async () => {
    const { storage, ports } = fakeRuntime({});

    await applyPlan(
      planOf({ kind: "delete_file", path: ".brain/missing.json" }),
      ports,
      { rootMode: "initialize" },
    );

    expect(storage.snapshot()).toEqual({ files: {}, directories: [] });
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

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
