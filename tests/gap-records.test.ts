import type { GapProposalV1, GapRecordV1 } from "@kratos/contracts";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  budgetExhausted,
  decideGapRecord,
  decideGapVerdict,
  decideGapWaiver,
  deriveGateFacts,
  describeGapRefusal,
  GAP_CATEGORIES,
  MAX_DOCUMENT_REFS,
  MAX_PROPOSED_GAPS,
  isOpenGap,
  type ApprovalBoundary,
  type GapCategory,
} from "@kratos/runtime/domain/gaps";
import { evaluateGates } from "@kratos/runtime/domain/gates";
import { describe, expect, it } from "vitest";

const PRD = "a".repeat(64);
const SPEC = "b".repeat(64);
const NOW = "2026-08-17T09:00:00.000Z";
const registry = createSchemaRegistry();

function proposed(
  gapId: string,
  category: GapCategory = "ambiguous-rule",
): GapProposalV1["gaps"][number] {
  return {
    gapId,
    category,
    weight: "high",
    description: "The refund window is stated twice with different lengths.",
    recommendation: "Adopt the thirty-day window and delete the other clause.",
    reasoning: "Two readings produce two different expiry checks in code.",
    documentRefs: [".brain/02-features/refunds/00-prd.md"],
  };
}

function proposal(
  ...gaps: readonly GapProposalV1["gaps"][number][]
): GapProposalV1 {
  return {
    contractVersion: "1.0.0",
    hostContract: "1.0.0",
    gaps: [gaps[0] ?? proposed("gap-01"), ...gaps.slice(1)],
  };
}

function request(
  overrides: Partial<Parameters<typeof decideGapRecord>[0]> = {},
): Parameters<typeof decideGapRecord>[0] {
  return {
    proposal: proposal(),
    runId: "run-01",
    phase: "prd",
    boundary: "pre-approval",
    prdDigest: PRD,
    specDigest: SPEC,
    policyMode: "enforce",
    recordedAt: NOW,
    existing: [],
    ...overrides,
  };
}

function recordOne(gapId: string): GapRecordV1 {
  const decision = decideGapRecord(
    request({ proposal: proposal(proposed(gapId)) }),
  );
  if (decision.kind !== "recorded" || decision.gaps[0] === undefined) {
    throw new Error("the proposal was not recorded");
  }
  return decision.gaps[0];
}

function facts(
  gaps: readonly GapRecordV1[],
  boundary: ApprovalBoundary = "pre-approval",
) {
  return deriveGateFacts({
    runId: "run-01",
    gaps,
    boundary,
    stopLoss: { tripped: false, exhausted: false },
    partitionRequired: false,
    partitionApproved: true,
    derivedAt: NOW,
  });
}

describe("the published gap proposal contract", () => {
  it("accepts every category in the closed set and nothing else", () => {
    for (const category of GAP_CATEGORIES) {
      expect(
        registry.validate({
          id: "host.gap-proposal",
          version: "1.0.0",
          value: proposal(proposed("gap-01", category)),
          structuralReasonCode: "trail.uso",
        }).kind,
      ).toBe("valid");
    }

    const rejected = registry.validate({
      id: "host.gap-proposal",
      version: "1.0.0",
      value: proposal({
        ...proposed("gap-01"),
        category: "missing-test-coverage",
      } as unknown as GapProposalV1["gaps"][number]),
      structuralReasonCode: "trail.uso",
    });

    // Rejected with a reason that names the offending member, rather than
    // silently accepted as a fifth kind of gap.
    expect(rejected.kind).toBe("invalid");
    if (rejected.kind !== "invalid") return;
    expect(rejected.diagnostics[0]?.pointer).toBe("/gaps/0/category");
    expect(rejected.diagnostics[0]?.keyword).toBe("enum");
  });

  it("requires a description, a recommendation, reasoning, and a weight", () => {
    for (const field of [
      "description",
      "recommendation",
      "reasoning",
      "weight",
    ] as const) {
      const gap = Object.fromEntries(
        Object.entries(proposed("gap-01")).filter(([key]) => key !== field),
      );
      const validated = registry.validate({
        id: "host.gap-proposal",
        version: "1.0.0",
        value: {
          contractVersion: "1.0.0",
          hostContract: "1.0.0",
          gaps: [gap],
        },
        structuralReasonCode: "trail.uso",
      });
      expect(validated.kind).toBe("invalid");
    }
  });

  it("publishes every recorded gap under the state contract", () => {
    expect(
      registry.validate({
        id: "state.gap",
        version: "1.0.0",
        value: recordOne("gap-01"),
        structuralReasonCode: "runtime.state_corrupt",
      }).kind,
    ).toBe("valid");
  });

  it("publishes every derived fact set under the state contract", () => {
    expect(
      registry.validate({
        id: "state.gates",
        version: "1.0.0",
        value: facts([recordOne("gap-01")]),
        structuralReasonCode: "runtime.state_corrupt",
      }).kind,
    ).toBe("valid");
  });
});

