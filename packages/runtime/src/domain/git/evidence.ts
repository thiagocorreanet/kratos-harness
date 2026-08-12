import type { Digests } from "../../ports/index.js";
import type { GitCommandRecord } from "./model.js";

/** Exactly what the Node runner returns for one invocation. */
export interface RawCommandResult {
  readonly spawned: boolean;
  readonly exitCode: number | null;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
  readonly timedOut: boolean;
}

/**
 * The low-level execution boundary the observation is composed from.
 *
 * It lives in the domain because it is an interface with no Node dependency of
 * its own. Declaring it in `infra/node` would force `composition/git.ts` to
 * import an infrastructure module for a type.
 *
 * Implementations should resolve, never reject: a process that failed to
 * spawn, timed out, or exited non-zero is a normal `RawCommandResult`
 * (`spawned: false`, `timedOut: true`, a non-zero `exitCode`), and a git
 * directory that cannot be listed is `null` — none of these are exceptions.
 * `composeGit` defends against a rejecting implementation anyway, mapping any
 * rejection to the `unreadable` observation rather than letting it escape, so
 * a runner that breaks this expectation degrades the observation instead of
 * breaking `observe()`'s own never-rejects contract.
 */
export interface GitRunner {
  run(args: readonly string[]): Promise<RawCommandResult>;
  listGitDirectory(gitDir: string): Promise<readonly string[] | null>;
}

function outcomeOf(result: RawCommandResult): GitCommandRecord["outcome"] {
  if (!result.spawned) return "not_spawned";
  if (result.timedOut) return "timeout";
  return result.exitCode === 0 ? "ok" : "failed";
}

/**
 * Build the evidence record for one invocation.
 *
 * Output bytes, duration, and timestamps are all absent by construction. Any of
 * them would make two observations of an unchanged repository unequal, which is
 * the determinism property the observation is tested for. `argv` is safe to
 * record because the command sequence is fixed and carries no user data.
 */
export function gitCommandRecord(
  argv: readonly string[],
  result: RawCommandResult,
  digests: Digests,
): GitCommandRecord {
  return {
    argv: [...argv],
    exitCode: result.exitCode,
    stdoutSha256: digests.sha256Bytes(result.stdout),
    stdoutBytes: result.stdout.length,
    stderrSha256: digests.sha256Bytes(result.stderr),
    stderrBytes: result.stderr.length,
    outcome: outcomeOf(result),
  };
}
