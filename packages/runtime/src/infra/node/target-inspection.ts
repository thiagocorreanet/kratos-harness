import { lstat, realpath } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import type {
  TargetInspection,
  TargetInspectionSession,
  TargetInspector,
} from "../../ports/filesystem.js";
import {
  captureCanonicalRoot,
  type CanonicalRootIdentity,
} from "./transactions.js";

interface InspectionStat {
  readonly dev: number;
  readonly ino: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface TargetInspectionOperations {
  captureRoot(root: string): CanonicalRootIdentity | Error;
  lstat(path: string): Promise<InspectionStat>;
  realpath(path: string): Promise<string>;
}

const nodeOperations: TargetInspectionOperations = {
  captureRoot: (root) => captureCanonicalRoot(root),
  lstat,
  realpath,
};

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function lexicalCandidate(root: string, target: string): string | null {
  if (
    target.length === 0 ||
    target.includes("\\") ||
    hasControlCharacter(target)
  ) {
    return null;
  }
  return resolve(root, isAbsolute(target) ? target : resolve(root, target));
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function missingPath(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function rootMatches(
  identity: CanonicalRootIdentity,
  operations: TargetInspectionOperations,
): Promise<boolean> {
  try {
    const details = await operations.lstat(identity.path);
    return (
      details.isDirectory() &&
      !details.isSymbolicLink() &&
      details.dev === identity.device &&
      details.ino === identity.inode &&
      (await operations.realpath(identity.path)) === identity.path
    );
  } catch {
    return false;
  }
}

async function inspect(
  identity: CanonicalRootIdentity,
  target: string,
  operations: TargetInspectionOperations,
): Promise<TargetInspection> {
  const canonicalRoot = identity.path;
  if (!(await rootMatches(identity, operations))) {
    return { kind: "uninspectable" };
  }
  if (/^[A-Za-z]:[\\/]/u.test(target)) return { kind: "escape" };
  const candidate = lexicalCandidate(canonicalRoot, target);
  if (candidate === null) return { kind: "uninspectable" };
  if (!inside(canonicalRoot, candidate)) return { kind: "escape" };
  const lexicalPath = relative(canonicalRoot, candidate).split(sep).join("/");
  if (lexicalPath === "") return { kind: "uninspectable" };

  const suffix: string[] = [];
  let ancestor = candidate;
  for (;;) {
    try {
      await operations.lstat(ancestor);
      break;
    } catch (error) {
      if (!missingPath(error)) return { kind: "uninspectable" };
      const parent = dirname(ancestor);
      if (parent === ancestor) return { kind: "uninspectable" };
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }

  let canonicalAncestor: string;
  try {
    canonicalAncestor = await operations.realpath(ancestor);
  } catch {
    // lstat succeeded but realpath did not: the existing entry is most
    // commonly a dangling symlink, and its destination cannot be proven safe.
    return { kind: "uninspectable" };
  }
  if (!inside(canonicalRoot, canonicalAncestor)) return { kind: "escape" };
  if (suffix.length > 0) {
    try {
      if (!(await operations.lstat(canonicalAncestor)).isDirectory()) {
        return { kind: "uninspectable" };
      }
    } catch {
      return { kind: "uninspectable" };
    }
  }

  const canonicalTarget = resolve(canonicalAncestor, ...suffix);
  if (!inside(canonicalRoot, canonicalTarget)) return { kind: "escape" };
  const canonicalPath = relative(canonicalRoot, canonicalTarget)
    .split(sep)
    .join("/");
  return canonicalPath === ""
    ? { kind: "uninspectable" }
    : { kind: "inside", lexicalPath, canonicalPath };
}

/** Inspect targets without opening or mutating them. */
export function nodeTargetInspector(
  root: string,
  operations: TargetInspectionOperations = nodeOperations,
): TargetInspector {
  return {
    capture(): Promise<TargetInspectionSession> {
      const identity = operations.captureRoot(root);
      if (identity instanceof Error) return Promise.reject(identity);
      return Promise.resolve({
        inspect: (target) => inspect(identity, target, operations),
      });
    },
  };
}
