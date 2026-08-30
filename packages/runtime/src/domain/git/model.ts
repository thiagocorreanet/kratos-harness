export type GitPath =
  | { readonly kind: "text"; readonly value: string }
  | {
      readonly kind: "undecodable";
      readonly sha256: string;
      readonly bytes: number;
    };

export type GitChangeKind =
  | "none"
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type_changed";

export interface GitConflict {
  readonly ours: boolean;
  readonly theirs: boolean;
  readonly base: boolean;
}

export interface GitChange {
  readonly path: GitPath;
  readonly tracking: "tracked" | "untracked" | "ignored";
  readonly index: GitChangeKind;
  readonly worktree: GitChangeKind;
  readonly conflict: GitConflict | null;
  readonly renamedFrom: GitPath | null;
  readonly entry: "file" | "directory" | "symlink" | "submodule";
}

export interface GitUpstream {
  readonly ref: string;
  readonly ahead: number;
  readonly behind: number;
}

export type GitHead =
  | { readonly kind: "unborn"; readonly branch: string }
  | {
      readonly kind: "branch";
      readonly branch: string;
      readonly commit: string;
      readonly upstream: GitUpstream | null;
    }
  | { readonly kind: "detached"; readonly commit: string };

export type GitOperation =
  "none" | "merge" | "rebase" | "cherry_pick" | "revert";

export interface GitRepository {
  readonly head: GitHead;
  readonly worktree: "principal" | "linked";
  readonly worktreePrefix: string;
  readonly operation: GitOperation;
  readonly changes: readonly GitChange[];
}

export interface GitCommandRecord {
  readonly argv: readonly string[];
  readonly exitCode: number | null;
  readonly stdoutSha256: string;
  readonly stdoutBytes: number;
  readonly stderrSha256: string;
  readonly stderrBytes: number;
  readonly outcome: "ok" | "failed" | "timeout" | "not_spawned";
}

export type GitObservationFailureKind =
  | "git_absent"
  | "not_a_repository"
  | "timeout"
  | "command_failed"
  | "unreadable";

export type GitObservation =
  | {
      readonly kind: "observed";
      readonly repository: GitRepository;
      readonly evidence: readonly GitCommandRecord[];
    }
  | {
      readonly kind: GitObservationFailureKind;
      readonly evidence: readonly GitCommandRecord[];
    };
