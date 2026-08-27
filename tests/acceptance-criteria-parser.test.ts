import {
  inspectTaskDocument,
  renderCriterionCheckboxes,
} from "@kratos/runtime/domain/acceptance-criteria";
import { describe, expect, it } from "vitest";

function document(criteria: readonly string[]): string {
  return [
    "# Tasks",
    "",
    "## Ordered work",
    "",
    "### Work unit 01: Runtime contract",
    "",
    "#### Task 01.2: Parse declarations",
    "",
    "##### Files",
    "",
    "- `packages/runtime/src/domain/acceptance-criteria/`",
    "",
    "##### Acceptance criteria",
    "",
    ...criteria,
    "",
    "##### Edge cases",
    "",
    "- [ ] AC-01.2.E1: Reject a doubled E.",
    "",
    "## Out of scope",
    "",
    "- Acceptance prompt authoring.",
    "",
  ].join("\n");
}

const valid = document([
  "- [ ] AC-01.2.3: Reject duplicate identifiers.",
  "- [x] AC-01.2.7: Preserve non-contiguous numbering.",
]);

describe("task acceptance criterion parser", () => {
  it("returns ordered declarations with lexical coordinates and checkbox state", () => {
    expect(inspectTaskDocument(valid)).toEqual({
      kind: "valid",
      declarations: [
        {
          criterionId: "AC-01.2.3",
          workUnit: "01",
          task: "2",
          criterionKind: "main",
          checked: false,
          ordinal: 0,
          line: 15,
          text: "Reject duplicate identifiers.",
          normalizedDeclaration:
            "- [ ] AC-01.2.3: Reject duplicate identifiers.",
        },
        {
          criterionId: "AC-01.2.7",
          workUnit: "01",
          task: "2",
          criterionKind: "main",
          checked: true,
          ordinal: 1,
          line: 16,
          text: "Preserve non-contiguous numbering.",
          normalizedDeclaration:
            "- [ ] AC-01.2.7: Preserve non-contiguous numbering.",
        },
        {
          criterionId: "AC-01.2.E1",
          workUnit: "01",
          task: "2",
          criterionKind: "edge",
          checked: false,
          ordinal: 2,
          line: 20,
          text: "Reject a doubled E.",
          normalizedDeclaration: "- [ ] AC-01.2.E1: Reject a doubled E.",
        },
      ],
    });
  });

  it("names a duplicate valid identifier", () => {
    expect(
      inspectTaskDocument(
        document([
          "- [ ] AC-01.2.3: First declaration.",
          "- [ ] AC-01.2.3: Duplicate declaration.",
        ]),
      ),
    ).toEqual({ kind: "duplicate", criterionId: "AC-01.2.3" });
  });

  it.each([
    ["missing edge E", "- [ ] AC-01.2.1: Main syntax in edge section.", 19],
    ["doubled E", "- [ ] AC-01.2.EE1: Invalid edge identifier.", 19],
    ["negative component", "- [ ] AC-01.-2.E1: Negative task.", 19],
    ["coordinate mismatch", "- [ ] AC-02.2.E1: Wrong work unit.", 19],
    ["missing identifier", "- [ ] State an observable outcome.", 19],
  ] as const)("rejects %s at its declaration line", (_name, edge, line) => {
    const source = document(["- [ ] AC-01.2.3: Main criterion."]).replace(
      "- [ ] AC-01.2.E1: Reject a doubled E.",
      edge,
    );
    expect(inspectTaskDocument(source)).toEqual({ kind: "malformed", line });
  });

  it("rejects an identifier over the shared maximum length", () => {
    const id = `AC-${"1".repeat(122)}.2.3`;
    expect(inspectTaskDocument(document([`- [ ] ${id}: Too long.`]))).toEqual({
      kind: "malformed",
      line: 15,
    });
  });

  it("ignores heading and checkbox examples inside fenced code", () => {
    const source = valid.replace(
      "##### Acceptance criteria",
      [
        "```markdown",
        "### Work unit 9: Decoy",
        "#### Task 9.9: Decoy",
        "##### Acceptance criteria",
        "- [ ] AC-9.9.9: Decoy.",
        "```",
        "",
        "##### Acceptance criteria",
      ].join("\n"),
    );
    const parsed = inspectTaskDocument(source);
    expect(parsed.kind).toBe("valid");
    if (parsed.kind !== "valid") return;
    expect(parsed.declarations.map(({ criterionId }) => criterionId)).toEqual([
      "AC-01.2.3",
      "AC-01.2.7",
      "AC-01.2.E1",
    ]);
  });

  it("bounds the document to 256 declarations", () => {
    const criteria = Array.from(
      { length: 257 },
      (_, index) => `- [ ] AC-01.2.${String(index + 1)}: Criterion.`,
    );
    expect(inspectTaskDocument(document(criteria))).toEqual({
      kind: "malformed",
      line: 271,
    });
  });

  it("changes only declared checkbox bytes and is idempotent", () => {
    const outcomes = new Map([
      ["AC-01.2.3", "passed"],
      ["AC-01.2.7", "failed"],
      ["AC-01.2.E1", "not-run"],
    ] as const);
    const rendered = renderCriterionCheckboxes(valid, outcomes);

    expect(rendered).toContain(
      "- [x] AC-01.2.3: Reject duplicate identifiers.",
    );
    expect(rendered).toContain(
      "- [ ] AC-01.2.7: Preserve non-contiguous numbering.",
    );
    expect(rendered).toContain("- [ ] AC-01.2.E1: Reject a doubled E.");
    expect(renderCriterionCheckboxes(rendered, outcomes)).toBe(rendered);
  });

  it("preserves CRLF and the final newline", () => {
    const source = valid.replaceAll("\n", "\r\n");
    const rendered = renderCriterionCheckboxes(
      source,
      new Map([["AC-01.2.3", "passed"]]),
    );
    expect(rendered.replaceAll("\r\n", "")).not.toContain("\n");
    expect(rendered.endsWith("\r\n")).toBe(true);
  });
});
