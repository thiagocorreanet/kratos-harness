import {
  type DurableOperation,
  type MemoryTransactionStorage,
  memoryTransactionStorage,
} from "@mestre-yoda/runtime/infra/fake";
import { describe, expect, it } from "vitest";

interface StorageSnapshot {
  readonly files: Readonly<Record<string, string>>;
  readonly directories: readonly string[];
}

interface OperationCase {
  readonly operation: DurableOperation;
  readonly seed?: Parameters<typeof memoryTransactionStorage>[0];
  readonly run: (storage: MemoryTransactionStorage) => Promise<unknown>;
  readonly before: StorageSnapshot;
  readonly after: StorageSnapshot;
}

const empty: StorageSnapshot = { files: {}, directories: [] };
const brain: StorageSnapshot = { files: {}, directories: [".brain"] };
const written: StorageSnapshot = {
  files: { ".brain/state.json": "new" },
  directories: [".brain"],
};

const cases: readonly OperationCase[] = [
  {
    operation: "inspect",
    seed: { files: { ".brain/state.json": "old" } },
    run: (storage) => storage.durableFileSystem.inspect(".brain/state.json"),
    before: {
      files: { ".brain/state.json": "old" },
      directories: [".brain"],
    },
    after: {
      files: { ".brain/state.json": "old" },
      directories: [".brain"],
    },
  },
  {
    operation: "list",
    seed: { files: { ".brain/state.json": "old" } },
    run: (storage) => storage.durableFileSystem.list(".brain"),
    before: {
      files: { ".brain/state.json": "old" },
      directories: [".brain"],
    },
    after: {
      files: { ".brain/state.json": "old" },
      directories: [".brain"],
    },
  },
  {
    operation: "read_text",
    seed: { files: { ".brain/state.json": "old" } },
    run: (storage) => storage.durableFileSystem.readText(".brain/state.json"),
    before: {
      files: { ".brain/state.json": "old" },
      directories: [".brain"],
    },
    after: {
      files: { ".brain/state.json": "old" },
      directories: [".brain"],
    },
  },
  {
    operation: "create_directory",
    run: (storage) => storage.durableFileSystem.createDirectory(".brain"),
    before: empty,
    after: brain,
  },
  {
    operation: "create_directory_exclusive",
    run: (storage) =>
      storage.durableFileSystem.createDirectoryExclusive(".brain"),
    before: empty,
    after: brain,
  },
  {
    operation: "open_file",
    seed: { directories: [".brain"] },
    run: (storage) =>
      storage.durableFileSystem.writeSynced(".brain/state.json", "new"),
    before: brain,
    after: {
      files: { ".brain/state.json": "" },
      directories: [".brain"],
    },
  },
  {
    operation: "write_file",
    seed: { directories: [".brain"] },
    run: (storage) =>
      storage.durableFileSystem.writeSynced(".brain/state.json", "new"),
    before: {
      files: { ".brain/state.json": "" },
      directories: [".brain"],
    },
    after: written,
  },
  {
    operation: "sync_file",
    seed: { directories: [".brain"] },
    run: (storage) =>
      storage.durableFileSystem.writeSynced(".brain/state.json", "new"),
    before: written,
    after: written,
  },
  {
    operation: "close_file",
    seed: { directories: [".brain"] },
    run: (storage) =>
      storage.durableFileSystem.writeSynced(".brain/state.json", "new"),
    before: written,
    after: written,
  },
  {
    operation: "replace_file",
    seed: {
      files: {
        ".brain/staged": "new",
        ".brain/state.json": "old",
      },
    },
    run: (storage) =>
      storage.durableFileSystem.replaceFile(
        ".brain/staged",
        ".brain/state.json",
      ),
    before: {
      files: {
        ".brain/staged": "new",
        ".brain/state.json": "old",
      },
      directories: [".brain"],
    },
    after: written,
  },
  {
    operation: "remove_file",
    seed: { files: { ".brain/state.json": "old" } },
    run: (storage) => storage.durableFileSystem.removeFile(".brain/state.json"),
    before: {
      files: { ".brain/state.json": "old" },
      directories: [".brain"],
    },
    after: brain,
  },
  {
    operation: "remove_empty_directory",
    seed: { directories: [".brain", ".brain/empty"] },
    run: (storage) =>
      storage.durableFileSystem.removeEmptyDirectory(".brain/empty"),
    before: {
      files: {},
      directories: [".brain", ".brain/empty"],
    },
    after: brain,
  },
  {
    operation: "sync_directory",
    seed: { directories: [".brain"] },
    run: (storage) => storage.durableFileSystem.syncDirectory(".brain"),
    before: brain,
    after: brain,
  },
];

