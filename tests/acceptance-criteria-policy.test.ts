import {
  compareCriteriaSnapshot,
  decideAcceptanceVerdict,
  findLegacyPlanBaselineIndex,
  isLegacyPlanBaseline,
  type FrozenCriterion,
} from "@kratos/runtime/domain/acceptance-criteria";
import type { EvidenceV1 } from "@kratos/contracts";
import { describe, expect, it } from "vitest";

const digest = "a".repeat(64);
const frozen = [
  {
    criterionId: "AC-1.2.1",
    workUnit: "1",
    task: "2",
    kind: "main",
    ordinal: 0,
    declarationDigest: digest,
  },
  {
    criterionId: "AC-1.2.E1",
    workUnit: "1",
    task: "2",
    kind: "edge",
    ordinal: 1,
    declarationDigest: "b".repeat(64),
  },
] as const satisfies readonly FrozenCriterion[];
const current = [
  { ...frozen[0], checked: false },
  { ...frozen[1], checked: false },
] as const;
const evidence: EvidenceV1 = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  evidenceId: "evidence-1",
  kind: "test",
  ref: ".brain/evidence/test.json",
  sha256: "c".repeat(64),
  classification: "internal",
  redaction: "none",
  recordedAt: "2026-08-27T12:00:00Z",
};

describe("acceptance criterion freeze policy", () => {
  it("accepts an unchanged frozen declaration prefix", () => {
    expect(compareCriteriaSnapshot({ phase: "code", frozen, current })).toEqual(
      { kind: "unchanged" },
    );
  });

  it.each([
    ["renumber", [{ ...current[0], criterionId: "AC-1.2.9" }, current[1]]],
    ["remove", [current[0]]],
    ["reorder", [current[1], current[0]]],
    [
      "edit",
      [{ ...current[0], declarationDigest: "d".repeat(64) }, current[1]],
    ],
  ] as const)("refuses a post-freeze %s", (_name, changed) => {
    expect(
      compareCriteriaSnapshot({ phase: "code", frozen, current: changed }),
    ).toMatchObject({
      kind: "refused",
      reasonCode: "gate.ac_declaration_changed",
    });
  });

  it("allows an unchecked tail append only in acceptance", () => {
    const appended = [
      ...current,
      {
        criterionId: "AC-1.2.2",
        workUnit: "1",
        task: "2",
        kind: "main" as const,
        ordinal: 2,
        declarationDigest: "e".repeat(64),
        checked: false,
      },
    ] as const;
    expect(
      compareCriteriaSnapshot({
        phase: "acceptance",
        frozen,
        current: appended,
      }),
    ).toEqual({ kind: "append", appendedIds: ["AC-1.2.2"] });
    expect(
      compareCriteriaSnapshot({ phase: "review", frozen, current: appended }),
    ).toMatchObject({
      kind: "refused",
      reasonCode: "gate.ac_append_forbidden",
    });
    expect(
      compareCriteriaSnapshot({
        phase: "acceptance",
        frozen,
        current: [{ ...appended[0], checked: true }, ...appended.slice(1)],
      }),
    ).toMatchObject({
      kind: "refused",
      reasonCode: "gate.ac_checkbox_forbidden",
    });
  });

  it("permits checkbox state only when it matches the latest verdicts", () => {
    expect(
      compareCriteriaSnapshot({
        phase: "code",
        frozen,
        current: [{ ...current[0], checked: true }, current[1]],
        latestOutcomes: new Map([["AC-1.2.1", "passed"]]),
      }),
    ).toEqual({ kind: "unchanged" });
  });
});

