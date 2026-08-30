import { describe, expect, it } from "vitest";
import {
  isMechanicalAssertion,
  type PromptEvaluationCase,
  type PromptAssertion,
  type TrialObservation,
  type VariantMetrics,
  type AssertionAnalysis,
  type CaseComparisonReport,
} from "@kratos/runtime/domain/prompt-eval";

describe("prompt evaluation domain contracts", () => {
  it("distinguishes mechanical from model-graded assertions", () => {
    const mechanical: PromptAssertion = {
      id: "assert-schema",
      description: "Validates against machine schema",
      kind: "mechanical",
      mechanicalRule: { type: "schema_valid" },
    };
    const modelGraded: PromptAssertion = {
      id: "assert-tone",
      description: "Tone check",
      kind: "model_graded",
      modelGradedRubric: "Check if tone is neutral",
    };
    const mechanicalWithoutRule: PromptAssertion = {
      id: "assert-incomplete",
      description: "Incomplete mechanical assertion",
      kind: "mechanical",
    };

    expect(isMechanicalAssertion(mechanical)).toBe(true);
    expect(isMechanicalAssertion(modelGraded)).toBe(false);
    expect(isMechanicalAssertion(mechanicalWithoutRule)).toBe(false);
  });

  it("constructs a valid prompt evaluation case with all mechanical rule variants", () => {
    const testCase: PromptEvaluationCase = {
      id: "case-01",
      description: "Tests implementer output",
      promptId: "code-implementer",
      input: {
        context: "Implement step 1",
        featureDocuments: {
          "00-prd.md": "# PRD",
        },
      },
      trials: 3,
      assertions: [
        {
          id: "rule-schema",
          description: "Schema valid",
          kind: "mechanical",
          mechanicalRule: { type: "schema_valid" },
        },
        {
          id: "rule-coherence",
          description: "Coherence valid",
          kind: "mechanical",
          mechanicalRule: { type: "coherence_valid" },
        },
        {
          id: "rule-agent",
          description: "Agent equals",
          kind: "mechanical",
          mechanicalRule: { type: "agent_equals", expected: "code" },
        },
        {
          id: "rule-status",
          description: "Status equals",
          kind: "mechanical",
          mechanicalRule: { type: "status_equals", expected: "completed" },
        },
        {
          id: "rule-hint",
          description: "Routing hint equals",
          kind: "mechanical",
          mechanicalRule: { type: "routing_hint_equals", expected: "proceed" },
        },
        {
          id: "rule-scope",
          description: "Scope bounded",
          kind: "mechanical",
          mechanicalRule: { type: "scope_bounded", allowedPrefixes: ["src/"] },
        },
        {
          id: "rule-contains",
          description: "Artifacts contains",
          kind: "mechanical",
          mechanicalRule: { type: "artifacts_contains", path: "src/index.ts" },
        },
        {
          id: "rule-artifacts-empty",
          description: "Artifacts empty",
          kind: "mechanical",
          mechanicalRule: { type: "artifacts_empty" },
        },
        {
          id: "rule-changed-empty",
          description: "Changed files empty",
          kind: "mechanical",
          mechanicalRule: { type: "changed_files_empty" },
        },
        {
          id: "rule-blocking-q",
          description: "Has blocking question",
          kind: "mechanical",
          mechanicalRule: { type: "has_blocking_question" },
        },
        {
          id: "rule-no-blockers",
          description: "No blockers",
          kind: "mechanical",
          mechanicalRule: { type: "no_blockers" },
        },
        {
          id: "rule-verdict",
          description: "Verdict equals",
          kind: "mechanical",
          mechanicalRule: { type: "verdict_equals", expected: "pass" },
        },
      ],
    };

    expect(testCase.id).toBe("case-01");
    expect(testCase.assertions).toHaveLength(12);
  });

  it("constructs comparison report and metrics contracts", () => {
    const trial: TrialObservation = {
      trialIndex: 0,
      rawReply:
        "markdown\n===KRATOS-AGENT-OUTPUT-V1===\n{}\n===END-KRATOS-AGENT-OUTPUT-V1===",
      durationMs: 1200,
      consumption: {
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
      },
      assertionOutcomes: [
        {
          assertionId: "assert-schema",
          passed: true,
        },
      ],
    };

    const variantMetrics: VariantMetrics = {
      variant: "with_prompt",
      trials: [trial],
      passRateByAssertion: { "assert-schema": 1.0 },
      overallPassRate: 1.0,
      spread: 0.0,
      averageDurationMs: 1200,
      averageConsumption: {
        inputTokens: 1000,
        outputTokens: 200,
        totalTokens: 1200,
      },
    };

    const analysis: AssertionAnalysis = {
      assertionId: "assert-schema",
      kind: "mechanical",
      withPromptPassRate: 1.0,
      withoutPromptPassRate: 0.0,
      previousPromptPassRate: 0.8,
      discrimination: "discriminating_benefit",
      isDiscriminating: true,
    };

    const report: CaseComparisonReport = {
      caseId: "case-01",
      promptId: "code-implementer",
      withPrompt: variantMetrics,
      withoutPrompt: {
        ...variantMetrics,
        variant: "without_prompt",
        overallPassRate: 0.0,
      },
      previousPrompt: {
        ...variantMetrics,
        variant: "previous_prompt",
        overallPassRate: 0.8,
      },
      assertions: [analysis],
      nonDiscriminatingCount: 0,
      modelGradedCount: 0,
      costMultiplier: 1.2,
      latencyMultiplier: 1.1,
      passingAuthorized: true,
    };

    expect(report.caseId).toBe("case-01");
    expect(report.passingAuthorized).toBe(true);
  });
});