describe("memory transaction storage", () => {
  it("shares seeded files and directories between simple and durable views", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/transactions"],
      files: { ".brain/state.json": "seeded" },
    });

    expect(await storage.fileSystem.read(".brain/state.json")).toBe("seeded");
    await storage.fileSystem.write(".brain/simple.json", "simple");
    expect(await storage.durableFileSystem.readText(".brain/simple.json")).toBe(
      "simple",
    );
    await storage.durableFileSystem.writeSynced(
      ".brain/durable.json",
      "durable",
    );
    expect(await storage.fileSystem.read(".brain/durable.json")).toBe(
      "durable",
    );
    expect(storage.snapshot().directories).toEqual([
      ".brain",
      ".brain/transactions",
    ]);
  });

  it("returns detached snapshots and call traces", async () => {
    const storage = memoryTransactionStorage({ directories: [".brain"] });
    const snapshot = storage.snapshot();
    const calls = storage.calls();

    await storage.durableFileSystem.writeSynced(".brain/state.json", "new");

    expect(snapshot).toEqual(brain);
    expect(calls).toEqual([]);
    expect(storage.snapshot()).toEqual(written);
    expect(storage.calls()).toEqual([
      "open_file",
      "write_file",
      "sync_file",
      "close_file",
    ]);
  });

  it("provides the same deterministic SHA-256 capability as production", () => {
    expect(memoryTransactionStorage().digests.sha256("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("models an ambiguous failure after atomic replacement", async () => {
    const storage = memoryTransactionStorage({ directories: [".brain"] });
    storage.fail({
      operation: "replace_file",
      timing: "after",
      occurrence: 1,
    });
    await storage.durableFileSystem.writeSynced(".brain/staged", "new");

    await expect(
      storage.durableFileSystem.replaceFile(
        ".brain/staged",
        ".brain/state.json",
      ),
    ).rejects.toThrow("Injected durable filesystem failure");
    expect(storage.snapshot().files[".brain/state.json"]).toBe("new");
    expect(storage.snapshot().files).not.toHaveProperty(".brain/staged");
  });

  it.each(cases)(
    "$operation fails before its effect at the selected boundary",
    async ({ operation, seed, run, before }) => {
      const storage = memoryTransactionStorage(seed);
      storage.fail({ operation, timing: "before", occurrence: 1 });

      await expect(run(storage)).rejects.toThrow(
        "Injected durable filesystem failure",
      );

      expect(storage.snapshot()).toEqual(before);
      expect(storage.calls()).toContain(operation);
    },
  );

  it.each(cases)(
    "$operation fails after exposing its completed effect",
    async ({ operation, seed, run, after }) => {
      const storage = memoryTransactionStorage(seed);
      storage.fail({ operation, timing: "after", occurrence: 1 });

      await expect(run(storage)).rejects.toThrow(
        "Injected durable filesystem failure",
      );

      expect(storage.snapshot()).toEqual(after);
      expect(storage.calls()).toContain(operation);
    },
  );

  it("targets an exact occurrence once", async () => {
    const storage = memoryTransactionStorage({ directories: [".brain"] });
    storage.fail({ operation: "inspect", timing: "before", occurrence: 2 });

    await expect(
      storage.durableFileSystem.inspect(".brain/missing"),
    ).resolves.toEqual({ kind: "missing" });
    await expect(
      storage.durableFileSystem.inspect(".brain/missing"),
    ).rejects.toThrow("Injected durable filesystem failure");
    await expect(
      storage.durableFileSystem.inspect(".brain/missing"),
    ).resolves.toEqual({ kind: "missing" });
  });

  it.each(["permission", "disk_full"] as const)(
    "retains the sanitized %s fault label",
    async (fault) => {
      const storage = memoryTransactionStorage();
      storage.fail({
        operation: "inspect",
        timing: "before",
        occurrence: 1,
        fault,
      });

      await expect(
        storage.durableFileSystem.inspect(".brain/state.json"),
      ).rejects.toThrow(fault);
    },
  );

  it("rejects a non-positive occurrence", () => {
    const storage = memoryTransactionStorage();
    expect(() => {
      storage.fail({
        operation: "inspect",
        timing: "before",
        occurrence: 0,
      });
    }).toThrow("positive integer");
  });

  it("records operation names without paths or content", async () => {
    const storage = memoryTransactionStorage({ directories: [".brain"] });
    const secret = "never-record-this-content";
    const path = ".brain/never-record-this-path.json";

    await storage.durableFileSystem.writeSynced(path, secret);
    await storage.durableFileSystem.inspect(path);

    const trace = JSON.stringify(storage.calls());
    expect(trace).not.toContain(secret);
    expect(trace).not.toContain(path);
    expect(storage.calls()).toEqual([
      "open_file",
      "write_file",
      "sync_file",
      "close_file",
      "inspect",
    ]);
  });
});
