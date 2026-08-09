import type {
  Digests,
  DurableEntry,
  DurableFileSystem,
  FileStat,
  FileSystem,
} from "../../ports/index.js";
import { sha256Digests } from "../digests.js";

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
  | "remove_file"
  | "remove_empty_directory"
  | "sync_directory";

export interface FailureRule {
  readonly operation: DurableOperation;
  readonly timing: "before" | "after";
  readonly occurrence: number;
  readonly fault?: "generic" | "permission" | "disk_full";
}

export interface MemoryTransactionStorageSeed {
  readonly files?: Readonly<Record<string, string>>;
  readonly directories?: readonly string[];
}

export interface MemoryTransactionStorage {
  readonly fileSystem: FileSystem;
  readonly durableFileSystem: DurableFileSystem;
  readonly digests: Digests;
  readonly fail: (rule: FailureRule) => void;
  readonly calls: () => readonly DurableOperation[];
  readonly snapshot: () => {
    readonly files: Readonly<Record<string, string>>;
    readonly directories: readonly string[];
  };
}

function normalizePath(path: string): string {
  const reject = (): never => {
    throw new Error("Runtime path escapes the project");
  };
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
    reject();
  }
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") reject();
    segments.push(segment);
  }
  if (segments.length === 0) reject();
  return segments.join("/");
}

function deferred<T>(body: () => T): Promise<T> {
  return Promise.resolve().then(body);
}

function parentOf(path: string): string | null {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? null : path.slice(0, separator);
}

function immediateEntries(
  path: string | null,
  files: ReadonlyMap<string, string>,
  directories: ReadonlySet<string>,
): readonly string[] {
  const prefix = path === null ? "" : `${path}/`;
  const names = new Set<string>();
  for (const candidate of [...files.keys(), ...directories]) {
    if (!candidate.startsWith(prefix)) continue;
    const rest = candidate.slice(prefix.length);
    const separator = rest.indexOf("/");
    names.add(separator === -1 ? rest : rest.slice(0, separator));
  }
  return [...names].sort((left, right) => left.localeCompare(right, "en-US"));
}

