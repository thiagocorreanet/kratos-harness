import { createHash } from "node:crypto";

import {
  approvalChallenge,
  issueApproval,
  validateApproval,
} from "@kratos/runtime/domain/approvals";
import {
  buildHandoff,
  recordEvidence,
  verifyEvidence,
} from "@kratos/runtime/domain/evidence";
import {
  approvalModeFor,
  evaluateGates,
  resolveGateModes,
  type GateMode,
} from "@kratos/runtime/domain/gates";
import { describe, expect, it } from "vitest";

const digests = {
  sha256: (value: string) => createHash("sha256").update(value).digest("hex"),
};
const binding = {
  runId: "run-01",
  gate: "spec",
  prdDigest: "a".repeat(64),
  specDigest: "b".repeat(64),
  policyVersion: "workflow-v1",
  policyMode: "enforce",
  objectiveDigest: "c".repeat(64),
  revision: 4,
};

describe("content-bound approvals", () => {
  const approval = issueApproval(
    {
      ...binding,
      approvalId: "approval-01",
      decision: "approved",
      approver: "human:owner",
      observation: "Reviewed the exact PRD and specification digests.",
      decidedAt: "2026-08-15T12:00:00.000Z",
      expiresAt: "2026-08-15T13:00:00.000Z",
    },
    digests,
  );

  it("derives the same deterministic challenge from the same content", () => {
    expect(approval.challenge).toBe(approvalChallenge(binding, digests));
    expect(approval.challenge).toHaveLength(64);
  });

  it("accepts only the current, unexpired, unseen approval", () => {
    expect(
      validateApproval(
        approval,
        binding,
        "2026-08-15T12:30:00.000Z",
        new Set(),
        digests,
      ),
    ).toMatchObject({ kind: "valid" });
    expect(
      validateApproval(
        approval,
        binding,
        "2026-08-15T14:00:00.000Z",
        new Set(),
        digests,
      ),
    ).toEqual({ kind: "expired" });
    expect(
      validateApproval(
        approval,
        { ...binding, specDigest: "c".repeat(64) },
        "2026-08-15T12:30:00.000Z",
        new Set(),
        digests,
      ),
    ).toEqual({ kind: "stale" });
    expect(
      validateApproval(
        approval,
        binding,
        "2026-08-15T12:30:00.000Z",
        new Set(["approval-01"]),
        digests,
      ),
    ).toEqual({ kind: "replayed" });
  });

  it("binds a spec challenge only to the spec-approved policy mode", () => {
    const inherited = resolveGateModes("standard", {});
    const unrelatedOverride = resolveGateModes("standard", {
      "gaps-closed": "shadow",
    });
    const authorizedOverride = resolveGateModes("standard", {
      "spec-approved": "enforce",
    });
    const challengeFor = (
      gateModes: ReturnType<typeof resolveGateModes>,
    ): string =>
      approvalChallenge(
        {
          ...binding,
          policyMode: approvalModeFor("spec", "warn", gateModes),
        },
        digests,
      );

    expect(challengeFor(unrelatedOverride)).toBe(challengeFor(inherited));
    expect(challengeFor(authorizedOverride)).not.toBe(challengeFor(inherited));
  });

  it("uses the authorized gate mode and project default for other targets", () => {
    const gateModes = resolveGateModes("standard", {
      "final-acceptance": "shadow",
      "partition-approved": "enforce",
    });

    expect(approvalModeFor("final-acceptance", "warn", gateModes)).toBe(
      "shadow",
    );
    expect(approvalModeFor("partition-approved", "warn", gateModes)).toBe(
      "enforce",
    );
    expect(approvalModeFor("custom-review", "warn", gateModes)).toBe("warn");
  });
});

