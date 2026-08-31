import {
  buildAcceptanceDecisionMetadata,
  buildRepairLoopStop,
  decideRepairLoop,
  type RepairLoopAttempt,
} from "@kratos/runtime/domain/repair-loop";
import { describe, expect, it } from "vitest";

const prior: readonly RepairLoopAttempt[] = [
  { criterionId: "AC-1.1.1", attempt: 2 },
  { criterionId: "AC-1.1.2", attempt: 1 },
];

describe("repair-loop decisions", () => {
  it("increments every failed criterion in document order below the ceiling", () => {
    expect(
      decideRepairLoop({
        attemptCeiling: 4,
        attempts: prior,
        criteria: [
          { criterionId: "AC-1.1.2", outcome: "failed" },
          { criterionId: "AC-1.1.1", outcome: "failed" },
        ],
        faults: [],
      }),
    ).toEqual({
      kind: "repair",
      attempts: [
        { criterionId: "AC-1.1.2", attempt: 2 },
        { criterionId: "AC-1.1.1", attempt: 3 },
      ],
    });
  });

  it("requires one diagnosis for every criterion that reaches the ceiling", () => {
    expect(
      decideRepairLoop({
        attemptCeiling: 3,
        attempts: prior,
        criteria: [
          { criterionId: "AC-1.1.2", outcome: "failed" },
          { criterionId: "AC-1.1.1", outcome: "failed" },
        ],
        faults: [],
      }),
    ).toEqual({
      kind: "refused",
      reason: "missing-fault",
      criterionId: "AC-1.1.1",
    });
  });

  it("rejects a whitespace-only diagnosis without normalizing nonblank text", () => {
    expect(
      decideRepairLoop({
        attemptCeiling: 3,
        attempts: [{ criterionId: "AC-1.1.1", attempt: 2 }],
        criteria: [{ criterionId: "AC-1.1.1", outcome: "failed" }],
        faults: [
          {
            criterionId: "AC-1.1.1",
            classification: "code",
            diagnosis: "   ",
          },
        ],
      }),
    ).toEqual({
      kind: "refused",
      reason: "invalid-fault",
      criterionId: "AC-1.1.1",
    });

    const diagnosis = "  Preserve this nonblank diagnosis.  ";
    const decision = decideRepairLoop({
      attemptCeiling: 3,
      attempts: [{ criterionId: "AC-1.1.1", attempt: 2 }],
      criteria: [{ criterionId: "AC-1.1.1", outcome: "failed" }],
      faults: [{ criterionId: "AC-1.1.1", classification: "code", diagnosis }],
    });
    expect(decision).toMatchObject({
      kind: "stopped",
      stops: [expect.objectContaining({ diagnosis })],
    });
  });

  it.each([
    {
      label: "criterion outcome",
      criteria: [{ criterionId: "AC-1.1.1", outcome: "skipped" }],
      faults: [],
      expected: {
        kind: "refused",
        reason: "invalid-criterion",
        criterionId: "AC-1.1.1",
      },
    },
    {
      label: "fault classification",
      criteria: [{ criterionId: "AC-1.1.1", outcome: "failed" }],
      faults: [
        {
          criterionId: "AC-1.1.1",
          classification: "infrastructure",
          diagnosis: "The implementation cannot satisfy this criterion.",
        },
      ],
      expected: {
        kind: "refused",
        reason: "invalid-fault",
        criterionId: "AC-1.1.1",
      },
    },
  ])("refuses an unknown $label at the runtime boundary", (subject) => {
    expect(
      decideRepairLoop({
        attemptCeiling: 3,
        attempts: [{ criterionId: "AC-1.1.1", attempt: 2 }],
        criteria: subject.criteria,
        faults: subject.faults,
      } as never),
    ).toEqual(subject.expected);
  });

  it("preserves every simultaneous stop in criterion document order", () => {
    expect(
      decideRepairLoop({
        attemptCeiling: 3,
        attempts: [
          { criterionId: "AC-1.1.1", attempt: 2 },
          { criterionId: "AC-1.1.2", attempt: 2 },
        ],
        criteria: [
          { criterionId: "AC-1.1.2", outcome: "failed" },
          { criterionId: "AC-1.1.1", outcome: "failed" },
        ],
        faults: [
          {
            criterionId: "AC-1.1.1",
            classification: "specification",
            diagnosis: "The criterion contradicts the approved behavior.",
          },
          {
            criterionId: "AC-1.1.2",
            classification: "code",
            diagnosis: "The implementation still returns the wrong state.",
          },
        ],
      }),
    ).toEqual({
      kind: "stopped",
      attempts: [
        { criterionId: "AC-1.1.2", attempt: 3 },
        { criterionId: "AC-1.1.1", attempt: 3 },
      ],
      stops: [
        {
          criterionId: "AC-1.1.2",
          attempt: 3,
          classification: "code",
          diagnosis: "The implementation still returns the wrong state.",
        },
        {
          criterionId: "AC-1.1.1",
          attempt: 3,
          classification: "specification",
          diagnosis: "The criterion contradicts the approved behavior.",
        },
      ],
    });
  });

  it("does not reset attempts when every criterion passes", () => {
    expect(
      decideRepairLoop({
        attemptCeiling: 3,
        attempts: prior,
        criteria: [
          { criterionId: "AC-1.1.1", outcome: "passed" },
          { criterionId: "AC-1.1.2", outcome: "passed" },
        ],
        faults: [],
      }),
    ).toEqual({ kind: "passed", attempts: prior });
  });

  it("builds an immutable diagnosis artifact without embedding its digest", () => {
    const artifact = buildRepairLoopStop({
      stopId: "stop-01",
      runId: "run-01",
      criterionId: "AC-1.1.1",
      attempt: 3,
      attemptCeiling: 3,
      classification: "code",
      diagnosis: "The implementation misses the terminal transition.",
      recordedAt: "2026-08-30T12:00:00.000Z",
    });

    expect(artifact).toEqual({
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      stopId: "stop-01",
      runId: "run-01",
      criterionId: "AC-1.1.1",
      attempt: 3,
      attemptCeiling: 3,
      classification: "code",
      diagnosis: "The implementation misses the terminal transition.",
      recordedAt: "2026-08-30T12:00:00.000Z",
    });
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(artifact).not.toHaveProperty("artifactDigest");
  });

  it("binds stopped decisions to digest references in criterion order", () => {
    const decision = decideRepairLoop({
      attemptCeiling: 3,
      attempts: [{ criterionId: "AC-1.1.1", attempt: 2 }],
      criteria: [{ criterionId: "AC-1.1.1", outcome: "failed" }],
      faults: [
        {
          criterionId: "AC-1.1.1",
          classification: "code",
          diagnosis: "The implementation misses the terminal transition.",
        },
      ],
    });
    if (decision.kind !== "stopped") throw new Error("expected stop");

    expect(
      buildAcceptanceDecisionMetadata(decision, [
        {
          criterionId: "AC-1.1.1",
          artifactRef: ".brain/runs/run-01/repair-stops/AC-1.1.1.json",
          artifactDigest: "d".repeat(64),
        },
      ]),
    ).toEqual({
      outcome: "stopped",
      attempts: [{ criterionId: "AC-1.1.1", attempt: 3 }],
      repairStops: [
        {
          criterionId: "AC-1.1.1",
          attempt: 3,
          classification: "code",
          artifactRef: ".brain/runs/run-01/repair-stops/AC-1.1.1.json",
          artifactDigest: "d".repeat(64),
        },
      ],
    });
  });
});
