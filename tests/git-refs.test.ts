import { describe, expect, it } from "vitest";

import {
  classifyOperation,
  classifyWorktree,
  parseRevParse,
} from "../packages/runtime/src/domain/git/refs.js";

describe("parseRevParse", () => {
  it("reads the three fields in argument order", () => {
    expect(parseRevParse("true\n/tmp/p/.git\n/tmp/p/.git\n")).toEqual({
      insideWorkTree: true,
      gitDir: "/tmp/p/.git",
      gitCommonDir: "/tmp/p/.git",
    });
  });

  it("reads a false work-tree report", () => {
    expect(
      parseRevParse("false\n/tmp/p.git\n/tmp/p.git\n")?.insideWorkTree,
    ).toBe(false);
  });

  it("returns null when a field is missing", () => {
    expect(parseRevParse("true\n/tmp/p/.git\n")).toBeNull();
  });

  it("returns null on a non-boolean work-tree field", () => {
    expect(parseRevParse("maybe\n/tmp/p/.git\n/tmp/p/.git\n")).toBeNull();
  });

  it("returns null on empty output", () => {
    expect(parseRevParse("")).toBeNull();
  });

  it("does not transpose gitDir and gitCommonDir", () => {
    expect(
      parseRevParse("true\n/repo/.git/worktrees/feature\n/repo/.git\n"),
    ).toEqual({
      insideWorkTree: true,
      gitDir: "/repo/.git/worktrees/feature",
      gitCommonDir: "/repo/.git",
    });
  });
});

describe("classifyWorktree", () => {
  it("reports a principal worktree when the directories match", () => {
    expect(
      classifyWorktree({
        insideWorkTree: true,
        gitDir: "/p/.git",
        gitCommonDir: "/p/.git",
      }),
    ).toBe("principal");
  });

  it("reports a linked worktree when they differ", () => {
    expect(
      classifyWorktree({
        insideWorkTree: true,
        gitDir: "/p/.git/worktrees/feature",
        gitCommonDir: "/p/.git",
      }),
    ).toBe("linked");
  });

  it("derives a linked worktree from parsed rev-parse output", () => {
    const facts = parseRevParse(
      "true\n/repo/.git/worktrees/feature\n/repo/.git\n",
    );
    if (facts === null) throw new Error("expected parseRevParse to succeed");
    expect(classifyWorktree(facts)).toBe("linked");
  });
});

describe("classifyOperation", () => {
  it("reports none for an idle repository", () => {
    expect(classifyOperation(["HEAD", "config", "objects"])).toBe("none");
  });

  it("reports a merge from MERGE_HEAD", () => {
    expect(
      classifyOperation([
        "AUTO_MERGE",
        "MERGE_HEAD",
        "MERGE_MODE",
        "MERGE_MSG",
      ]),
    ).toBe("merge");
  });

  it("reports a rebase from rebase-merge", () => {
    expect(classifyOperation(["rebase-merge"])).toBe("rebase");
  });

  it("reports a rebase from rebase-apply", () => {
    expect(classifyOperation(["rebase-apply"])).toBe("rebase");
  });

  it("reports a cherry-pick from CHERRY_PICK_HEAD", () => {
    expect(classifyOperation(["CHERRY_PICK_HEAD"])).toBe("cherry_pick");
  });

  it("reports a revert from REVERT_HEAD", () => {
    expect(classifyOperation(["REVERT_HEAD"])).toBe("revert");
  });

  it("prefers rebase over merge when both markers exist", () => {
    // An interactive rebase resolving a conflict leaves both. The rebase is the
    // operation the user is in; the merge is one step inside it.
    expect(classifyOperation(["MERGE_HEAD", "rebase-merge"])).toBe("rebase");
  });
});
