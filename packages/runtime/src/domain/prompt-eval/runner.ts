import { PHASE_AGENT_PROMPTS } from "../phase-agents/model.js";
import type { SchemaRegistry } from "../schema/index.js";
import {
  calculateVariantMetrics,
  generateComparisonReport,
} from "./analysis.js";
import { evaluateMechanicalRule } from "./mechanical.js";
import type {
  AssertionOutcome,
  CaseComparisonReport,
  PromptEvaluationCase,
  TrialObservation,
  VariantMetrics,
} from "./model.js";
import type { EvaluationModelProvider } from "./provider.js";

export async function runPromptEvaluationCase(
  evaluationCase: PromptEvaluationCase,
  provider: EvaluationModelProvider,
  options: {
    readonly trials?: number | undefined;
    readonly previousPrompt?: string | undefined;
    readonly registry?: SchemaRegistry | undefined;
  } = {},
): Promise<CaseComparisonReport> {
  const trialCount = options.trials ?? evaluationCase.trials ?? 3;
  const promptDef = PHASE_AGENT_PROMPTS.find(
    (p) => p.id === evaluationCase.promptId,
  );
  const activePrompt = promptDef?.instructions ?? "";

  const userMessage = formatUserMessage(evaluationCase.input);

  const withTrials = await runTrials(
    activePrompt,
    userMessage,
    trialCount,
    evaluationCase,
    provider,
    options.registry,
  );

  const withoutTrials = await runTrials(
    "",
    userMessage,
    trialCount,
    evaluationCase,
    provider,
    options.registry,
  );

  const withMetrics = calculateVariantMetrics(
    "with_prompt",
    withTrials,
    evaluationCase.assertions,
  );
  const withoutMetrics = calculateVariantMetrics(
    "without_prompt",
    withoutTrials,
    evaluationCase.assertions,
  );

  let prevMetrics: VariantMetrics | undefined;
  if (options.previousPrompt !== undefined) {
    const prevTrials = await runTrials(
      options.previousPrompt,
      userMessage,
      trialCount,
      evaluationCase,
      provider,
      options.registry,
    );
    prevMetrics = calculateVariantMetrics(
      "previous_prompt",
      prevTrials,
      evaluationCase.assertions,
    );
  }

  return generateComparisonReport(
    evaluationCase.id,
    evaluationCase.promptId,
    withMetrics,
    withoutMetrics,
    evaluationCase.assertions,
    prevMetrics,
  );
}

async function runTrials(
  systemPrompt: string,
  userMessage: string,
  trialCount: number,
  evaluationCase: PromptEvaluationCase,
  provider: EvaluationModelProvider,
  registry?: SchemaRegistry,
): Promise<readonly TrialObservation[]> {
  const observations: TrialObservation[] = [];

  for (let i = 0; i < trialCount; i++) {
    const response = await provider.invoke({
      systemPrompt,
      userMessage,
    });

    const assertionOutcomes: AssertionOutcome[] = [];
    for (const assertion of evaluationCase.assertions) {
      if (assertion.kind === "mechanical" && assertion.mechanicalRule) {
        const result = evaluateMechanicalRule(
          response.rawReply,
          assertion.mechanicalRule,
          registry,
        );
        assertionOutcomes.push({
          assertionId: assertion.id,
          passed: result.passed,
          reason: result.reason,
        });
      } else if (
        assertion.kind === "model_graded" &&
        assertion.modelGradedRubric
      ) {
        if (provider.gradeSemantic) {
          const result = await provider.gradeSemantic(
            assertion.modelGradedRubric,
            response.rawReply,
          );
          assertionOutcomes.push({
            assertionId: assertion.id,
            passed: result.passed,
            reason: result.reason,
          });
        } else {
          assertionOutcomes.push({
            assertionId: assertion.id,
            passed: false,
            reason: "No semantic grader available in provider",
          });
        }
      }
    }

    observations.push({
      trialIndex: i,
      rawReply: response.rawReply,
      durationMs: response.durationMs,
      consumption: response.consumption,
      assertionOutcomes,
    });
  }

  return observations;
}

function formatUserMessage(input: PromptEvaluationCase["input"]): string {
  let message = "";
  if (input.featureDocuments) {
    message += "Feature documents in context:\n";
    for (const [path, content] of Object.entries(input.featureDocuments)) {
      message += `--- ${path} ---\n${content}\n\n`;
    }
  }
  message += `Context and instruction:\n${input.context}\n`;
  return message;
}
