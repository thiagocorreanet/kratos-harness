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
    operation: "link_file_exclusive",
    seed: { files: { ".brain/source": "new" } },
    run: (storage) =>
      storage.durableFileSystem.linkFileExclusive(
        ".brain/source",
        ".brain/tombstone",
      ),
    before: {
      files: { ".brain/source": "new" },
      directories: [".brain"],
    },
    after: {
      files: { ".brain/source": "new", ".brain/tombstone": "new" },
      directories: [".brain"],
    },
  },
  {
    operation: "rename_directory_exclusive",
    seed: {
      directories: [".brain", ".brain/candidate", ".brain/candidate/run"],
      files: { ".brain/candidate/run/claim.json": "new" },
    },
    run: (storage) =>
      storage.durableFileSystem.renameDirectoryExclusive(
        ".brain/candidate",
        ".brain/published",
      ),
    before: {
      files: { ".brain/candidate/run/claim.json": "new" },
      directories: [".brain", ".brain/candidate", ".brain/candidate/run"],
    },
    after: {
      files: { ".brain/published/run/claim.json": "new" },
      directories: [".brain", ".brain/published", ".brain/published/run"],
    },
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

  it.each([
    {
      label: "write",
      mutate: (storage: MemoryTransactionStorage) =>
        storage.fileSystem.write(".brain/blocker/child.json", "child"),
    },
    {
      label: "makeDirectory",
      mutate: (storage: MemoryTransactionStorage) =>
        storage.fileSystem.makeDirectory(".brain/blocker/child"),
    },
  ])(
    "$label refuses a file ancestor without changing the shared model",
    async ({ mutate }) => {
      const storage = memoryTransactionStorage({
        files: { ".brain/blocker": "unchanged" },
      });
      const before = storage.snapshot();
      const encodedBefore = JSON.stringify(before);

      await expect(mutate(storage)).rejects.toThrow("file ancestor");

      expect(storage.snapshot()).toEqual(before);
      expect(JSON.stringify(storage.snapshot())).toBe(encodedBefore);
      await expect(
        storage.durableFileSystem.inspect(".brain/blocker"),
      ).resolves.toMatchObject({ kind: "file" });
      await expect(storage.durableFileSystem.list(".brain")).resolves.toEqual([
        "blocker",
      ]);
      await expect(
        storage.durableFileSystem.inspect(".brain/blocker/child"),
      ).resolves.toEqual({ kind: "missing" });
    },
  );

  it.each([
    {
      label: "unsafe directory",
      seed: { directories: ["../outside"] },
      message: "escapes the project",
    },
    {
      label: "unsafe file",
      seed: { files: { "/outside": "content" } },
      message: "escapes the project",
    },
    {
      label: "file and directory at the same path",
      seed: {
        directories: [".brain/conflict"],
        files: { ".brain/conflict": "content" },
      },
      message: "conflicting entries",
    },
    {
      label: "file below a file",
      seed: {
        files: {
          ".brain/file": "parent",
          ".brain/file/child": "child",
        },
      },
      message: "file ancestor",
    },
  ])("rejects a $label seed", ({ seed, message }) => {
    expect(() => memoryTransactionStorage(seed)).toThrow(message);
  });

  it("normalizes harmless separators without creating duplicate entries", async () => {
    const storage = memoryTransactionStorage();

    await storage.fileSystem.write(".brain//./state.json", "state");

    expect(storage.snapshot()).toEqual({
      files: { ".brain/state.json": "state" },
      directories: [".brain"],
    });
  });

  it.each([
    {
      label: "write over a directory",
      seed: { directories: [".brain/entry"] },
      mutate: (storage: MemoryTransactionStorage) =>
        storage.fileSystem.write(".brain/entry", "content"),
      message: "directory",
    },
    {
      label: "makeDirectory over a file",
      seed: { files: { ".brain/entry": "content" } },
      mutate: (storage: MemoryTransactionStorage) =>
        storage.fileSystem.makeDirectory(".brain/entry"),
      message: "file",
    },
  ])(
    "refuses $label without changing storage",
    async ({ seed, mutate, message }) => {
      const storage = memoryTransactionStorage(seed);
      const before = storage.snapshot();

      await expect(mutate(storage)).rejects.toThrow(message);

      expect(storage.snapshot()).toEqual(before);
    },
  );

  it("removes a complete subtree through the simple view", async () => {
    const storage = memoryTransactionStorage({
      directories: [".brain/remove/deep", ".brain/keep"],
      files: {
        ".brain/remove/a.json": "a",
        ".brain/remove/deep/b.json": "b",
        ".brain/keep/state.json": "keep",
      },
    });

    await storage.fileSystem.remove(".brain/remove");

    expect(storage.snapshot()).toEqual({
      files: { ".brain/keep/state.json": "keep" },
      directories: [".brain", ".brain/keep"],
    });
  });

  it.each([
    {
      label: "file",
      seed: { files: { ".brain/entry": "old" } },
    },
    {
      label: "directory",
      seed: { directories: [".brain/entry"] },
    },
  ])("writeSynced refuses an existing $label", async ({ seed }) => {
    const storage = memoryTransactionStorage(seed);
    const before = storage.snapshot();

    await expect(
      storage.durableFileSystem.writeSynced(".brain/entry", "new"),
    ).rejects.toThrow("already has an entry");

    expect(storage.snapshot()).toEqual(before);
    expect(storage.calls()).toEqual(["open_file"]);
  });

  it("createDirectory refuses to replace a file", async () => {
    const storage = memoryTransactionStorage({
      files: { ".brain/entry": "content" },
    });
    const before = storage.snapshot();

    await expect(
      storage.durableFileSystem.createDirectory(".brain/entry"),
    ).rejects.toThrow("has a file");

    expect(storage.snapshot()).toEqual(before);
  });

  it("createDirectoryExclusive refuses to replace a file", async () => {
    const storage = memoryTransactionStorage({
      files: { ".brain/entry": "content" },
    });
    const before = storage.snapshot();

    await expect(
      storage.durableFileSystem.createDirectoryExclusive(".brain/entry"),
    ).rejects.toThrow("already has an entry");

    expect(storage.snapshot()).toEqual(before);
  });

  it.each([
    {
      label: "staged path is a directory",
      seed: {
        directories: [".brain/staged"],
        files: { ".brain/target": "old" },
      },
      message: "no file",
    },
    {
      label: "target path is a directory",
      seed: {
        directories: [".brain/target"],
        files: { ".brain/staged": "new" },
      },
      message: "has a directory",
    },
  ])("replaceFile refuses when the $label", async ({ seed, message }) => {
    const storage = memoryTransactionStorage(seed);
    const before = storage.snapshot();

    await expect(
      storage.durableFileSystem.replaceFile(".brain/staged", ".brain/target"),
    ).rejects.toThrow(message);

    expect(storage.snapshot()).toEqual(before);
  });

  it("rejects the project root as a durable entry path", async () => {
    await expect(
      memoryTransactionStorage().durableFileSystem.inspect("."),
    ).rejects.toThrow("escapes the project");
  });

  it("synchronizes the implicit project root without materializing it", async () => {
    const storage = memoryTransactionStorage();

    await expect(storage.durableFileSystem.syncDirectory(".")).resolves.toBe(
      "supported",
    );

    expect(storage.snapshot()).toEqual(empty);
    expect(storage.calls()).toEqual(["sync_directory"]);
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
    const rule = {
      operation: "inspect" as const,
      timing: "before" as const,
      occurrence: 2,
    };
    storage.fail(rule);

    await expect(
      storage.durableFileSystem.inspect(".brain/missing"),
    ).resolves.toEqual({ kind: "missing" });
    await expect(
      storage.durableFileSystem.inspect(".brain/missing"),
    ).rejects.toThrow("Injected durable filesystem failure");
    await expect(
      storage.durableFileSystem.inspect(".brain/missing"),
    ).resolves.toEqual({ kind: "missing" });
    expect(storage.failureHits()).toEqual([rule]);
  });

  it("returns isolated readonly evidence for reached failure rules", async () => {
    const storage = memoryTransactionStorage();
    const rule = {
      operation: "inspect" as const,
      timing: "after" as const,
      occurrence: 1,
      fault: "permission" as const,
    };
    storage.fail(rule);

    await expect(
      storage.durableFileSystem.inspect(".brain/state.json"),
    ).rejects.toThrow("permission");
    const first = storage.failureHits();
    expect(first).toEqual([rule]);

    (first as (typeof rule)[]).push({ ...rule });
    expect(storage.failureHits()).toEqual([rule]);
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

  it("rejects a fractional occurrence", () => {
    const storage = memoryTransactionStorage();
    expect(() => {
      storage.fail({
        operation: "inspect",
        timing: "before",
        occurrence: 1.5,
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
