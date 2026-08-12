import type { GitOperation } from "./model.js";

export interface RevParseFacts {
  readonly insideWorkTree: boolean;
  readonly gitDir: string;
  readonly gitCommonDir: string;
}

function isTriple(
  lines: readonly string[],
): lines is readonly [string, string, string] {
  return lines.length === 3;
}

/** Read the three fields `rev-parse` emits, one per line, in argument order. */
export function parseRevParse(stdout: string): RevParseFacts | null {
  const lines = stdout.split("\n").filter((line) => line.length > 0);
  if (!isTriple(lines)) return null;
  const [worktree, gitDir, gitCommonDir] = lines;
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