describe("receiving proposed gaps", () => {
  it("records a proposal the run has never seen", () => {
    const decision = decideGapRecord(request());

    expect(decision).toMatchObject({ kind: "recorded" });
    if (decision.kind !== "recorded") return;
    expect(decision.gaps).toHaveLength(1);
    expect(decision.gaps[0]).toMatchObject({
      gapId: "gap-01",
      runId: "run-01",
      phase: "prd",
      prdDigest: PRD,
      specDigest: SPEC,
      resolution: null,
      waiver: null,
    });
  });

  it("treats a repeated proposal as one gap observed twice", () => {
    const existing = recordOne("gap-01");

    expect(decideGapRecord(request({ existing: [existing] }))).toEqual({
      kind: "unchanged",
    });
    // Provenance may differ without making it a second finding.
    expect(
      decideGapRecord(request({ existing: [existing], policyMode: "warn" })),
    ).toEqual({ kind: "unchanged" });
  });

  it("records only the gaps the run does not already hold", () => {
    const decision = decideGapRecord(
      request({
        proposal: proposal(proposed("gap-02"), proposed("gap-01")),
        existing: [recordOne("gap-01")],
      }),
    );

    expect(decision).toMatchObject({ kind: "recorded" });
    if (decision.kind !== "recorded") return;
    expect(decision.gaps.map(({ gapId }) => gapId)).toEqual(["gap-02"]);
  });

  it("refuses to rewrite a recorded gap under the same identifier", () => {
    const existing = recordOne("gap-01");

    expect(
      decideGapRecord(
        request({
          existing: [existing],
          proposal: proposal({
            ...proposed("gap-01"),
            description: "Something else entirely.",
          }),
        }),
      ),
    ).toEqual({ kind: "refused", reason: "conflicting-gap" });
  });

  it("refuses a proposal that repeats one identifier", () => {
    expect(
      decideGapRecord(
        request({ proposal: proposal(proposed("gap-01"), proposed("gap-01")) }),
      ),
    ).toEqual({ kind: "refused", reason: "duplicate-proposal-id" });
  });

  it("refuses a proposal larger than the published bounds", () => {
    expect(
      decideGapRecord(
        request({
          proposal: proposal(
            ...Array.from({ length: MAX_PROPOSED_GAPS + 1 }, (_value, index) =>
              proposed(`gap-${String(index)}`),
            ),
          ),
        }),
      ),
    ).toEqual({ kind: "refused", reason: "gap-limit" });
    expect(
      decideGapRecord(
        request({
          proposal: proposal({
            ...proposed("gap-01"),
            documentRefs: Array.from(
              { length: MAX_DOCUMENT_REFS + 1 },
              (_value, index) => `docs/${String(index)}.md`,
            ) as unknown as GapProposalV1["gaps"][number]["documentRefs"],
          }),
        }),
      ),
    ).toEqual({ kind: "refused", reason: "document-ref-limit" });
  });

  it("refuses detection after the specification is approved", () => {
    expect(decideGapRecord(request({ boundary: "post-approval" }))).toEqual({
      kind: "refused",
      reason: "post-approval",
    });
  });

  it("refuses a request whose binding is not the published shape", () => {
    expect(decideGapRecord(request({ runId: "" }))).toEqual({
      kind: "refused",
      reason: "invalid-request",
    });
    expect(decideGapRecord(request({ prdDigest: "short" }))).toEqual({
      kind: "refused",
      reason: "invalid-request",
    });
    expect(decideGapRecord(request({ recordedAt: "yesterday" }))).toEqual({
      kind: "refused",
      reason: "invalid-request",
    });
  });

  it("names every refusal it can return", () => {
    for (const reason of [
      "conflicting-gap",
      "conflicting-verdict",
      "document-ref-limit",
      "duplicate-proposal-id",
      "gap-limit",
      "invalid-request",
      "post-approval",
      "unknown-gap",
    ] as const) {
      expect(describeGapRefusal(reason).length).toBeGreaterThan(0);
    }
  });
});

