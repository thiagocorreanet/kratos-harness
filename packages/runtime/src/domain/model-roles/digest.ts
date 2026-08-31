import { canonicalizeJson } from "../schema/index.js";

import type { ResolvedPhaseAssignment } from "./model.js";

type PhaseMemoryBinding = null | {
  readonly ref: ".brain/03-memory/gotchas.md";
  readonly sha256: string;
  readonly lessonIds: readonly string[];
};

/** Bind a canonical resolved assignment to its configuration and run revision. */
export function digestPhaseAssignment(
  input: {
    readonly configDigest: string;
    readonly runId: string;
    readonly revision: number;
    readonly host: "claude" | "codex" | "antigravity";
    readonly assignment: ResolvedPhaseAssignment;
    /** The exact curated-memory observation shown to the assigned agent. */
    readonly memory: PhaseMemoryBinding;
  },
  sha256: (canonical: string) => string,
): string {
  return sha256(
    canonicalizeJson({
      configDigest: input.configDigest,
      runId: input.runId,
      revision: input.revision,
      phase: input.assignment.phase,
      host: input.host,
      role: input.assignment.role,
      model: input.assignment.model,
      effort: input.assignment.effort,
      memory:
        input.memory === null
          ? null
          : {
              ref: input.memory.ref,
              sha256: input.memory.sha256,
              lessonIds: [...input.memory.lessonIds],
            },
    }),
  );
}
