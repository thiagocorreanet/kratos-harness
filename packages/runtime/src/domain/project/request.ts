/** Whether linked-worktree discovery may fall back to the principal worktree. */
export type WorktreeMode = "principal" | "local";

/** Untrusted invocation context supplied to project discovery. */
export interface DiscoveryRequest {
  readonly workingDirectory: string;
  readonly explicitRoot: string | null;
  readonly worktreeMode: WorktreeMode;
}
