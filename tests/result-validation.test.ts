import { describe, expect, it } from "vitest";

import {
  resultFor,
  validateResult,
  type Result,
} from "@mestre-yoda/runtime/domain/result";

function withField(overrides: Partial<Result>): Result {
  return { ...resultFor("trail.uso", { why: ["cause"] }), ...overrides };
}

describe("result validation", () => {
  it("accepts a result that agrees with its reason", () => {
    const result = resultFor("trail.uso", { why: ["cause"] });
    expect(validateResult(result)).toEqual(result);
  });

  it.each([
    ["status", withField({ status: "success" })],
    ["exit code", withField({ exitCode: 0 })],
    ["retry policy", withField({ retryable: false })],
    ["recovery", withField({ recovery: "do something else" })],
  ])("rejects a result whose %s contradicts its reason", (_label, result) => {
    expect(() => validateResult(result)).toThrow("conflicts with its reason");
  });

  it("rejects a false state mutation claim", () => {
    expect(() => validateResult(withField({ stateChanged: true }))).toThrow(
      "false state mutation claim",
    );
  });

  it("accepts no mutation when the reason only permits a state change", () => {
    const result = {
      ...resultFor("trail.ok", {
        evidence: [{ kind: "event", ref: ".brain/events.jsonl" }],
      }),
      stateChanged: false,
    };
    expect(validateResult(result)).toEqual(result);
  });

  it("rejects forbidden evidence", () => {
    expect(() =>
      validateResult(
        withField({
          evidence: [{ kind: "event", ref: ".brain/events.jsonl" }],
        }),
      ),
    ).toThrow("forbidden evidence");
  });

  it("rejects evidence properties outside canonical order", () => {
    const evidence = {
      ref: ".brain/events.jsonl",
      kind: "event" as const,
    };
    expect(() =>
      validateResult(
        resultFor("blocked.empty_plan", {
          why: ["cause"],
          evidence: [evidence],
        }),
      ),
    ).toThrow("evidence properties are not in canonical order");
  });

  it("rejects an unknown reason code", () => {
    expect(() =>
      validateResult(withField({ reasonCode: "runtime.unknown" })),
    ).toThrow("result uses an unknown reason code");
  });

  it("requires a cause for a failure", () => {
    expect(() => validateResult(withField({ why: [] }))).toThrow(
      "requires at least one cause",
    );
  });

  it("rejects duplicate causes", () => {
    expect(() => validateResult(withField({ why: ["a", "a"] }))).toThrow(
      "must be unique",
    );
  });

  it("requires fixed public prose for an internal failure", () => {
    const result = resultFor("runtime.internal_failure", {
      summary: "A different safe summary.",
      why: ["A different safe cause."],
    });
    expect(() => validateResult(result)).toThrow(
      "internal failures require fixed catalog-owned public prose",
    );
  });

  it("requires evidence when the reason policy requires it", () => {
    expect(() => validateResult(resultFor("trail.ok", { why: [] }))).toThrow(
      "required evidence is absent",
    );
  });

  it.each([
    ["an absolute path", "Failed reading /home/someone/project/file.json"],
    ["a URL", "See https://example.test/report for details"],
    ["a control character", "Broken\u0007summary"],
    ["an escape character", "Broken\u001bsummary"],
    // A terminal reading UTF-8 treats U+009B as a control sequence introducer
    // exactly as it treats `ESC [`, so refusing only the seven-bit spelling
    // would leave the same door open under a different name.
    ["an eight-bit control sequence introducer", "Broken\u009b31msummary"],
    ["a C1 control", "Broken\u0085summary"],
    ["a stack frame", "at handler (/app/index.js:10:5)"],
    ["a bearer token", "Authorization Bearer abcdefghijklmnopqrstuvwxyz"],
    ["a backslash", "C:\\Users\\someone"],
  ])("rejects %s in public text", (_label, summary) => {
    expect(() => validateResult(withField({ summary }))).toThrow(
      "unsafe text is not publishable",
    );
  });

  it("rejects fields outside the canonical order", () => {
    const reordered = JSON.parse(
      JSON.stringify({
        status: "failure",
        contractVersion: "1.0.0",
        exitCode: 2,
        reasonCode: "trail.uso",
        summary: "s",
        why: ["cause"],
        evidence: [],
        stateChanged: false,
        retryable: true,
        recovery:
          "Correct the command arguments according to the operation usage and invoke it again.",
      }),
    ) as Result;

    expect(() => validateResult(reordered)).toThrow("canonical order");
  });

  it.each([
    ["contract version", { contractVersion: "2.0.0" }],
    ["empty summary", { summary: "" }],
    ["oversized summary", { summary: "a".repeat(4_097) }],
    ["empty cause", { why: [""] }],
  ])("rejects a result with an invalid %s", (_label, overrides) => {
    const invalid = {
      ...resultFor("trail.uso", { why: ["cause"] }),
      ...overrides,
    } as unknown as Result;
    expect(() => validateResult(invalid)).toThrow(
      "result does not satisfy its closed schema",
    );
  });

  it.each([
    [{ kind: "private", ref: ".brain/events.jsonl" }],
    [{ kind: "event", ref: "../events.jsonl" }],
    [{ kind: "event", ref: ".brain/events.jsonl", sha256: "ABC" }],
  ])("rejects invalid evidence metadata: %o", (evidence) => {
    const invalid = resultFor("blocked.empty_plan", {
      why: ["cause"],
      evidence: [evidence as unknown as Result["evidence"][number]],
    });
    expect(() => validateResult(invalid)).toThrow(
      "result does not satisfy its closed schema",
    );
  });

  it("rejects a non-object result", () => {
    expect(() => validateResult(null as unknown as Result)).toThrow(
      "result does not satisfy its closed schema",
    );
  });

  it("rejects a non-object evidence entry", () => {
    const invalid = resultFor("blocked.empty_plan", {
      why: ["cause"],
      evidence: [null as unknown as Result["evidence"][number]],
    });
    expect(() => validateResult(invalid)).toThrow(
      "result does not satisfy its closed schema",
    );
  });
});
