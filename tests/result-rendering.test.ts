import { describe, expect, it } from "vitest";

import {
  renderResultHuman,
  renderResultJson,
  resultFor,
  usageFailure,
  USAGE_WHY,
} from "@mestre-yoda/runtime/domain/result";

describe("result rendering", () => {
  it("emits one compact newline-terminated object in JSON mode", () => {
    const result = resultFor("runtime.orientation_ok", {
      summary: "Runtime version 0.0.0-development.",
    });
    const rendered = renderResultJson(result);

    expect(rendered.stdout).toBe(`${JSON.stringify(result)}\n`);
    expect(rendered.stdout).not.toContain("\n  ");
    expect(rendered.stderr).toBe("");
    expect(rendered.exitCode).toBe(0);
  });

  it("emits only the summary on stdout for a human success", () => {
    expect(
      renderResultHuman(
        resultFor("runtime.orientation_ok", { summary: "All good." }),
      ),
    ).toEqual({ stdout: "All good.\n", stderr: "", exitCode: 0 });
  });

  it("emits labeled lines on stderr for a human failure", () => {
    const rendered = renderResultHuman(
      usageFailure(USAGE_WHY.unknownCommand),
    );

    expect(rendered.stdout).toBe("");
    expect(rendered.exitCode).toBe(2);
    expect(rendered.stderr).toBe(
      [
        "Summary: The trail command arguments do not satisfy the operation usage contract.",
        `Why: ${USAGE_WHY.unknownCommand}`,
        "Reason: trail.uso",
        "State changed: false",
        "Retryable: true",
        "Recovery: Correct the command arguments according to the operation usage and invoke it again.",
      ].join("\n") + "\n",
    );
  });

  it("renders evidence references in order after the reason", () => {
    const rendered = renderResultHuman(
      resultFor("blocked.empty_plan", {
        why: ["cause"],
        evidence: [
          { kind: "event", ref: ".brain/events.jsonl" },
          {
            kind: "artifact",
            ref: ".brain/plan.json",
            sha256: "a".repeat(64),
          },
        ],
      }),
    );

    expect(rendered.stderr).toContain(
      "Evidence: event .brain/events.jsonl\nEvidence: artifact .brain/plan.json sha256=" +
        "a".repeat(64),
    );
  });

  it("refuses to render a result that fails validation", () => {
    expect(() =>
      renderResultJson({ ...usageFailure(USAGE_WHY.arity), why: [] }),
    ).toThrow("requires at least one cause");
  });
});
