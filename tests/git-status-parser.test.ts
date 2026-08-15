import { sha256Digests } from "@kratos/runtime/infra/node";
import { describe, expect, it } from "vitest";

import { parseStatusPorcelainV2 } from "../packages/runtime/src/domain/git/status.js";

const digests = sha256Digests();

/** Build a NUL-separated porcelain v2 payload from its records. */
const payload = (...records: string[]): Uint8Array =>
  new TextEncoder().encode(records.map((record) => `${record}\0`).join(""));

const parse = (...records: string[]) =>
  parseStatusPorcelainV2(payload(...records), digests);

describe("head classification", () => {
  it("reads an unborn branch as unborn with no commit", () => {
    const result = parse("# branch.oid (initial)", "# branch.head main");

    expect(result?.head).toEqual({ kind: "unborn", branch: "main" });
  });

  it("reads a detached head as detached with no branch", () => {
    const result = parse(
      "# branch.oid f901eb330ad4a83dafb882db1aae74ef5d859b32",
      "# branch.head (detached)",
    );

    expect(result?.head).toEqual({
      kind: "detached",
      commit: "f901eb330ad4a83dafb882db1aae74ef5d859b32",
    });
  });

  it("reads a branch without upstream", () => {
    const result = parse(
      "# branch.oid abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      "# branch.head main",
    );

    expect(result?.head).toEqual({
      kind: "branch",
      branch: "main",
      commit: "abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      upstream: null,
    });
  });

  it("reads a branch with upstream divergence", () => {
    const result = parse(
      "# branch.oid abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +2 -1",
    );

    expect(result?.head).toEqual({
      kind: "branch",
      branch: "main",
      commit: "abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      upstream: { ref: "origin/main", ahead: 2, behind: 1 },
    });
  });

  it("defaults ahead and behind to zero when branch.ab is absent", () => {
    const result = parse(
      "# branch.oid abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      "# branch.head main",
      "# branch.upstream origin/main",
    );

    expect(result?.head).toEqual({
      kind: "branch",
      branch: "main",
      commit: "abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      upstream: { ref: "origin/main", ahead: 0, behind: 0 },
    });
  });

  it("tolerates an unrecognized branch header field", () => {
    const result = parse(
      "# branch.oid abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      "# branch.head main",
      "# branch.something-new future-value",
    );

    expect(result?.head).toEqual({
      kind: "branch",
      branch: "main",
      commit: "abbb959b96f57e81b23fa8bb7dfbf5449c6cf82a",
      upstream: null,
    });
  });
});

