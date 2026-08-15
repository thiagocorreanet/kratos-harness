import type { EventV1 } from "@kratos/contracts";
import {
  deriveBudget,
  deriveStats,
  diagnose,
  explainReason,
} from "@kratos/runtime/domain/diagnostics";
import { describe, expect, it } from "vitest";

const baseEvent = {
  artifactRefs: ["artifact-a"],
  evidenceRefs: ["evidence-a"],
  reasonCode: "run.transition.accepted",
} as EventV1;

describe("read-only diagnostics", () => {
  it("derives stable event statistics without writing state", () => {
    expect(
      deriveStats([
        baseEvent,
        { ...baseEvent, reasonCode: "run.transition.rejected" },
        { ...baseEvent, reasonCode: "run.resumed" },
      ]),
    ).toEqual({
      events: 3,
      acceptedTransitions: 1,
      rejectedTransitions: 1,
      resumes: 1,
      artifactRefs: 1,
      evidenceRefs: 1,
    });
  });

  it("reports bounded and unbounded budgets honestly", () => {
    expect(deriveBudget(100, 40)).toEqual({
      allocated: 100,
      used: 40,
      remaining: 60,
      exhausted: false,
    });
    expect(deriveBudget(null, 40)).toEqual({
      allocated: null,
      used: 40,
      remaining: null,
      exhausted: false,
    });
    expect(deriveBudget(100, null)).toEqual({
      allocated: 100,
      used: null,
      remaining: null,
      exhausted: false,
    });
  });

  it("aggregates doctor checks independently of input order", () => {
    const checks = [
      { name: "state", status: "pass" as const, evidenceRef: null },
      { name: "locks", status: "warn" as const, evidenceRef: ".brain/locks" },
    ];
    expect(diagnose(checks)).toEqual(diagnose([...checks].reverse()));
    expect(diagnose(checks).health).toBe("degraded");
    expect(
      diagnose([
        { name: "gate", status: "block", evidenceRef: ".brain/gates.json" },
      ]).health,
    ).toBe("blocked");
  });

  it("explains catalog reasons and refuses invented ones", () => {
    expect(explainReason("runtime.revision_conflict")).toMatchObject({
      known: true,
      retryable: true,
    });
    expect(explainReason("invented.reason")).toEqual({
      known: false,
      code: "invented.reason",
      description: "The reason code is not registered in this runtime.",
      retryable: null,
      recovery: null,
    });
  });
});
