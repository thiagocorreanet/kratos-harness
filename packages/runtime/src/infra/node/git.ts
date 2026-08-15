import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { GitRunner, RawCommandResult } from "../../domain/git/index.js";

export interface GitRunnerOptions {
  readonly timeoutMs?: number; // default 10_000
  readonly maxBuffer?: number; // default 16 * 1024 * 1024
  /**
   * Test-facing. Replaces the inherited `PATH` so a test can simulate Git
   * missing from the system without mutating the process environment.
   */
  readonly pathOverride?: string;
}

// `--no-optional-locks` is what keeps the observation read-only: without it
// `git status` refreshes the index as a side effect and takes the index lock,
// so a read both mutates the user's repository and can fail against a
// concurrent reader.
//
// `-c status.renames=copies` pins rename and copy detection so a repository's
// own `.git/config` cannot turn it off. Unlike the environment variables
// below, `.git/config` is not neutralized by this adapter — a repository with
// `status.renames=false` would otherwise turn every rename into a plain add
// plus a delete, and `renamedFrom` is load-bearing: a file moved out of a
// declared scope is a case the scope gate must see, and the pair is the only
// way to see it. `-c` on the command line always outranks repository config,
// so this cannot be shadowed the way an environment variable can be unset.
const PREFIX = [
  "--no-optional-locks",
  "--no-pager",
  "-c",
  "core.quotepath=false",
  "-c",
  "status.renames=copies",
] as const;

const EMPTY = new Uint8Array(0);

function toBytes(value: unknown): Uint8Array {
  return Buffer.isBuffer(value) ? new Uint8Array(value) : EMPTY;
}

/** Real Git process execution. Deliberately free of decision branches. */
export function nodeGitRunner(
  root: string,
  options: GitRunnerOptions = {},
): GitRunner {
  const timeout = options.timeoutMs ?? 10_000;
  const maxBuffer = options.maxBuffer ?? 16 * 1024 * 1024;

  return {
    run: (args) =>
      new Promise<RawCommandResult>((resolve) => {
        execFile(
          "git",
          [...PREFIX, ...args],
          {
            cwd: root,
            encoding: "buffer",
            killSignal: "SIGKILL",
            maxBuffer,
            timeout,
            windowsHide: true,
            env: {
              PATH: options.pathOverride ?? process.env.PATH ?? "",
              GIT_CONFIG_NOSYSTEM: "1",
              // A path that cannot exist neutralizes the user's ~/.gitconfig.
              // A personal `status.showUntrackedFiles=no` would otherwise
              // silently change the change set a gate evaluates.
              GIT_CONFIG_GLOBAL: join(
                root,
                ".git",
                "kratos-absent-global-config",
              ),
              GIT_OPTIONAL_LOCKS: "0",
              GIT_TERMINAL_PROMPT: "0",
              LC_ALL: "C",
            },
          },
          (error, stdout, stderr) => {
            const code = error?.code;
            resolve({
              spawned: code !== "ENOENT",
              exitCode: typeof code === "number" ? code : error ? null : 0,
              stdout: toBytes(stdout),
              stderr: toBytes(stderr),
              timedOut: error?.killed === true,
              bufferExceeded: code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
            });
          },
        );
      }),
    listGitDirectory: async (gitDir) => {
      try {
        return await readdir(gitDir);
      } catch {
        return null;
      }
    },
  };
}
