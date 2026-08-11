import { constants, lstatSync, realpathSync, type Stats } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

import type { DurableEntry, DurableFileSystem } from "../../ports/index.js";

export type DurableOperation =
  | "inspect"
  | "list"
  | "read_text"
  | "create_directory"
  | "create_directory_exclusive"
  | "open_file"
  | "write_file"
  | "sync_file"
  | "close_file"
  | "replace_file"
  | "link_file_exclusive"
  | "remove_file"
  | "remove_empty_directory"
  | "sync_directory";

export interface DurableOperationEvent {
  readonly operation: DurableOperation;
  readonly timing: "before" | "after";
}

export type DurableOperationObserver = (
  event: DurableOperationEvent,
) => Promise<void>;

interface NormalizedPath {
  readonly path: string;
  readonly segments: readonly string[];
}

interface ScannedPath {
  readonly absolute: string;
  readonly details: Stats | null;
  readonly missingAt: number | null;
  readonly normalized: NormalizedPath;
}

interface CanonicalRootIdentity {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

interface RootIdentityStat {
  readonly dev: number;
  readonly ino: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface CanonicalRootCaptureOperations {
  lstat(path: string): RootIdentityStat;
  realpath(path: string): string;
}

function sameRootIdentity(
  left: RootIdentityStat,
  right: RootIdentityStat,
): boolean {
  return (
    left.isDirectory() &&
    !left.isSymbolicLink() &&
    right.isDirectory() &&
    !right.isSymbolicLink() &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

/** Source-level seam for deterministic root-capture race tests. */
export function captureCanonicalRoot(
  root: string,
  operations: CanonicalRootCaptureOperations = {
    lstat: lstatSync,
    realpath: realpathSync,
  },
): CanonicalRootIdentity | Error {
  try {
    const pre = operations.lstat(root);
    if (!pre.isDirectory() || pre.isSymbolicLink()) {
      throw new Error("Runtime project root is not a directory");
    }
    const path = operations.realpath(root);
    const resolved = operations.lstat(path);
    const post = operations.lstat(root);
    if (!sameRootIdentity(pre, resolved) || !sameRootIdentity(pre, post)) {
      throw new Error("Runtime project root changed");
    }
    return { path, device: pre.dev, inode: pre.ino };
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error("Runtime project root is unusable");
  }
}

function pathRefusal(): never {
  throw new Error("Runtime path escapes the project");
}

function normalizeManagedPath(path: string): NormalizedPath {
  let hasControlCharacter = false;
  for (const character of path) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) hasControlCharacter = true;
  }
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(path) ||
    path.includes("\\") ||
    hasControlCharacter
  ) {
    return pathRefusal();
  }

  const segments = path.split("/");
  if (
    segments.length === 0 ||
    segments[0] !== ".brain" ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) ||
    segments.join("/") !== path
  ) {
    return pathRefusal();
  }
  return { path, segments };
}

function missing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function optionalLstat(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function foldCase(name: string): string {
  return name.toLocaleLowerCase("en-US");
}

async function refuseCaseCollision(
  parent: string,
  requested: string,
): Promise<void> {
  const folded = foldCase(requested);
  const entries = await readdir(parent);
  if (
    entries.some((entry) => entry !== requested && foldCase(entry) === folded)
  ) {
    throw new Error("Runtime durable path has a case collision");
  }
}

function assertDirectory(details: Stats | null): asserts details is Stats {
  if (details?.isDirectory() !== true) {
    throw new Error("Runtime durable path is not a directory");
  }
}

function assertRegularFile(details: Stats | null): asserts details is Stats {
  if (details?.isFile() !== true) {
    throw new Error("Runtime durable path is not a regular file");
  }
}

function durableNonFileEntry(details: Stats | null): DurableEntry {
  if (details === null) return { kind: "missing" };
  if (details.isSymbolicLink()) return { kind: "symlink" };
  if (details.isDirectory()) return { kind: "directory" };
  return { kind: "special" };
}

function parentPath(path: NormalizedPath): string {
  return path.segments.slice(0, -1).join("/");
}

/**
 * Directory handles are unsupported on Windows, where Node reports EISDIR.
 * No other error is downgraded; extending this table requires a contract test.
 */
export function isUnsupportedDirectorySyncError(
  error: unknown,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    platform === "win32" &&
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "EISDIR"
  );
}

