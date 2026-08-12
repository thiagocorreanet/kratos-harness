import { sha256Digests } from "@mestre-yoda/runtime/infra/node";
import { describe, expect, it } from "vitest";

import { composeGit } from "../packages/runtime/src/composition/git.js";
import type {
  GitRunner,
  RawCommandResult,
} from "../packages/runtime/src/domain/git/index.js";

const digests = sha256Digests();
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const EMPTY = new Uint8Array(0);

const ok = (stdout: string): RawCommandResult => ({
  spawned: true,
  exitCode: 0,
  stdout: utf8(stdout),
  stderr: EMPTY,
  timedOut: false,
});

const REFS_OK = "true\n/p/.git\n/p/.git\n";
const STATUS_OK = "# branch.oid " + "a".repeat(40) + "\0# branch.head main\0";

/** Drive the sequence by position: first call is rev-parse, second is status. */
function runner(
  results: readonly RawCommandResult[],
  markers: readonly string[] | null = ["HEAD"],
): GitRunner {
  let call = 0;
  return {
    run: (): Promise<RawCommandResult> => {
      const result = results[call] ?? ok("");
      call += 1;
      return Promise.resolve(result);
    },
    listGitDirectory: () => Promise.resolve(markers),
  };
}

const observe = (
  results: readonly RawCommandResult[],
  markers: readonly string[] | null = ["HEAD"],
) => composeGit(runner(results, markers), digests).observe();

describe("successful observation", () => {
  it("assembles a clean principal worktree", async () => {
    const result = await observe([ok(REFS_OK), ok(STATUS_OK)]);

    expect(result).toEqual({
      kind: "observed",
      repository: {
        head: {
          kind: "branch",
          branch: "main",
          commit: "a".repeat(40),
          upstream: null,
        },
        worktree: "principal",
        operation: "none",
        changes: [],
      },
      evidence: [
        {
          argv: [
            "rev-parse",
            "--path-format=absolute",
            "--is-inside-work-tree",
            "--git-dir",
            "--git-common-dir",
          ],
          exitCode: 0,
          stdoutSha256: digests.sha256Bytes(utf8(REFS_OK)),
          stdoutBytes: utf8(REFS_OK).length,
          stderrSha256: digests.sha256Bytes(EMPTY),
          stderrBytes: 0,
          outcome: "ok",
        },
        {
          argv: [
            "status",
            "--porcelain=v2",
            "-z",
            "--branch",
            "-uall",
            "--ignored=matching",
          ],
          exitCode: 0,
          stdoutSha256: digests.sha256Bytes(utf8(STATUS_OK)),
          stdoutBytes: utf8(STATUS_OK).length,
          stderrSha256: digests.sha256Bytes(EMPTY),
          stderrBytes: 0,
          outcome: "ok",
        },
      ],
    });
  });

  it("reports a linked worktree when the git dirs differ", async () => {
    const result = await observe([
      ok("true\n/p/.git/worktrees/f\n/p/.git\n"),
      ok(STATUS_OK),
    ]);

    expect(result.kind === "observed" && result.repository.worktree).toBe(
      "linked",
    );
  });

  it("reports the in-progress operation from git-directory markers", async () => {
    const result = await observe([ok(REFS_OK), ok(STATUS_OK)], ["MERGE_HEAD"]);

    expect(result.kind === "observed" && result.repository.operation).toBe(
      "merge",
    );
  });

  it("records no evidence for the marker read", async () => {
    const result = await observe([ok(REFS_OK), ok(STATUS_OK)]);

    expect(result.evidence).toHaveLength(2);
  });
});

describe("failure classification", () => {
  it("reports git_absent when the process never spawned", async () => {
    const result = await observe([
      {
        spawned: false,
        exitCode: null,
        stdout: EMPTY,
        stderr: EMPTY,
        timedOut: false,
      },
    ]);

    expect(result.kind).toBe("git_absent");
    expect(result.evidence).toHaveLength(1);
  });

  it("reports not_a_repository when rev-parse exits 128", async () => {
    const result = await observe([
      {
        spawned: true,
        exitCode: 128,
        stdout: EMPTY,
        stderr: EMPTY,
        timedOut: false,
      },
    ]);

    expect(result.kind).toBe("not_a_repository");
  });

  it("reports not_a_repository for a bare repository", async () => {
    // Exit 0 with a false work-tree report: bare repo, or inside .git.
    const result = await observe([ok("false\n/p.git\n/p.git\n")]);

    expect(result.kind).toBe("not_a_repository");
  });

  it("reports timeout when rev-parse is killed", async () => {
    const result = await observe([
      {
        spawned: true,
        exitCode: null,
        stdout: EMPTY,
        stderr: EMPTY,
        timedOut: true,
      },
    ]);

    expect(result.kind).toBe("timeout");
  });

  it("reports timeout when status is killed", async () => {
    const result = await observe([
      ok(REFS_OK),
      {
        spawned: true,
        exitCode: null,
        stdout: EMPTY,
        stderr: EMPTY,
        timedOut: true,
      },
    ]);

    expect(result.kind).toBe("timeout");
  });

  it("reports command_failed on an unexpected rev-parse exit", async () => {
    const result = await observe([
      {
        spawned: true,
        exitCode: 1,
        stdout: EMPTY,
        stderr: EMPTY,
        timedOut: false,
      },
    ]);

    expect(result.kind).toBe("command_failed");
  });

  it("reports command_failed on a non-zero status exit", async () => {
    const result = await observe([
      ok(REFS_OK),
      {
        spawned: true,
        exitCode: 1,
        stdout: EMPTY,
        stderr: EMPTY,
        timedOut: false,
      },
    ]);

    expect(result.kind).toBe("command_failed");
  });

  it("reports unreadable on unparsable rev-parse output", async () => {
    const result = await observe([ok("nonsense\n")]);

    expect(result.kind).toBe("unreadable");
  });

  it("reports unreadable on unparsable status output", async () => {
    const result = await observe([ok(REFS_OK), ok("x bogus\0")]);

    expect(result.kind).toBe("unreadable");
  });

  it("reports unreadable when the git directory cannot be listed", async () => {
    const result = await observe([ok(REFS_OK), ok(STATUS_OK)], null);

    expect(result.kind).toBe("unreadable");
  });

  it("resolves rather than rejecting on every failure branch", async () => {
    const branches: RawCommandResult[][] = [
      [
        {
          spawned: false,
          exitCode: null,
          stdout: EMPTY,
          stderr: EMPTY,
          timedOut: false,
        },
      ],
      [
        {
          spawned: true,
          exitCode: 128,
          stdout: EMPTY,
          stderr: EMPTY,
          timedOut: false,
        },
      ],
      [
        {
          spawned: true,
          exitCode: null,
          stdout: EMPTY,
          stderr: EMPTY,
          timedOut: true,
        },
      ],
      [ok("nonsense\n")],
      [ok(REFS_OK), ok("x bogus\0")],
    ];

    for (const branch of branches) {
      await expect(observe(branch)).resolves.toBeDefined();
    }
  });
});
