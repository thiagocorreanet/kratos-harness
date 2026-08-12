import { execFileSync } from "node:child_process";

import { nodeGitRunner, sha256Digests } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import { composeGit } from "../packages/runtime/src/composition/git.js";
import { parseStatusPorcelainV2 } from "../packages/runtime/src/domain/git/status.js";
import type {
  GitChange,
  GitChangeKind,
  GitConflict,
  GitHead,
  GitObservation,
  GitPath,
  GitRepository,
  GitUpstream,
} from "../packages/runtime/src/domain/git/index.js";

import {
  SCENARIOS,
  createScenarioRepository,
  digestTree,
  type ScenarioName,
} from "./support/git-repositories.js";

const digests = sha256Digests();

/**
 * The proof this suite exists for: every classified Git state, observed
 * against a real repository rather than a hand-written byte vector, with the
 * expected `repository` computed independently of the code under test.
 */

// A `head.commit` is a real object id Git assigns during scenario
// construction, not a value this suite can predict. It is read back with an
// independent `rev-parse`, not derived from the observation being tested.
function commitId(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

const text = (value: string): GitPath => ({ kind: "text", value });

function branchHead(
  root: string,
  branch = "main",
  upstream: GitUpstream | null = null,
): GitHead {
  return { kind: "branch", branch, commit: commitId(root), upstream };
}

function repository(
  head: GitHead,
  options: {
    readonly worktree?: GitRepository["worktree"];
    readonly operation?: GitRepository["operation"];
    readonly changes?: readonly GitChange[];
  } = {},
): GitRepository {
  return {
    head,
    worktree: options.worktree ?? "principal",
    operation: options.operation ?? "none",
    changes: options.changes ?? [],
  };
}

function change(fields: {
  readonly path: GitPath;
  readonly tracking: GitChange["tracking"];
  readonly index: GitChangeKind;
  readonly worktree: GitChangeKind;
  readonly conflict?: GitConflict | null;
  readonly renamedFrom?: GitPath | null;
  readonly entry: GitChange["entry"];
}): GitChange {
  return {
    conflict: null,
    renamedFrom: null,
    ...fields,
  };
}

const CONFLICT: GitConflict = { ours: true, theirs: true, base: true };

/** The unmerged `f.txt` record every conflict scenario below produces. */
function conflictedFile(): GitChange {
  return change({
    path: text("f.txt"),
    tracking: "tracked",
    index: "modified",
    worktree: "modified",
    conflict: CONFLICT,
    entry: "file",
  });
}

/**
 * The unmerged `f.txt` record `delete-modify-conflict` produces: ours (main)
 * modified it and is present, theirs (other) deleted it and is absent. This
 * is what an implementation that hardcodes `{ true, true, true }` — correct
 * only for a symmetric both-sides-modified conflict — gets wrong.
 */
function deleteModifyConflictedFile(): GitChange {
  return change({
    path: text("f.txt"),
    tracking: "tracked",
    index: "modified",
    worktree: "modified",
    conflict: { ours: true, theirs: false, base: true },
    entry: "file",
  });
}

type Expected =
  | { readonly kind: "observed"; readonly repository: GitRepository }
  | { readonly kind: Exclude<GitObservation["kind"], "observed"> };

function observed(repo: GitRepository): Expected {
  return { kind: "observed", repository: repo };
}

const EXPECTED: Record<ScenarioName, (root: string) => Expected> = {
  "not-a-repository": () => ({ kind: "not_a_repository" }),

  unborn: () => observed(repository({ kind: "unborn", branch: "main" })),

  clean: (root) => observed(repository(branchHead(root))),

  staged: (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("b.txt"),
            tracking: "tracked",
            index: "added",
            worktree: "none",
            entry: "file",
          }),
        ],
      }),
    ),

  unstaged: (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("a.txt"),
            tracking: "tracked",
            index: "none",
            worktree: "modified",
            entry: "file",
          }),
        ],
      }),
    ),

  "staged-and-unstaged": (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("a.txt"),
            tracking: "tracked",
            index: "modified",
            worktree: "modified",
            entry: "file",
          }),
        ],
      }),
    ),

  deleted: (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("a.txt"),
            tracking: "tracked",
            index: "none",
            worktree: "deleted",
            entry: "file",
          }),
        ],
      }),
    ),

  untracked: (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("new.txt"),
            tracking: "untracked",
            index: "none",
            worktree: "none",
            entry: "file",
          }),
        ],
      }),
    ),

  "ignored-file": (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("debug.log"),
            tracking: "ignored",
            index: "none",
            worktree: "none",
            entry: "file",
          }),
        ],
      }),
    ),

  "ignored-directory": (root) =>
    observed(
      repository(branchHead(root), {
        // The whole directory collapses to one entry: this is what proves
        // `--ignored=matching` (not `traditional`) is the flag actually live
        // in the adapter.
        changes: [
          change({
            path: text("node_modules/"),
            tracking: "ignored",
            index: "none",
            worktree: "none",
            entry: "directory",
          }),
        ],
      }),
    ),

  renamed: (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("new.txt"),
            tracking: "tracked",
            index: "renamed",
            worktree: "none",
            renamedFrom: text("old.txt"),
            entry: "file",
          }),
        ],
      }),
    ),

  copied: (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("copy.txt"),
            tracking: "tracked",
            index: "copied",
            worktree: "none",
            renamedFrom: text("origin.txt"),
            entry: "file",
          }),
          change({
            path: text("origin.txt"),
            tracking: "tracked",
            index: "modified",
            worktree: "none",
            entry: "file",
          }),
        ],
      }),
    ),

  "type-changed": (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("f.txt"),
            tracking: "tracked",
            index: "type_changed",
            worktree: "none",
            entry: "symlink",
          }),
        ],
      }),
    ),

  symlink: (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("link.txt"),
            tracking: "tracked",
            index: "none",
            worktree: "modified",
            entry: "symlink",
          }),
        ],
      }),
    ),

  submodule: (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text(".gitmodules"),
            tracking: "tracked",
            index: "added",
            worktree: "none",
            entry: "file",
          }),
          change({
            path: text("vendor/sub"),
            tracking: "tracked",
            index: "added",
            worktree: "none",
            entry: "submodule",
          }),
        ],
      }),
    ),

  detached: (root) =>
    observed(repository({ kind: "detached", commit: commitId(root) })),

  "branch-with-upstream": (root) =>
    observed(
      repository(
        branchHead(root, "main", { ref: "origin/main", ahead: 1, behind: 0 }),
      ),
    ),

  "linked-worktree": (root) =>
    observed(repository(branchHead(root, "feature"), { worktree: "linked" })),

  "merge-conflict": (root) =>
    observed(
      repository(branchHead(root), {
        operation: "merge",
        changes: [conflictedFile()],
      }),
    ),

  "rebase-conflict": (root) =>
    observed(
      repository(
        { kind: "detached", commit: commitId(root) },
        { operation: "rebase", changes: [conflictedFile()] },
      ),
    ),

  "cherry-pick-conflict": (root) =>
    observed(
      repository(branchHead(root), {
        operation: "cherry_pick",
        changes: [conflictedFile()],
      }),
    ),

  "revert-conflict": (root) =>
    observed(
      repository(branchHead(root), {
        operation: "revert",
        changes: [conflictedFile()],
      }),
    ),

  "delete-modify-conflict": (root) =>
    observed(
      repository(branchHead(root), {
        operation: "merge",
        changes: [deleteModifyConflictedFile()],
      }),
    ),

  "name-with-space": (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("a file.txt"),
            tracking: "untracked",
            index: "none",
            worktree: "none",
            entry: "file",
          }),
        ],
      }),
    ),

  "name-with-newline": (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("line1\nline2.txt"),
            tracking: "untracked",
            index: "none",
            worktree: "none",
            entry: "file",
          }),
        ],
      }),
    ),

  "name-with-unicode": (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("café-日本語.txt"),
            tracking: "untracked",
            index: "none",
            worktree: "none",
            entry: "file",
          }),
        ],
      }),
    ),

  "name-with-leading-dash": (root) =>
    observed(
      repository(branchHead(root), {
        changes: [
          change({
            path: text("-dashfile.txt"),
            tracking: "tracked",
            index: "added",
            worktree: "none",
            entry: "file",
          }),
        ],
      }),
    ),
};