describe("answering a recorded gap", () => {
  const gap = recordOne("gap-01");
  const verdict = {
    gapId: "gap-01",
    decision: "accepted" as const,
    documentChanged: true,
    decidedBy: "human:owner",
    decidedAt: NOW,
    observation: "Adopted the thirty-day window and revised the PRD.",
    gaps: [gap],
  };

  it("records the verdict and whether a document changed", () => {
    const decision = decideGapVerdict(verdict);

    expect(decision).toMatchObject({ kind: "updated" });
    if (decision.kind !== "updated") return;
    expect(decision.gap.resolution).toEqual({
      decision: "accepted",
      documentChanged: true,
      decidedBy: "human:owner",
      decidedAt: NOW,
      observation: "Adopted the thirty-day window and revised the PRD.",
    });
    expect(isOpenGap(decision.gap)).toBe(false);
  });

  it("keeps the document change separate from the verdict", () => {
    const decision = decideGapVerdict({
      ...verdict,
      decision: "rejected",
      documentChanged: false,
    });

    expect(decision).toMatchObject({
      kind: "updated",
      gap: { resolution: { decision: "rejected", documentChanged: false } },
    });
  });

  it("repeats the same verdict without rewriting the record", () => {
    const first = decideGapVerdict(verdict);
    if (first.kind !== "updated") throw new Error("no verdict was recorded");

    expect(decideGapVerdict({ ...verdict, gaps: [first.gap] })).toMatchObject({
      kind: "unchanged",
    });
    expect(
      decideGapVerdict({ ...verdict, decision: "rejected", gaps: [first.gap] }),
    ).toEqual({ kind: "refused", reason: "conflicting-verdict" });
  });

  it("refuses a verdict on a gap the run never recorded", () => {
    expect(decideGapVerdict({ ...verdict, gapId: "gap-99" })).toEqual({
      kind: "refused",
      reason: "unknown-gap",
    });
    expect(
      decideGapWaiver({
        gapId: "gap-99",
        acknowledgedBy: "human:owner",
        acknowledgedAt: NOW,
        observation: "Shipping without an answer.",
        gaps: [gap],
      }),
    ).toEqual({ kind: "refused", reason: "unknown-gap" });
  });

  it("refuses a verdict whose owner or observation is not usable", () => {
    expect(decideGapVerdict({ ...verdict, decidedBy: "" })).toEqual({
      kind: "refused",
      reason: "invalid-request",
    });
    expect(decideGapVerdict({ ...verdict, observation: "" })).toEqual({
      kind: "refused",
      reason: "invalid-request",
    });
    expect(decideGapVerdict({ ...verdict, decidedAt: "soon" })).toEqual({
      kind: "refused",
      reason: "invalid-request",
    });
  });

  it("keeps a waived gap visible as unanswered", () => {
    const decision = decideGapWaiver({
      gapId: "gap-01",
      acknowledgedBy: "human:owner",
      acknowledgedAt: NOW,
      observation: "Released with the question still open.",
      gaps: [gap],
    });

    expect(decision).toMatchObject({ kind: "updated" });
    if (decision.kind !== "updated") return;
    expect(decision.gap.resolution).toBeNull();
    expect(decision.gap.waiver).toMatchObject({
      acknowledgedBy: "human:owner",
    });
    // Waived, so it no longer blocks, and still on record as unanswered.
    expect(isOpenGap(decision.gap)).toBe(false);
    expect(facts([decision.gap]).openGaps).toBe(0);
  });

  it("refuses to waive a gap the owner already answered", () => {
    const answered = decideGapVerdict(verdict);
    if (answered.kind !== "updated") throw new Error("no verdict was recorded");

    expect(
      decideGapWaiver({
        gapId: "gap-01",
        acknowledgedBy: "human:owner",
        acknowledgedAt: NOW,
        observation: "Proceeding anyway.",
        gaps: [answered.gap],
      }),
    ).toEqual({ kind: "refused", reason: "conflicting-verdict" });
  });

  it("refuses a waiver whose owner or observation is not usable", () => {
    for (const overrides of [
      { acknowledgedBy: "" },
      { observation: "" },
      { acknowledgedAt: "soon" },
    ]) {
      expect(
        decideGapWaiver({
          gapId: "gap-01",
          acknowledgedBy: "human:owner",
          acknowledgedAt: NOW,
          observation: "Proceeding anyway.",
          gaps: [gap],
          ...overrides,
        }),
      ).toEqual({ kind: "refused", reason: "invalid-request" });
    }
  });
});

