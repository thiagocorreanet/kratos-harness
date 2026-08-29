import type { ApprovalV1 } from "@kratos/contracts";
import { evaluateGates, type GateContext } from "@kratos/runtime/domain/gates";
import { describe, expect, it } from "vitest";

describe("gate evaluation language advisory", () => {
  const baseContext: GateContext = {
    mode: "enforce",
    phase: "acceptance",
    contextReadable: true,
    stopLoss: { tripped: false, exhausted: false },
    prdDigest: "a".repeat(64),
    prdDocument: { kind: "complete" },
    specDigest: "b".repeat(64),
    approvals: [
      {
        runId: "run-01",
        gate: "spec",
        decision: "approved",
        prdDigest: "a".repeat(64),
        specDigest: "b".repeat(64),
      } as ApprovalV1,
      {
        runId: "run-01",
        gate: "final-acceptance",
        decision: "approved",
        prdDigest: "a".repeat(64),
        specDigest: "b".repeat(64),
      } as ApprovalV1,
    ],
    openGaps: 0,
    partitionRequired: false,
    partitionApproved: false,
    finalAcceptance: true,
    acceptanceCriteria: [
      {
        criterionId: "AC-1.1.1",
        state: "passed",
        checked: true,
        evidenceValid: true,
      },
    ],
  };

  const contextWithLanguageMismatch: GateContext = {
    ...baseContext,
    languagePolicy: {
      conversation: "en",
      documentation: "en",
      comments: "en",
      identifiers: "en",
      commits: "en",
      preserveConventions: true,
      enforcement: "advisory",
    },
    languageObservations: [
      {
        artifactRef: ".brain/02-features/active/01-prd.md",
        artifactType: "documentation",
        observedLanguage: "pt-BR",
        expectedLanguage: "en",
      },
    ],
  };

  it("reports language mismatch as advisory without failing gate or criteria", () => {
    const decision = evaluateGates(contextWithLanguageMismatch);
    expect(decision.outcome).toBe("pass");
    expect(
      decision.failures.some((f) => f.gateId === "acceptance-criteria"),
    ).toBe(false);
    expect(
      decision.advisories?.some(
        (a) => a.reasonCode === "policy.language_convention_mismatch_advisory",
      ),
    ).toBe(true);
  });

  it("does not report advisory when enforcement is off", () => {
    const policy = contextWithLanguageMismatch.languagePolicy;
    if (policy === undefined || policy === null) {
      throw new Error("Expected languagePolicy to be defined in test fixture");
    }
    const decision = evaluateGates({
      ...contextWithLanguageMismatch,
      languagePolicy: {
        ...policy,
        enforcement: "off",
      },
    });
    expect(
      decision.advisories?.some(
        (a) => a.reasonCode === "policy.language_convention_mismatch_advisory",
      ),
    ).toBe(false);
  });

  it("does not report advisory when language matches declared policy", () => {
    const decision = evaluateGates({
      ...baseContext,
      languagePolicy: {
        conversation: "en",
        documentation: "en",
        comments: "en",
        identifiers: "en",
        commits: "en",
        preserveConventions: true,
        enforcement: "advisory",
      },
      languageObservations: [
        {
          artifactRef: ".brain/02-features/active/01-prd.md",
          artifactType: "documentation",
          observedLanguage: "en",
          expectedLanguage: "en",
        },
      ],
    });
    expect(
      decision.advisories?.some(
        (a) => a.reasonCode === "policy.language_convention_mismatch_advisory",
      ),
    ).toBe(false);
  });
});