describe("real-repository scenario corpus", () => {
  it.each(SCENARIOS)("observes %s as expected", async (name) => {
    const scenario = await createScenarioRepository(name);
    try {
      if (!scenario.available) {
        // A scenario that vanishes from a green report is indistinguishable
        // from one that passed, so the absence is asserted rather than
        // skipped.
        expect(scenario.reason).toBeTypeOf("string");
        return;
      }

      const observation = await composeGit(
        nodeGitRunner(scenario.root),
        digests,
      ).observe();
      const expected = EXPECTED[name](scenario.root);

      expect(observation.kind).toBe(expected.kind);
      if (observation.kind === "observed" && expected.kind === "observed") {
        expect(observation.repository).toEqual(expected.repository);
      }

      // Evidence digests vary with the repository's own object ids, so shape
      // — not value — is what is asserted here: a successful observation
      // always runs exactly two commands, both of which succeed.
      if (observation.kind === "observed") {
        expect(observation.evidence).toHaveLength(2);
        for (const record of observation.evidence) {
          expect(record.outcome).toBe("ok");
        }
      } else {
        expect(observation.evidence.length).toBeGreaterThan(0);
        for (const record of observation.evidence) {
          expect(record.outcome).not.toBe("ok");
        }
      }
    } finally {
      await scenario.dispose();
    }
  });

  it.each(SCENARIOS)("leaves %s byte-identical", async (name) => {
    const scenario = await createScenarioRepository(name);
    try {
      if (!scenario.available) {
        expect(scenario.reason).toBeTypeOf("string");
        return;
      }

      const before = await digestTree(scenario.root);
      await composeGit(nodeGitRunner(scenario.root), digests).observe();

      // An index refresh changes .git/index and nothing else, so a digest
      // that skipped .git would let a mutating observation pass.
      expect(await digestTree(scenario.root)).toBe(before);
    } finally {
      await scenario.dispose();
    }
  });

  it.each(SCENARIOS)("observes %s deterministically", async (name) => {
    const scenario = await createScenarioRepository(name);
    try {
      if (!scenario.available) {
        expect(scenario.reason).toBeTypeOf("string");
        return;
      }

      const git = composeGit(nodeGitRunner(scenario.root), digests);

      expect(await git.observe()).toEqual(await git.observe());
    } finally {
      await scenario.dispose();
    }
  });

  it.each(SCENARIOS)("parses the real status bytes of %s", async (name) => {
    const scenario = await createScenarioRepository(name);
    try {
      if (!scenario.available) return;

      const status = await nodeGitRunner(scenario.root).run([
        "status",
        "--porcelain=v2",
        "-z",
        "--branch",
        "-uall",
        "--ignored=matching",
      ]);
      if (status.exitCode !== 0) return;

      // The parser must accept every byte sequence Git actually produces. A
      // hand-written vector that drifts from real output fails here, which is
      // what keeps the pure parser tests honest.
      expect(parseStatusPorcelainV2(status.stdout, digests)).not.toBeNull();
    } finally {
      await scenario.dispose();
    }
  });

  it.each(SCENARIOS)(
    "derives no argv element from observed data in %s",
    async (name) => {
      const scenario = await createScenarioRepository(name);
      try {
        if (!scenario.available) return;
        const observation = await composeGit(
          nodeGitRunner(scenario.root),
          digests,
        ).observe();
        const allowed = new Set([
          "rev-parse",
          "--path-format=absolute",
          "--is-inside-work-tree",
          "--git-dir",
          "--git-common-dir",
          "status",
          "--porcelain=v2",
          "-z",
          "--branch",
          "-uall",
          "--ignored=matching",
        ]);

        for (const record of observation.evidence) {
          for (const argument of record.argv)
            expect(allowed).toContain(argument);
        }
      } finally {
        await scenario.dispose();
      }
    },
  );
});
