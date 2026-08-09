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

function writePlan(
  storage: ReturnType<typeof memoryTransactionStorage>,
  expected: string,
  result: string,
): ManagedMutationPlan {
  return {
    operations: [
      {
        operationId: "operation-0001",
        kind: "write_file",
        path: ".brain/state.json",
        expected: {
          kind: "file",
          size: Buffer.byteLength(expected, "utf8"),
          sha256: storage.digests.sha256(expected),
        },
        result: {
          kind: "file",
          size: Buffer.byteLength(result, "utf8"),
          sha256: storage.digests.sha256(result),
        },
        stagedPath: "staging/operation-0001.payload",
        content: result,
      },
    ],
  };
}

function twoWritePlan(
  storage: ReturnType<typeof memoryTransactionStorage>,
): ManagedMutationPlan {
  return {
    operations: [
      ...writePlan(storage, "old", "new").operations,
      {
        operationId: "operation-0002",
        kind: "write_file",
        path: ".brain/second.json",
        expected: {
          kind: "file",
          size: 6,
          sha256: storage.digests.sha256("second"),
        },
        result: {
          kind: "file",
          size: 7,
          sha256: storage.digests.sha256("updated"),
        },
        stagedPath: "staging/operation-0002.payload",
        content: "updated",
      },
    ],
  };
}

