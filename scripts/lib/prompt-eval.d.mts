export interface PromptAssertion {
  readonly id: string;
  readonly description: string;
  readonly kind: "mechanical" | "model_graded";
  readonly mechanicalRule?: Record<string, unknown>;
  readonly modelGradedRubric?: string;
}

export interface TokenConsumption {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

export interface AssertionOutcome {
  readonly assertionId: string;
  readonly passed: boolean;
  readonly reason?: string;
}

export interface TrialObservation {
  readonly trialIndex: number;
  readonly rawReply: string;
  readonly durationMs: number;
  readonly consumption: TokenConsumption;
  readonly assertionOutcomes: readonly AssertionOutcome[];
}

export interface VariantMetrics {
  readonly variant: "with_prompt" | "without_prompt" | "previous_prompt";
  readonly trials: readonly TrialObservation[];
  readonly passRateByAssertion: Record<string, number>;
  readonly overallPassRate: number;
  readonly spread: number;
  readonly averageDurationMs: number;
  readonly averageConsumption: TokenConsumption;
}

export interface AssertionAnalysis {
  readonly assertionId: string;
  readonly kind: "mechanical" | "model_graded";
  readonly withPromptPassRate: number;
  readonly withoutPromptPassRate: number;
  readonly previousPromptPassRate?: number;
  readonly discrimination: string;
  readonly isDiscriminating: boolean;
}

export interface CaseComparisonReport {
  readonly caseId: string;
  readonly promptId: string;
  readonly withPrompt: VariantMetrics;
  readonly withoutPrompt: VariantMetrics;
  readonly previousPrompt?: VariantMetrics;
  readonly assertions: readonly AssertionAnalysis[];
  readonly nonDiscriminatingCount: number;
  readonly modelGradedCount: number;
  readonly costMultiplier: number;
  readonly latencyMultiplier: number;
  readonly passingAuthorized: boolean;
}

export function extractAgentBlock(reply: string):
  | { readonly kind: "absent" }
  | { readonly kind: "malformed"; readonly reason: string }
  | {
      readonly kind: "extracted";
      readonly value: unknown;
      readonly text: string;
    };

export function evaluateMechanicalRule(
  rawReply: string,
  rule: Record<string, unknown>,
  schema?: Record<string, unknown>,
): { readonly passed: boolean; readonly reason?: string };

export function classifyDiscrimination(
  withPromptPassRate: number,
  withoutPromptPassRate: number,
): { readonly discrimination: string; readonly isDiscriminating: boolean };

export function calculateVariantMetrics(
  variant: "with_prompt" | "without_prompt" | "previous_prompt",
  trials: readonly TrialObservation[],
  assertions: readonly PromptAssertion[],
): VariantMetrics;

export function generateComparisonReport(
  caseId: string,
  promptId: string,
  withPrompt: VariantMetrics,
  withoutPrompt: VariantMetrics,
  assertions: readonly PromptAssertion[],
  previousPrompt?: VariantMetrics,
): CaseComparisonReport;
