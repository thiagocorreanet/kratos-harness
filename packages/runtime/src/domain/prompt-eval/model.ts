import type { PhaseAgentId } from "../phase-agents/model.js";

export type PromptAssertionKind = "mechanical" | "model_graded";

export type MechanicalRule =
  | { readonly type: "schema_valid" }
  | { readonly type: "coherence_valid" }
  | { readonly type: "agent_equals"; readonly expected: string }
  | {
      readonly type: "status_equals";
      readonly expected: "completed" | "awaiting-input" | "blocked";
    }
  | {
      readonly type: "routing_hint_equals";
      readonly expected: "proceed" | "wait" | "retry" | "finish" | "stop";
    }
  | {
      readonly type: "scope_bounded";
      readonly allowedPrefixes: readonly string[];
    }
  | { readonly type: "artifacts_contains"; readonly path: string }
  | { readonly type: "artifacts_empty" }
  | { readonly type: "changed_files_empty" }
  | { readonly type: "has_blocking_question" }
  | { readonly type: "no_blockers" }
  | { readonly type: "verdict_equals"; readonly expected: string };

export interface PromptAssertion {
  readonly id: string;
  readonly description: string;
  readonly kind: PromptAssertionKind;
  readonly mechanicalRule?: MechanicalRule;
  readonly modelGradedRubric?: string;
}

export function isMechanicalAssertion(
  assertion: PromptAssertion,
): assertion is PromptAssertion & { readonly mechanicalRule: MechanicalRule } {
  return (
    assertion.kind === "mechanical" && assertion.mechanicalRule !== undefined
  );
}

export interface PromptEvaluationCase {
  readonly id: string;
  readonly description: string;
  readonly promptId: PhaseAgentId;
  readonly input: {
    readonly featureDocuments?: Record<string, string>;
    readonly context: string;
  };
  readonly assertions: readonly PromptAssertion[];
  readonly trials?: number;
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

export type AssertionDiscrimination =
  | "discriminating_benefit"
  | "non_discriminating_pass"
  | "non_discriminating_fail"
  | "regression";

export interface AssertionAnalysis {
  readonly assertionId: string;
  readonly kind: PromptAssertionKind;
  readonly withPromptPassRate: number;
  readonly withoutPromptPassRate: number;
  readonly previousPromptPassRate?: number;
  readonly discrimination: AssertionDiscrimination;
  readonly isDiscriminating: boolean;
}

export interface CaseComparisonReport {
  readonly caseId: string;
  readonly promptId: PhaseAgentId;
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
