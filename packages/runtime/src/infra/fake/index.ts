import { posix } from "node:path";

import type {
  ConfigurationObservation,
  DirectoryProbe,
  WorktreeLocation,
} from "../../domain/project/index.js";
import type {
  Clock,
  Environment,
  FileStat,
  FileSystem,
  Ids,
  Output,
  Workspace,
} from "../../ports/index.js";

export { stubGit } from "./git.js";
export {
  memoryTransactionStorage,
  type DurableOperation,
  type FailureRule,
  type MemoryTransactionStorage,
  type MemoryTransactionStorageSeed,
} from "./transactions.js";

/**
 * Deterministic in-memory port implementations.
 *
 * These exist so the core can be exercised with no disk, no wall clock, and no
 * randomness. They are held to the same contract suite as the Node-backed
 * implementations, so a divergence fails immediately rather than letting
 * in-memory tests pass while the real runtime misbehaves.
 */

/** Always the same instant, returned as a fresh Date so callers cannot mutate it. */
export function fixedClock(iso: string): Clock {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Fake clock requires a valid ISO instant");
  }
  return {
    now: () => new Date(instant.getTime()),
  };
}

/** Identifiers numbered from one, so an event stream reads the same every run. */
export function sequentialIds(prefix = "id"): Ids {
  let counter = 0;
  return {
    next: () => {
      counter += 1;
      return `${prefix}-${String(counter)}`;
    },
  };
}

/**
 * Reject anything that is not a safe project-relative path before it can reach
 * storage. The message is part of the port contract, so both implementations
 * report an escape the same way.
 */
export function normalizeProjectPath(path: string): string {
  const reject = (): never => {
    // The message is part of the port contract, so both implementations report
    // an escape identically and a caller can match on one string.
    throw new Error("Runtime path escapes the project");
  };
  // Only what is unambiguously unsafe is refused. A space is legal in a real
  // project path, so rejecting it here would be a restriction the runtime would
  // have to walk back the first time it reads a user's repository.
  let hasControlCharacter = false;
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0;
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
    // Traversal is refused rather than clamped, so a path that tried to escape
    // never silently resolves to something inside the project.
    if (segment === "..") reject();
    segments.push(segment);
  }
  if (segments.length === 0) reject();
  return segments.join("/");
}

/** Run a synchronous body so a throw surfaces as a rejected promise. */
function deferred<T>(body: () => T): Promise<T> {
  return Promise.resolve().then(body);
}

export function memoryFileSystem(
  seed: Readonly<Record<string, string>> = {},
): FileSystem {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  function recordParents(path: string): void {
    const segments = path.split("/");
    segments.pop();
    for (let index = 0; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index + 1).join("/"));
    }
  }

  for (const [path, content] of Object.entries(seed)) {
    const normalized = normalizeProjectPath(path);
    files.set(normalized, content);
    recordParents(normalized);
  }

  // Every method is async so a rejected path surfaces as a rejected promise,
  // matching how the Node implementation fails. A synchronous throw here would
  // make the two implementations disagree on how a caller observes an error.
  // Deferred rather than async: a throw becomes a rejected promise, which is
  // how the Node implementation fails, without an async function that never
  // awaits anything.
  return {
    read: (path) =>
      deferred(() => {
        const normalized = normalizeProjectPath(path);
        const content = files.get(normalized);
        if (content === undefined) {
          throw new Error(`Fake filesystem has no file at ${normalized}`);
        }
        return content;
      }),
    write: (path, content) =>
      deferred(() => {
        const normalized = normalizeProjectPath(path);
        files.set(normalized, content);
        recordParents(normalized);
      }),
    remove: (path) =>
      deferred(() => {
        const normalized = normalizeProjectPath(path);
        files.delete(normalized);
        directories.delete(normalized);
        // Removing a directory removes what it held, so a later stat cannot
        // report a child of a directory that no longer exists.
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
        const normalized = normalizeProjectPath(path);
        directories.add(normalized);
        recordParents(normalized);
      }),
    list: (path) =>
      deferred(() => {
        const prefix =
          path === "." || path === "" ? "" : `${normalizeProjectPath(path)}/`;
        const names = new Set<string>();
        for (const candidate of [...files.keys(), ...directories]) {
          if (!candidate.startsWith(prefix)) continue;
          const rest = candidate.slice(prefix.length);
          if (rest.length === 0) continue;
          names.add(rest.split("/")[0] ?? rest);
        }
        return [...names].sort((left, right) =>
          left.localeCompare(right, "en-US"),
        );
      }),
    stat: (path) =>
      deferred(() => {
        const normalized = normalizeProjectPath(path);
        const content = files.get(normalized);
        if (content !== undefined) {
          // Bytes, not UTF-16 code units: any policy budgeting by size would
          // otherwise pass in memory and misbehave on disk.
          return {
            kind: "file",
            size: Buffer.byteLength(content, "utf8"),
          } satisfies FileStat;
        }
        if (directories.has(normalized)) {
          return { kind: "directory", size: 0 } satisfies FileStat;
        }
        return null;
      }),
  };
}

