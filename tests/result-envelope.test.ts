import { describe, expect, it } from "vitest";

import {
  internalFailure,
  resultFor,
  usageFailure,
  USAGE_WHY,
} from "@kratos/runtime/domain/result";

describe("result envelope", () => {
  it("takes status, exit, retry, and recovery from the catalog", () => {
    expect(resultFor("trail.uso", { why: [USAGE_WHY.unknownCommand] })).toEqual(
      {
        contractVersion: "1.0.0",
        status: "failure",
        exitCode: 2,
        reasonCode: "trail.uso",
        summary:
          "The trail command arguments do not satisfy the operation usage contract.",
        why: [USAGE_WHY.unknownCommand],
        evidence: [],
        stateChanged: false,
        retryable: true,
        recovery:
          "Correct the command arguments according to the operation usage and invoke it again.",
      },
    );
  });

  it("carries a caller summary without changing catalog policy", () => {
    const result = resultFor("runtime.orientation_ok", {
      summary: "Runtime version 0.4.0.",
    });

    expect(result.summary).toBe("Runtime version 0.4.0.");
    expect(result.exitCode).toBe(0);
    expect(result.recovery).toBeNull();
    expect(result.stateChanged).toBe(false);
  });

  it("refuses a reason the catalog does not define", () => {
    expect(() => resultFor("trail.invented", {})).toThrow(
      "Unknown reason code",
    );
  });

  it("fixes the public prose of an internal failure", () => {
    expect(internalFailure()).toMatchObject({
      reasonCode: "runtime.internal_failure",
      summary: "The operation stopped after an unexpected internal failure.",
      why: ["A sanitized runtime boundary caught an unexpected condition."],
      exitCode: 2,
    });
  });

  it("builds a usage failure that carries exactly one cause", () => {
    expect(usageFailure(USAGE_WHY.unknownFlag).why).toEqual([
      USAGE_WHY.unknownFlag,
    ]);
  });

  it("defaults a mutating reason to a truthful state-change claim", () => {
    expect(
      resultFor("trail.ok", {
        evidence: [{ kind: "event", ref: ".brain/events.jsonl" }],
      }).stateChanged,
    ).toBe(true);
  });
});
