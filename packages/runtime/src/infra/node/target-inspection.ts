import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { canonicalizeProjectPath } from "../../domain/paths/index.js";
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
  const canonicalResult = canonicalizeProjectPath(target, {
    root: canonicalRoot,
  });
  if (canonicalResult.kind === "refused") {
    return canonicalResult.reasonCode === "guard.path_escape"
      ? { kind: "escape" }
      : { kind: "uninspectable" };
  }
  if (canonicalResult.path === "") {
    return { kind: "uninspectable" };
  }
  const lexicalPath = canonicalResult.path;
  const candidate = resolve(canonicalRoot, lexicalPath);

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
