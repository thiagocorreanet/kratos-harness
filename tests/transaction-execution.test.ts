import {
  executeManagedMutation,
  inspectManagedTransactions,
  recoverManagedMutation,
  TransactionFailure,
  type TransactionServices,
} from "@mestre-yoda/runtime/composition";
import type { ManagedMutationPlan } from "@mestre-yoda/runtime/domain/transactions";
import { canonicalizeJson } from "@mestre-yoda/runtime/domain/schema";
import type {
  DurableEntry,
  DurableFileSystem,
} from "@mestre-yoda/runtime/ports";
import {
  fixedClock,
  memoryTransactionStorage,
  sequentialIds,
} from "@mestre-yoda/runtime/infra/fake";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { describe, expect, it } from "vitest";

function services(
  storage: ReturnType<typeof memoryTransactionStorage>,
): TransactionServices {
  return {
    clock: fixedClock("2026-08-09T00:00:00.000Z"),
    ids: sequentialIds("transaction"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  };
}

function replacementPlan(
  storage: ReturnType<typeof memoryTransactionStorage>,
): ManagedMutationPlan {
  return {
    operations: [
      {
        operationId: "operation-0001",
        kind: "write_file",
        path: ".brain/state.json",
        expected: {
          kind: "file",
          size: 3,
          sha256: storage.digests.sha256("old"),
        },
        result: {
          kind: "file",
          size: 3,
          sha256: storage.digests.sha256("new"),
        },
        stagedPath: "staging/operation-0001.payload",
        content: "new",
      },
    ],
  };
}

describe("managed transaction execution", () => {
  it.each([
    ["invalid root mode", { rootMode: "unexpected" }],
    ["options extra", { rootMode: "existing", extra: true }],
    ["empty tuple", { rootMode: "existing", eventStorePreconditions: [] }],
    [
      "one-entry tuple",
      { rootMode: "existing", eventStorePreconditions: [{}] },
    ],
    [
      "outside pair",
      {
        rootMode: "existing",
        eventStorePreconditions: [
          {
            path: ".brain/runs/run-01/events.jsonl",
            expected: { kind: "missing" },
          },
          { path: ".brain/outside.json", expected: { kind: "missing" } },
        ],
      },
    ],
    [
      "missing root mode",
      {
        eventStorePreconditions: [
          {
            path: ".brain/runs/run-01/events.jsonl",
            expected: { kind: "missing" },
          },
          {
            path: ".brain/runs/run-01/state.json",
            expected: { kind: "missing" },
          },
        ],
      },
    ],
  ])(
    "sanitizes invalid eventStorePreconditions: %s",
    async (_label, options) => {
      const storage = memoryTransactionStorage({
        directories: [".brain", ".brain/transactions"],
      });
      await expect(
        executeManagedMutation(
          replacementPlan(storage),
          options as never,
          services(storage),
        ),
      ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
      expect(storage.calls()).not.toContain("create_directory_exclusive");
    },
  );

  it("rejects an accessor eventStorePreconditions boundary without creating a marker", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain", ".brain/transactions"],
    });
    const options = Object.defineProperty(
      { rootMode: "existing" },
      "eventStorePreconditions",
      {
        get() {
          throw new TransactionFailure("runtime.state_corrupt", [
            { kind: "artifact", ref: ".brain/private" },
          ]);
        },
      },
    );
    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        options as never,
        services(storage),
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it.each([
    ["options proxy", () => new Proxy({ rootMode: "existing" }, {})],
    [
      "tuple proxy",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: new Proxy([], {}),
      }),
    ],
    [
      "tuple index accessor",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: Object.defineProperty([{}, {}], "0", {
          get() {
            throw new Error("private");
          },
        }),
      }),
    ],
    [
      "tuple symbol",
      () => {
        const value = [{}, {}];
        Object.defineProperty(value, Symbol("extra"), { value: true });
        return { rootMode: "existing", eventStorePreconditions: value };
      },
    ],
    [
      "tuple hole",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: Object.assign(new Array(2), { 1: {} }),
      }),
    ],
    [
      "three entries",
      () => ({ rootMode: "existing", eventStorePreconditions: [{}, {}, {}] }),
    ],
    [
      "entry proxy",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: [new Proxy({}, {}), {}],
      }),
    ],
    [
      "entry extra",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: [
          {
            path: ".brain/runs/run-01/events.jsonl",
            expected: { kind: "missing" },
            extra: true,
          },
          {},
        ],
      }),
    ],
    [
      "non-string entry path",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: [
          { path: 7, expected: { kind: "missing" } },
          {
            path: ".brain/runs/run-01/state.json",
            expected: { kind: "missing" },
          },
        ],
      }),
    ],
    [
      "expected proxy",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: [
          {
            path: ".brain/runs/run-01/events.jsonl",
            expected: new Proxy({ kind: "missing" }, {}),
          },
          {},
        ],
      }),
    ],
    [
      "expected symbol",
      () => {
        const expected = { kind: "missing" };
        Object.defineProperty(expected, Symbol("x"), { value: true });
        return {
          rootMode: "existing",
          eventStorePreconditions: [
            { path: ".brain/runs/run-01/events.jsonl", expected },
            {},
          ],
        };
      },
    ],
    [
      "unsupported expected fingerprint",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: [
          {
            path: ".brain/runs/run-01/events.jsonl",
            expected: { kind: "directory" },
          },
          {
            path: ".brain/runs/run-01/state.json",
            expected: { kind: "missing" },
          },
        ],
      }),
    ],
    [
      "reordered pair",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: [
          {
            path: ".brain/runs/run-01/state.json",
            expected: { kind: "missing" },
          },
          {
            path: ".brain/runs/run-01/events.jsonl",
            expected: { kind: "missing" },
          },
        ],
      }),
    ],
    [
      "different runs",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: [
          {
            path: ".brain/runs/run-01/events.jsonl",
            expected: { kind: "missing" },
          },
          {
            path: ".brain/runs/run-02/state.json",
            expected: { kind: "missing" },
          },
        ],
      }),
    ],
    [
      "case alias",
      () => ({
        rootMode: "existing",
        eventStorePreconditions: [
          {
            path: ".brain/runs/run-01/EVENTS.JSONL",
            expected: { kind: "missing" },
          },
          {
            path: ".brain/runs/run-01/state.json",
            expected: { kind: "missing" },
          },
        ],
      }),
    ],
  ])("sanitizes hostile eventStorePreconditions: %s", async (_label, build) => {
    const storage = memoryTransactionStorage({
      directories: [".brain", ".brain/transactions"],
    });
    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        build() as never,
        services(storage),
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it.each(["file", "directory", "symlink", "special"] as const)(
    "treats a successful %s event precondition inspection as pre-marker drift",
    async (kind) => {
      const storage = memoryTransactionStorage({
        directories: [".brain", ".brain/transactions"],
      });
      const eventPath = ".brain/runs/run-01/events.jsonl";
      const snapshotPath = ".brain/runs/run-01/state.json";
      const durableFileSystem: DurableFileSystem = {
        ...storage.durableFileSystem,
        inspect(path) {
          if (path === eventPath)
            return Promise.resolve(
              kind === "file"
                ? { kind, size: 1, sha256: "a".repeat(64) }
                : { kind },
            );
          return storage.durableFileSystem.inspect(path);
        },
      };
      const options = {
        rootMode: "existing" as const,
        eventStorePreconditions: [
          { path: eventPath, expected: { kind: "missing" as const } },
          { path: snapshotPath, expected: { kind: "missing" as const } },
        ],
      };
      await expect(
        executeManagedMutation(replacementPlan(storage), options, {
          ...services(storage),
          durableFileSystem,
        }),
      ).rejects.toEqual(
        new TransactionFailure("runtime.revision_conflict", [
          { kind: "event", ref: eventPath },
        ]),
      );
      expect(storage.calls()).not.toContain("create_directory_exclusive");
    },
  );

  it("aggregates both event-store precondition drifts before a marker", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain", ".brain/transactions"],
    });
    const eventPath = ".brain/runs/run-01/events.jsonl";
    const snapshotPath = ".brain/runs/run-01/state.json";
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect(path) {
        if (path === eventPath) return Promise.resolve({ kind: "special" });
        if (path === snapshotPath) return Promise.resolve({ kind: "symlink" });
        return storage.durableFileSystem.inspect(path);
      },
    };
    const options = {
      rootMode: "existing" as const,
      eventStorePreconditions: [
        { path: eventPath, expected: { kind: "missing" as const } },
        { path: snapshotPath, expected: { kind: "missing" as const } },
      ],
    };
    await expect(
      executeManagedMutation(replacementPlan(storage), options, {
        ...services(storage),
        durableFileSystem,
      }),
    ).rejects.toEqual(
      new TransactionFailure("runtime.revision_conflict", [
        { kind: "event", ref: eventPath },
        { kind: "artifact", ref: snapshotPath },
      ]),
    );
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it("labels a regular snapshot precondition drift as an artifact", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain", ".brain/transactions"],
    });
    const eventPath = ".brain/runs/run-01/events.jsonl";
    const snapshotPath = ".brain/runs/run-01/state.json";
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect(path) {
        if (path === snapshotPath) {
          return Promise.resolve({
            kind: "file" as const,
            size: 5,
            sha256: storage.digests.sha256("stale"),
          });
        }
        return storage.durableFileSystem.inspect(path);
      },
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        {
          rootMode: "existing",
          eventStorePreconditions: [
            { path: eventPath, expected: { kind: "missing" } },
            { path: snapshotPath, expected: { kind: "missing" } },
          ],
        },
        { ...services(storage), durableFileSystem },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.revision_conflict", [
        { kind: "artifact", ref: snapshotPath },
      ]),
    );
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it("accepts matching file event-store preconditions before execution", async () => {
    const eventPath = ".brain/runs/run-01/events.jsonl";
    const snapshotPath = ".brain/runs/run-01/state.json";
    const storage = memoryTransactionStorage({
      directories: [
        ".brain",
        ".brain/transactions",
        ".brain/runs",
        ".brain/runs/run-01",
      ],
      files: {
        ".brain/state.json": "old",
        [eventPath]: "event",
        [snapshotPath]: "snapshot",
      },
    });
    const options = {
      rootMode: "existing" as const,
      eventStorePreconditions: [
        {
          path: eventPath,
          expected: {
            kind: "file" as const,
            size: 5,
            sha256: storage.digests.sha256("event"),
          },
        },
        {
          path: snapshotPath,
          expected: {
            kind: "file" as const,
            size: 8,
            sha256: storage.digests.sha256("snapshot"),
          },
        },
      ],
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        options,
        services(storage),
      ),
    ).resolves.toMatchObject({ phase: "committed" });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
  });

  it("initializes an empty existing root whose transaction namespace is absent", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain"],
    });
    const plan = replacementPlan(storage);
    const operation = plan.operations[0];
    if (operation?.kind !== "write_file") throw new Error("missing write plan");
    const initializePlan: ManagedMutationPlan = {
      operations: [{ ...operation, expected: { kind: "missing" } }],
    };

    await expect(
      executeManagedMutation(
        initializePlan,
        { rootMode: "initialize" },
        services(storage),
      ),
    ).resolves.toMatchObject({ phase: "committed" });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
    expect(storage.snapshot().directories).toContain(".brain/transactions");
  });

  it("sanitizes a rejected event-store precondition observation", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain", ".brain/transactions"],
    });
    const eventPath = ".brain/runs/run-01/events.jsonl";
    const snapshotPath = ".brain/runs/run-01/state.json";
    const durableFileSystem: DurableFileSystem = {
      ...storage.durableFileSystem,
      inspect(path) {
        if (path === eventPath)
          return Promise.reject(new Error("private read"));
        return storage.durableFileSystem.inspect(path);
      },
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        {
          rootMode: "existing",
          eventStorePreconditions: [
            { path: eventPath, expected: { kind: "missing" } },
            { path: snapshotPath, expected: { kind: "missing" } },
          ],
        },
        { ...services(storage), durableFileSystem },
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
    expect(storage.calls()).not.toContain("create_directory_exclusive");
  });

  it.each([
    {
      label: "non-object plan",
      reasonCode: "runtime.state_corrupt",
      plan: () => null,
    },
    {
      label: "non-array operations",
      reasonCode: "runtime.state_corrupt",
      plan: () => ({ operations: "forged" }),
    },
    {
      label: "empty plan",
      reasonCode: "runtime.state_corrupt",
      plan: () => ({ operations: [] }),
    },
    {
      label: "non-object operation",
      reasonCode: "runtime.state_corrupt",
      plan: () => ({ operations: [null] }),
    },
    {
      label: "unknown operation kind",
      reasonCode: "runtime.state_corrupt",
      plan: () => ({
        operations: [
          {
            operationId: "operation-0001",
            kind: "rename_file",
            path: ".brain/state.json",
            expected: { kind: "missing" },
            result: { kind: "file", size: 3, sha256: "f".repeat(64) },
            stagedPath: null,
          },
        ],
      }),
    },
    {
      label: "invalid create fingerprints",
      reasonCode: "runtime.state_corrupt",
      plan: () => ({
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/runs",
            expected: { kind: "file", size: 1, sha256: "f".repeat(64) },
            result: { kind: "directory" },
            stagedPath: null,
          },
        ],
      }),
    },
    {
      label: "invalid delete fingerprints",
      reasonCode: "runtime.state_corrupt",
      plan: () => ({
        operations: [
          {
            operationId: "operation-0001",
            kind: "delete_file",
            path: ".brain/state.json",
            expected: { kind: "missing" },
            result: { kind: "directory" },
            stagedPath: null,
          },
        ],
      }),
    },
    {
      label: "non-object fingerprint",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            expected: null,
          },
        ],
      }),
    },
    {
      label: "extended missing fingerprint",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            expected: { kind: "missing", forged: true },
          },
        ],
      }),
    },
    {
      label: "extended directory fingerprint",
      reasonCode: "runtime.state_corrupt",
      plan: () => ({
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/runs",
            expected: { kind: "missing" },
            result: { kind: "directory", forged: true },
            stagedPath: null,
          },
        ],
      }),
    },
    {
      label: "invalid file fingerprint",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            expected: { kind: "file", size: -1, sha256: "not-a-digest" },
          },
        ],
      }),
    },
    {
      label: "unknown fingerprint kind",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            expected: { kind: "special" },
          },
        ],
      }),
    },
    {
      label: "outside destination",
      reasonCode: "guard.outside_allow",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            path: "src/owned.txt",
          },
        ],
      }),
    },
    {
      label: "reserved destination",
      reasonCode: "guard.outside_allow",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            path: ".brain/transactions/owned.txt",
          },
        ],
      }),
    },
    {
      label: "unsafe destination",
      reasonCode: "guard.outside_allow",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            path: ".brain/../owned.txt",
          },
        ],
      }),
    },
    {
      label: "control-character destination",
      reasonCode: "guard.outside_allow",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            path: ".brain/control\npath",
          },
        ],
      }),
    },
    {
      label: "forged operation ID",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            operationId: "operation-0002",
            stagedPath: "staging/operation-0002.payload",
          },
        ],
      }),
    },
    {
      label: "forged staged payload",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            stagedPath: "staging/forged.payload",
          },
        ],
      }),
    },
    {
      label: "equal expected and result fingerprints",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => {
        const operation = replacementPlan(storage).operations[0];
        return {
          operations: [
            {
              ...operation,
              expected: operation?.result,
            },
          ],
        };
      },
    },
    {
      label: "content fingerprint mismatch",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            result: {
              kind: "file",
              size: 999,
              sha256: storage.digests.sha256("forged"),
            },
          },
        ],
      }),
    },
    {
      label: "case-colliding destinations",
      reasonCode: "runtime.state_corrupt",
      plan: () => ({
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/Runs",
            expected: { kind: "missing" },
            result: { kind: "directory" },
            stagedPath: null,
          },
          {
            operationId: "operation-0002",
            kind: "create_directory",
            path: ".brain/runs",
            expected: { kind: "missing" },
            result: { kind: "directory" },
            stagedPath: null,
          },
        ],
      }),
    },
    {
      label: "duplicate destinations",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          replacementPlan(storage).operations[0],
          {
            ...replacementPlan(storage).operations[0],
            operationId: "operation-0002",
            stagedPath: "staging/operation-0002.payload",
          },
        ],
      }),
    },
    {
      label: "non-directory parent operation",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            path: ".brain/runs",
          },
          {
            ...replacementPlan(storage).operations[0],
            operationId: "operation-0002",
            path: ".brain/runs/state.json",
            stagedPath: "staging/operation-0002.payload",
          },
        ],
      }),
    },
    {
      label: "preexisting child beneath a newly created ancestor",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/runs",
            expected: { kind: "missing" },
            result: { kind: "directory" },
            stagedPath: null,
          },
          {
            operationId: "operation-0002",
            kind: "write_file",
            path: ".brain/runs/state.json",
            expected: {
              kind: "file",
              size: 3,
              sha256: storage.digests.sha256("old"),
            },
            result: {
              kind: "file",
              size: 3,
              sha256: storage.digests.sha256("new"),
            },
            stagedPath: "staging/operation-0002.payload",
            content: "new",
          },
        ],
      }),
    },
    {
      label: "preexisting deleted child beneath a newly created ancestor",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/runs",
            expected: { kind: "missing" },
            result: { kind: "directory" },
            stagedPath: null,
          },
          {
            operationId: "operation-0002",
            kind: "delete_file",
            path: ".brain/runs/state.json",
            expected: {
              kind: "file",
              size: 3,
              sha256: storage.digests.sha256("old"),
            },
            result: { kind: "missing" },
            stagedPath: null,
          },
        ],
      }),
    },
    {
      label: "skipped intermediate prefix beneath a newly created ancestor",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/a",
            expected: { kind: "missing" },
            result: { kind: "directory" },
            stagedPath: null,
          },
          {
            operationId: "operation-0002",
            kind: "write_file",
            path: ".brain/a/b/state.json",
            expected: { kind: "missing" },
            result: {
              kind: "file",
              size: 3,
              sha256: storage.digests.sha256("new"),
            },
            stagedPath: "staging/operation-0002.payload",
            content: "new",
          },
        ],
      }),
    },
    {
      label: "skipped deep prefix after a partial created chain",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            operationId: "operation-0001",
            kind: "create_directory",
            path: ".brain/a",
            expected: { kind: "missing" },
            result: { kind: "directory" },
            stagedPath: null,
          },
          {
            operationId: "operation-0002",
            kind: "create_directory",
            path: ".brain/a/b",
            expected: { kind: "missing" },
            result: { kind: "directory" },
            stagedPath: null,
          },
          {
            operationId: "operation-0003",
            kind: "write_file",
            path: ".brain/a/b/c/state.json",
            expected: { kind: "missing" },
            result: {
              kind: "file",
              size: 3,
              sha256: storage.digests.sha256("new"),
            },
            stagedPath: "staging/operation-0003.payload",
            content: "new",
          },
        ],
      }),
    },
    {
      label: "invalid parent-child order",
      reasonCode: "runtime.state_corrupt",
      plan: (storage: ReturnType<typeof memoryTransactionStorage>) => ({
        operations: [
          {
            ...replacementPlan(storage).operations[0],
            path: ".brain/runs/state.json",
          },
          {
            operationId: "operation-0002",
            kind: "create_directory",
            path: ".brain/runs",
            expected: { kind: "missing" },
            result: { kind: "directory" },
            stagedPath: null,
          },
        ],
      }),
    },
  ])(
    "rejects a forged $label before every injected effect boundary",
    async ({ plan, reasonCode }) => {
      const storage = memoryTransactionStorage({
        directories: [".brain/transactions"],
        files: {
          ".brain/state.json": "old",
          "src/owned.txt": "old",
        },
      });
      const before = storage.snapshot();
      let clockCalls = 0;
      let idCalls = 0;
      const injected: TransactionServices = {
        ...services(storage),
        clock: {
          now: () => {
            clockCalls += 1;
            return new Date("2026-08-09T00:00:00.000Z");
          },
        },
        ids: {
          next: () => {
            idCalls += 1;
            return "transaction-1";
          },
        },
      };

      await expect(
        executeManagedMutation(
          plan(storage) as ManagedMutationPlan,
          { rootMode: "existing" },
          injected,
        ),
      ).rejects.toMatchObject({ reasonCode });
      expect(storage.snapshot()).toEqual(before);
      expect(storage.calls()).toEqual([]);
      expect(clockCalls).toBe(0);
      expect(idCalls).toBe(0);
    },
  );

  it("executes an immutable snapshot when the caller mutates its plan after preflight", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const original = replacementPlan(storage).operations[0];
    if (original?.kind !== "write_file") {
      throw new Error("missing write fixture operation");
    }
    const mutablePlan: { operations: ManagedMutationPlan["operations"] } = {
      operations: [original],
    };
    const base = storage.durableFileSystem;
    let mutated = false;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path) => {
        if (!mutated) {
          mutated = true;
          mutablePlan.operations = [
            {
              ...original,
              content: "evil",
              result: {
                kind: "file",
                size: 4,
                sha256: storage.digests.sha256("evil"),
              },
            },
          ];
        }
        return base.inspect(path);
      },
    };

    await expect(
      executeManagedMutation(
        mutablePlan,
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).resolves.toMatchObject({ phase: "committed" });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
  });

  it("sanitizes a digest failure during preflight without crossing another boundary", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected: TransactionServices = {
      ...services(storage),
      digests: {
        sha256: () => {
          throw new Error("digest detail");
        },
      },
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
    expect(storage.calls()).toEqual([]);
  });

  it("durably prepares, publishes, commits, and removes staged payloads", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });

    const receipt = await executeManagedMutation(
      replacementPlan(storage),
      { rootMode: "existing" },
      services(storage),
    );

    expect(receipt).toMatchObject({
      transactionId: "transaction-1",
      phase: "committed",
      directorySync: "supported",
    });
    expect(receipt.manifestDigest).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.recoveryToken).toMatch(/^[a-f0-9]{64}$/u);
    expect(receipt.recoveryToken).toBe(receipt.manifestDigest);

    const snapshot = storage.snapshot();
    expect(snapshot.files[".brain/state.json"]).toBe("new");
    expect(snapshot.files).not.toHaveProperty(
      ".brain/transactions/transaction-1/staging/operation-0001.payload",
    );
    expect(snapshot.directories).not.toContain(
      ".brain/transactions/transaction-1/staging",
    );

    const manifestText =
      snapshot.files[".brain/transactions/transaction-1/manifest.json"];
    const progressText =
      snapshot.files[".brain/transactions/transaction-1/progress.json"];
    expect(manifestText?.endsWith("\n")).toBe(true);
    expect(progressText?.endsWith("\n")).toBe(true);
    const manifest: unknown = JSON.parse(manifestText ?? "null");
    const progress: unknown = JSON.parse(progressText ?? "null");
    expect(JSON.stringify(manifest)).not.toContain("content");
    expect(manifest).toMatchObject({
      transactionId: "transaction-1",
      operations: [
        {
          operationId: "operation-0001",
          stagedPath:
            ".brain/transactions/transaction-1/staging/operation-0001.payload",
        },
      ],
    });
    expect(progress).toMatchObject({
      transactionId: "transaction-1",
      manifestDigest: receipt.manifestDigest,
      recoveryToken: receipt.recoveryToken,
      phase: "committed",
      publishedOperationIds: ["operation-0001"],
      directorySync: "supported",
    });

    const registry = createSchemaRegistry();
    expect(
      registry.validate({
        id: "state.transaction-manifest",
        version: "1.0.0",
        value: manifest,
        structuralReasonCode: "runtime.state_corrupt",
      }).kind,
    ).toBe("valid");
    expect(
      registry.validate({
        id: "state.transaction-progress",
        version: "1.0.0",
        value: progress,
        structuralReasonCode: "runtime.state_corrupt",
      }).kind,
    ).toBe("valid");
  });

  it("initializes and synchronizes only the managed root bootstrap", async () => {
    const storage = memoryTransactionStorage();
    const plan: ManagedMutationPlan = {
      operations: [
        {
          operationId: "operation-0001",
          kind: "write_file",
          path: ".brain/state.json",
          expected: { kind: "missing" },
          result: {
            kind: "file",
            size: 3,
            sha256: storage.digests.sha256("new"),
          },
          stagedPath: "staging/operation-0001.payload",
          content: "new",
        },
      ],
    };

    await expect(
      executeManagedMutation(
        plan,
        { rootMode: "initialize" },
        services(storage),
      ),
    ).resolves.toMatchObject({ phase: "committed" });

    expect(storage.calls().slice(0, 9)).toEqual([
      "inspect",
      "inspect",
      "inspect",
      "inspect",
      "create_directory",
      "sync_directory",
      "inspect",
      "create_directory",
      "sync_directory",
    ]);
    expect(storage.snapshot().directories).toEqual([
      ".brain",
      ".brain/transactions",
      ".brain/transactions/transaction-1",
    ]);
    expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
  });

  it("refuses a missing existing root without creating bootstrap entries", async () => {
    const storage = memoryTransactionStorage();
    const plan: ManagedMutationPlan = {
      operations: [
        {
          operationId: "operation-0001",
          kind: "create_directory",
          path: ".brain/runs",
          expected: { kind: "missing" },
          result: { kind: "directory" },
          stagedPath: null,
        },
      ],
    };

    await expect(
      executeManagedMutation(plan, { rootMode: "existing" }, services(storage)),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: ".brain" },
      ]),
    );
    expect(storage.snapshot()).toEqual({ files: {}, directories: [] });
    expect(storage.calls()).toEqual(["inspect", "inspect"]);
  });

  it.each([
    { path: ".brain", evidenceRef: ".brain" },
    {
      path: ".brain/transactions",
      evidenceRef: ".brain/transactions",
    },
  ])(
    "rejects $path changing after the repeated preflight",
    async ({ path, evidenceRef }) => {
      const storage = memoryTransactionStorage({
        directories: [".brain", ".brain/transactions"],
        files: { ".brain/state.json": "old" },
      });
      let inspections = 0;
      const boundary: DurableFileSystem = {
        ...storage.durableFileSystem,
        inspect(candidate): Promise<DurableEntry> {
          if (candidate === path && ++inspections === 4) {
            return Promise.resolve({ kind: "special" });
          }
          return storage.durableFileSystem.inspect(candidate);
        },
      };

      await expect(
        executeManagedMutation(
          replacementPlan(storage),
          { rootMode: "existing" },
          { ...services(storage), durableFileSystem: boundary },
        ),
      ).rejects.toEqual(
        new TransactionFailure("runtime.state_corrupt", [
          { kind: "artifact", ref: evidenceRef },
        ]),
      );
      expect(inspections).toBe(4);
      expect(storage.calls()).not.toContain("create_directory_exclusive");
    },
  );

  it("leaves a pre-publication revision conflict explicitly abortable", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "actual" },
    });

    const injected = services(storage);
    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.revision_conflict",
      evidence: [{ kind: "artifact", ref: ".brain/state.json" }],
    });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("actual");
    const progress = JSON.parse(
      storage.snapshot().files[
        ".brain/transactions/transaction-1/progress.json"
      ] ?? "null",
    ) as { readonly phase?: unknown };
    expect(progress.phase).toBe("begun");
    const [summary] = await inspectManagedTransactions(injected);
    const request = {
      transactionId: "transaction-1",
      recoveryToken: summary?.recoveryToken ?? "missing",
    };
    const first = await recoverManagedMutation(request, injected);
    const second = await recoverManagedMutation(request, injected);
    expect(first).toEqual({
      transactionId: "transaction-1",
      manifestDigest: null,
      recoveryToken: summary?.recoveryToken,
      phase: "aborted",
      directorySync: "supported",
    });
    expect(second).toEqual(first);
    expect(storage.snapshot().files[".brain/state.json"]).toBe("actual");
  });

  it("publishes directory creation, file replacement, and deletion in order", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: {
        ".brain/replace.json": "old",
        ".brain/delete.json": "delete",
      },
    });
    const mutation: ManagedMutationPlan = {
      operations: [
        {
          operationId: "operation-0001",
          kind: "create_directory",
          path: ".brain/new-directory",
          expected: { kind: "missing" },
          result: { kind: "directory" },
          stagedPath: null,
        },
        {
          operationId: "operation-0002",
          kind: "write_file",
          path: ".brain/replace.json",
          expected: {
            kind: "file",
            size: 3,
            sha256: storage.digests.sha256("old"),
          },
          result: {
            kind: "file",
            size: 3,
            sha256: storage.digests.sha256("new"),
          },
          stagedPath: "staging/operation-0002.payload",
          content: "new",
        },
        {
          operationId: "operation-0003",
          kind: "delete_file",
          path: ".brain/delete.json",
          expected: {
            kind: "file",
            size: 6,
            sha256: storage.digests.sha256("delete"),
          },
          result: { kind: "missing" },
          stagedPath: null,
        },
      ],
    };

    await expect(
      executeManagedMutation(
        mutation,
        { rootMode: "existing" },
        services(storage),
      ),
    ).resolves.toMatchObject({ phase: "committed" });
    expect(storage.snapshot().directories).toContain(".brain/new-directory");
    expect(storage.snapshot().files[".brain/replace.json"]).toBe("new");
    expect(storage.snapshot().files).not.toHaveProperty(".brain/delete.json");
  });

  it("accepts a normalized parent-first directory and child write", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const content = "state";
    const mutation: ManagedMutationPlan = {
      operations: [
        {
          operationId: "operation-0001",
          kind: "create_directory",
          path: ".brain/runs",
          expected: { kind: "missing" },
          result: { kind: "directory" },
          stagedPath: null,
        },
        {
          operationId: "operation-0002",
          kind: "write_file",
          path: ".brain/runs/state.json",
          expected: { kind: "missing" },
          result: {
            kind: "file",
            size: 5,
            sha256: storage.digests.sha256(content),
          },
          stagedPath: "staging/operation-0002.payload",
          content,
        },
      ],
    };

    await expect(
      executeManagedMutation(
        mutation,
        { rootMode: "existing" },
        services(storage),
      ),
    ).resolves.toMatchObject({ phase: "committed" });
    expect(storage.snapshot().files[".brain/runs/state.json"]).toBe(content);
  });

  it("accepts a complete synthesized directory chain before a deep child write", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const content = "state";

    await expect(
      executeManagedMutation(
        {
          operations: [
            {
              operationId: "operation-0001",
              kind: "create_directory",
              path: ".brain/a",
              expected: { kind: "missing" },
              result: { kind: "directory" },
              stagedPath: null,
            },
            {
              operationId: "operation-0002",
              kind: "create_directory",
              path: ".brain/a/b",
              expected: { kind: "missing" },
              result: { kind: "directory" },
              stagedPath: null,
            },
            {
              operationId: "operation-0003",
              kind: "write_file",
              path: ".brain/a/b/state.json",
              expected: { kind: "missing" },
              result: {
                kind: "file",
                size: 5,
                sha256: storage.digests.sha256(content),
              },
              stagedPath: "staging/operation-0003.payload",
              content,
            },
          ],
        },
        { rootMode: "existing" },
        services(storage),
      ),
    ).resolves.toMatchObject({ phase: "committed" });
    expect(storage.snapshot().files[".brain/a/b/state.json"]).toBe(content);
  });

  it("accepts a deep path beneath preexisting ancestors absent from the plan", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions", ".brain/a", ".brain/a/b"],
      files: { ".brain/a/b/state.json": "old" },
    });
    const content = "new";

    await expect(
      executeManagedMutation(
        {
          operations: [
            {
              operationId: "operation-0001",
              kind: "write_file",
              path: ".brain/a/b/state.json",
              expected: {
                kind: "file",
                size: 3,
                sha256: storage.digests.sha256("old"),
              },
              result: {
                kind: "file",
                size: 3,
                sha256: storage.digests.sha256(content),
              },
              stagedPath: "staging/operation-0001.payload",
              content,
            },
          ],
        },
        { rootMode: "existing" },
        services(storage),
      ),
    ).resolves.toMatchObject({ phase: "committed" });
    expect(storage.snapshot().files[".brain/a/b/state.json"]).toBe(content);
  });

  it("records unsupported directory synchronization in progress and receipt", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const unsupported: DurableFileSystem = {
      ...base,
      syncDirectory: async (path) => {
        await base.syncDirectory(path);
        return "unsupported";
      },
    };
    const injected = {
      ...services(storage),
      durableFileSystem: unsupported,
    };

    const receipt = await executeManagedMutation(
      replacementPlan(storage),
      { rootMode: "existing" },
      injected,
    );
    expect(receipt.directorySync).toBe("unsupported");
    const progress = JSON.parse(
      storage.snapshot().files[
        ".brain/transactions/transaction-1/progress.json"
      ] ?? "null",
    ) as { readonly directorySync?: unknown };
    expect(progress.directorySync).toBe("unsupported");
  });

  it("does not initialize a reserved namespace inside a non-empty root", async () => {
    const storage = memoryTransactionStorage({
      files: { ".brain/existing.json": "existing" },
    });

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "initialize" },
        services(storage),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.snapshot().files[".brain/existing.json"]).toBe("existing");
    expect(storage.snapshot().directories).not.toContain(".brain/transactions");
  });

  it("refuses existing mode when only the managed root exists", async () => {
    const storage = memoryTransactionStorage({ directories: [".brain"] });

    await expect(
      executeManagedMutation(
        {
          operations: [
            {
              operationId: "operation-0001",
              kind: "create_directory",
              path: ".brain/runs",
              expected: { kind: "missing" },
              result: { kind: "directory" },
              stagedPath: null,
            },
          ],
        },
        { rootMode: "existing" },
        services(storage),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.snapshot().directories).toEqual([".brain"]);
  });

  it.each([
    {
      label: "special precondition",
      occurrence: 1,
      observed: { kind: "special" } as const,
      reasonCode: "runtime.state_corrupt",
    },
    {
      label: "drift immediately before publication",
      occurrence: 2,
      observed: { kind: "missing" } as const,
      reasonCode: "runtime.recovery_required",
    },
    {
      label: "wrong immediate publication result",
      occurrence: 3,
      observed: { kind: "missing" } as const,
      reasonCode: "runtime.recovery_required",
    },
    {
      label: "wrong final publication result",
      occurrence: 4,
      observed: { kind: "missing" } as const,
      reasonCode: "runtime.recovery_required",
    },
  ])(
    "blocks a $label observation",
    async ({ occurrence, observed, reasonCode }) => {
      const storage = memoryTransactionStorage({
        directories: [".brain/transactions"],
        files: { ".brain/state.json": "old" },
      });
      const base = storage.durableFileSystem;
      let targetInspections = 0;
      const boundary: DurableFileSystem = {
        ...base,
        inspect: async (path): Promise<DurableEntry> => {
          const actual = await base.inspect(path);
          if (path !== ".brain/state.json") return actual;
          targetInspections += 1;
          return targetInspections === occurrence ? observed : actual;
        },
      };

      await expect(
        executeManagedMutation(
          replacementPlan(storage),
          { rootMode: "existing" },
          { ...services(storage), durableFileSystem: boundary },
        ),
      ).rejects.toMatchObject({ reasonCode });
    },
  );

  it("reclassifies persistent drift after publishing as corrupt state", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    let targetInspections = 0;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path): Promise<DurableEntry> => {
        const actual = await base.inspect(path);
        if (path !== ".brain/state.json") return actual;
        targetInspections += 1;
        return targetInspections >= 2 ? { kind: "missing" } : actual;
      },
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: ".brain/state.json" },
      ]),
    );
    expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
  });

  it("rebinds progress identity while classifying a publishing failure", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const progressPath = ".brain/transactions/transaction-1/progress.json";
    let targetInspections = 0;
    let progressReads = 0;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path): Promise<DurableEntry> => {
        const actual = await base.inspect(path);
        if (path !== ".brain/state.json") return actual;
        targetInspections += 1;
        return targetInspections === 2 ? { kind: "missing" } : actual;
      },
      readText: async (path) => {
        const actual = await base.readText(path);
        if (path !== progressPath) return actual;
        progressReads += 1;
        if (progressReads !== 2) return actual;
        const replacement = JSON.parse(actual) as Record<string, unknown>;
        replacement.recoveryToken = "f".repeat(64);
        return `${canonicalizeJson(replacement)}\n`;
      },
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
  });

  it("classifies persistent create-directory drift from fresh state", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const base = storage.durableFileSystem;
    let targetInspections = 0;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path): Promise<DurableEntry> => {
        const actual = await base.inspect(path);
        if (path !== ".brain/runs") return actual;
        targetInspections += 1;
        return targetInspections >= 2
          ? { kind: "file", size: 1, sha256: "f".repeat(64) }
          : actual;
      },
    };

    await expect(
      executeManagedMutation(
        {
          operations: [
            {
              operationId: "operation-0001",
              kind: "create_directory",
              path: ".brain/runs",
              expected: { kind: "missing" },
              result: { kind: "directory" },
              stagedPath: null,
            },
          ],
        },
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: ".brain/runs" },
      ]),
    );
  });

  it("classifies an invalid publishing prefix without inventing an operation", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const progressPath = ".brain/transactions/transaction-1/progress.json";
    let targetInspections = 0;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path): Promise<DurableEntry> => {
        const actual = await base.inspect(path);
        if (path !== ".brain/state.json") return actual;
        targetInspections += 1;
        return targetInspections === 2 ? { kind: "missing" } : actual;
      },
      readText: async (path) => {
        const actual = await base.readText(path);
        if (path !== progressPath) return actual;
        const replacement = JSON.parse(actual) as Record<string, unknown>;
        replacement.publishedOperationIds = ["operation-unknown"];
        return `${canonicalizeJson(replacement)}\n`;
      },
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: progressPath },
      ]),
    );
  });

  it.each(["inspect", "read", "list"] as const)(
    "classifies a raw $label failure during fresh publishing observation as recovery required",
    async (failureBoundary) => {
      const storage = memoryTransactionStorage({
        directories: [".brain/transactions"],
        files: { ".brain/state.json": "old" },
      });
      const base = storage.durableFileSystem;
      const progressPath = ".brain/transactions/transaction-1/progress.json";
      const staging = ".brain/transactions/transaction-1/staging";
      let targetInspections = 0;
      let progressReads = 0;
      const boundary: DurableFileSystem = {
        ...base,
        inspect: async (path): Promise<DurableEntry> => {
          if (path === ".brain/state.json") {
            targetInspections += 1;
            if (failureBoundary === "inspect" && targetInspections === 3) {
              throw new Error("fresh inspect detail");
            }
          }
          const actual = await base.inspect(path);
          return path === ".brain/state.json" && targetInspections === 2
            ? { kind: "missing" }
            : actual;
        },
        readText: async (path) => {
          if (path === progressPath) {
            progressReads += 1;
            if (failureBoundary === "read" && progressReads === 2) {
              throw new Error("fresh read detail");
            }
          }
          return base.readText(path);
        },
        list: async (path) => {
          if (failureBoundary === "list" && path === staging) {
            throw new Error("fresh list detail");
          }
          return base.list(path);
        },
      };

      await expect(
        executeManagedMutation(
          replacementPlan(storage),
          { rootMode: "existing" },
          { ...services(storage), durableFileSystem: boundary },
        ),
      ).rejects.toEqual(
        new TransactionFailure("runtime.recovery_required", [
          { kind: "artifact", ref: progressPath },
        ]),
      );
      const [summary] = await inspectManagedTransactions(services(storage));
      expect(summary?.phase).toBe("publishing");
      expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
    },
  );

  it("classifies raw original and fresh publishing failures as recovery required", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const progressPath = ".brain/transactions/transaction-1/progress.json";
    const staging = ".brain/transactions/transaction-1/staging";
    const boundary: DurableFileSystem = {
      ...base,
      replaceFile: (stagedPath, targetPath) =>
        targetPath === ".brain/state.json"
          ? Promise.reject(new Error("original publish detail"))
          : base.replaceFile(stagedPath, targetPath),
      list: (path) =>
        path === staging
          ? Promise.reject(new Error("fresh list detail"))
          : base.list(path),
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.recovery_required", [
        { kind: "artifact", ref: progressPath },
      ]),
    );
    const [summary] = await inspectManagedTransactions(services(storage));
    expect(summary?.phase).toBe("publishing");
    expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
  });

  it("uses durable publishing context when a stale typed failure is followed by a raw scan failure", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const progressPath = ".brain/transactions/transaction-1/progress.json";
    let targetInspections = 0;
    let classificationStarted = false;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path): Promise<DurableEntry> => {
        if (classificationStarted && path === ".brain") {
          throw new Error("classification scan detail");
        }
        const actual = await base.inspect(path);
        if (path !== ".brain/state.json") return actual;
        targetInspections += 1;
        if (targetInspections === 2) {
          classificationStarted = true;
          return { kind: "missing" };
        }
        return actual;
      },
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.recovery_required", [
        { kind: "artifact", ref: progressPath },
      ]),
    );
    const [summary] = await inspectManagedTransactions(services(storage));
    expect(summary?.phase).toBe("publishing");
  });

  it("uses durable publishing context when raw publication and scan both fail", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const progressPath = ".brain/transactions/transaction-1/progress.json";
    let publicationFailed = false;
    const boundary: DurableFileSystem = {
      ...base,
      replaceFile: (stagedPath, targetPath) => {
        if (targetPath === ".brain/state.json") {
          publicationFailed = true;
          return Promise.reject(new Error("publication detail"));
        }
        return base.replaceFile(stagedPath, targetPath);
      },
      inspect: (path) =>
        publicationFailed && path === ".brain"
          ? Promise.reject(new Error("classification scan detail"))
          : base.inspect(path),
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.recovery_required", [
        { kind: "artifact", ref: progressPath },
      ]),
    );
    const [summary] = await inspectManagedTransactions(services(storage));
    expect(summary?.phase).toBe("publishing");
  });

  it("keeps a pre-prepared revision conflict when its classification scan fails", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    let preconditionFailed = false;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path): Promise<DurableEntry> => {
        if (preconditionFailed && path === ".brain") {
          throw new Error("classification scan detail");
        }
        const actual = await base.inspect(path);
        if (path === ".brain/state.json") {
          preconditionFailed = true;
          return { kind: "missing" };
        }
        return actual;
      },
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.revision_conflict", [
        { kind: "artifact", ref: ".brain/state.json" },
      ]),
    );
    const [summary] = await inspectManagedTransactions(services(storage));
    expect(summary?.phase).toBe("begun");
  });

  it("persists directory-sync capability discovered during terminal cleanup", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const root = ".brain/transactions/transaction-1";
    const staging = `${root}/staging`;
    const boundary: DurableFileSystem = {
      ...base,
      syncDirectory: async (path) => {
        await base.syncDirectory(path);
        return path === root && (await base.inspect(staging)).kind === "missing"
          ? "unsupported"
          : "supported";
      },
    };
    const injected = { ...services(storage), durableFileSystem: boundary };

    const first = await executeManagedMutation(
      replacementPlan(storage),
      { rootMode: "existing" },
      injected,
    );
    const second = await recoverManagedMutation(
      {
        transactionId: first.transactionId,
        recoveryToken: first.recoveryToken,
      },
      injected,
    );
    expect(first.directorySync).toBe("unsupported");
    expect(second).toEqual(first);
  });

  it("reconstructs a committed receipt after terminal cleanup completed before an error", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    storage.fail({
      operation: "remove_empty_directory",
      timing: "after",
      occurrence: 1,
    });
    const injected = services(storage);

    const first = await executeManagedMutation(
      replacementPlan(storage),
      { rootMode: "existing" },
      injected,
    );
    const second = await recoverManagedMutation(
      {
        transactionId: first.transactionId,
        recoveryToken: first.recoveryToken,
      },
      injected,
    );
    expect(first.phase).toBe("committed");
    expect(second).toEqual(first);
  });

  it("revalidates the destination parent immediately before publication", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions", ".brain/runs"],
    });
    const base = storage.durableFileSystem;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path) =>
        path === ".brain/runs" ? { kind: "missing" } : base.inspect(path),
    };
    const content = "state";
    const mutation: ManagedMutationPlan = {
      operations: [
        {
          operationId: "operation-0001",
          kind: "write_file",
          path: ".brain/runs/state.json",
          expected: { kind: "missing" },
          result: {
            kind: "file",
            size: 5,
            sha256: storage.digests.sha256(content),
          },
          stagedPath: "staging/operation-0001.payload",
          content,
        },
      ],
    };

    await expect(
      executeManagedMutation(
        mutation,
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.snapshot().files).not.toHaveProperty(
      ".brain/runs/state.json",
    );
  });

  it.each([
    { label: "altered", action: "alter" as const },
    { label: "missing", action: "remove" as const },
  ])(
    "blocks an $label staged payload immediately before publication",
    async ({ action }) => {
      const storage = memoryTransactionStorage({
        directories: [".brain/transactions"],
        files: { ".brain/state.json": "old" },
      });
      const base = storage.durableFileSystem;
      const payload =
        ".brain/transactions/transaction-1/staging/operation-0001.payload";
      let tampered = false;
      const boundary: DurableFileSystem = {
        ...base,
        inspect: async (path) => {
          if (path === ".brain/state.json" && !tampered) {
            tampered = true;
            if (action === "alter") {
              await storage.fileSystem.write(payload, "evil");
            } else {
              await base.removeFile(payload);
            }
          }
          return base.inspect(path);
        },
      };

      await expect(
        executeManagedMutation(
          replacementPlan(storage),
          { rootMode: "existing" },
          { ...services(storage), durableFileSystem: boundary },
        ),
      ).rejects.toEqual(
        new TransactionFailure("runtime.state_corrupt", [
          { kind: "artifact", ref: payload },
        ]),
      );
      expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
    },
  );

  it("sanitizes a bootstrap failure before any marker becomes durable", async () => {
    const storage = memoryTransactionStorage();
    storage.fail({
      operation: "create_directory",
      timing: "before",
      occurrence: 1,
    });

    await expect(
      executeManagedMutation(
        {
          operations: [
            {
              operationId: "operation-0001",
              kind: "create_directory",
              path: ".brain/runs",
              expected: { kind: "missing" },
              result: { kind: "directory" },
              stagedPath: null,
            },
          ],
        },
        { rootMode: "initialize" },
        services(storage),
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
    expect(storage.snapshot()).toEqual({ files: {}, directories: [] });
  });

  it("sanitizes an exclusive-create failure that leaves no attempt directory", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const base = storage.durableFileSystem;
    const boundary: DurableFileSystem = {
      ...base,
      createDirectoryExclusive: () =>
        Promise.reject(new Error("create detail")),
    };

    await expect(
      executeManagedMutation(
        {
          operations: [
            {
              operationId: "operation-0001",
              kind: "create_directory",
              path: ".brain/runs",
              expected: { kind: "missing" },
              result: { kind: "directory" },
              stagedPath: null,
            },
          ],
        },
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
    expect(storage.snapshot().directories).not.toContain(
      ".brain/transactions/transaction-1",
    );
  });

  it("sanitizes an unexpected inspection failure while classifying a driver failure", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const base = storage.durableFileSystem;
    let driverFailed = false;
    const boundary: DurableFileSystem = {
      ...base,
      createDirectoryExclusive: () => {
        driverFailed = true;
        return Promise.reject(new Error("driver detail"));
      },
      inspect: async (path) => {
        if (driverFailed) throw new Error("inspection detail");
        return base.inspect(path);
      },
    };

    await expect(
      executeManagedMutation(
        {
          operations: [
            {
              operationId: "operation-0001",
              kind: "create_directory",
              path: ".brain/runs",
              expected: { kind: "missing" },
              result: { kind: "directory" },
              stagedPath: null,
            },
          ],
        },
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
  });

  it("rejects a non-file progress scratch entry", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path) =>
        path.endsWith("/progress.next")
          ? { kind: "directory" }
          : base.inspect(path),
    };

    await expect(
      executeManagedMutation(
        replacementPlan(storage),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });
});
