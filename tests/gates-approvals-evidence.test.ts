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
import { evaluateGates } from "@kratos/runtime/domain/gates";
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
});

describe("deterministic gates", () => {
  const context = {
    mode: "enforce" as const,
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

  it("keeps the same findings in warn and shadow modes", () => {
    const enforce = evaluateGates(context);
    const warn = evaluateGates({ ...context, mode: "warn" });
    const shadow = evaluateGates({ ...context, mode: "shadow" });
    expect(warn.outcome).toBe("warn");
    expect(shadow.outcome).toBe("pass");
    expect(warn.failures).toEqual(enforce.failures);
    expect(shadow.failures).toEqual(enforce.failures);
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