describe("change classification", () => {
  const head = ["# branch.oid " + "a".repeat(40), "# branch.head main"];

  it("separates staged from unstaged state on one path", () => {
    const result = parse(
      ...head,
      "1 AM N... 000000 100644 100644 " +
        "0".repeat(40) +
        " " +
        "1".repeat(40) +
        " both.txt",
    );

    expect(result?.changes).toEqual([
      {
        path: { kind: "text", value: "both.txt" },
        tracking: "tracked",
        index: "added",
        worktree: "modified",
        conflict: null,
        renamedFrom: null,
        entry: "file",
      },
    ]);
  });

  it("preserves the origin path of a rename", () => {
    const result = parse(
      ...head,
      "2 R. N... 100644 100644 100644 " +
        "5".repeat(40) +
        " " +
        "5".repeat(40) +
        " R100 renamed.txt\0staged.txt",
    );

    expect(result?.changes[0]?.index).toBe("renamed");
    expect(result?.changes[0]?.path).toEqual({
      kind: "text",
      value: "renamed.txt",
    });
    expect(result?.changes[0]?.renamedFrom).toEqual({
      kind: "text",
      value: "staged.txt",
    });
  });

  it("reports an untracked path with no index or worktree kind", () => {
    const result = parse(...head, "? untracked.txt");

    expect(result?.changes).toEqual([
      {
        path: { kind: "text", value: "untracked.txt" },
        tracking: "untracked",
        index: "none",
        worktree: "none",
        conflict: null,
        renamedFrom: null,
        entry: "file",
      },
    ]);
  });

  it("reports an aggregated ignored directory as a directory entry", () => {
    const result = parse(...head, "! node_modules/");

    expect(result?.changes[0]?.tracking).toBe("ignored");
    expect(result?.changes[0]?.entry).toBe("directory");
  });

  it("reports a loose ignored file as a file entry", () => {
    const result = parse(...head, "! .env");

    expect(result?.changes[0]?.tracking).toBe("ignored");
    expect(result?.changes[0]?.entry).toBe("file");
  });

  it("records which conflict stages are present", () => {
    const result = parse(
      ...head,
      "u UU N... 100644 100644 100644 100644 " +
        "d".repeat(40) +
        " " +
        "b".repeat(40) +
        " " +
        "9".repeat(40) +
        " c.txt",
    );

    expect(result?.changes[0]?.conflict).toEqual({
      ours: true,
      theirs: true,
      base: true,
    });
  });

  it("reports no base when stage-1 is an all-zero object id", () => {
    const result = parse(
      ...head,
      "u UU N... 100644 100644 100644 100644 " +
        "0".repeat(40) +
        " " +
        "b".repeat(40) +
        " " +
        "9".repeat(40) +
        " c.txt",
    );

    expect(result?.changes[0]?.conflict).toEqual({
      ours: true,
      theirs: true,
      base: false,
    });
  });

  // `ours` and `theirs` must come from h2/h3, not from the `XY` status
  // letters: porcelain v2's unmerged `XY` is always one of
  // `DD AU UD UA DU AA UU`, so a `.` never appears there and cannot signal an
  // absent side. Each vector below reproduces the real byte layout Git 2.43
  // emits for its code, confirmed empirically.
  it("reports both sides absent for a both-deleted conflict (DD)", () => {
    const result = parse(
      ...head,
      "u DD N... 100644 000000 000000 000000 " +
        "d".repeat(40) +
        " " +
        "0".repeat(40) +
        " " +
        "0".repeat(40) +
        " f.txt",
    );

    expect(result?.changes[0]?.conflict).toEqual({
      ours: false,
      theirs: false,
      base: true,
    });
  });

  it("reports ours absent for a deleted-by-us conflict (DU)", () => {
    const result = parse(
      ...head,
      "u DU N... 100644 000000 100644 100644 " +
        "d".repeat(40) +
        " " +
        "0".repeat(40) +
        " " +
        "9".repeat(40) +
        " f.txt",
    );

    expect(result?.changes[0]?.conflict).toEqual({
      ours: false,
      theirs: true,
      base: true,
    });
  });

  it("reports theirs absent for a deleted-by-them conflict (UD)", () => {
    const result = parse(
      ...head,
      "u UD N... 100644 100644 000000 100644 " +
        "d".repeat(40) +
        " " +
        "b".repeat(40) +
        " " +
        "0".repeat(40) +
        " f.txt",
    );

    expect(result?.changes[0]?.conflict).toEqual({
      ours: true,
      theirs: false,
      base: true,
    });
  });

  it("reports base and ours absent for an added-by-them conflict (UA)", () => {
    const result = parse(
      ...head,
      "u UA N... 000000 000000 100644 100644 " +
        "0".repeat(40) +
        " " +
        "0".repeat(40) +
        " " +
        "9".repeat(40) +
        " g.txt",
    );

    expect(result?.changes[0]?.conflict).toEqual({
      ours: false,
      theirs: true,
      base: false,
    });
  });

  it("reports base and theirs absent for an added-by-us conflict (AU)", () => {
    const result = parse(
      ...head,
      "u AU N... 000000 100644 000000 100644 " +
        "0".repeat(40) +
        " " +
        "b".repeat(40) +
        " " +
        "0".repeat(40) +
        " g.txt",
    );

    expect(result?.changes[0]?.conflict).toEqual({
      ours: true,
      theirs: false,
      base: false,
    });
  });

  it("classifies a symlink by its worktree mode", () => {
    const result = parse(
      ...head,
      "1 .M N... 100644 100644 120000 " +
        "1".repeat(40) +
        " " +
        "2".repeat(40) +
        " link.txt",
    );

    expect(result?.changes[0]?.entry).toBe("symlink");
  });

  it("classifies a submodule by its mode", () => {
    const result = parse(
      ...head,
      "1 .M SC.. 160000 160000 160000 " +
        "1".repeat(40) +
        " " +
        "2".repeat(40) +
        " vendor/lib",
    );

    expect(result?.changes[0]?.entry).toBe("submodule");
  });

  // A deletion always reports the worktree mode as `000000`, which alone
  // cannot classify the entry kind. Each vector reproduces the real byte
  // layout Git 2.43 emits, confirmed empirically.
  it("classifies a deleted symlink by falling back to the index mode", () => {
    const result = parse(
      ...head,
      "1 .D N... 120000 120000 000000 " +
        "1".repeat(40) +
        " " +
        "1".repeat(40) +
        " link",
    );

    expect(result?.changes[0]?.entry).toBe("symlink");
  });

  it("classifies a removed submodule by falling back to the head mode", () => {
    const result = parse(
      ...head,
      "1 D. N... 160000 000000 000000 " +
        "1".repeat(40) +
        " " +
        "0".repeat(40) +
        " vendor/sub",
    );

    expect(result?.changes[0]?.entry).toBe("submodule");
  });

  it("classifies a sparse directory entry by its worktree mode", () => {
    const result = parse(
      ...head,
      "1 .M N... 040000 040000 040000 " +
        "1".repeat(40) +
        " " +
        "2".repeat(40) +
        " sparse/dir",
    );

    expect(result?.changes[0]?.entry).toBe("directory");
  });

  it("skips a stray empty record between two real records", () => {
    const result = parse(...head, "", "? untracked.txt");

    expect(result?.changes).toEqual([
      {
        path: { kind: "text", value: "untracked.txt" },
        tracking: "untracked",
        index: "none",
        worktree: "none",
        conflict: null,
        renamedFrom: null,
        entry: "file",
      },
    ]);
  });

  it("keeps a path containing a space intact", () => {
    const result = parse(
      ...head,
      "1 .M N... 100644 100644 100644 " +
        "1".repeat(40) +
        " " +
        "2".repeat(40) +
        " a file.txt",
    );

    expect(result?.changes[0]?.path).toEqual({
      kind: "text",
      value: "a file.txt",
    });
  });

  it("keeps a path beginning with a dash intact", () => {
    const result = parse(...head, "? --not-a-flag.txt");

    expect(result?.changes[0]?.path).toEqual({
      kind: "text",
      value: "--not-a-flag.txt",
    });
  });

  it("sorts changes by path bytes regardless of emission order", () => {
    const result = parse(...head, "? b.txt", "? B.txt", "? a.txt");

    expect(result?.changes.map((change) => change.path)).toEqual([
      { kind: "text", value: "B.txt" },
      { kind: "text", value: "a.txt" },
      { kind: "text", value: "b.txt" },
    ]);
  });
});