/** One deterministic model shared by the ordinary and durable filesystem views. */
export function memoryTransactionStorage(
  seed: MemoryTransactionStorageSeed = {},
): MemoryTransactionStorage {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const trace: DurableOperation[] = [];
  const occurrences = new Map<DurableOperation, number>();
  const rules: FailureRule[] = [];
  const digests = sha256Digests();

  function addParents(path: string): void {
    let parent = parentOf(path);
    const parents: string[] = [];
    while (parent !== null) {
      parents.push(parent);
      parent = parentOf(parent);
    }
    for (const candidate of parents) {
      if (files.has(candidate)) {
        throw new Error(
          `Memory transaction storage has a file ancestor at ${candidate}`,
        );
      }
    }
    for (const candidate of parents.reverse()) directories.add(candidate);
  }

  for (const path of seed.directories ?? []) {
    const normalized = normalizePath(path);
    addParents(normalized);
    directories.add(normalized);
  }
  for (const [path, content] of Object.entries(seed.files ?? {})) {
    const normalized = normalizePath(path);
    addParents(normalized);
    if (directories.has(normalized)) {
      throw new Error("Memory transaction seed has conflicting entries");
    }
    files.set(normalized, content);
  }
  function injectedFailure(rule: FailureRule): Error {
    const fault = rule.fault ?? "generic";
    const suffix = fault === "generic" ? "" : ` (${fault})`;
    return new Error(`Injected durable filesystem failure${suffix}`);
  }

  function matchingRule(
    operation: DurableOperation,
    timing: FailureRule["timing"],
    occurrence: number,
  ): FailureRule | undefined {
    return rules.find(
      (rule) =>
        rule.operation === operation &&
        rule.timing === timing &&
        rule.occurrence === occurrence,
    );
  }

  function boundary<T>(operation: DurableOperation, effect: () => T): T {
    trace.push(operation);
    const occurrence = (occurrences.get(operation) ?? 0) + 1;
    occurrences.set(operation, occurrence);
    const before = matchingRule(operation, "before", occurrence);
    if (before !== undefined) throw injectedFailure(before);
    const result = effect();
    const after = matchingRule(operation, "after", occurrence);
    if (after !== undefined) throw injectedFailure(after);
    return result;
  }

  function requireParentDirectory(path: string): void {
    const parent = parentOf(path);
    if (parent !== null && !directories.has(parent)) {
      throw new Error(`Memory transaction storage has no parent for ${path}`);
    }
  }

  function requireDirectory(path: string): void {
    if (!directories.has(path)) {
      throw new Error(`Memory transaction storage has no directory at ${path}`);
    }
  }

  function requireFile(path: string): string {
    const content = files.get(path);
    if (content === undefined) {
      throw new Error(`Memory transaction storage has no file at ${path}`);
    }
    return content;
  }

  const fileSystem: FileSystem = {
    read: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        return requireFile(normalized);
      }),
    write: (path, content) =>
      deferred(() => {
        const normalized = normalizePath(path);
        if (directories.has(normalized)) {
          throw new Error(
            `Memory transaction storage has a directory at ${normalized}`,
          );
        }
        addParents(normalized);
        files.set(normalized, content);
      }),
    remove: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        files.delete(normalized);
        directories.delete(normalized);
        for (const candidate of [...files.keys()]) {
          if (candidate.startsWith(`${normalized}/`)) files.delete(candidate);
        }
        for (const candidate of [...directories]) {
          if (candidate.startsWith(`${normalized}/`)) {
            directories.delete(candidate);
          }
        }
      }),
    makeDirectory: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        if (files.has(normalized)) {
          throw new Error(
            `Memory transaction storage has a file at ${normalized}`,
          );
        }
        addParents(normalized);
        directories.add(normalized);
      }),
    list: (path) =>
      deferred(() => {
        const normalized = path === "." ? null : normalizePath(path);
        if (
          normalized !== null &&
          !directories.has(normalized) &&
          !files.has(normalized)
        ) {
          return [];
        }
        if (normalized !== null && files.has(normalized)) return [];
        return immediateEntries(normalized, files, directories);
      }),
    stat: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        const content = files.get(normalized);
        if (content !== undefined) {
          return {
            kind: "file",
            size: Buffer.byteLength(content, "utf8"),
          } satisfies FileStat;
        }
        return directories.has(normalized)
          ? ({ kind: "directory", size: 0 } satisfies FileStat)
          : null;
      }),
  };

  const durableFileSystem: DurableFileSystem = {
    inspect: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        return boundary("inspect", (): DurableEntry => {
          const content = files.get(normalized);
          if (content !== undefined) {
            return {
              kind: "file",
              size: Buffer.byteLength(content, "utf8"),
              sha256: digests.sha256(content),
            };
          }
          return directories.has(normalized)
            ? { kind: "directory" }
            : { kind: "missing" };
        });
      }),
    list: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        return boundary("list", () => {
          requireDirectory(normalized);
          return immediateEntries(normalized, files, directories);
        });
      }),
    readText: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        return boundary("read_text", () => requireFile(normalized));
      }),
    createDirectory: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        boundary("create_directory", () => {
          requireParentDirectory(normalized);
          if (files.has(normalized)) {
            throw new Error(
              `Memory transaction storage has a file at ${normalized}`,
            );
          }
          directories.add(normalized);
        });
      }),
    createDirectoryExclusive: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        boundary("create_directory_exclusive", () => {
          requireParentDirectory(normalized);
          if (files.has(normalized) || directories.has(normalized)) {
            throw new Error(
              `Memory transaction storage already has an entry at ${normalized}`,
            );
          }
          directories.add(normalized);
        });
      }),
    writeSynced: async (path, content) => {
      const normalized = normalizePath(path);
      const handle = { opened: false };
      try {
        await deferred(() => {
          boundary("open_file", () => {
            requireParentDirectory(normalized);
            if (files.has(normalized) || directories.has(normalized)) {
              throw new Error(
                `Memory transaction storage already has an entry at ${normalized}`,
              );
            }
            files.set(normalized, "");
            handle.opened = true;
          });
        });
        await deferred(() => {
          boundary("write_file", () => {
            requireFile(normalized);
            files.set(normalized, content);
          });
        });
        await deferred(() => {
          boundary("sync_file", () => {
            requireFile(normalized);
          });
        });
      } finally {
        if (handle.opened) {
          await deferred(() => {
            boundary("close_file", () => {
              requireFile(normalized);
            });
          });
        }
      }
    },
    replaceFile: (stagedPath, targetPath) =>
      deferred(() => {
        const normalizedStaged = normalizePath(stagedPath);
        const normalizedTarget = normalizePath(targetPath);
        boundary("replace_file", () => {
          requireParentDirectory(normalizedStaged);
          requireParentDirectory(normalizedTarget);
          const content = requireFile(normalizedStaged);
          if (directories.has(normalizedTarget)) {
            throw new Error(
              `Memory transaction storage has a directory at ${normalizedTarget}`,
            );
          }
          files.delete(normalizedStaged);
          files.set(normalizedTarget, content);
        });
      }),
    removeFile: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        boundary("remove_file", () => {
          requireFile(normalized);
          files.delete(normalized);
        });
      }),
    removeEmptyDirectory: (path) =>
      deferred(() => {
        const normalized = normalizePath(path);
        boundary("remove_empty_directory", () => {
          requireDirectory(normalized);
          if (immediateEntries(normalized, files, directories).length !== 0) {
            throw new Error(
              `Memory transaction storage directory is not empty at ${normalized}`,
            );
          }
          directories.delete(normalized);
        });
      }),
    syncDirectory: (path) =>
      deferred(() => {
        const normalized = path === "." ? null : normalizePath(path);
        return boundary("sync_directory", () => {
          if (normalized !== null) requireDirectory(normalized);
          return "supported" as const;
        });
      }),
  };

  return {
    fileSystem,
    durableFileSystem,
    digests,
    fail: (rule) => {
      if (!Number.isInteger(rule.occurrence) || rule.occurrence <= 0) {
        throw new Error("Failure occurrence must be a positive integer");
      }
      rules.push({ ...rule });
    },
    calls: () => [...trace],
    snapshot: () => ({
      files: Object.fromEntries(
        [...files.entries()].sort(([left], [right]) =>
          left.localeCompare(right, "en-US"),
        ),
      ),
      directories: [...directories].sort((left, right) =>
        left.localeCompare(right, "en-US"),
      ),
    }),
  };
}