describe("managed transaction inspection and recovery", () => {
  it.each([
    {
      label: "empty transaction directory",
      seed: {
        directories: [
          ".brain/transactions",
          ".brain/transactions/transaction-1",
        ],
        files: { ".brain/state.json": "old" },
      },
    },
    {
      label: "partial progress scratch",
      seed: {
        directories: [
          ".brain/transactions",
          ".brain/transactions/transaction-1",
        ],
        files: {
          ".brain/state.json": "old",
          ".brain/transactions/transaction-1/progress.next": "partial",
        },
      },
    },
    {
      label: "multiple sorted empty transaction directories",
      seed: {
        directories: [
          ".brain/transactions",
          ".brain/transactions/transaction-2",
          ".brain/transactions/transaction-1",
        ],
        files: { ".brain/state.json": "old" },
      },
    },
  ])(
    "reconciles a safe unmarked $label before starting a new transaction",
    async ({ seed }) => {
      const storage = memoryTransactionStorage(seed);

      await expect(
        executeManagedMutation(
          writePlan(storage, "old", "new"),
          { rootMode: "existing" },
          services(storage),
        ),
      ).resolves.toMatchObject({
        transactionId: "transaction-1",
        phase: "committed",
      });
      expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
      expect(storage.calls()).toContain("remove_empty_directory");
      expect(storage.calls()).toContain("sync_directory");
    },
  );

  it("blocks unknown content in an unmarked transaction without removing it", async () => {
    const unknownPath = ".brain/transactions/transaction-crash/unknown-content";
    const storage = memoryTransactionStorage({
      directories: [
        ".brain/transactions",
        ".brain/transactions/transaction-crash",
      ],
      files: {
        ".brain/state.json": "old",
        [unknownPath]: "preserve",
      },
    });

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        services(storage),
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        {
          kind: "artifact",
          ref: ".brain/transactions/transaction-crash",
        },
      ]),
    );
    expect(storage.snapshot().files[unknownPath]).toBe("preserve");
    expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
    expect(storage.calls()).not.toContain("remove_file");
    expect(storage.calls()).not.toContain("remove_empty_directory");
  });

  it.each([
    {
      label: "invalid transaction ID",
      seed: {
        directories: [".brain/transactions", ".brain/transactions/-invalid"],
      },
      evidenceRef: ".brain/transactions",
    },
    {
      label: "non-directory transaction entry",
      seed: {
        directories: [".brain/transactions"],
        files: { ".brain/transactions/transaction-foreign": "foreign" },
      },
      evidenceRef: ".brain/transactions/transaction-foreign",
    },
    {
      label: "non-file progress scratch",
      seed: {
        directories: [
          ".brain/transactions",
          ".brain/transactions/transaction-foreign",
          ".brain/transactions/transaction-foreign/progress.next",
        ],
      },
      evidenceRef: ".brain/transactions/transaction-foreign/progress.next",
    },
  ])("blocks a safe-reconciliation $label", async ({ seed, evidenceRef }) => {
    const storage = memoryTransactionStorage(seed);

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
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: evidenceRef },
      ]),
    );
  });

  it("blocks content that appears while an unmarked layout is revalidated", async () => {
    const root = ".brain/transactions/transaction-crash";
    const concurrent = `${root}/concurrent`;
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions", root],
    });
    const base = storage.durableFileSystem;
    let rootLists = 0;
    const boundary: DurableFileSystem = {
      ...base,
      list: async (path) => {
        if (path !== root) return base.list(path);
        rootLists += 1;
        if (rootLists === 2) {
          await storage.fileSystem.write(concurrent, "preserve");
        }
        return base.list(path);
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
        { kind: "artifact", ref: root },
      ]),
    );
    expect(storage.snapshot().files[concurrent]).toBe("preserve");
  });

  it("cleans only the current unmarked attempt while classifying its failure", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const foreignRoot = ".brain/transactions/transaction-foreign";
    const boundary: DurableFileSystem = {
      ...base,
      createDirectoryExclusive: async (path) => {
        await base.createDirectoryExclusive(path);
        await base.createDirectoryExclusive(foreignRoot);
        throw new Error("current attempt failed");
      },
    };

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: `${foreignRoot}/progress.json` },
      ]),
    );
    expect(storage.snapshot().directories).toContain(foreignRoot);
    expect(storage.snapshot().directories).not.toContain(
      ".brain/transactions/transaction-1",
    );
  });

  it("preserves unknown content created in the current unmarked attempt", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const root = ".brain/transactions/transaction-1";
    const unknown = `${root}/unknown`;
    const boundary: DurableFileSystem = {
      ...base,
      createDirectoryExclusive: async (path) => {
        await base.createDirectoryExclusive(path);
        await storage.fileSystem.write(unknown, "preserve");
        throw new Error("current attempt failed");
      },
    };

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.snapshot().files[unknown]).toBe("preserve");
  });

  it("preserves a non-file scratch created in the current unmarked attempt", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const next = ".brain/transactions/transaction-1/progress.next";
    const boundary: DurableFileSystem = {
      ...base,
      createDirectoryExclusive: async (path) => {
        await base.createDirectoryExclusive(path);
        await base.createDirectory(next);
        throw new Error("current attempt failed");
      },
    };

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: next },
      ]),
    );
    expect(storage.snapshot().directories).toContain(next);
  });

  it("preserves content racing with cleanup of the current unmarked attempt", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const base = storage.durableFileSystem;
    const root = ".brain/transactions/transaction-1";
    const concurrent = `${root}/concurrent`;
    let rootLists = 0;
    const boundary: DurableFileSystem = {
      ...base,
      createDirectoryExclusive: async (path) => {
        await base.createDirectoryExclusive(path);
        throw new Error("current attempt failed");
      },
      list: async (path) => {
        if (path !== root) return base.list(path);
        rootLists += 1;
        if (rootLists === 2) {
          await storage.fileSystem.write(concurrent, "preserve");
        }
        return base.list(path);
      },
    };

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        { ...services(storage), durableFileSystem: boundary },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.snapshot().files[concurrent]).toBe("preserve");
  });

  it("lists validated transaction summaries in stable order without writes", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    const first = await executeManagedMutation(
      writePlan(storage, "old", "new"),
      { rootMode: "existing" },
      injected,
    );
    const second = await executeManagedMutation(
      writePlan(storage, "new", "newer"),
      { rootMode: "existing" },
      injected,
    );
    const before = storage.snapshot();

    await expect(inspectManagedTransactions(injected)).resolves.toEqual([
      {
        transactionId: "transaction-1",
        manifestDigest: first.manifestDigest,
        recoveryToken: first.recoveryToken,
        phase: "committed",
        evidenceRef: ".brain/transactions/transaction-1/progress.json",
      },
      {
        transactionId: "transaction-2",
        manifestDigest: second.manifestDigest,
        recoveryToken: second.recoveryToken,
        phase: "committed",
        evidenceRef: ".brain/transactions/transaction-2/progress.json",
      },
    ]);
    expect(storage.snapshot()).toEqual(before);
  });

  it("aborts explicitly after prepared progress became durable", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "sync_directory",
      timing: "after",
      occurrence: 6,
    });

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.recovery_required",
      evidence: [
        {
          kind: "artifact",
          ref: ".brain/transactions/transaction-1/progress.json",
        },
      ],
    });
    const [summary] = await inspectManagedTransactions(injected);
    expect(summary).toMatchObject({
      transactionId: "transaction-1",
      phase: "prepared",
    });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("old");

    const first = await recoverManagedMutation(
      {
        transactionId: summary?.transactionId ?? "missing",
        recoveryToken: summary?.recoveryToken ?? "missing",
      },
      injected,
    );
    const second = await recoverManagedMutation(
      {
        transactionId: "transaction-1",
        recoveryToken: first.recoveryToken,
      },
      injected,
    );
    expect(first).toEqual({
      transactionId: "transaction-1",
      manifestDigest: summary?.manifestDigest ?? null,
      recoveryToken: summary?.recoveryToken,
      phase: "aborted",
      directorySync: "supported",
    });
    expect(second).toEqual(first);
    expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
    expect(storage.snapshot().directories).not.toContain(
      ".brain/transactions/transaction-1/staging",
    );
  });

  it("aborts a begun transaction after its manifest became durable", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "sync_directory",
      timing: "after",
      occurrence: 5,
    });

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    const [summary] = await inspectManagedTransactions(injected);
    expect(summary).toMatchObject({ phase: "begun", manifestDigest: null });

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        injected,
      ),
    ).resolves.toMatchObject({ phase: "aborted", manifestDigest: null });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
  });

  it.each([
    {
      label: "exclusive transaction directory creation",
      operation: "create_directory_exclusive" as const,
      timing: "after" as const,
      occurrence: 1,
    },
    {
      label: "opening the initial progress scratch file",
      operation: "open_file" as const,
      timing: "after" as const,
      occurrence: 1,
    },
  ])(
    "cleans an unmarked transaction after $label fails",
    async ({ operation, timing, occurrence }) => {
      const storage = memoryTransactionStorage({
        directories: [".brain/transactions"],
        files: { ".brain/state.json": "old" },
      });
      storage.fail({ operation, timing, occurrence });

      await expect(
        executeManagedMutation(
          writePlan(storage, "old", "new"),
          { rootMode: "existing" },
          services(storage),
        ),
      ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
      expect(storage.snapshot().directories).not.toContain(
        ".brain/transactions/transaction-1",
      );
      expect(storage.snapshot().files).not.toHaveProperty(
        ".brain/transactions/transaction-1/progress.next",
      );
      expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
    },
  );

  it("recovers a begun marker that has no manifest", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 1,
    });

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    const [summary] = await inspectManagedTransactions(injected);
    expect(summary).toMatchObject({ phase: "begun", manifestDigest: null });
    expect(storage.snapshot().files).not.toHaveProperty(
      ".brain/transactions/transaction-1/manifest.json",
    );

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        injected,
      ),
    ).resolves.toMatchObject({ phase: "aborted", manifestDigest: null });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
  });

  it("replaces a leftover progress.next from a pre-publishing failure", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "write_file",
      timing: "after",
      occurrence: 5,
    });

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    const nextPath = ".brain/transactions/transaction-1/progress.next";
    expect(storage.snapshot().files).toHaveProperty(nextPath);
    const [summary] = await inspectManagedTransactions(injected);
    expect(summary?.phase).toBe("prepared");

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        injected,
      ),
    ).resolves.toMatchObject({ phase: "aborted" });
    expect(storage.snapshot().files).not.toHaveProperty(nextPath);
  });

  it("removes staged payloads when aborting before a manifest exists", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "sync_directory",
      timing: "after",
      occurrence: 4,
    });

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    const payload =
      ".brain/transactions/transaction-1/staging/operation-0001.payload";
    expect(storage.snapshot().files).toHaveProperty(payload, "new");
    const [summary] = await inspectManagedTransactions(injected);

    const first = await recoverManagedMutation(
      {
        transactionId: "transaction-1",
        recoveryToken: summary?.recoveryToken ?? "missing",
      },
      injected,
    );
    expect(first.phase).toBe("aborted");
    expect(storage.snapshot().files).not.toHaveProperty(payload);
    expect(storage.snapshot().directories).not.toContain(
      ".brain/transactions/transaction-1/staging",
    );
    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: first.recoveryToken,
        },
        injected,
      ),
    ).resolves.toEqual(first);
  });

  it.each([
    {
      label: "unknown file name",
      name: "unexpected.payload",
      kind: "file" as const,
    },
    {
      label: "non-file payload",
      name: "operation-0002.payload",
      kind: "directory" as const,
    },
  ])(
    "blocks a $label before cleaning an unmanifested staging directory",
    async ({ name, kind }) => {
      const storage = memoryTransactionStorage({
        directories: [".brain/transactions"],
        files: { ".brain/state.json": "old" },
      });
      const injected = services(storage);
      storage.fail({
        operation: "sync_directory",
        timing: "after",
        occurrence: 4,
      });
      await expect(
        executeManagedMutation(
          writePlan(storage, "old", "new"),
          { rootMode: "existing" },
          injected,
        ),
      ).rejects.toBeInstanceOf(Error);
      const path = `.brain/transactions/transaction-1/staging/${name}`;
      if (kind === "file") await storage.fileSystem.write(path, "unexpected");
      else await storage.fileSystem.makeDirectory(path);
      const [summary] = await inspectManagedTransactions(injected);
      const before = storage.snapshot();

      await expect(
        recoverManagedMutation(
          {
            transactionId: "transaction-1",
            recoveryToken: summary?.recoveryToken ?? "missing",
          },
          injected,
        ),
      ).rejects.toEqual(
        new TransactionFailure("runtime.state_corrupt", [
          { kind: "artifact", ref: path },
        ]),
      );
      expect(storage.snapshot()).toEqual(before);
    },
  );

  it("cleans a scratch file from an already-aborted unmanifested marker", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 1,
    });
    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toBeInstanceOf(Error);
    const [summary] = await inspectManagedTransactions(injected);
    const receipt = await recoverManagedMutation(
      {
        transactionId: "transaction-1",
        recoveryToken: summary?.recoveryToken ?? "missing",
      },
      injected,
    );
    const next = ".brain/transactions/transaction-1/progress.next";
    await storage.fileSystem.write(next, "scratch");

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: receipt.recoveryToken,
        },
        injected,
      ),
    ).resolves.toEqual(receipt);
    expect(storage.snapshot().files).not.toHaveProperty(next);
  });

  it("rolls forward create and delete operations from a publishing marker", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/delete.json": "delete" },
    });
    const injected = services(storage);
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
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 3,
    });
    await expect(
      executeManagedMutation(mutation, { rootMode: "existing" }, injected),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    const [summary] = await inspectManagedTransactions(injected);

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        injected,
      ),
    ).resolves.toMatchObject({ phase: "committed" });
    expect(storage.snapshot().directories).toContain(".brain/new-directory");
    expect(storage.snapshot().files).not.toHaveProperty(".brain/delete.json");
  });

  it("blocks an unknown staged payload and preserves the marker", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "sync_directory",
      timing: "after",
      occurrence: 6,
    });
    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toBeInstanceOf(Error);
    const unknown = ".brain/transactions/transaction-1/staging/unknown.payload";
    await storage.fileSystem.write(unknown, "unknown");
    const [summary] = await inspectManagedTransactions(injected);
    const before = storage.snapshot();

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        injected,
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        {
          kind: "artifact",
          ref: ".brain/transactions/transaction-1/progress.json",
        },
      ]),
    );
    expect(storage.snapshot()).toEqual(before);
  });

  it("removes a terminal progress scratch file idempotently", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    const receipt = await executeManagedMutation(
      writePlan(storage, "old", "new"),
      { rootMode: "existing" },
      injected,
    );
    const next = ".brain/transactions/transaction-1/progress.next";
    await storage.fileSystem.write(next, "scratch");

    await expect(
      recoverManagedMutation(
        {
          transactionId: receipt.transactionId,
          recoveryToken: receipt.recoveryToken,
        },
        injected,
      ),
    ).resolves.toEqual(receipt);
    expect(storage.snapshot().files).not.toHaveProperty(next);
  });

  it("verifies the result after applying a recovery publication", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const initial = services(storage);
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 3,
    });
    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        initial,
      ),
    ).rejects.toBeInstanceOf(Error);
    const [summary] = await inspectManagedTransactions(initial);
    const base = storage.durableFileSystem;
    let targetInspections = 0;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path): Promise<DurableEntry> => {
        const actual = await base.inspect(path);
        if (path !== ".brain/state.json") return actual;
        targetInspections += 1;
        return targetInspections === 3 ? { kind: "missing" } : actual;
      },
    };

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        { ...initial, durableFileSystem: boundary },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        initial,
      ),
    ).resolves.toMatchObject({ phase: "committed" });
  });

  it("revalidates a destination parent before recovery publication", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions", ".brain/runs"],
    });
    const initial = services(storage);
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
            sha256: storage.digests.sha256("state"),
          },
          stagedPath: "staging/operation-0001.payload",
          content: "state",
        },
      ],
    };
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 3,
    });
    await expect(
      executeManagedMutation(mutation, { rootMode: "existing" }, initial),
    ).rejects.toBeInstanceOf(Error);
    const [summary] = await inspectManagedTransactions(initial);
    const base = storage.durableFileSystem;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path) =>
        path === ".brain/runs" ? { kind: "missing" } : base.inspect(path),
    };

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        { ...initial, durableFileSystem: boundary },
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.snapshot().files).not.toHaveProperty(
      ".brain/runs/state.json",
    );
  });

  it("revalidates the manifest identity on the recovery read", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const initial = services(storage);
    storage.fail({
      operation: "sync_directory",
      timing: "after",
      occurrence: 6,
    });
    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        initial,
      ),
    ).rejects.toBeInstanceOf(Error);
    const manifestPath = ".brain/transactions/transaction-1/manifest.json";
    const persisted = storage.snapshot().files[manifestPath] ?? "null";
    const tampered = JSON.parse(persisted) as Record<string, unknown>;
    tampered.createdAt = "2026-08-09T00:00:01.000Z";
    const base = storage.durableFileSystem;
    let manifestReads = 0;
    const boundary: DurableFileSystem = {
      ...base,
      readText: async (path) => {
        const actual = await base.readText(path);
        if (path !== manifestPath) return actual;
        manifestReads += 1;
        return manifestReads === 2 ? `${canonicalizeJson(tampered)}\n` : actual;
      },
    };
    const [summary] = await inspectManagedTransactions(initial);

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        { ...initial, durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: manifestPath },
      ]),
    );
  });

  it("rejects a valid replacement identity between recovery inspection and drive", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const initial = services(storage);
    await executeManagedMutation(
      writePlan(storage, "old", "new"),
      { rootMode: "existing" },
      initial,
    );
    const [summary] = await inspectManagedTransactions(initial);
    const root = ".brain/transactions/transaction-1";
    const progressPath = `${root}/progress.json`;
    const manifestPath = `${root}/manifest.json`;
    const snapshot = storage.snapshot();
    const replacementManifest = JSON.parse(
      snapshot.files[manifestPath] ?? "null",
    ) as Record<string, unknown>;
    replacementManifest.createdAt = "2026-08-09T00:00:01.000Z";
    const manifestText = canonicalizeJson(replacementManifest);
    const manifestDigest = storage.digests.sha256(manifestText);
    const replacementProgress = JSON.parse(
      snapshot.files[progressPath] ?? "null",
    ) as Record<string, unknown>;
    replacementProgress.createdAt = "2026-08-09T00:00:01.000Z";
    replacementProgress.updatedAt = "2026-08-09T00:00:01.000Z";
    replacementProgress.manifestDigest = manifestDigest;
    replacementProgress.recoveryToken = manifestDigest;
    const progressText = canonicalizeJson(replacementProgress);
    const base = storage.durableFileSystem;
    let progressReads = 0;
    const boundary: DurableFileSystem = {
      ...base,
      readText: async (path) => {
        const actual = await base.readText(path);
        if (path !== progressPath) return actual;
        progressReads += 1;
        if (progressReads !== 2) return actual;
        await storage.fileSystem.write(manifestPath, `${manifestText}\n`);
        await storage.fileSystem.write(progressPath, `${progressText}\n`);
        return `${progressText}\n`;
      },
    };

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        { ...initial, durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.recovery_required", [
        { kind: "artifact", ref: progressPath },
      ]),
    );
  });

  it.each([
    {
      label: "atomic replacement",
      operation: "replace_file" as const,
      occurrence: 4,
    },
    {
      label: "published-directory synchronization",
      operation: "sync_directory" as const,
      occurrence: 8,
    },
  ])(
    "rolls forward after a failure following $label",
    async ({ operation, occurrence }) => {
      const storage = memoryTransactionStorage({
        directories: [".brain/transactions"],
        files: { ".brain/state.json": "old" },
      });
      const injected = services(storage);
      storage.fail({ operation, timing: "after", occurrence });

      await expect(
        executeManagedMutation(
          writePlan(storage, "old", "new"),
          { rootMode: "existing" },
          injected,
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
      expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
      const [summary] = await inspectManagedTransactions(injected);
      expect(summary?.phase).toBe("publishing");

      const first = await recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        injected,
      );
      const second = await recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: first.recoveryToken,
        },
        injected,
      );
      expect(first).toMatchObject({
        transactionId: "transaction-1",
        phase: "committed",
      });
      expect(second).toEqual(first);
      expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
    },
  );

  it("rolls forward when publishing became durable before the first target", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 3,
    });

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
    const [summary] = await inspectManagedTransactions(injected);
    expect(summary?.phase).toBe("publishing");

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        injected,
      ),
    ).resolves.toMatchObject({ phase: "committed" });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
  });

  it.each([
    { label: "altered", action: "alter" as const },
    { label: "missing", action: "remove" as const },
  ])(
    "blocks an $label payload introduced after recovery observation",
    async ({ action }) => {
      const storage = memoryTransactionStorage({
        directories: [".brain/transactions"],
        files: { ".brain/state.json": "old" },
      });
      const initial = services(storage);
      storage.fail({
        operation: "replace_file",
        timing: "after",
        occurrence: 3,
      });
      await expect(
        executeManagedMutation(
          writePlan(storage, "old", "new"),
          { rootMode: "existing" },
          initial,
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
      const [summary] = await inspectManagedTransactions(initial);
      const payload =
        ".brain/transactions/transaction-1/staging/operation-0001.payload";
      const base = storage.durableFileSystem;
      let observedPayload = false;
      let tampered = false;
      const boundary: DurableFileSystem = {
        ...base,
        inspect: async (path) => {
          if (path === payload) observedPayload = true;
          if (path === ".brain" && observedPayload && !tampered) {
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
        recoverManagedMutation(
          {
            transactionId: "transaction-1",
            recoveryToken: summary?.recoveryToken ?? "missing",
          },
          { ...initial, durableFileSystem: boundary },
        ),
      ).rejects.toEqual(
        new TransactionFailure("runtime.state_corrupt", [
          { kind: "artifact", ref: payload },
        ]),
      );
      expect(storage.snapshot().files[".brain/state.json"]).toBe("old");
    },
  );

  it("blocks target drift introduced after recovery observation", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const initial = services(storage);
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 3,
    });
    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        initial,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    const [summary] = await inspectManagedTransactions(initial);
    const payload =
      ".brain/transactions/transaction-1/staging/operation-0001.payload";
    const base = storage.durableFileSystem;
    let observedTarget = false;
    let observedPayload = false;
    let drifted = false;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path) => {
        if (path === ".brain/state.json") observedTarget = true;
        if (path === payload) observedPayload = true;
        if (
          path === ".brain" &&
          observedTarget &&
          observedPayload &&
          !drifted
        ) {
          drifted = true;
          await storage.fileSystem.write(".brain/state.json", "intruder");
        }
        return base.inspect(path);
      },
    };

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        { ...initial, durableFileSystem: boundary },
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: ".brain/state.json" },
      ]),
    );
    expect(storage.snapshot().files[".brain/state.json"]).toBe("intruder");
  });

  it("records a target that reached its result after recovery observation", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const initial = services(storage);
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 3,
    });
    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        initial,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    const [summary] = await inspectManagedTransactions(initial);
    const payload =
      ".brain/transactions/transaction-1/staging/operation-0001.payload";
    const base = storage.durableFileSystem;
    let observedTarget = false;
    let observedPayload = false;
    let publishedExternally = false;
    const boundary: DurableFileSystem = {
      ...base,
      inspect: async (path) => {
        if (path === ".brain/state.json") observedTarget = true;
        if (path === payload) observedPayload = true;
        if (
          path === ".brain" &&
          observedTarget &&
          observedPayload &&
          !publishedExternally
        ) {
          publishedExternally = true;
          await storage.fileSystem.write(".brain/state.json", "new");
          await base.removeFile(payload);
        }
        return base.inspect(path);
      },
    };

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        { ...initial, durableFileSystem: boundary },
      ),
    ).resolves.toMatchObject({ phase: "committed" });
    expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
  });

  it("blocks roll-forward when a later destination is unexpected", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: {
        ".brain/state.json": "old",
        ".brain/second.json": "second",
      },
    });
    const injected = services(storage);
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 4,
    });
    await expect(
      executeManagedMutation(
        twoWritePlan(storage),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    await storage.fileSystem.write(".brain/second.json", "intruder");
    const [summary] = await inspectManagedTransactions(injected);
    const before = storage.snapshot();

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-1",
          recoveryToken: summary?.recoveryToken ?? "missing",
        },
        injected,
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: ".brain/second.json" },
      ]),
    );
    expect(storage.snapshot()).toEqual(before);
    expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
    expect(storage.snapshot().files[".brain/second.json"]).toBe("intruder");
  });

  it("finishes cleanup after committed progress became durable", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "remove_empty_directory",
      timing: "before",
      occurrence: 1,
    });

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    const [summary] = await inspectManagedTransactions(injected);
    expect(summary?.phase).toBe("committed");
    expect(storage.snapshot().directories).toContain(
      ".brain/transactions/transaction-1/staging",
    );

    const receipt = await recoverManagedMutation(
      {
        transactionId: "transaction-1",
        recoveryToken: summary?.recoveryToken ?? "missing",
      },
      injected,
    );
    expect(receipt.phase).toBe("committed");
    expect(storage.snapshot().directories).not.toContain(
      ".brain/transactions/transaction-1/staging",
    );
  });

  it("reconstructs the terminal receipt when recovery cleanup completed before an error", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "remove_empty_directory",
      timing: "before",
      occurrence: 1,
    });
    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    const [summary] = await inspectManagedTransactions(injected);
    storage.fail({
      operation: "remove_empty_directory",
      timing: "after",
      occurrence: 2,
    });

    const first = await recoverManagedMutation(
      {
        transactionId: "transaction-1",
        recoveryToken: summary?.recoveryToken ?? "missing",
      },
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

  it("persists unsupported directory sync discovered by recovery cleanup", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const initial = services(storage);
    storage.fail({
      operation: "remove_empty_directory",
      timing: "before",
      occurrence: 1,
    });
    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        initial,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    const [summary] = await inspectManagedTransactions(initial);
    const root = ".brain/transactions/transaction-1";
    const staging = `${root}/staging`;
    const base = storage.durableFileSystem;
    const boundary: DurableFileSystem = {
      ...base,
      syncDirectory: async (path) => {
        await base.syncDirectory(path);
        return path === root && (await base.inspect(staging)).kind === "missing"
          ? "unsupported"
          : "supported";
      },
    };
    const injected = { ...initial, durableFileSystem: boundary };

    const first = await recoverManagedMutation(
      {
        transactionId: "transaction-1",
        recoveryToken: summary?.recoveryToken ?? "missing",
      },
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

  it("requires recovery before another mutation can use an incomplete marker", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "sync_directory",
      timing: "after",
      occurrence: 6,
    });
    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toBeInstanceOf(Error);

    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "other"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.recovery_required", [
        {
          kind: "artifact",
          ref: ".brain/transactions/transaction-1/progress.json",
        },
      ]),
    );
  });

  it("requires recovery before another mutation when terminal scratch remains", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    const receipt = await executeManagedMutation(
      writePlan(storage, "old", "new"),
      { rootMode: "existing" },
      injected,
    );
    await storage.fileSystem.write(
      `.brain/transactions/${receipt.transactionId}/progress.next`,
      "scratch",
    );

    await expect(
      executeManagedMutation(
        writePlan(storage, "new", "newer"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
  });

  it("refuses stale recovery identity without changing the marker", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "old" },
    });
    const injected = services(storage);
    storage.fail({
      operation: "sync_directory",
      timing: "after",
      occurrence: 6,
    });
    await expect(
      executeManagedMutation(
        writePlan(storage, "old", "new"),
        { rootMode: "existing" },
        injected,
      ),
    ).rejects.toBeInstanceOf(Error);
    const before = storage.snapshot();

    await expect(
      recoverManagedMutation(
        { transactionId: "transaction-1", recoveryToken: "f".repeat(64) },
        injected,
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.recovery_required",
    });
    await expect(
      recoverManagedMutation(
        { transactionId: "transaction-stale", recoveryToken: "f".repeat(64) },
        injected,
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.recovery_required",
    });
    expect(storage.snapshot()).toEqual(before);
  });

  it("reports a missing recovery transaction as corrupt when no marker is active", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });

    await expect(
      recoverManagedMutation(
        {
          transactionId: "transaction-missing",
          recoveryToken: "f".repeat(64),
        },
        services(storage),
      ),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        {
          kind: "artifact",
          ref: ".brain/transactions/transaction-missing",
        },
      ]),
    );
  });
});