describe("deriving the facts the gates read", () => {
  const first = recordOne("gap-01");
  const second = recordOne("gap-02");

  it("counts zero, one, and many open gaps", () => {
    expect(facts([])).toMatchObject({ openGaps: 0, openGapIds: [] });
    expect(facts([first])).toMatchObject({
      openGaps: 1,
      openGapIds: ["gap-01"],
    });
    expect(facts([second, first])).toMatchObject({
      openGaps: 2,
      openGapIds: ["gap-01", "gap-02"],
    });
  });

  it("counts a gap in exactly one run", () => {
    expect(facts([{ ...first, runId: "run-02" }]).openGaps).toBe(0);
  });

  it("reports no open gaps after the specification is approved", () => {
    expect(facts([first, second], "post-approval")).toMatchObject({
      openGaps: 0,
      openGapIds: [],
    });
  });

  it("stops a run under enforce and reports it under the other modes", () => {
    const context = {
      phase: "spec" as const,
      contextReadable: true,
      stopLoss: { tripped: false, exhausted: false },
      prdDigest: PRD,
      prdDocument: { kind: "complete" as const },
      specDigest: SPEC,
      approvals: [],
      openGaps: facts([first]).openGaps,
      partitionRequired: false,
      partitionApproved: true,
      finalAcceptance: false,
    };

    const enforce = evaluateGates({ ...context, mode: "enforce" });
    expect(enforce.outcome).toBe("block");
    expect(enforce.primary?.reasonCode).toBe("gate.gaps_abertos");
    for (const mode of ["shadow", "warn"] as const) {
      const decision = evaluateGates({ ...context, mode });
      expect(decision.outcome).not.toBe("block");
      expect(decision.failures.map(({ gateId }) => gateId)).toContain(
        "gaps-closed",
      );
    }
  });

  it("reports exhaustion only against a budget the project chose", () => {
    expect(budgetExhausted(null, 10_000)).toBe(false);
    expect(budgetExhausted(100, 99)).toBe(false);
    expect(budgetExhausted(100, 100)).toBe(true);
    expect(budgetExhausted(100, -1)).toBe(false);
    expect(budgetExhausted(100, 1.5)).toBe(false);
  });
});

describe("the derived facts as a function of the records", () => {
  /**
   * The property that lets a gate trust the file: two derivations from the
   * same validated records agree, whatever order they arrived in and whatever
   * else the run holds.
   */
  it("depends on the validated records and nothing else", () => {
    const answered = decideGapVerdict({
      gapId: "gap-03",
      decision: "adjusted",
      documentChanged: false,
      decidedBy: "human:owner",
      decidedAt: NOW,
      observation: "Narrowed the recommendation before adopting it.",
      gaps: [recordOne("gap-03")],
    });
    if (answered.kind !== "updated") throw new Error("no verdict was recorded");
    const population = [
      recordOne("gap-01"),
      recordOne("gap-02"),
      answered.gap,
      recordOne("gap-04"),
    ];

    for (let seed = 0; seed < 32; seed += 1) {
      const shuffled = [...population].sort(
        (left, right) =>
          ((seed + left.gapId.length * 7) % 5) -
            ((seed + right.gapId.length * 3) % 5) ||
          ((seed * 31 + left.gapId.charCodeAt(4)) % 7) -
            ((seed * 17 + right.gapId.charCodeAt(4)) % 7),
      );

      expect(facts(shuffled)).toEqual(facts(population));
      expect(facts(shuffled)).toEqual(facts(shuffled));
      expect(facts(shuffled).openGapIds).toEqual([
        "gap-01",
        "gap-02",
        "gap-04",
      ]);
    }
  });

  it("carries the stop-loss and partition facts it was given", () => {
    expect(
      deriveGateFacts({
        runId: "run-01",
        gaps: [],
        boundary: "pre-approval",
        stopLoss: { tripped: true, exhausted: true },
        partitionRequired: true,
        partitionApproved: false,
        derivedAt: NOW,
      }),
    ).toEqual({
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      runId: "run-01",
      openGaps: 0,
      openGapIds: [],
      stopLoss: { tripped: true, exhausted: true },
      partitionRequired: true,
      partitionApproved: false,
      derivedAt: NOW,
    });
  });
});