/** Real durable primitives rooted at a canonical project directory. */
export function nodeDurableFileSystem(
  root: string,
  observer?: DurableOperationObserver,
): DurableFileSystem {
  const canonicalRoot = captureCanonicalRoot(root);

  async function validatedRoot(): Promise<string> {
    if (canonicalRoot instanceof Error) throw canonicalRoot;
    const expected = canonicalRoot;
    try {
      const details = await lstat(expected.path);
      if (
        details.isSymbolicLink() ||
        !details.isDirectory() ||
        details.dev !== expected.device ||
        details.ino !== expected.inode ||
        (await realpath(expected.path)) !== expected.path
      ) {
        throw new Error("Runtime project root changed");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Runtime project root changed"
      ) {
        throw error;
      }
      throw new Error("Runtime project root changed", { cause: error });
    }
    return expected.path;
  }

  async function notify(
    operation: DurableOperation,
    timing: DurableOperationEvent["timing"],
  ): Promise<void> {
    await observer?.({ operation, timing });
  }

  async function boundary<T>(
    operation: DurableOperation,
    effect: () => Promise<T>,
  ): Promise<T> {
    await notify(operation, "before");
    const result = await effect();
    await notify(operation, "after");
    return result;
  }

  async function scan(path: string): Promise<ScannedPath> {
    const normalized = normalizeManagedPath(path);
    const project = await validatedRoot();
    let absolute = project;

    for (const [index, segment] of normalized.segments.entries()) {
      await refuseCaseCollision(absolute, segment);
      absolute = join(absolute, segment);
      const details = await optionalLstat(absolute);
      if (details === null) {
        return { absolute, details, missingAt: index, normalized };
      }
      const final = index === normalized.segments.length - 1;
      if (details.isSymbolicLink() && !final) {
        throw new Error("Runtime durable path contains a symlink");
      }
      if (!final && !details.isDirectory()) {
        throw new Error("Runtime durable path ancestor is not a directory");
      }
    }

    return {
      absolute,
      details: await optionalLstat(absolute),
      missingAt: null,
      normalized,
    };
  }

  function requireDeclaredParent(observation: ScannedPath): void {
    if (
      observation.missingAt !== null &&
      observation.missingAt < observation.normalized.segments.length - 1
    ) {
      throw new Error("Runtime durable path has no declared parent directory");
    }
  }

  async function requireDirectory(path: string): Promise<ScannedPath> {
    const observation = await scan(path);
    assertDirectory(observation.details);
    return observation;
  }

  async function readRegularBytes(path: string): Promise<Buffer> {
    const observation = await scan(path);
    assertRegularFile(observation.details);
    const handle = await open(
      observation.absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const before = await handle.stat();
      assertRegularFile(before);
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async function closeObserved(handle: FileHandle): Promise<void> {
    await boundary("close_file", async () => handle.close());
  }

  return {
    inspect: (path) =>
      boundary("inspect", async () => {
        const observation = await scan(path);
        if (observation.details?.isFile() !== true) {
          return durableNonFileEntry(observation.details);
        }
        const bytes = await readRegularBytes(observation.normalized.path);
        return {
          kind: "file",
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      }),
    list: (path) =>
      boundary("list", async () => {
        const observation = await requireDirectory(path);
        const entries = await readdir(observation.absolute);
        return entries.sort((left, right) =>
          left.localeCompare(right, "en-US"),
        );
      }),
    readText: (path) =>
      boundary("read_text", async () =>
        (await readRegularBytes(path)).toString("utf8"),
      ),
    createDirectory: (path) =>
      boundary("create_directory", async () => {
        const observation = await scan(path);
        requireDeclaredParent(observation);
        if (observation.details === null) {
          await mkdir(observation.absolute);
          return;
        }
        assertDirectory(observation.details);
      }),
    createDirectoryExclusive: (path) =>
      boundary("create_directory_exclusive", async () => {
        const observation = await scan(path);
        requireDeclaredParent(observation);
        if (observation.details !== null) {
          throw new Error("Runtime durable path already has an entry");
        }
        await mkdir(observation.absolute);
      }),
    writeSynced: async (path, content) => {
      const opened: { handle: FileHandle | null } = { handle: null };
      try {
        await boundary("open_file", async () => {
          const observation = await scan(path);
          requireDeclaredParent(observation);
          if (observation.details !== null) {
            throw new Error("Runtime durable path already has an entry");
          }
          opened.handle = await open(
            observation.absolute,
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              constants.O_NOFOLLOW,
            0o600,
          );
        });
        await boundary("write_file", async () => {
          await opened.handle?.writeFile(content, "utf8");
        });
        await boundary("sync_file", async () => {
          await opened.handle?.sync();
        });
      } finally {
        if (opened.handle !== null) await closeObserved(opened.handle);
      }
    },
    replaceFile: (stagedPath, targetPath) =>
      boundary("replace_file", async () => {
        const staged = await scan(stagedPath);
        const target = await scan(targetPath);
        assertRegularFile(staged.details);
        requireDeclaredParent(target);
        if (target.details !== null && !target.details.isFile()) {
          throw new Error("Runtime durable path is not a regular file");
        }
        await requireDirectory(parentPath(staged.normalized));
        await requireDirectory(parentPath(target.normalized));
        await rename(staged.absolute, target.absolute);
      }),
    linkFileExclusive: (sourcePath, targetPath) =>
      boundary("link_file_exclusive", async () => {
        const source = await scan(sourcePath);
        const target = await scan(targetPath);
        assertRegularFile(source.details);
        requireDeclaredParent(target);
        if (target.details !== null)
          throw new Error("Runtime durable path already has an entry");
        await requireDirectory(parentPath(source.normalized));
        await requireDirectory(parentPath(target.normalized));
        await link(source.absolute, target.absolute);
      }),
    removeFile: (path) =>
      boundary("remove_file", async () => {
        const observation = await scan(path);
        assertRegularFile(observation.details);
        await unlink(observation.absolute);
      }),
    removeEmptyDirectory: (path) =>
      boundary("remove_empty_directory", async () => {
        const observation = await requireDirectory(path);
        await rmdir(observation.absolute);
      }),
    syncDirectory: (path) =>
      boundary("sync_directory", async () => {
        const absolute =
          path === "."
            ? await validatedRoot()
            : (await requireDirectory(path)).absolute;
        let handle: FileHandle | null = null;
        try {
          handle = await open(
            absolute,
            constants.O_RDONLY | constants.O_DIRECTORY,
          );
          await handle.sync();
          return "supported" as const;
        } catch (error) {
          /* v8 ignore start -- Windows-only syscall outcome; the exact
           * error/platform classifier is covered independently. */
          if (isUnsupportedDirectorySyncError(error)) {
            return "unsupported" as const;
          }
          throw error;
          /* v8 ignore stop */
        } finally {
          await handle?.close();
        }
      }),
  };
}
