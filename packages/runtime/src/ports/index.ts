import type { GitObservation } from "../domain/git/index.js";
import type {
  DirectoryProbe,
  WorktreeLocation,
} from "../domain/project/observation.js";
import type { Digests, DurableFileSystem } from "./transactions.js";
import type { TargetInspector } from "./filesystem.js";

export type { Locks } from "./locks.js";

export type {
  Digests,
  DurableEntry,
  DurableFileSystem,
} from "./transactions.js";
export type {
  TargetInspection,
  TargetInspectionSession,
  TargetInspector,
} from "./filesystem.js";

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

/**
 * Atomic Git observation.
 *
 * `observe()` never rejects: every failure the underlying process or
 * filesystem can produce is a typed variant of `GitObservation` rather than a
 * thrown error, so a caller never needs a try/catch to read a repository.
 */
export interface Git {
  observe(): Promise<GitObservation>;
}

import type { Locks } from "./locks.js";

/** Ambient process state, read through a boundary so tests can fix it. */
export interface Environment {
  get(name: string): string | undefined;
  workingDirectory(): string;
}

/**
 * Whatever the caller piped in, read once.
 *
 * `null` is the absence of a document, which is the ordinary case of a caller
 * who used a flag instead. A document that is present but blank is a
 * validation failure with a reason, and the two must not be confused: one is
 * somebody choosing another input, the other is somebody sending nothing when
 * they meant to send something.
 */
export interface StandardInput {
  read(): Promise<string | null>;
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
  readonly digests: Digests;
  readonly durableFileSystem: DurableFileSystem;
  readonly fileSystem: FileSystem;
  readonly git: Git;
  readonly locks: Locks;
  readonly environment: Environment;
  readonly output: Output;
  readonly standardInput: StandardInput;
  readonly targetInspector: TargetInspector;
  /**
   * Read-only facts about where the project is.
   *
   * Composed with the rest because a command that resolves its own root needs
   * it at dispatch time, and reaching for a second set of ports mid-command is
   * how a runtime ends up with two answers about which project it is in.
   */
  readonly workspace: Workspace;
}