export function fixedEnvironment(
  values: Readonly<Record<string, string>>,
  cwd: string,
): Environment {
  return {
    get: (name) => values[name],
    workingDirectory: () => cwd,
  };
}

export interface RecordingOutput extends Output {
  readonly structured_: readonly string[];
  readonly human_: readonly string[];
}

export function recordingOutput(): RecordingOutput {
  const structuredLines: string[] = [];
  const humanLines: string[] = [];
  return {
    structured: (text) => structuredLines.push(text),
    human: (text) => humanLines.push(text),
    structured_: structuredLines,
    human_: humanLines,
  };
}

export interface MemoryWorkspaceSeed {
  readonly directories?: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
  readonly symlinks?: Readonly<Record<string, string>>;
  readonly gitRoots?: readonly string[];
  readonly worktrees?: readonly WorktreeLocation[];
}

function unsafeWorkspacePath(path: string): boolean {
  let control = false;
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) control = true;
  }
  return (
    path.length === 0 ||
    path.includes("\\") ||
    /^[A-Za-z]:/u.test(path) ||
    control
  );
}

/** Deterministic read-only workspace observations over an inert POSIX tree. */
export function memoryWorkspace(seed: MemoryWorkspaceSeed = {}): Workspace {
  const directories = new Set<string>(["/"]);
  const files = new Map<string, string>();
  const symlinks = new Map<string, string>();
  const gitRoots = new Set(
    (seed.gitRoots ?? []).map((path) => posix.resolve(path)),
  );
  const worktrees = [...(seed.worktrees ?? [])];

  function addParents(path: string): void {
    let current = posix.dirname(path);
    for (;;) {
      directories.add(current);
      const parent = posix.dirname(current);
      if (parent === current) return;
      current = parent;
    }
  }

  for (const path of seed.directories ?? []) {
    const absolute = posix.resolve(path);
    directories.add(absolute);
    addParents(absolute);
  }
  for (const [path, content] of Object.entries(seed.files ?? {})) {
    const absolute = posix.resolve(path);
    files.set(absolute, content);
    addParents(absolute);
  }
  for (const [path, target] of Object.entries(seed.symlinks ?? {})) {
    const absolute = posix.resolve(path);
    symlinks.set(absolute, posix.resolve(posix.dirname(absolute), target));
    addParents(absolute);
  }

  function canonicalize(path: string, base: string): string | null {
    if (unsafeWorkspacePath(path) || unsafeWorkspacePath(base)) return null;
    const absolute = posix.resolve(base, path);
    const target = symlinks.get(absolute) ?? absolute;
    return directories.has(target) ? target : null;
  }

  function inside(root: string, candidate: string): boolean {
    const relative = posix.relative(root, candidate);
    return (
      relative === "" || (!relative.startsWith("../") && relative !== "..")
    );
  }

  function configuration(
    marker: string,
    brain: DirectoryProbe["brain"],
  ): ConfigurationObservation {
    if (brain !== "directory") return { kind: "absent" };
    const target = symlinks.get(marker) ?? marker;
    const config = posix.join(target, "config.json");
    const text = files.get(config);
    if (text !== undefined) return { kind: "file", text };
    return directories.has(config) ? { kind: "other" } : { kind: "absent" };
  }

  function inspect(path: string): DirectoryProbe {
    const marker = posix.join(path, ".brain");
    const linked = symlinks.get(marker);
    let brain: DirectoryProbe["brain"];
    if (linked !== undefined) {
      brain = !inside(path, linked)
        ? "escaping"
        : directories.has(linked)
          ? "directory"
          : "other";
    } else if (directories.has(marker)) {
      brain = "directory";
    } else if (files.has(marker)) {
      brain = "other";
    } else {
      brain = "absent";
    }
    const legacy = posix.join(
      posix.dirname(path),
      `${posix.basename(path)}-brain`,
      ".brain",
    );
    return {
      path,
      brain,
      git: gitRoots.has(path) ? "present" : "absent",
      legacyBrain: directories.has(legacy),
      configuration: configuration(marker, brain),
    };
  }

  return {
    canonicalize: (path, base) => Promise.resolve(canonicalize(path, base)),
    inspect: (path) =>
      deferred(() => {
        const canonical = canonicalize(path, path);
        if (canonical === null) throw new Error("Workspace path is unusable");
        return inspect(canonical);
      }),
    ancestors: (start) => {
      const canonical = canonicalize(start, start);
      if (canonical === null) return Promise.resolve([]);
      const probes: DirectoryProbe[] = [];
      let current = canonical;
      for (;;) {
        probes.push(inspect(current));
        const parent = posix.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      return Promise.resolve(probes);
    },
    locateWorktree: (start) => {
      const canonical = canonicalize(start, start);
      if (canonical === null) return Promise.resolve(null);
      const location = worktrees
        .filter(({ topLevel }) => inside(topLevel, canonical))
        .sort((left, right) => right.topLevel.length - left.topLevel.length)[0];
      return Promise.resolve(location ?? null);
    },
  };
}
