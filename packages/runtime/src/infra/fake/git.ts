import type { GitObservation } from "../../domain/git/index.js";
import type { Git } from "../../ports/index.js";

/** Deterministic default: a clean principal worktree with nothing to report. */
const CLEAN_PRINCIPAL: GitObservation = {
  kind: "observed",
  repository: {
    head: {
      kind: "branch",
      branch: "main",
      commit: "0".repeat(40),
      upstream: null,
    },
    worktree: "principal",
    worktreePrefix: "",
    operation: "none",
    changes: [],
  },
  evidence: [],
};

/** A Git port that reports a fixed observation, so a test runs no process. */
export function stubGit(observation: GitObservation = CLEAN_PRINCIPAL): Git {
  return {
    observe: () => Promise.resolve(observation),
  };
}
