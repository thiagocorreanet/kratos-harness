export type BrainMarker = "absent" | "directory" | "other" | "escaping";

export type ConfigurationObservation =
  | { readonly kind: "absent" | "other" }
  | { readonly kind: "file"; readonly text: string };

/** One canonical ancestor inspected without interpreting its contents. */
export interface DirectoryProbe {
  /** Internal absolute path. It must never be copied to public output. */
  readonly path: string;
  readonly brain: BrainMarker;
  readonly git: "absent" | "present";
  readonly legacyBrain: boolean;
  readonly configuration: ConfigurationObservation;
}

export interface WorktreeLocation {
  readonly kind: "principal" | "linked";
  /** Internal absolute path. It must never be copied to public output. */
  readonly topLevel: string;
  /** Internal absolute path. It must never be copied to public output. */
  readonly principal: string;
}

/** Read-only facts collected by a Workspace adapter. */
export interface WorkspaceObservation {
  readonly canonicalWorkingDirectory: string | null;
  readonly canonicalExplicitRoot: string | null;
  readonly ancestors: readonly DirectoryProbe[];
  /** Principal-worktree chain, populated only for linked worktrees. */
  readonly principalAncestors: readonly DirectoryProbe[];
  readonly worktree: WorktreeLocation | null;
}
