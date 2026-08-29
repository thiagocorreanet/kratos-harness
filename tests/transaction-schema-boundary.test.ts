import {
  canonicalizeJson,
  type SchemaRegistry,
} from "@kratos/runtime/domain/schema";
import {
  executeManagedMutation,
  inspectManagedTransactions,
  TransactionFailure,
  type TransactionServices,
} from "@kratos/runtime/composition";
import type { ManagedMutationPlan } from "@kratos/runtime/domain/transactions";
import {
  fixedClock,
  memoryTransactionStorage,
  sequentialIds,
} from "@kratos/runtime/infra/fake";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { describe, expect, it } from "vitest";

function plan(
  storage: ReturnType<typeof memoryTransactionStorage>,
): ManagedMutationPlan {
  return {
    operations: [
      {
        operationId: "operation-0001",
        kind: "write_file",
        path: ".brain/state.json",
        expected: { kind: "missing" },
        result: {
          kind: "file",
          size: 6,
          sha256: storage.digests.sha256("secret"),
        },
        stagedPath: "staging/operation-0001.payload",
        content: "secret",
      },
    ],
  };
}

function services(
  storage: ReturnType<typeof memoryTransactionStorage>,
  schemaRegistry: SchemaRegistry,
): TransactionServices {
  return {
    clock: fixedClock("2026-08-09T00:00:00.000Z"),
    ids: sequentialIds("transaction"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    schemaRegistry,
  };
}

describe("transaction schema boundary", () => {
  it("uses the injected registry for every persisted and inspected contract", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const production = createSchemaRegistry();
    const requests: { readonly id: string; readonly version: unknown }[] = [];
    const tracking: SchemaRegistry = {
      validate: ((request: {
        readonly id: string;
        readonly version: unknown;
      }) => {
        requests.push({ id: request.id, version: request.version });
        return (production.validate as (request: unknown) => unknown)(request);
      }) as SchemaRegistry["validate"],
    };
    const injected = services(storage, tracking);

    await executeManagedMutation(
      plan(storage),
      { rootMode: "existing" },
      injected,
    );
    const writes = [...requests];
    requests.length = 0;
    await inspectManagedTransactions(injected);

    expect(writes.map(({ id }) => id)).toContain("state.transaction-manifest");
    expect(
      writes.filter(({ id }) => id === "state.transaction-progress").length,
    ).toBeGreaterThan(4);
    expect(
      writes.filter(
        ({ id }) =>
          id === "state.transaction-manifest" ||
          id === "state.transaction-progress",
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "state.transaction-manifest",
          version: "1.0.0",
        }),
        expect.objectContaining({
          id: "state.transaction-progress",
          version: "1.0.0",
        }),
      ]),
    );
    expect(requests).toEqual([
      { id: "state.transaction-progress", version: "1.0.0" },
      { id: "state.transaction-manifest", version: "1.0.0" },
    ]);
  });

  it("rejects non-canonical persisted progress without exposing payloads", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const injected = services(storage, createSchemaRegistry());
    await executeManagedMutation(
      plan(storage),
      { rootMode: "existing" },
      injected,
    );
    const progressPath = ".brain/transactions/transaction-1/progress.json";
    const progress = storage.snapshot().files[progressPath] ?? "{}";
    await storage.fileSystem.write(progressPath, ` ${progress}`);

    await expect(inspectManagedTransactions(injected)).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: progressPath },
      ]),
    );
    expect(JSON.stringify(await inspectFailure(injected))).not.toContain(
      "secret",
    );
  });

  it.each([
    {
      label: "plan digest",
      mutate: (manifest: Record<string, unknown>) => {
        manifest.planDigest = "f".repeat(64);
      },
    },
    {
      label: "staged payload namespace",
      mutate: (manifest: Record<string, unknown>) => {
        const operations = manifest.operations as Record<string, unknown>[];
        const operation = operations[0];
        if (operation !== undefined) {
          operation.stagedPath = ".brain/outside-staging.payload";
        }
      },
    },
    {
      label: "operation identity",
      mutate: (manifest: Record<string, unknown>) => {
        const operations = manifest.operations as Record<string, unknown>[];
        const operation = operations[0];
        if (operation !== undefined) operation.operationId = "operation-9999";
      },
    },
    ...[
      "",
      ".brain\\escape",
      "C:/escape",
      ".brain/control\npath",
      ".brain/transactions/escape",
    ].map((path) => ({
      label: `managed destination ${JSON.stringify(path)}`,
      mutate: (manifest: Record<string, unknown>) => {
        const operations = manifest.operations as Record<string, unknown>[];
        const operation = operations[0];
        if (operation !== undefined) operation.path = path;
      },
    })),
    {
      label: "create-directory fingerprints",
      mutate: (manifest: Record<string, unknown>) => {
        const operations = manifest.operations as Record<string, unknown>[];
        const operation = operations[0];
        if (operation !== undefined) {
          operation.kind = "create_directory";
          operation.stagedPath = null;
        }
      },
    },
    {
      label: "delete-file fingerprints",
      mutate: (manifest: Record<string, unknown>) => {
        const operations = manifest.operations as Record<string, unknown>[];
        const operation = operations[0];
        if (operation !== undefined) {
          operation.kind = "delete_file";
          operation.stagedPath = null;
        }
      },
    },
  ])("rejects a manifest with a forged $label", async ({ mutate }) => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const injected = services(storage, createSchemaRegistry());
    await executeManagedMutation(
      plan(storage),
      { rootMode: "existing" },
      injected,
    );
    const root = ".brain/transactions/transaction-1";
    const manifestPath = `${root}/manifest.json`;
    const progressPath = `${root}/progress.json`;
    const manifest = JSON.parse(
      storage.snapshot().files[manifestPath] ?? "null",
    ) as Record<string, unknown>;
    mutate(manifest);
    const manifestText = canonicalizeJson(manifest);
    const digest = storage.digests.sha256(manifestText);
    const progress = JSON.parse(
      storage.snapshot().files[progressPath] ?? "null",
    ) as Record<string, unknown>;
    progress.manifestDigest = digest;
    progress.recoveryToken = digest;
    await storage.fileSystem.write(manifestPath, `${manifestText}\n`);
    await storage.fileSystem.write(
      progressPath,
      `${canonicalizeJson(progress)}\n`,
    );

    await expect(inspectManagedTransactions(injected)).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: manifestPath },
      ]),
    );
  });

  it.each([
    {
      label: "missing managed root",
      seed: {},
      expected: [] as const,
    },
    {
      label: "missing transaction namespace",
      seed: { directories: [".brain"] },
      expected: [] as const,
    },
  ])("reports no markers for a $label", async ({ seed, expected }) => {
    const storage = memoryTransactionStorage(seed);
    await expect(
      inspectManagedTransactions(services(storage, createSchemaRegistry())),
    ).resolves.toEqual(expected);
  });

  it.each([
    {
      label: "managed root file",
      seed: { files: { ".brain": "file" } },
      evidenceRef: ".brain",
    },
    {
      label: "transaction namespace file",
      seed: { files: { ".brain/transactions": "file" } },
      evidenceRef: ".brain/transactions",
    },
    {
      label: "transaction entry file",
      seed: { files: { ".brain/transactions/transaction-1": "file" } },
      evidenceRef: ".brain/transactions/transaction-1",
    },
  ])("rejects a $label", async ({ seed, evidenceRef }) => {
    const storage = memoryTransactionStorage(seed);
    await expect(
      inspectManagedTransactions(services(storage, createSchemaRegistry())),
    ).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: evidenceRef },
      ]),
    );
  });

  it.each([
    {
      label: "unknown transaction entry",
      path: ".brain/transactions/transaction-1/unknown",
      kind: "file" as const,
      evidenceRef: ".brain/transactions/transaction-1",
    },
    {
      label: "directory manifest",
      path: ".brain/transactions/transaction-1/manifest.json",
      kind: "directory" as const,
      evidenceRef: ".brain/transactions/transaction-1/manifest.json",
    },
    {
      label: "file staging root",
      path: ".brain/transactions/transaction-1/staging",
      kind: "file" as const,
      evidenceRef: ".brain/transactions/transaction-1/staging",
    },
  ])("rejects a $label in a receipt", async ({ path, kind, evidenceRef }) => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const injected = services(storage, createSchemaRegistry());
    await executeManagedMutation(
      plan(storage),
      { rootMode: "existing" },
      injected,
    );
    if (kind === "directory") {
      await storage.fileSystem.remove(path);
      await storage.fileSystem.makeDirectory(path);
    } else {
      await storage.fileSystem.write(path, "unexpected");
    }

    await expect(inspectManagedTransactions(injected)).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: evidenceRef },
      ]),
    );
  });

  it.each([
    { label: "invalid JSON", text: "{\n" },
    { label: "schema-invalid JSON", text: "{}\n" },
  ])("rejects $label in progress", async ({ text }) => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const injected = services(storage, createSchemaRegistry());
    await executeManagedMutation(
      plan(storage),
      { rootMode: "existing" },
      injected,
    );
    const progressPath = ".brain/transactions/transaction-1/progress.json";
    await storage.fileSystem.write(progressPath, text);

    await expect(inspectManagedTransactions(injected)).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: progressPath },
      ]),
    );
  });

  it("rejects a schema-invalid manifest from the injected registry before publication", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const production = createSchemaRegistry();
    const rejecting: SchemaRegistry = {
      validate: ((request: { readonly id: string }) =>
        request.id === "state.transaction-manifest"
          ? { kind: "invalid", diagnostics: [] }
          : (production.validate as (request: unknown) => unknown)(
              request,
            )) as SchemaRegistry["validate"],
    };

    await expect(
      executeManagedMutation(
        plan(storage),
        { rootMode: "existing" },
        services(storage, rejecting),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.snapshot().files).not.toHaveProperty(".brain/state.json");
  });

  it.each([
    {
      label: "directory identity",
      mutate: (progress: Record<string, unknown>) => {
        progress.transactionId = "transaction-other";
      },
      removeManifest: false,
    },
    {
      label: "recovery token",
      mutate: (progress: Record<string, unknown>) => {
        progress.recoveryToken = "f".repeat(64);
      },
      removeManifest: false,
    },
    {
      label: "required manifest",
      mutate: () => undefined,
      removeManifest: true,
    },
  ])(
    "rejects a progress marker with a forged $label",
    async ({ mutate, removeManifest }) => {
      const storage = memoryTransactionStorage({
        directories: [".brain/transactions"],
      });
      const injected = services(storage, createSchemaRegistry());
      await executeManagedMutation(
        plan(storage),
        { rootMode: "existing" },
        injected,
      );
      const root = ".brain/transactions/transaction-1";
      const progressPath = `${root}/progress.json`;
      const manifestPath = `${root}/manifest.json`;
      const progress = JSON.parse(
        storage.snapshot().files[progressPath] ?? "null",
      ) as Record<string, unknown>;
      mutate(progress);
      await storage.fileSystem.write(
        progressPath,
        `${canonicalizeJson(progress)}\n`,
      );
      if (removeManifest) await storage.fileSystem.remove(manifestPath);

      await expect(inspectManagedTransactions(injected)).rejects.toMatchObject({
        reasonCode: "runtime.state_corrupt",
      });
    },
  );

  it("rejects a manifest whose identity changed without a matching progress digest", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const injected = services(storage, createSchemaRegistry());
    await executeManagedMutation(
      plan(storage),
      { rootMode: "existing" },
      injected,
    );
    const manifestPath = ".brain/transactions/transaction-1/manifest.json";
    const manifest = JSON.parse(
      storage.snapshot().files[manifestPath] ?? "null",
    ) as Record<string, unknown>;
    manifest.createdAt = "2026-08-09T00:00:01.000Z";
    await storage.fileSystem.write(
      manifestPath,
      `${canonicalizeJson(manifest)}\n`,
    );

    await expect(inspectManagedTransactions(injected)).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: manifestPath },
      ]),
    );
  });

  it("rejects an empty managed plan before writing a manifest", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });

    await expect(
      executeManagedMutation(
        { operations: [] },
        { rootMode: "existing" },
        services(storage, createSchemaRegistry()),
      ),
    ).rejects.toEqual(new TransactionFailure("runtime.state_corrupt", []));
    expect(storage.snapshot().files).not.toHaveProperty(
      ".brain/transactions/transaction-1/manifest.json",
    );
  });

  it("rejects a forged begun recovery token", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const injected = services(storage, createSchemaRegistry());
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 1,
    });
    await expect(
      executeManagedMutation(plan(storage), { rootMode: "existing" }, injected),
    ).rejects.toBeInstanceOf(Error);
    const progressPath = ".brain/transactions/transaction-1/progress.json";
    const progress = JSON.parse(
      storage.snapshot().files[progressPath] ?? "null",
    ) as Record<string, unknown>;
    progress.recoveryToken = "f".repeat(64);
    await storage.fileSystem.write(
      progressPath,
      `${canonicalizeJson(progress)}\n`,
    );

    await expect(inspectManagedTransactions(injected)).rejects.toEqual(
      new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: progressPath },
      ]),
    );
  });

  it("sanitizes an unexpected injected registry failure while inspecting", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    await executeManagedMutation(
      plan(storage),
      { rootMode: "existing" },
      services(storage, createSchemaRegistry()),
    );
    const throwing: SchemaRegistry = {
      validate: () => {
        throw new Error("registry detail");
      },
    };

    await expect(
      inspectManagedTransactions(services(storage, throwing)),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
  });

  it("sanitizes an unexpected manifest-registry failure while inspecting", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
    });
    const production = createSchemaRegistry();
    await executeManagedMutation(
      plan(storage),
      { rootMode: "existing" },
      services(storage, production),
    );
    const throwing: SchemaRegistry = {
      validate: ((request: { readonly id: string }) => {
        if (request.id === "state.transaction-manifest") {
          throw new Error("registry detail");
        }
        return (production.validate as (request: unknown) => unknown)(request);
      }) as SchemaRegistry["validate"],
    };

    await expect(
      inspectManagedTransactions(services(storage, throwing)),
    ).rejects.toEqual(new TransactionFailure("runtime.internal_failure", []));
  });
});

async function inspectFailure(injected: TransactionServices): Promise<unknown> {
  try {
    await inspectManagedTransactions(injected);
    return null;
  } catch (error) {
    return error;
  }
}
