import type { PhaseAgentId } from "../phase-agents/model.js";
import type {
  AssertionAnalysis,
  AssertionDiscrimination,
  CaseComparisonReport,
  PromptAssertion,
  TokenConsumption,
  TrialObservation,
  VariantMetrics,
} from "./model.js";

export function classifyDiscrimination(
  withPromptPassRate: number,
  withoutPromptPassRate: number,
): {
  readonly discrimination: AssertionDiscrimination;
  readonly isDiscriminating: boolean;
} {
  if (withPromptPassRate === withoutPromptPassRate) {
    return {
      discrimination:
        withPromptPassRate > 0
          ? "non_discriminating_pass"
          : "non_discriminating_fail",
      isDiscriminating: false,
    };
  }
  if (withPromptPassRate > withoutPromptPassRate) {
    return {
      discrimination: "discriminating_benefit",
      isDiscriminating: true,
    };
  }
  return {
    discrimination: "regression",
    isDiscriminating: true,
  };
}

export function calculateVariantMetrics(
  variant: "with_prompt" | "without_prompt" | "previous_prompt",
  trials: readonly TrialObservation[],
  assertions: readonly PromptAssertion[],
): VariantMetrics {
  if (trials.length === 0) {
    return {
      variant,
      trials: [],
      passRateByAssertion: {},
      overallPassRate: 0,
      spread: 0,
      averageDurationMs: 0,
      averageConsumption: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
  }

  const passRateByAssertion: Record<string, number> = {};
  for (const assertion of assertions) {
    const passedCount = trials.filter((t) =>
      t.assertionOutcomes.some(
        (o) => o.assertionId === assertion.id && o.passed,
      ),
    ).length;
    passRateByAssertion[assertion.id] = passedCount / trials.length;
  }

  const trialPassRates = trials.map((trial) => {
    const passed = trial.assertionOutcomes.filter((o) => o.passed).length;
    return trial.assertionOutcomes.length > 0
      ? passed / trial.assertionOutcomes.length
      : 0;
  });

  const overallPassRate =
    trialPassRates.reduce((acc, curr) => acc + curr, 0) / trialPassRates.length;

  const variance =
    trialPassRates.reduce(
      (acc, curr) => acc + Math.pow(curr - overallPassRate, 2),
      0,
    ) / trialPassRates.length;
  const spread = Math.sqrt(variance);

  const totalDuration = trials.reduce((acc, t) => acc + t.durationMs, 0);
  const averageDurationMs = totalDuration / trials.length;

  const totalConsumption: TokenConsumption = trials.reduce(
    (acc, t) => ({
      inputTokens: acc.inputTokens + t.consumption.inputTokens,
      outputTokens: acc.outputTokens + t.consumption.outputTokens,
      totalTokens: acc.totalTokens + t.consumption.totalTokens,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  );

  const averageConsumption: TokenConsumption = {
    inputTokens: Math.round(totalConsumption.inputTokens / trials.length),
    outputTokens: Math.round(totalConsumption.outputTokens / trials.length),
    totalTokens: Math.round(totalConsumption.totalTokens / trials.length),
  };

  return {
    variant,
    trials,
    passRateByAssertion,
    overallPassRate,
    spread,
    averageDurationMs,
    averageConsumption,
  };
}

export function generateComparisonReport(
  caseId: string,
  promptId: PhaseAgentId,
  withPrompt: VariantMetrics,
  withoutPrompt: VariantMetrics,
  assertions: readonly PromptAssertion[],
  previousPrompt?: VariantMetrics,
): CaseComparisonReport {
  const assertionAnalyses: AssertionAnalysis[] = assertions.map((assertion) => {
    const withRate = withPrompt.passRateByAssertion[assertion.id] ?? 0;
    const withoutRate = withoutPrompt.passRateByAssertion[assertion.id] ?? 0;
    const prevRate =
      previousPrompt !== undefined
        ? (previousPrompt.passRateByAssertion[assertion.id] ?? 0)
        : undefined;
    const { discrimination, isDiscriminating } = classifyDiscrimination(
      withRate,
      withoutRate,
    );

    return {
      assertionId: assertion.id,
      kind: assertion.kind,
      withPromptPassRate: withRate,
      withoutPromptPassRate: withoutRate,
      previousPromptPassRate: prevRate,
      discrimination,
      isDiscriminating,
    };
  });

  const nonDiscriminatingCount = assertionAnalyses.filter(
    (a) => !a.isDiscriminating,
  ).length;
  const modelGradedCount = assertions.filter(
    (a) => a.kind === "model_graded",
  ).length;

  const costMultiplier =
    withoutPrompt.averageConsumption.totalTokens > 0
      ? withPrompt.averageConsumption.totalTokens /
        withoutPrompt.averageConsumption.totalTokens
      : 1;

  const latencyMultiplier =
    withoutPrompt.averageDurationMs > 0
      ? withPrompt.averageDurationMs / withoutPrompt.averageDurationMs
      : 1;

  const discriminating = assertionAnalyses.filter((a) => a.isDiscriminating);
  const passingAuthorized =
    discriminating.length > 0 &&
    discriminating.every((a) => a.discrimination === "discriminating_benefit");

  return {
    caseId,
    promptId,
    withPrompt,
    withoutPrompt,
    previousPrompt,
    assertions: assertionAnalyses,
    nonDiscriminatingCount,
    modelGradedCount,
    costMultiplier,
    latencyMultiplier,
    passingAuthorized,
  };
}
