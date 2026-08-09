import type {
  DirectoryProbe,
  WorktreeLocation,
} from "../domain/project/observation.js";

export type {
  Digests,
  DurableEntry,
  DurableFileSystem,
} from "./transactions.js";

/**
 * Injected effect boundaries.
 *
 * Every capability the deterministic core is not allowed to reach directly —
 * the clock, randomness, the filesystem, Git, locking, the process
 * environment, and output streams — arrives through one of these interfaces.
 *
 * These are interfaces only. A port that carried an implementation would drag
 * its runtime dependencies into every module that imports it, which is exactly
 * what the layering exists to prevent.
 */

/** Current instant, so nothing in the core reads a wall clock. */
export interface Clock {
  now(): Date;
}

/** Identifier generation, so nothing in the core reaches for randomness. */
export interface Ids {
  next(): string;
}

export interface FileStat {
  readonly kind: "file" | "directory" | "symlink";
  readonly size: number;
}

/** Project-scoped filesystem access. Paths are project-relative. */
export interface FileSystem {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  list(path: string): Promise<readonly string[]>;
  stat(path: string): Promise<FileStat | null>;
}

export type RepositoryState =
  "absent" | "clean" | "dirty" | "detached" | "unborn";

/**
 * Repository classification. `RUN-08` owns the semantics; this fixes the shape
 * so it implements against a settled interface instead of inventing one.
 */
export interface Git {
  state(): Promise<RepositoryState>;
  head(): Promise<string | null>;
  changedPaths(): Promise<readonly string[]>;
}

export interface Lease {
  readonly owner: string;
  readonly fencingToken: number;
  readonly expiresAt: Date;
}

/** Serialized mutation leases. `RUN-07` owns expiry and fencing semantics. */
export interface Locks {
  acquire(scope: string, ttlMs: number): Promise<Lease | null>;
  release(lease: Lease): Promise<void>;
}

/** Ambient process state, read through a boundary so tests can fix it. */
export interface Environment {
  get(name: string): string | undefined;
  workingDirectory(): string;
}

/** Output streams, so rendering is observable rather than a side effect. */
export interface Output {
  structured(text: string): void;
  human(text: string): void;
}

/** Read-only filesystem and Git facts available before a project root exists. */
export interface Workspace {
  canonicalize(path: string, base: string): Promise<string | null>;
  inspect(path: string): Promise<DirectoryProbe>;
  ancestors(start: string): Promise<readonly DirectoryProbe[]>;
  locateWorktree(start: string): Promise<WorktreeLocation | null>;
}

/** The complete set of injected boundaries a runtime is composed from. */
export interface RuntimePorts {
  readonly clock: Clock;
  readonly ids: Ids;
  readonly fileSystem: FileSystem;
  readonly git: Git;
  readonly locks: Locks;
  readonly environment: Environment;
  readonly output: Output;
}
