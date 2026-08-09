import type { DurableFileSystem } from "@mestre-yoda/runtime/ports";
import { describe, expect, it } from "vitest";

import type { Disposable } from "./port-contracts.js";

const helloDigest =
  "3c48591d8d098a4538f5e013dfcf406e948eac4d3277b10bf614e295d6068179";
const replacementDigest =
  "95713e9cbdd1dfcb2d4080c2537f418d43ca0da25f0d7d6631f4f7c97b89dc47";

/** Behavior every durable filesystem adapter must implement identically. */
export function describeDurableFileSystemContract(
  label: string,
  factory: () => Promise<Disposable<DurableFileSystem>>,
): void {
  describe(`DurableFileSystem contract: ${label}`, () => {
    async function withFileSystem(
      body: (fileSystem: DurableFileSystem) => Promise<void>,
    ): Promise<void> {
      const { port, dispose } = await factory();
      try {
        await body(port);
      } finally {
        await dispose();
      }
    }

    async function createBrain(fileSystem: DurableFileSystem): Promise<void> {
      await fileSystem.createDirectory(".brain");
    }

    it("writes, synchronizes, reads, and fingerprints complete UTF-8 text", async () => {
      await withFileSystem(async (fileSystem) => {
        await createBrain(fileSystem);
        await fileSystem.writeSynced(".brain/state.json", "héllo");

        expect(await fileSystem.readText(".brain/state.json")).toBe("héllo");
        expect(await fileSystem.inspect(".brain/state.json")).toEqual({
          kind: "file",
          size: 6,
          sha256: helloDigest,
        });
      });
    });

    it("reports missing paths without following them", async () => {
      await withFileSystem(async (fileSystem) => {
        expect(await fileSystem.inspect(".brain/missing.json")).toEqual({
          kind: "missing",
        });
      });
    });

    it("rejects reading a missing file", async () => {
      await withFileSystem(async (fileSystem) => {
        await expect(
          fileSystem.readText(".brain/missing.json"),
        ).rejects.toThrow();
      });
    });

    it("creates a directory idempotently", async () => {
      await withFileSystem(async (fileSystem) => {
        await createBrain(fileSystem);
        await fileSystem.createDirectory(".brain/runs");
        await fileSystem.createDirectory(".brain/runs");

        expect(await fileSystem.inspect(".brain/runs")).toEqual({
          kind: "directory",
        });
      });
    });

    it("creates a directory exclusively", async () => {
      await withFileSystem(async (fileSystem) => {
        await createBrain(fileSystem);
        await fileSystem.createDirectoryExclusive(".brain/transaction-1");

        expect(await fileSystem.inspect(".brain/transaction-1")).toEqual({
          kind: "directory",
        });
        await expect(
          fileSystem.createDirectoryExclusive(".brain/transaction-1"),
        ).rejects.toThrow();
      });
    });

    it("does not create undeclared parent directories", async () => {
      await withFileSystem(async (fileSystem) => {
        await expect(
          fileSystem.createDirectory(".brain/runs/deep"),
        ).rejects.toThrow();
        await expect(
          fileSystem.writeSynced(".brain/runs/state.json", "state"),
        ).rejects.toThrow();
        expect(await fileSystem.inspect(".brain/runs")).toEqual({
          kind: "missing",
        });
      });
    });

    it("atomically replaces a destination and consumes the staged file", async () => {
      await withFileSystem(async (fileSystem) => {
        await createBrain(fileSystem);
        await fileSystem.writeSynced(".brain/staged", "replacement");
        await fileSystem.writeSynced(".brain/state.json", "old");

        await fileSystem.replaceFile(".brain/staged", ".brain/state.json");

        expect(await fileSystem.inspect(".brain/staged")).toEqual({
          kind: "missing",
        });
        expect(await fileSystem.readText(".brain/state.json")).toBe(
          "replacement",
        );
        expect(await fileSystem.inspect(".brain/state.json")).toEqual({
          kind: "file",
          size: 11,
          sha256: replacementDigest,
        });
      });
    });

    it("publishes a staged file to a missing destination", async () => {
      await withFileSystem(async (fileSystem) => {
        await createBrain(fileSystem);
        await fileSystem.writeSynced(".brain/staged", "replacement");

        await fileSystem.replaceFile(".brain/staged", ".brain/new.json");

        expect(await fileSystem.inspect(".brain/staged")).toEqual({
          kind: "missing",
        });
        expect(await fileSystem.readText(".brain/new.json")).toBe(
          "replacement",
        );
      });
    });

    it("removes only regular files", async () => {
      await withFileSystem(async (fileSystem) => {
        await createBrain(fileSystem);
        await fileSystem.writeSynced(".brain/remove.json", "gone");
        await fileSystem.createDirectory(".brain/keep");

        await fileSystem.removeFile(".brain/remove.json");

        expect(await fileSystem.inspect(".brain/remove.json")).toEqual({
          kind: "missing",
        });
        await expect(fileSystem.removeFile(".brain/keep")).rejects.toThrow();
        expect(await fileSystem.inspect(".brain/keep")).toEqual({
          kind: "directory",
        });
      });
    });

    it("removes only empty directories", async () => {
      await withFileSystem(async (fileSystem) => {
        await createBrain(fileSystem);
        await fileSystem.createDirectory(".brain/empty");
        await fileSystem.createDirectory(".brain/non-empty");
        await fileSystem.writeSynced(".brain/non-empty/state.json", "state");

        await fileSystem.removeEmptyDirectory(".brain/empty");

        expect(await fileSystem.inspect(".brain/empty")).toEqual({
          kind: "missing",
        });
        await expect(
          fileSystem.removeEmptyDirectory(".brain/non-empty"),
        ).rejects.toThrow();
        expect(await fileSystem.readText(".brain/non-empty/state.json")).toBe(
          "state",
        );
        await expect(
          fileSystem.removeEmptyDirectory(".brain/non-empty/state.json"),
        ).rejects.toThrow();
      });
    });

    it("lists only immediate entries in sorted order", async () => {
      await withFileSystem(async (fileSystem) => {
        await createBrain(fileSystem);
        await fileSystem.writeSynced(".brain/b.json", "b");
        await fileSystem.writeSynced(".brain/a.json", "a");
        await fileSystem.createDirectory(".brain/c");
        await fileSystem.writeSynced(".brain/c/nested.json", "nested");

        expect(await fileSystem.list(".brain")).toEqual([
          "a.json",
          "b.json",
          "c",
        ]);
      });
    });

    it("classifies directory synchronization without hiding path errors", async () => {
      await withFileSystem(async (fileSystem) => {
        await createBrain(fileSystem);
        expect(["supported", "unsupported"]).toContain(
          await fileSystem.syncDirectory("."),
        );
        expect(["supported", "unsupported"]).toContain(
          await fileSystem.syncDirectory(".brain"),
        );
        await expect(
          fileSystem.syncDirectory(".brain/missing"),
        ).rejects.toThrow();
      });
    });

    const unsafePaths = [
      "../escape",
      "/absolute",
      "a/../../escape",
      "",
      "C:/windows",
      "a\\b",
      "a\u0000b",
      "a\nb",
      ".brain//state.json",
      ".brain/./state.json",
      ".brain/state.json/",
      "outside.txt",
      "relative/path",
    ] as const;

    const durableEntryPathOperations: readonly [
      label: string,
      run: (fileSystem: DurableFileSystem, path: string) => Promise<unknown>,
    ][] = [
      ["inspect", (fileSystem, path) => fileSystem.inspect(path)],
      ["list", (fileSystem, path) => fileSystem.list(path)],
      ["readText", (fileSystem, path) => fileSystem.readText(path)],
      [
        "createDirectory",
        (fileSystem, path) => fileSystem.createDirectory(path),
      ],
      [
        "createDirectoryExclusive",
        (fileSystem, path) => fileSystem.createDirectoryExclusive(path),
      ],
      [
        "writeSynced",
        (fileSystem, path) => fileSystem.writeSynced(path, "content"),
      ],
      ["removeFile", (fileSystem, path) => fileSystem.removeFile(path)],
      [
        "removeEmptyDirectory",
        (fileSystem, path) => fileSystem.removeEmptyDirectory(path),
      ],
      [
        "replaceFile staged path",
        (fileSystem, path) => fileSystem.replaceFile(path, ".brain/target"),
      ],
      [
        "replaceFile target path",
        (fileSystem, path) => fileSystem.replaceFile(".brain/staged", path),
      ],
    ];

    it.each(durableEntryPathOperations)(
      "%s refuses the project root sentinel as a managed entry",
      async (_operation, run) => {
        await withFileSystem(async (fileSystem) => {
          await expect(run(fileSystem, ".")).rejects.toThrow(
            "escapes the project",
          );
        });
      },
    );

    const unsafePathOperations = [
      ...durableEntryPathOperations,
      [
        "syncDirectory",
        (fileSystem: DurableFileSystem, path: string) =>
          fileSystem.syncDirectory(path),
      ] as const,
    ];

    it.each(unsafePathOperations)(
      "%s refuses every unsafe project-relative path",
      async (_operation, run) => {
        await withFileSystem(async (fileSystem) => {
          for (const path of unsafePaths) {
            await expect(run(fileSystem, path), path).rejects.toThrow(
              "escapes the project",
            );
          }
        });
      },
    );
  });
}

export type DurableFileSystemContractFactory = () => Promise<
  Disposable<DurableFileSystem>
>;
