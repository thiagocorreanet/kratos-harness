import {
  MANAGED_SECTION_BEGIN,
  MANAGED_SECTION_END,
  planManagedFile,
  type ManagedFileAuthorization,
} from "@kratos/runtime/domain/init";
import { describe, expect, it } from "vitest";

const GENERATED = `${MANAGED_SECTION_BEGIN}\n# Kratos\n\nGenerated.\n${MANAGED_SECTION_END}\n`;

const NOTHING_AUTHORIZED: ManagedFileAuthorization = {
  merge: false,
  force: false,
};

function file(text: string) {
  return { kind: "file", text } as const;
}

function plan(
  existing: Parameters<typeof planManagedFile>[0],
  authorization: ManagedFileAuthorization = NOTHING_AUTHORIZED,
) {
  return planManagedFile(existing, GENERATED, authorization);
}

describe("the managed section", () => {
  it("writes the whole generated document when the file is absent", () => {
    expect(plan({ kind: "absent" })).toEqual({
      kind: "write",
      content: GENERATED,
    });
  });

  it("replaces the section and preserves everything around it", () => {
    // Trailing spaces and a carriage return are exactly what a careless
    // rewrite loses, so they are what this asserts on. This is a person's
    // file.
    const before = "# My project\r\n\r\nMine, with trailing space.   \r\n\r\n";
    const after = "\r\n\r\n## Notes   \r\nStill mine.\r\n";
    const existing = `${before}${MANAGED_SECTION_BEGIN}\nold\n${MANAGED_SECTION_END}${after}`;

    expect(plan(file(existing))).toEqual({
      kind: "write",
      content: `${before}${MANAGED_SECTION_BEGIN}\n# Kratos\n\nGenerated.\n${MANAGED_SECTION_END}${after}`,
    });
  });

  it("refuses an unmarked file rather than guessing where the section goes", () => {
    // Appending to a document whose structure it does not understand is how a
    // tool silently corrupts something somebody wrote.
    expect(plan(file("# Mine\n"))).toEqual({
      kind: "refused",
      reasonCode: "guard.outside_allow",
    });
  });

  it("appends to an unmarked file only when merging is authorized", () => {
    const existing = "# Mine\n\nContent.\n";

    const merged = plan(file(existing), { merge: true, force: false });

    expect(merged).toEqual({
      kind: "write",
      content: `${existing}\n${GENERATED}`,
    });
  });

  it("separates an appended section from a file that ends without a newline", () => {
    const merged = plan(file("# Mine"), { merge: true, force: false });

    expect(merged).toEqual({
      kind: "write",
      content: `# Mine\n\n${GENERATED}`,
    });
  });

  it("merges once and updates in place afterwards", () => {
    const first = plan(file("# Mine\n\nContent.\n"), {
      merge: true,
      force: false,
    });
    if (first.kind !== "write") throw new Error("the merge was refused");

    // The second run finds its own markers, so it needs no authorization and
    // produces the same bytes -- which is what lets the transaction decide
    // there is nothing to do.
    expect(plan(file(first.content))).toEqual(first);
  });

  it("replaces the whole file only when forcing is authorized", () => {
    expect(plan(file("# Mine\n"), { merge: false, force: true })).toEqual({
      kind: "write",
      content: GENERATED,
    });
  });

  it("does not infer one authorization from the absence of the other", () => {
    const unmarked = file("# Mine\n");

    expect(plan(unmarked, { merge: true, force: false })).toMatchObject({
      kind: "write",
    });
    expect(plan(unmarked, { merge: false, force: true })).toEqual({
      kind: "write",
      content: GENERATED,
    });
    expect(plan(unmarked)).toMatchObject({ kind: "refused" });
  });

  it("keeps a marked file's own content even when forcing", () => {
    const existing = `# Mine\n\n${MANAGED_SECTION_BEGIN}\nold\n${MANAGED_SECTION_END}\n`;

    // There is a safe place for the section, so there is nothing to force:
    // discarding the rest of the file would be a loss nobody asked for.
    expect(plan(file(existing), { merge: true, force: true })).toEqual({
      kind: "write",
      content: `# Mine\n\n${GENERATED}`,
    });
  });

  it.each([
    [
      "an end marker before its beginning",
      `${MANAGED_SECTION_END}\nstranded\n${MANAGED_SECTION_BEGIN}\n`,
    ],
    [
      "the section twice",
      `${MANAGED_SECTION_BEGIN}\na\n${MANAGED_SECTION_END}\n${MANAGED_SECTION_BEGIN}\nb\n${MANAGED_SECTION_END}\n`,
    ],
    ["a beginning with no end", `${MANAGED_SECTION_BEGIN}\nunclosed\n`],
    ["an end with no beginning", `${MANAGED_SECTION_END}\nunopened\n`],
    [
      "one beginning closed twice",
      `${MANAGED_SECTION_BEGIN}\na\n${MANAGED_SECTION_END}\n${MANAGED_SECTION_END}\n`,
    ],
  ])("refuses %s as corrupt state", (_label, text) => {
    // Repairing this means guessing which marker was meant, and a guess about
    // somebody's file is the one thing initialization must not make.
    expect(plan(file(text))).toEqual({
      kind: "refused",
      reasonCode: "runtime.state_corrupt",
    });
  });

  it("refuses malformed markers however the run was authorized", () => {
    const malformed = file(
      `${MANAGED_SECTION_END}\nstranded\n${MANAGED_SECTION_BEGIN}\n`,
    );

    // `--force` authorizes replacing a file, not interpreting state no
    // protocol can read. Repairing that is `OBS-02`.
    expect(plan(malformed, { merge: true, force: true })).toEqual({
      kind: "refused",
      reasonCode: "runtime.state_corrupt",
    });
  });

  it("refuses a destination that is not a file", () => {
    // A directory where `CLAUDE.md` belongs is not a file to be replaced, and
    // removing it is not initialization's decision to make.
    expect(plan({ kind: "other" }, { merge: true, force: true })).toEqual({
      kind: "refused",
      reasonCode: "guard.outside_allow",
    });
  });

  it("refuses generated content that carries no managed section", () => {
    // The caller supplies the generated document. One without markers cannot
    // be updated on the next run, so it is refused now rather than written and
    // discovered later.
    expect(
      planManagedFile({ kind: "absent" }, "# Ungoverned\n", NOTHING_AUTHORIZED),
    ).toEqual({ kind: "refused", reasonCode: "runtime.state_corrupt" });
  });
});
