/**
 * What a legacy sibling Brain holds, and what would move into the project.
 *
 * The observation is supplied rather than read, so the decision is a pure
 * function of the facts and the same layout always produces the same plan.
 */
export interface MigrationEntry {
  /** Path relative to the Brain root, never absolute and never escaping it. */
  readonly path: string;
  readonly kind: "file" | "directory" | "other";
  readonly sha256: string | null;
  readonly bytes: number;
}

export interface MigrationObservation {
  /**
   * Every sibling layout discovery recognized.
   *
   * More than one is not a preference to resolve: two candidates mean the
   * runtime cannot know which project the state belongs to.
   */
  readonly candidates: readonly string[];
  /** What the recognized legacy layout holds, or null when there is none. */
  readonly legacy: readonly MigrationEntry[] | null;
  /** What the project's own `.brain` already holds. */
  readonly destination: readonly MigrationEntry[];
}

export type MigrationAction =
  | {
      readonly kind: "copy";
      readonly source: string;
      readonly target: string;
      readonly sha256: string;
      readonly bytes: number;
      readonly reason: "absent_in_project";
    }
  | {
      readonly kind: "skip";
      readonly source: string;
      readonly target: string;
      readonly sha256: string;
      readonly reason: "identical_in_project";
    }
  | {
      readonly kind: "conflict";
      readonly source: string;
      readonly target: string;
      readonly sourceSha256: string;
      /** Absent when the project holds something that is not a file there. */
      readonly targetSha256: string | null;
      readonly reason: "differs_in_project";
    }
  | {
      readonly kind: "unsupported";
      readonly source: string;
      readonly target: string;
      readonly reason: "not_a_regular_file";
    };

export type MigrationPlan =
  | { readonly kind: "nothing_to_migrate" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly string[] }
  | {
      readonly kind: "blocked";
      readonly actions: readonly MigrationAction[];
      readonly blocking: readonly MigrationAction[];
    }
  | {
      readonly kind: "ready";
      readonly actions: readonly MigrationAction[];
      /** Bytes the copy actions would write, so free space can be checked. */
      readonly requiredBytes: number;
      /** Whether every action can be undone by removing what it wrote. */
      readonly reversible: true;
      readonly planDigest: string;
    };

// Two entries never share a source path, so a two-way comparison is total.
function byPath(left: { source: string }, right: { source: string }): number {
  return left.source < right.source ? -1 : 1;
}

/**
 * Decide what a migration would do, without doing any of it.
 *
 * Every entry produces exactly one action naming its source, its target, the
 * transformation, and why. An entry the plan cannot describe blocks the
 * migration rather than being carried across unexplained.
 */
export function planBrainMigration(
  observation: MigrationObservation,
  sha256: (value: string) => string,
): MigrationPlan {
  if (observation.candidates.length > 1) {
    return Object.freeze({
      kind: "ambiguous" as const,
      candidates: Object.freeze([...observation.candidates].sort()),
    });
  }
  const legacy = observation.legacy;
  if (legacy === null || legacy.length === 0) {
    return Object.freeze({ kind: "nothing_to_migrate" as const });
  }

  const existing = new Map(
    observation.destination.map((entry) => [entry.path, entry]),
  );
  const actions: MigrationAction[] = [];
  for (const entry of legacy) {
    const target = `.brain/${entry.path}`;
    if (entry.kind !== "file" || entry.sha256 === null) {
      // A directory is created by the file it holds, and anything else is
      // state no transformation is declared for.
      if (entry.kind !== "directory") {
        actions.push({
          kind: "unsupported",
          source: entry.path,
          target,
          reason: "not_a_regular_file",
        });
      }
      continue;
    }
    const current = existing.get(entry.path);
    if (current === undefined) {
      actions.push({
        kind: "copy",
        source: entry.path,
        target,
        sha256: entry.sha256,
        bytes: entry.bytes,
        reason: "absent_in_project",
      });
      continue;
    }
    if (current.sha256 === entry.sha256) {
      actions.push({
        kind: "skip",
        source: entry.path,
        target,
        sha256: entry.sha256,
        reason: "identical_in_project",
      });
      continue;
    }
    // The project's own state wins by default: overwriting it silently is how
    // a migration destroys the work it was meant to preserve.
    actions.push({
      kind: "conflict",
      source: entry.path,
      target,
      sourceSha256: entry.sha256,
      targetSha256: current.sha256,
      reason: "differs_in_project",
    });
  }

  const ordered = Object.freeze([...actions].sort(byPath));
  const blocking = ordered.filter(
    (action) => action.kind === "conflict" || action.kind === "unsupported",
  );
  if (blocking.length !== 0) {
    return Object.freeze({
      kind: "blocked" as const,
      actions: ordered,
      blocking: Object.freeze(blocking),
    });
  }
  const requiredBytes = ordered.reduce(
    (total, action) => (action.kind === "copy" ? total + action.bytes : total),
    0,
  );
  return Object.freeze({
    kind: "ready" as const,
    actions: ordered,
    requiredBytes,
    // Every action either writes a file that was absent or writes nothing, so
    // undoing the migration is removing exactly what it created.
    reversible: true as const,
    planDigest: sha256(JSON.stringify(ordered)),
  });
}
