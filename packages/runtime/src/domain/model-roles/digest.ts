import { canonicalizeJson } from "../schema/index.js";

import type { ResolvedPhaseAssignment } from "./model.js";

/** Bind a canonical resolved assignment to its configuration and run revision. */
export function digestPhaseAssignment(
  input: {
    readonly configDigest: string;
    readonly runId: string;
    readonly revision: number;
    readonly host: "claude" | "codex";
    readonly assignment: ResolvedPhaseAssignment;
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
    }),
  );
}