describe("deterministic gates", () => {
  function gateModes(mode: GateMode) {
    return resolveGateModes("standard", {
      "context-readable": mode,
      "stop-loss": mode,
      "prd-present": mode,
      "spec-approved": mode,
      "gaps-closed": mode,
      "partition-approved": mode,
      "acceptance-criteria": mode,
      "final-acceptance": mode,
    });
  }

  const context = {
    gateModes: gateModes("enforce"),
    phase: "acceptance" as const,
    contextReadable: true,
    stopLoss: { tripped: false, exhausted: false },
    prdDigest: "a".repeat(64),
    prdDocument: { kind: "complete" as const },
    specDigest: "b".repeat(64),
    approvals: [],
    openGaps: 2,
    partitionRequired: true,
    partitionApproved: false,
    finalAcceptance: false,
  };

  it("aggregates failures with stable precedence", () => {
    const decision = evaluateGates(context);
    expect(decision.outcome).toBe("block");
    expect(decision.failures.map(({ gateId }) => gateId)).toEqual([
      "spec-approved",
      "gaps-closed",
      "partition-approved",
      "final-acceptance",
    ]);
    expect(decision.primary?.reasonCode).toBe("gate.aprovacao_spec");
  });

  it("uses the enforcing failure as primary in a mixed decision", () => {
    const mixed = evaluateGates({
      ...context,
      phase: "plan",
      gateModes: resolveGateModes("standard", {
        "spec-approved": "enforce",
        "gaps-closed": "shadow",
      }),
      partitionRequired: false,
    });

    expect(mixed.outcome).toBe("block");
    expect(mixed.primary?.gateId).toBe("spec-approved");
    expect(mixed.failures.map(({ mode }) => mode)).toEqual([
      "enforce",
      "shadow",
    ]);
  });

  it("keeps the same findings in warn and shadow modes", () => {
    const enforce = evaluateGates(context);
    const warn = evaluateGates({ ...context, gateModes: gateModes("warn") });
    const shadow = evaluateGates({
      ...context,
      gateModes: gateModes("shadow"),
    });
    expect(warn.outcome).toBe("warn");
    expect(shadow.outcome).toBe("pass");
    expect(warn.failures.map(({ gateId }) => gateId)).toEqual(
      enforce.failures.map(({ gateId }) => gateId),
    );
    expect(shadow.failures.map(({ gateId }) => gateId)).toEqual(
      enforce.failures.map(({ gateId }) => gateId),
    );
  });

  it("reports partial acceptance in task-document order", () => {
    const decision = evaluateGates({
      ...context,
      approvals: [],
      openGaps: 0,
      partitionRequired: false,
      finalAcceptance: true,
      acceptanceCriteria: [
        {
          criterionId: "AC-1.2.1",
          state: "passed",
          checked: true,
          evidenceValid: true,
        },
        {
          criterionId: "AC-1.2.E1",
          state: "failed",
          checked: false,
          evidenceValid: true,
        },
      ],
    });
    expect(
      decision.criteria.map(({ criterionId, state }) => ({
        criterionId,
        state,
      })),
    ).toEqual([
      { criterionId: "AC-1.2.1", state: "passed" },
      { criterionId: "AC-1.2.E1", state: "failed" },
    ]);
    expect(decision.failures).toContainEqual(
      expect.objectContaining({
        gateId: "acceptance-criteria",
        reasonCode: "gate.ac_incomplete",
        detail: "Acceptance criterion AC-1.2.E1 is incomplete.",
      }),
    );
  });
});

describe("evidence and handoff", () => {
  const evidence = recordEvidence(
    {
      evidenceId: "evidence-01",
      kind: "test",
      ref: ".brain/evidence/test.json",
      content: "passed\n",
      classification: "internal",
      redaction: "none",
      recordedAt: "2026-08-15T12:00:00.000Z",
    },
    digests,
  );

  it("detects content substitution", () => {
    expect(verifyEvidence(evidence, "passed\n", digests)).toBe("valid");
    expect(verifyEvidence(evidence, "failed\n", digests)).toBe(
      "digest-mismatch",
    );
  });

  it("builds an order-independent, digest-bound handoff", () => {
    const second = { ...evidence, evidenceId: "evidence-02" };
    expect(
      buildHandoff(
        {
          runId: "run-01",
          fromPhase: "code",
          toPhase: "review",
          evidence: [evidence, second],
        },
        digests,
      ),
    ).toEqual(
      buildHandoff(
        {
          runId: "run-01",
          fromPhase: "code",
          toPhase: "review",
          evidence: [second, evidence],
        },
        digests,
      ),
    );
  });
});
