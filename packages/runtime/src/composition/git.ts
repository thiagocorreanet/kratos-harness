import {
  classifyOperation,
  classifyWorktree,
  gitCommandRecord,
  parseRevParse,
  parseStatusPorcelainV2,
  type GitCommandRecord,
  type GitObservation,
  type GitObservationFailureKind,
  type GitRunner,
} from "../domain/git/index.js";
import type { Digests, Git } from "../ports/index.js";

const REV_PARSE = [
  "rev-parse",
  "--path-format=absolute",
  "--is-inside-work-tree",
  "--git-dir",
  "--git-common-dir",
] as const;

const STATUS = [
  "status",
  "--porcelain=v2",
  "-z",
  "--branch",
  "-uall",
  "--ignored=matching",
] as const;

function failure(
  kind: GitObservationFailureKind,
  evidence: readonly GitCommandRecord[],
): GitObservation {
  return { kind, evidence };
}

/** Compose the atomic observation from a runner and a digest provider. */
export function composeGit(runner: GitRunner, digests: Digests): Git {
  return {
    observe: async (): Promise<GitObservation> => {
      const evidence: GitCommandRecord[] = [];

      const refs = await runner.run(REV_PARSE);
      evidence.push(gitCommandRecord(REV_PARSE, refs, digests));
      if (!refs.spawned) return failure("git_absent", evidence);
      if (refs.timedOut) return failure("timeout", evidence);
      // Exit 128 is how Git reports "not a repository" for rev-parse.
      if (refs.exitCode === 128) return failure("not_a_repository", evidence);
      if (refs.exitCode !== 0) return failure("command_failed", evidence);

      const facts = parseRevParse(new TextDecoder().decode(refs.stdout));
      if (facts === null) return failure("unreadable", evidence);
      // A bare repository and the inside of a .git directory both exit 0 while
      // reporting false. There is no worktree to classify in either case.
      if (!facts.insideWorkTree) return failure("not_a_repository", evidence);

      const status = await runner.run(STATUS);
      evidence.push(gitCommandRecord(STATUS, status, digests));
      if (status.timedOut) return failure("timeout", evidence);
      if (status.exitCode !== 0) return failure("command_failed", evidence);

      const parsed = parseStatusPorcelainV2(status.stdout, digests);
      if (parsed === null) return failure("unreadable", evidence);

      // A filesystem read, not a command, so it produces no evidence record.
      // An unreadable marker fails the whole observation rather than silently
      // reporting `operation: "none"`.
      const markers = await runner.listGitDirectory(facts.gitDir);
      if (markers === null) return failure("unreadable", evidence);

      return {
        kind: "observed",
        repository: {
          head: parsed.head,
          worktree: classifyWorktree(facts),
          operation: classifyOperation(markers),
          changes: parsed.changes,
        },
        evidence,
      };
    },
  };
}
