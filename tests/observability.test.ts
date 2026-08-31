import { renderStaticDashboard } from "@kratos/runtime/domain/observability";
import { describe, expect, it } from "vitest";

const digest = "a".repeat(64);

describe("static dashboard gate policy trace", () => {
  it("renders the effective mode of each mixed gate failure", () => {
    const dashboard = renderStaticDashboard({
      contractVersion: "1.0.0",
      runId: "run-mixed-policy",
      generatedAt: "2026-08-30T12:00:00.000Z",
      events: [],
      evidence: [],
      snapshot: {
        status: "active",
        currentStep: "code",
        eventCursor: 2,
        eventHash: digest,
        lineage: { prdDigest: digest, specDigest: "b".repeat(64) },
      },
      gates: {
        outcome: "block",
        primary: {
          gateId: "spec-approved",
          reasonCode: "gate.aprovacao_spec",
          priority: 40,
          mode: "enforce",
          evidenceRefs: ["approvals/spec.json"],
          detail: null,
        },
        failures: [
          {
            gateId: "spec-approved",
            reasonCode: "gate.aprovacao_spec",
            priority: 40,
            mode: "enforce",
            evidenceRefs: ["approvals/spec.json"],
            detail: null,
          },
          {
            gateId: "gaps-closed",
            reasonCode: "gate.gaps_abertos",
            priority: 50,
            mode: "shadow",
            evidenceRefs: ["gaps/open.json"],
            detail: "One gap remains open.",
          },
        ],
        gateModes: {
          "context-readable": "enforce",
          "stop-loss": "enforce",
          "prd-present": "enforce",
          "spec-approved": "enforce",
          "gaps-closed": "shadow",
          "partition-approved": "warn",
          "acceptance-criteria": "enforce",
          "final-acceptance": "enforce",
        },
        criteria: [],
      },
      approvals: [],
      lineage: [],
      budget: { allocated: null, used: null },
      redactionReport: { restrictedMetadata: 0, redacted: 0 },
      digest,
    });

    expect(dashboard).toContain("Policy: per-gate.");
    expect(dashboard).toContain(
      "<td>gaps-closed</td><td>gate.gaps_abertos</td><td>shadow</td>",
    );
    expect(dashboard).toContain(
      "<td>spec-approved</td><td>gate.aprovacao_spec</td><td>enforce</td>",
    );
  });
});
