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
  TargetInspector,
} from "../../ports/filesystem.js";

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
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

async function inspect(
  root: string,
  target: string,
): Promise<TargetInspection> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(root);
  } catch {
    return { kind: "uninspectable" };
  }
  if (/^[A-Za-z]:[\\/]/u.test(target)) return { kind: "escape" };
  const candidate = lexicalCandidate(canonicalRoot, target);
  if (candidate === null) return { kind: "uninspectable" };
  if (!inside(canonicalRoot, candidate)) return { kind: "escape" };

  const suffix: string[] = [];
  let ancestor = candidate;
  for (;;) {
    try {
      await lstat(ancestor);
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
    canonicalAncestor = await realpath(ancestor);
  } catch {
    // lstat succeeded but realpath did not: the existing entry is most
    // commonly a dangling symlink, and its destination cannot be proven safe.
    return { kind: "uninspectable" };
  }
  if (!inside(canonicalRoot, canonicalAncestor)) return { kind: "escape" };

  const canonicalTarget = resolve(canonicalAncestor, ...suffix);
  if (!inside(canonicalRoot, canonicalTarget)) return { kind: "escape" };
  const projectPath = relative(canonicalRoot, canonicalTarget)
    .split(sep)
    .join("/");
  return projectPath === ""
    ? { kind: "uninspectable" }
    : { kind: "inside", path: projectPath };
}

/** Inspect targets without opening or mutating them. */
export function nodeTargetInspector(root: string): TargetInspector {
  return { inspect: (target) => inspect(root, target) };
}
