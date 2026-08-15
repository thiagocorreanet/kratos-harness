import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  nodeDurableFileSystem,
  type DurableOperation,
  type DurableOperationEvent,
} from "@kratos/runtime/infra/node";
import { isUnsupportedDirectorySyncError } from "../packages/runtime/src/infra/node/transactions.js";
import { describe, expect, it } from "vitest";

async function temporaryProject<T>(
  body: (root: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "kratos-node-transactions-"));
  try {
    return await body(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

describe("node durable filesystem operations", () => {
  it("refuses a file where a directory was requested", async () => {
    await temporaryProject(async (root) => {
      const fileSystem = nodeDurableFileSystem(root);
      await fileSystem.createDirectory(".brain");
      await writeFile(join(root, ".brain/entry"), "value", "utf8");

      await expect(fileSystem.createDirectory(".brain/entry")).rejects.toThrow(
        "Runtime durable path is not a directory",
      );
    });
  });

  it("observes the exact before and after boundaries of a synced write", async () => {
    await temporaryProject(async (root) => {
      const events: DurableOperationEvent[] = [];
      const fileSystem = nodeDurableFileSystem(root, (event) => {
        events.push(event);
        return Promise.resolve();
      });
      await fileSystem.createDirectory(".brain");
      events.length = 0;

      await fileSystem.writeSynced(".brain/state.json", "state");

      expect(events).toEqual([
        { operation: "open_file", timing: "before" },
        { operation: "open_file", timing: "after" },
        { operation: "write_file", timing: "before" },
        { operation: "write_file", timing: "after" },
        { operation: "sync_file", timing: "before" },
        { operation: "sync_file", timing: "after" },
        { operation: "close_file", timing: "before" },
        { operation: "close_file", timing: "after" },
      ]);
      expect(await readFile(join(root, ".brain/state.json"), "utf8")).toBe(
        "state",
      );
    });
  });

  it("closes an exclusively opened file when a later boundary fails", async () => {
    await temporaryProject(async (root) => {
      const events: DurableOperationEvent[] = [];
      const failure = new Error("stop before write");
      const fileSystem = nodeDurableFileSystem(root, (event) => {
        events.push(event);
        return event.operation === "write_file" && event.timing === "before"
          ? Promise.reject(failure)
          : Promise.resolve();
      });
      await fileSystem.createDirectory(".brain");
      events.length = 0;

      await expect(
        fileSystem.writeSynced(".brain/state.json", "state"),
      ).rejects.toBe(failure);

      expect(events).toContainEqual({
        operation: "close_file",
        timing: "after",
      });
      await expect(fileSystem.removeFile(".brain/state.json")).resolves.toBe(
        undefined,
      );
    });
  });

  it.each(["before", "after"] as const)(
    "models a %s-effect atomic replacement failure",
    async (timing) => {
      await temporaryProject(async (root) => {
        const failure = new Error(`${timing} replacement`);
        let armed = false;
        const fileSystem = nodeDurableFileSystem(root, (event) =>
          armed && event.operation === "replace_file" && event.timing === timing
            ? Promise.reject(failure)
            : Promise.resolve(),
        );
        await fileSystem.createDirectory(".brain");
        await fileSystem.writeSynced(".brain/staged", "new");
        await fileSystem.writeSynced(".brain/target", "old");
        armed = true;

        await expect(
          fileSystem.replaceFile(".brain/staged", ".brain/target"),
        ).rejects.toBe(failure);

        expect(await readFile(join(root, ".brain/target"), "utf8")).toBe(
          timing === "before" ? "old" : "new",
        );
        if (timing === "before") {
          await expect(
            readFile(join(root, ".brain/staged"), "utf8"),
          ).resolves.toBe("new");
        } else {
          await expect(
            readFile(join(root, ".brain/staged"), "utf8"),
          ).rejects.toThrow();
        }
      });
    },
  );

  it("emits paired observer events for every durable operation", async () => {
    await temporaryProject(async (root) => {
      const events: DurableOperationEvent[] = [];
      const fileSystem = nodeDurableFileSystem(root, (event) => {
        events.push(event);
        return Promise.resolve();
      });

      await fileSystem.createDirectory(".brain");
      await fileSystem.createDirectory(".brain/run");
      await fileSystem.createDirectoryExclusive(".brain/exclusive");
      await fileSystem.writeSynced(".brain/staged", "content");
      await fileSystem.inspect(".brain/staged");
      await fileSystem.readText(".brain/staged");
      await fileSystem.list(".brain");
      await fileSystem.syncDirectory(".brain");
      await fileSystem.replaceFile(".brain/staged", ".brain/target");
      await fileSystem.linkFileExclusive(".brain/target", ".brain/link");
      await fileSystem.createDirectory(".brain/candidate");
      await fileSystem.writeSynced(".brain/candidate/claim", "content");
      await fileSystem.renameDirectoryExclusive(
        ".brain/candidate",
        ".brain/published",
      );
      await fileSystem.removeFile(".brain/link");
      await fileSystem.removeFile(".brain/target");
      await fileSystem.removeEmptyDirectory(".brain/run");

      const operations: readonly DurableOperation[] = [
        "inspect",
        "list",
        "read_text",
        "create_directory",
        "create_directory_exclusive",
        "open_file",
        "write_file",
        "sync_file",
        "close_file",
        "replace_file",
        "link_file_exclusive",
        "rename_directory_exclusive",
        "remove_file",
        "remove_empty_directory",
        "sync_directory",
      ];
      for (const operation of operations) {
        expect(events).toContainEqual({ operation, timing: "before" });
        expect(events).toContainEqual({ operation, timing: "after" });
      }
    });
  });

  it("never downgrades an observer sync error into an unsupported capability", async () => {
    await temporaryProject(async (root) => {
      const failure = Object.assign(new Error("synthetic sync failure"), {
        code: "EINVAL",
      });
      const fileSystem = nodeDurableFileSystem(root, (event) =>
        event.operation === "sync_directory" && event.timing === "before"
          ? Promise.reject(failure)
          : Promise.resolve(),
      );

      await expect(fileSystem.syncDirectory(".")).rejects.toBe(failure);
    });
  });

  it("does not leave an unhandled root lookup when an observer rejects first", async () => {
    const parent = await mkdtemp(join(tmpdir(), "kratos-node-root-absent-"));
    const root = join(parent, "missing");
    const failure = new Error("observer rejected before validation");
    const rejections: unknown[] = [];
    const observe = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on("unhandledRejection", observe);
    try {
      const fileSystem = nodeDurableFileSystem(root, () =>
        Promise.reject(failure),
      );

      await expect(fileSystem.syncDirectory(".")).rejects.toBe(failure);
      await Promise.resolve();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", observe);
      await rm(parent, { force: true, recursive: true });
    }
  });

  it("downgrades only Windows EISDIR for directory synchronization", () => {
    const error = (code: string): NodeJS.ErrnoException =>
      Object.assign(new Error(code), { code });

    expect(isUnsupportedDirectorySyncError(error("EISDIR"), "win32")).toBe(
      true,
    );
    for (const code of ["EACCES", "EBADF", "EINVAL", "ENOTSUP", "EPERM"]) {
      expect(isUnsupportedDirectorySyncError(error(code), "win32"), code).toBe(
        false,
      );
    }
    expect(isUnsupportedDirectorySyncError(error("EISDIR"), "linux")).toBe(
      false,
    );
    expect(isUnsupportedDirectorySyncError(error("EISDIR"), "darwin")).toBe(
      false,
    );
    expect(isUnsupportedDirectorySyncError(null, "win32")).toBe(false);
    expect(isUnsupportedDirectorySyncError("EISDIR", "win32")).toBe(false);
    expect(isUnsupportedDirectorySyncError(new Error("EISDIR"), "win32")).toBe(
      false,
    );
  });

  it("rejects a non-directory project root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kratos-node-root-file-"));
    const root = join(directory, "project");
    try {
      await writeFile(root, "not a directory", "utf8");

      await expect(
        nodeDurableFileSystem(root).inspect(".brain"),
      ).rejects.toThrow("not a directory");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("refuses to truncate an existing file or replace an existing directory", async () => {
    await temporaryProject(async (root) => {
      const fileSystem = nodeDurableFileSystem(root);
      await fileSystem.createDirectory(".brain");
      await writeFile(join(root, ".brain/state.json"), "original", "utf8");
      await fileSystem.createDirectory(".brain/directory");

      await expect(
        fileSystem.writeSynced(".brain/state.json", "replacement"),
      ).rejects.toThrow();
      await expect(
        fileSystem.writeSynced(".brain/directory", "replacement"),
      ).rejects.toThrow();

      expect(await readFile(join(root, ".brain/state.json"), "utf8")).toBe(
        "original",
      );
    });
  });
});