describe("acceptance verdict policy", () => {
  it("requires a verdict for every declaration exactly once", () => {
    expect(
      decideAcceptanceVerdict({
        declarations: current,
        globalVerdict: "rejected",
        criteria: [
          {
            criterionId: "AC-1.2.1",
            outcome: "passed",
            evidenceRef: evidence.ref,
          },
        ],
        evidence: [evidence],
      }),
    ).toEqual({
      kind: "refused",
      reasonCode: "gate.ac_verdict_mismatch",
      criterionId: "AC-1.2.E1",
    });
  });

  it("rejects passed criteria without matching valid evidence", () => {
    expect(
      decideAcceptanceVerdict({
        declarations: current,
        globalVerdict: "rejected",
        criteria: [
          {
            criterionId: "AC-1.2.1",
            outcome: "passed",
            evidenceRef: "missing",
          },
          {
            criterionId: "AC-1.2.E1",
            outcome: "failed",
            evidenceRef: evidence.ref,
          },
        ],
        evidence: [evidence],
      }),
    ).toEqual({
      kind: "refused",
      reasonCode: "gate.ac_evidence_missing",
      criterionId: "AC-1.2.1",
    });
  });

  it("returns document order and evidence bindings for a partial result", () => {
    expect(
      decideAcceptanceVerdict({
        declarations: current,
        globalVerdict: "rejected",
        criteria: [
          {
            criterionId: "AC-1.2.E1",
            outcome: "failed",
            evidenceRef: evidence.ref,
          },
          {
            criterionId: "AC-1.2.1",
            outcome: "passed",
            evidenceRef: evidence.ref,
          },
        ],
        evidence: [evidence],
      }),
    ).toEqual({
      kind: "accepted",
      criteria: [
        {
          criterionId: "AC-1.2.1",
          outcome: "passed",
          evidenceId: "evidence-1",
          evidenceRef: evidence.ref,
          evidenceDigest: evidence.sha256,
        },
        {
          criterionId: "AC-1.2.E1",
          outcome: "failed",
          evidenceId: "evidence-1",
          evidenceRef: evidence.ref,
          evidenceDigest: evidence.sha256,
        },
      ],
      checkboxOutcomes: new Map([
        ["AC-1.2.1", "passed"],
        ["AC-1.2.E1", "failed"],
      ]),
    });
  });

  it("requires the global verdict to agree with all outcomes", () => {
    expect(
      decideAcceptanceVerdict({
        declarations: current,
        globalVerdict: "accepted",
        criteria: [
          {
            criterionId: "AC-1.2.1",
            outcome: "passed",
            evidenceRef: evidence.ref,
          },
          {
            criterionId: "AC-1.2.E1",
            outcome: "failed",
            evidenceRef: evidence.ref,
          },
        ],
        evidence: [evidence],
      }),
    ).toMatchObject({
      kind: "refused",
      reasonCode: "gate.ac_verdict_mismatch",
    });
  });
});

describe("legacy acceptance criterion baseline", () => {
  const event = {
    eventType: "transition",
    reasonCode: "run.transition.accepted",
    operation: "sdd.continue:complete-plan",
    artifactRefs: [".brain/02-features/feature/02-tasks.md"],
  };
  const lineage = {
    artifactRef: ".brain/02-features/feature/02-tasks.md",
    artifactDigest: "a".repeat(64),
    phase: "plan",
    producerCommand: "sdd.continue:complete-plan",
  };

  it("accepts only exact accepted plan lineage", () => {
    expect(
      isLegacyPlanBaseline({
        documentRef: lineage.artifactRef,
        documentDigest: lineage.artifactDigest,
        event,
        lineage,
      }),
    ).toBe(true);
  });

  it.each([
    ["later phase", { ...lineage, phase: "code" }],
    ["different digest", { ...lineage, artifactDigest: "b".repeat(64) }],
    [
      "different producer",
      { ...lineage, producerCommand: "sdd.continue:code" },
    ],
  ])("rejects %s lineage as a bootstrap authority", (_name, candidate) => {
    expect(
      isLegacyPlanBaseline({
        documentRef: lineage.artifactRef,
        documentDigest: lineage.artifactDigest,
        event,
        lineage: candidate,
      }),
    ).toBe(false);
  });

  it("finds the older plan baseline behind a later code event", () => {
    expect(
      findLegacyPlanBaselineIndex({
        documentRef: lineage.artifactRef,
        documentDigest: lineage.artifactDigest,
        candidates: [
          {
            event: { ...event, operation: "sdd.continue:complete-code" },
            lineage: {
              ...lineage,
              phase: "code",
              producerCommand: "sdd.continue:complete-code",
            },
          },
          { event, lineage },
        ],
      }),
    ).toBe(1);
  });
});
