import type { GitOperation } from "./model.js";

export interface RevParseFacts {
  readonly insideWorkTree: boolean;
  readonly gitDir: string;
  readonly gitCommonDir: string;
}

/** Read the three fields `rev-parse` emits, one per line, in argument order. */
export function parseRevParse(stdout: string): RevParseFacts | null {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  if (lines.length !== 3) return null;
  /* v8 ignore next -- `lines.length === 3` is checked above, so index 0
   * always exists; the fallback exists only because noUncheckedIndexedAccess
   * types the read as possibly undefined. */
  const worktree = lines[0] ?? "";
  /* v8 ignore next -- see the index-0 fallback above; index 1 is covered by
   * the same length check. */
  const gitDir = lines[1] ?? "";
  /* v8 ignore next -- see the index-0 fallback above; index 2 is covered by
   * the same length check. */
  const gitCommonDir = lines[2] ?? "";
  if (worktree !== "true" && worktree !== "false") return null;
  return { insideWorkTree: worktree === "true", gitDir, gitCommonDir };
}

/** A linked worktree is exactly a git dir that differs from the common dir. */
export function classifyWorktree(facts: RevParseFacts): "principal" | "linked" {
  return facts.gitDir === facts.gitCommonDir ? "principal" : "linked";
}

// Ordered by precedence, not alphabetically. An interactive rebase resolving a
// conflict leaves MERGE_HEAD as well; the rebase is the operation the user is
// in, and the merge is one step inside it.
const OPERATIONS: readonly (readonly [string, GitOperation])[] = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase"],
  ["CHERRY_PICK_HEAD", "cherry_pick"],
  ["REVERT_HEAD", "revert"],
  ["MERGE_HEAD", "merge"],
];

/** Classify the in-progress operation from git-directory entry names. */
export function classifyOperation(markers: readonly string[]): GitOperation {
  const present = new Set(markers);
  for (const [marker, operation] of OPERATIONS) {
    if (present.has(marker)) return operation;
  }
  return "none";
}
