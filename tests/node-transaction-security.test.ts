import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { promisify } from "node:util";

import { nodeDurableFileSystem } from "@mestre-yoda/runtime/infra/node";
import { captureCanonicalRoot } from "../packages/runtime/src/infra/node/transactions.js";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);

async function temporaryProject<T>(
  body: (root: string, outside: string) => Promise<T>,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "yoda-node-security-"));
  const outside = await mkdtemp(join(tmpdir(), "yoda-node-outside-"));
  try {
    return await body(root, outside);
  } finally {
    await Promise.all([
      rm(root, { force: true, recursive: true }),
      rm(outside, { force: true, recursive: true }),
    ]);
  }
}

describe("node durable filesystem security", () => {
  it("rejects a root symlink at construction without touching its target", async () => {
    await temporaryProject(async (root, outside) => {
      await mkdir(join(outside, ".brain"));
      await writeFile(join(outside, ".brain/state.json"), "SENTINEL", "utf8");
      await rm(root, { force: true, recursive: true });
      await symlink(outside, root, "dir");
      const fileSystem = nodeDurableFileSystem(root);

      await expect(fileSystem.inspect(".brain/state.json")).rejects.toThrow(
        "not a directory",
      );
      await expect(
        fileSystem.writeSynced(".brain/state.json", "PWNED"),
      ).rejects.toThrow("not a directory");
      expect(await readFile(join(outside, ".brain/state.json"), "utf8")).toBe(
        "SENTINEL",
      );
    });
  });

  it.each([
    "before resolution",
    "between resolution and resolved identity",
    "between resolved identity and post identity",
  ] as const)("stores a refusal when the root swaps %s", (cutPoint) => {
    let swapped = false;
    let lstatCalls = 0;
    const directory = {
      dev: 1,
      ino: 1,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    };
    const symlinkRoot = {
      dev: 2,
      ino: 2,
      isDirectory: () => false,
      isSymbolicLink: () => true,
    };
    const result = captureCanonicalRoot("/project", {
      lstat(path) {
        lstatCalls += 1;
        if (
          cutPoint === "between resolved identity and post identity" &&
          lstatCalls === 3
        ) {
          swapped = true;
        }
        return path === "/project" && swapped ? symlinkRoot : directory;
      },
      realpath() {
        if (cutPoint === "before resolution") swapped = true;
        if (cutPoint === "between resolution and resolved identity") {
          swapped = true;
        }
        return "/project";
      },
    });

    expect(result).toBeInstanceOf(Error);
  });

  it.each(["ENOENT", "EACCES"])(
    "stores an initial root %s failure for the first operation",
    async (code) => {
      const root = join(tmpdir(), `yoda-node-root-${code.toLowerCase()}`);
      const failure = Object.assign(new Error(code), { code });
      const captured = captureCanonicalRoot(root, {
        lstat() {
          throw failure;
        },
        realpath() {
          throw new Error("must not resolve after lstat failure");
        },
      });
      expect(captured).toBe(failure);

      if (code === "ENOENT") {
        await expect(
          nodeDurableFileSystem(root).inspect(".brain/state.json"),
        ).rejects.toMatchObject({ code });
      }
    },
  );

  it("rejects a root symlink swap before the first durable operation", async () => {
    const container = await mkdtemp(join(tmpdir(), "yoda-node-root-swap-"));
    const root = join(container, "project");
    const displaced = join(container, "project-original");
    const outside = join(container, "outside");
    try {
      await mkdir(join(root, ".brain"), { recursive: true });
      await mkdir(join(outside, ".brain"), { recursive: true });
      await writeFile(join(root, ".brain/state.json"), "ORIGINAL", "utf8");
      await writeFile(join(outside, ".brain/state.json"), "SENTINEL", "utf8");
      const fileSystem = nodeDurableFileSystem(root);
      await rename(root, displaced);
      await symlink(outside, root, "dir");

      await expect(fileSystem.inspect(".brain/state.json")).rejects.toThrow(
        "project root changed",
      );
      await expect(
        fileSystem.writeSynced(".brain/state.json", "PWNED"),
      ).rejects.toThrow("project root changed");

      expect(await readFile(join(outside, ".brain/state.json"), "utf8")).toBe(
        "SENTINEL",
      );
      expect(await readFile(join(displaced, ".brain/state.json"), "utf8")).toBe(
        "ORIGINAL",
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("rejects an operation when the canonical root is persistently replaced by a symlink", async () => {
    const container = await mkdtemp(join(tmpdir(), "yoda-node-root-swap-"));
    const root = join(container, "project");
    const displaced = join(container, "project-original");
    const outside = join(container, "outside");
    try {
      await mkdir(join(root, ".brain"), { recursive: true });
      await mkdir(join(outside, ".brain"), { recursive: true });
      await writeFile(join(root, ".brain/state.json"), "ORIGINAL", "utf8");
      await writeFile(join(outside, ".brain/state.json"), "SENTINEL", "utf8");
      let armed = false;
      const fileSystem = nodeDurableFileSystem(root, async (event) => {
        if (
          armed &&
          event.operation === "inspect" &&
          event.timing === "before"
        ) {
          await rename(root, displaced);
          await symlink(outside, root, "dir");
        }
      });
      await expect(
        fileSystem.inspect(".brain/state.json"),
      ).resolves.toMatchObject({
        kind: "file",
      });
      armed = true;

      await expect(fileSystem.inspect(".brain/state.json")).rejects.toThrow(
        "project root changed",
      );

      expect(await readFile(join(outside, ".brain/state.json"), "utf8")).toBe(
        "SENTINEL",
      );
      expect(await readFile(join(displaced, ".brain/state.json"), "utf8")).toBe(
        "ORIGINAL",
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("rejects root directory synchronization after persistent directory substitution", async () => {
    const container = await mkdtemp(join(tmpdir(), "yoda-node-root-swap-"));
    const root = join(container, "project");
    const displaced = join(container, "project-original");
    try {
      await mkdir(join(root, ".brain"), { recursive: true });
      await writeFile(join(root, ".brain/state.json"), "ORIGINAL", "utf8");
      let armed = false;
      const fileSystem = nodeDurableFileSystem(root, async (event) => {
        if (
          armed &&
          event.operation === "sync_directory" &&
          event.timing === "before"
        ) {
          await rename(root, displaced);
          await mkdir(root);
          await writeFile(join(root, "sentinel.txt"), "SENTINEL", "utf8");
        }
      });
      await fileSystem.inspect(".brain/state.json");
      armed = true;

      await expect(fileSystem.syncDirectory(".")).rejects.toThrow(
        "project root changed",
      );

      expect(await readFile(join(root, "sentinel.txt"), "utf8")).toBe(
        "SENTINEL",
      );
      expect(await readFile(join(displaced, ".brain/state.json"), "utf8")).toBe(
        "ORIGINAL",
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("rejects an operation after the canonical root is renamed away", async () => {
    const container = await mkdtemp(join(tmpdir(), "yoda-node-root-swap-"));
    const root = join(container, "project");
    const displaced = join(container, "project-original");
    try {
      await mkdir(join(root, ".brain"), { recursive: true });
      await writeFile(join(root, ".brain/state.json"), "ORIGINAL", "utf8");
      let armed = false;
      const fileSystem = nodeDurableFileSystem(root, async (event) => {
        if (
          armed &&
          event.operation === "inspect" &&
          event.timing === "before"
        ) {
          await rename(root, displaced);
        }
      });
      await fileSystem.inspect(".brain/state.json");
      armed = true;

      await expect(fileSystem.inspect(".brain/state.json")).rejects.toThrow(
        "project root changed",
      );

      expect(await readFile(join(displaced, ".brain/state.json"), "utf8")).toBe(
        "ORIGINAL",
      );
    } finally {
      await rm(container, { force: true, recursive: true });
    }
  });

  it("refuses internal and escaping symlink ancestors", async () => {
    await temporaryProject(async (root, outside) => {
      await mkdir(join(root, ".brain/real"), { recursive: true });
      const sentinel = join(outside, "sentinel.txt");
      await writeFile(sentinel, "SAFE", "utf8");
      await symlink(join(root, ".brain/real"), join(root, ".brain/internal"));
      await symlink(outside, join(root, ".brain/escaping"));
      const fileSystem = nodeDurableFileSystem(root);

      for (const path of [
        ".brain/internal/state.json",
        ".brain/escaping/state.json",
      ]) {
        await expect(fileSystem.inspect(path)).rejects.toThrow("symlink");
        await expect(fileSystem.writeSynced(path, "PWNED")).rejects.toThrow(
          "symlink",
        );
      }

      expect(await readFile(sentinel, "utf8")).toBe("SAFE");
      expect(await lstat(join(root, ".brain/real"))).toMatchObject({});
    });
  });

  it("observes a final symlink without reading, replacing, or deleting it", async () => {
    await temporaryProject(async (root, outside) => {
      await mkdir(join(root, ".brain"));
      const sentinel = join(outside, "sentinel.txt");
      await writeFile(sentinel, "SAFE", "utf8");
      await symlink(sentinel, join(root, ".brain/alias"));
      const fileSystem = nodeDurableFileSystem(root);
      await fileSystem.writeSynced(".brain/staged", "PWNED");

      await expect(fileSystem.inspect(".brain/alias")).resolves.toEqual({
        kind: "symlink",
      });
      await expect(fileSystem.readText(".brain/alias")).rejects.toThrow(
        "regular file",
      );
      await expect(fileSystem.removeFile(".brain/alias")).rejects.toThrow(
        "regular file",
      );
      await expect(
        fileSystem.replaceFile(".brain/staged", ".brain/alias"),
      ).rejects.toThrow("regular file");

      expect(await readFile(sentinel, "utf8")).toBe("SAFE");
      expect((await lstat(join(root, ".brain/alias"))).isSymbolicLink()).toBe(
        true,
      );
    });
  });

  it("classifies a FIFO as special and never opens or removes it", async () => {
    if (process.platform === "win32") return;

    await temporaryProject(async (root) => {
      await mkdir(join(root, ".brain"));
      const fifo = join(root, ".brain/pipe");
      await run("mkfifo", [fifo]);
      const fileSystem = nodeDurableFileSystem(root);
      await fileSystem.writeSynced(".brain/staged", "content");

      await expect(fileSystem.inspect(".brain/pipe")).resolves.toEqual({
        kind: "special",
      });
      await expect(fileSystem.readText(".brain/pipe")).rejects.toThrow(
        "regular file",
      );
      await expect(fileSystem.removeFile(".brain/pipe")).rejects.toThrow(
        "regular file",
      );
      await expect(
        fileSystem.replaceFile(".brain/staged", ".brain/pipe"),
      ).rejects.toThrow("regular file");
      expect((await lstat(fifo)).isFIFO()).toBe(true);
    });
  });

  it("refuses to use a directory as a file", async () => {
    await temporaryProject(async (root) => {
      await mkdir(join(root, ".brain/directory"), { recursive: true });
      const fileSystem = nodeDurableFileSystem(root);
      await fileSystem.writeSynced(".brain/staged", "content");

      await expect(fileSystem.readText(".brain/directory")).rejects.toThrow(
        "regular file",
      );
      await expect(fileSystem.removeFile(".brain/directory")).rejects.toThrow(
        "regular file",
      );
      await expect(
        fileSystem.replaceFile(".brain/staged", ".brain/directory"),
      ).rejects.toThrow("regular file");
      expect((await lstat(join(root, ".brain/directory"))).isDirectory()).toBe(
        true,
      );
    });
  });

  it("refuses to traverse through a regular-file ancestor", async () => {
    await temporaryProject(async (root) => {
      await mkdir(join(root, ".brain"));
      await writeFile(join(root, ".brain/file"), "content", "utf8");

      await expect(
        nodeDurableFileSystem(root).inspect(".brain/file/child"),
      ).rejects.toThrow("ancestor is not a directory");
    });
  });

  it("rethrows native no-follow metadata errors", async () => {
    await temporaryProject(async (root) => {
      await mkdir(join(root, ".brain"));
      const tooLong = `x${"x".repeat(300)}`;

      await expect(
        nodeDurableFileSystem(root).inspect(`.brain/${tooLong}`),
      ).rejects.toMatchObject({ code: "ENAMETOOLONG" });
    });
  });

  it("refuses a case-colliding sibling on a case-sensitive filesystem", async () => {
    await temporaryProject(async (root) => {
      await mkdir(join(root, ".brain"));
      await writeFile(join(root, ".brain/State.json"), "SAFE", "utf8");
      try {
        await lstat(join(root, ".brain/state.json"));
        return;
      } catch (error) {
        if (
          error === null ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
      }
      const fileSystem = nodeDurableFileSystem(root);

      await expect(fileSystem.inspect(".brain/state.json")).rejects.toThrow(
        "case collision",
      );
      await expect(
        fileSystem.writeSynced(".brain/state.json", "PWNED"),
      ).rejects.toThrow("case collision");
      expect(await readFile(join(root, ".brain/State.json"), "utf8")).toBe(
        "SAFE",
      );
    });
  });

  it("revalidates parents after an observation before atomic replacement", async () => {
    await temporaryProject(async (root, outside) => {
      await mkdir(join(root, ".brain/destination"), { recursive: true });
      const sentinel = join(outside, "sentinel.txt");
      await writeFile(sentinel, "SAFE", "utf8");
      let substitute = false;
      const fileSystem = nodeDurableFileSystem(root, async (event) => {
        if (
          substitute &&
          event.operation === "replace_file" &&
          event.timing === "before"
        ) {
          await rename(
            join(root, ".brain/destination"),
            join(root, ".brain/destination-original"),
          );
          await symlink(outside, join(root, ".brain/destination"));
        }
      });
      await fileSystem.writeSynced(".brain/staged", "PWNED");
      await expect(
        fileSystem.inspect(".brain/destination/state.json"),
      ).resolves.toEqual({ kind: "missing" });
      substitute = true;

      await expect(
        fileSystem.replaceFile(
          ".brain/staged",
          ".brain/destination/state.json",
        ),
      ).rejects.toThrow("symlink");

      expect(await readFile(sentinel, "utf8")).toBe("SAFE");
      await expect(
        readFile(join(outside, "state.json"), "utf8"),
      ).rejects.toThrow();
      expect(await readFile(join(root, ".brain/staged"), "utf8")).toBe("PWNED");
    });
  });

  it.each([
    [
      "traversal",
      (root: string, outside: string) =>
        relative(root, join(outside, "sentinel.txt")),
    ],
    [
      "absolute",
      (_root: string, outside: string) => join(outside, "sentinel.txt"),
    ],
    ["drive", () => "C:/sentinel.txt"],
    ["backslash", () => ".brain\\sentinel.txt"],
    ["control", () => ".brain/sentinel\n.txt"],
  ])(
    "refuses %s paths without changing an external sentinel",
    async (_label, candidate) => {
      await temporaryProject(async (root, outside) => {
        await mkdir(join(root, ".brain"));
        const sentinel = join(outside, "sentinel.txt");
        await writeFile(sentinel, "SAFE", "utf8");
        const fileSystem = nodeDurableFileSystem(root);

        await expect(
          fileSystem.writeSynced(candidate(root, outside), "PWNED"),
        ).rejects.toThrow("escapes the project");

        expect(await readFile(sentinel, "utf8")).toBe("SAFE");
      });
    },
  );
});