describe("unparsable input", () => {
  it("returns null when the head record is missing", () => {
    expect(parse("? untracked.txt")).toBeNull();
  });

  it("returns null on an unknown record type", () => {
    expect(
      parse("# branch.oid " + "a".repeat(40), "# branch.head main", "x bogus"),
    ).toBeNull();
  });

  it("returns null on a truncated tracked record", () => {
    expect(
      parse(
        "# branch.oid " + "a".repeat(40),
        "# branch.head main",
        "1 AM N...",
      ),
    ).toBeNull();
  });

  it("returns null on a rename record missing its origin path", () => {
    expect(
      parse(
        "# branch.oid " + "a".repeat(40),
        "# branch.head main",
        "2 R. N... 100644 100644 100644 " +
          "5".repeat(40) +
          " " +
          "5".repeat(40) +
          " R100 renamed.txt",
      ),
    ).toBeNull();
  });

  it("returns null on a rename record whose origin path is empty", () => {
    expect(
      parse(
        "# branch.oid " + "a".repeat(40),
        "# branch.head main",
        "2 R. N... 100644 100644 100644 " +
          "5".repeat(40) +
          " " +
          "5".repeat(40) +
          " R100 renamed.txt",
        "",
      ),
    ).toBeNull();
  });

  it("returns null when an unborn head is also reported as detached", () => {
    expect(
      parse("# branch.oid (initial)", "# branch.head (detached)"),
    ).toBeNull();
  });

  it("returns null when branch.ab is missing its behind value", () => {
    expect(
      parse(
        "# branch.oid " + "a".repeat(40),
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +2",
      ),
    ).toBeNull();
  });

  it("returns null when branch.ab values lack sign prefixes", () => {
    expect(
      parse(
        "# branch.oid " + "a".repeat(40),
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab 2 -1",
      ),
    ).toBeNull();
  });

  it("returns null when branch.ab values are not integers", () => {
    expect(
      parse(
        "# branch.oid " + "a".repeat(40),
        "# branch.head main",
        "# branch.upstream origin/main",
        "# branch.ab +x -1",
      ),
    ).toBeNull();
  });

  it("returns null when stdout is cut off mid-record with no terminator", () => {
    const head = ["# branch.oid " + "a".repeat(40), "# branch.head main"];
    const terminated = new TextEncoder().encode(
      head.map((record) => `${record}\0`).join(""),
    );
    const truncated = new TextEncoder().encode("1 AM");
    const stdout = new Uint8Array(terminated.length + truncated.length);
    stdout.set(terminated, 0);
    stdout.set(truncated, terminated.length);

    expect(parseStatusPorcelainV2(stdout, digests)).toBeNull();
  });

  it("returns null on a truncated unmerged record", () => {
    expect(
      parse(
        "# branch.oid " + "a".repeat(40),
        "# branch.head main",
        "u UU N... 100644",
      ),
    ).toBeNull();
  });

  it("returns null when a tracked record's status field is incomplete", () => {
    expect(
      parse(
        "# branch.oid " + "a".repeat(40),
        "# branch.head main",
        "1  N... 100644 100644 100644 " +
          "1".repeat(40) +
          " " +
          "2".repeat(40) +
          " bogus.txt",
      ),
    ).toBeNull();
  });

  it("accepts an empty change set", () => {
    const result = parse(
      "# branch.oid " + "a".repeat(40),
      "# branch.head main",
    );

    expect(result?.changes).toEqual([]);
  });
});
