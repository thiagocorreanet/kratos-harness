import { describe, expect, it } from "vitest";
import {
  calculateVariantMetrics,
  classifyDiscrimination,
  generateComparisonReport,
  type PromptAssertion,
  type TrialObservation,
} from "@kratos/runtime/domain/prompt-eval";

describe("prompt evaluation analysis engine", () => {
  const assertions: readonly PromptAssertion[] = [
    { id: "a1", description: "Mechanical valid block", kind: "mechanical" },
    {
      id: "a2",
      description: "Follows specific prompt instruction",
      kind: "mechanical",
    },
    { id: "a3", description: "Always passes everywhere", kind: "mechanical" },
  ];

  it("classifies discriminating benefit vs non-discriminating pass and fail", () => {
    expect(classifyDiscrimination(1.0, 0.0)).toEqual({
      discrimination: "discriminating_benefit",
      isDiscriminating: true,
    });

    expect(classifyDiscrimination(1.0, 1.0)).toEqual({
      discrimination: "non_discriminating_pass",
      isDiscriminating: false,
    });

    expect(classifyDiscrimination(0.0, 0.0)).toEqual({
      discrimination: "non_discriminating_fail",
      isDiscriminating: false,
    });

    expect(classifyDiscrimination(0.0, 1.0)).toEqual({
      discrimination: "regression",
      isDiscriminating: true,
    });
  });

  it("calculates spread across trials", () => {
    const trials: TrialObservation[] = [
      {
        trialIndex: 0,
        rawReply: "r1",
        durationMs: 100,
        consumption: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
        assertionOutcomes: [
          { assertionId: "a1", passed: true },
          { assertionId: "a2", passed: true },
        ],
      },
      {
        trialIndex: 1,
        rawReply: "r2",
        durationMs: 200,
        consumption: { inputTokens: 50, outputTokens: 30, totalTokens: 80 },
        assertionOutcomes: [
          { assertionId: "a1", passed: true },
          { assertionId: "a2", passed: false },
        ],
      },
    ];

    const metrics = calculateVariantMetrics(
      "with_prompt",
      trials,
      assertions.slice(0, 2),
    );
    expect(metrics.passRateByAssertion.a1).toBe(1.0);
    expect(metrics.passRateByAssertion.a2).toBe(0.5);
    expect(metrics.overallPassRate).toBe(0.75);
    expect(metrics.averageDurationMs).toBe(150);
    expect(metrics.averageConsumption.totalTokens).toBe(75);
  });

  it("generates full comparison report identifying non-discriminating count", () => {
    const withTrials: TrialObservation[] = [
      {
        trialIndex: 0,
        rawReply: "",
        durationMs: 100,
        consumption: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        assertionOutcomes: [
          { assertionId: "a1", passed: true },
          { assertionId: "a2", passed: true },
          { assertionId: "a3", passed: true },
        ],
      },
    ];
    const withoutTrials: TrialObservation[] = [
      {
        trialIndex: 0,
        rawReply: "",
        durationMs: 50,
        consumption: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        assertionOutcomes: [
          { assertionId: "a1", passed: false },
          { assertionId: "a2", passed: false },
          { assertionId: "a3", passed: true },
        ],
      },
    ];

    const withMetrics = calculateVariantMetrics(
      "with_prompt",
      withTrials,
      assertions,
    );
    const withoutMetrics = calculateVariantMetrics(
      "without_prompt",
      withoutTrials,
      assertions,
    );

    const report = generateComparisonReport(
      "case-1",
      "code-implementer",
      withMetrics,
      withoutMetrics,
      assertions,
    );
    expect(report.nonDiscriminatingCount).toBe(1);
    expect(
      report.assertions.find((a) => a.assertionId === "a3")?.isDiscriminating,
    ).toBe(false);
    expect(report.costMultiplier).toBe(5);
    expect(report.latencyMultiplier).toBe(2);
    expect(report.passingAuthorized).toBe(true);
  });
});
