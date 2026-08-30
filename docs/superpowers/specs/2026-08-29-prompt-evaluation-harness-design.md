# Prompt Evaluation Against Baseline Harness Specification (QAL-08a)

## 1. Executive Summary

Kratos requires that prompt modifications be justified by evidence rather than subjective impression. This specification establishes a prompt evaluation subsystem that measures a prompt under test against a run of the same task without the prompt (empty baseline) and against previous prompt versions.

The subsystem emphasizes deterministic mechanical assertions over machine blocks (`===KRATOS-AGENT-OUTPUT-V1===`) and written artifacts, tracks trial variance and token consumption, classifies non-discriminating assertions, and isolates live model executions outside the standard verification path.

## 2. Architecture & Core Boundaries

```text
+-------------------------------------------------------------------------------+
|                             Evaluation Engine                                 |
|                                                                               |
|  +---------------------------+        +------------------------------------+  |
|  |   Prompt Evaluation Cases |        |          Model Provider            |  |
|  | (Fixtures / Static Cases) |        | (Deterministic Replay / Live API)  |  |
|  +-------------+-------------+        +-----------------+------------------+  |
|                |                                        |                     |
|                v                                        v                     |
|  +-------------------------------------------------------------------------+  |
|  |                     Dual-Run Trial Executor                             |  |
|  |   - Executes N trials with prompt                                       |  |
|  |   - Executes N trials without prompt (empty baseline)                   |  |
|  |   - (Optional) Executes N trials with previous prompt version           |  |
|  |   - Records latency (durationMs) & consumption (tokens) per trial       |  |
|  +-------------------------------------+-----------------------------------+  |
|                                        |                                      |
|                                        v                                      |
|  +-------------------------------------------------------------------------+  |
|  |                       Assertion Evaluator                               |  |
|  |   - Mechanical Assertions (Block Schema, Coherence, Scope, Fields)      |  |
|  |   - Model-Graded Assertions (Semantic criteria, explicitly labeled)     |  |
|  +-------------------------------------+-----------------------------------+  |
|                                        |                                      |
|                                        v                                      |
|  +-------------------------------------------------------------------------+  |
|  |                 Discrimination & Spread Classifier                      |  |
|  |   - Detects non-discriminating assertions (identical baseline rate)     |  |
|  |   - Calculates pass rates and trial variance/spread                     |  |
|  |   - Generates Comparison Report & Evidence Ledger                       |  |
|  +-------------------------------------+-----------------------------------+  |
+-------------------------------------------------------------------------------+
```

## 3. Data Contracts and Schemas

### 3.1 Evaluation Case Definition (`PromptEvaluationCase`)

Stored as static fixtures in `quality/evaluations/prompts/cases/*.v1.json`:

```typescript
export type PromptAssertionKind = "mechanical" | "model_graded";

export type MechanicalRule =
  | { readonly type: "schema_valid" }
  | { readonly type: "coherence_valid" }
  | { readonly type: "agent_equals"; readonly expected: string }
  | { readonly type: "status_equals"; readonly expected: "completed" | "awaiting-input" | "blocked" }
  | { readonly type: "routing_hint_equals"; readonly expected: "proceed" | "wait" | "retry" | "finish" | "stop" }
  | { readonly type: "scope_bounded"; readonly allowedPrefixes: readonly string[] }
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

export interface PromptEvaluationCase {
  readonly id: string;
  readonly description: string;
  readonly promptId: "code-implementer" | "implementation-evaluator" | "prd-researcher" | "spec-planner" | "spec-reviewer";
  readonly input: {
    readonly featureDocuments?: Record<string, string>;
    readonly context: string;
  };
  readonly assertions: readonly PromptAssertion[];
  readonly trials?: number;
}
```

### 3.2 Trial Observation and Spread Metrics

```typescript
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
  readonly spread: number; // Variance or standard deviation across trials
  readonly averageDurationMs: number;
  readonly averageConsumption: TokenConsumption;
}
```

### 3.3 Discrimination Classification and Comparison Report

```typescript
export type AssertionDiscrimination =
  | "discriminating_benefit"     // Passed with prompt, failed without prompt
  | "non_discriminating_pass"    // Passed both with and without prompt (measures baseline model capacity)
  | "non_discriminating_fail"    // Failed both with and without prompt
  | "regression";                // Failed with prompt, passed without prompt

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
  readonly promptId: string;
  readonly withPrompt: VariantMetrics;
  readonly withoutPrompt: VariantMetrics;
  readonly previousPrompt?: VariantMetrics;
  readonly assertions: readonly AssertionAnalysis[];
  readonly nonDiscriminatingCount: number;
  readonly modelGradedCount: number;
  readonly costMultiplier: number;
  readonly latencyMultiplier: number;
}
```

## 4. Assertion Evaluation Engine

### 4.1 Mechanical Assertion Evaluation

Mechanical assertions operate deterministically on the model's reply text by extracting the machine block using `extractAgentBlock` and checking schema & coherence contracts:

- `schema_valid`: Validates against `AgentOutputV1` schema via Ajv compiler.
- `coherence_valid`: Executes `checkAgentOutput` to confirm no internal contradictions.
- `scope_bounded`: Checks all `changedFiles` against permissible paths or bounds.
- `verdict_equals`: Compares payload verdicts (e.g. `accepted` vs `rejected`, `pass` vs `fail`).

For any given reply string, mechanical evaluations yield 100% reproducible results without network access.

### 4.2 Model-Graded Assertion Evaluation

Model-graded assertions are explicitly tagged with `kind: "model_graded"`. When evaluated, they invoke a dedicated grader prompt. The final summary report explicitly indicates what percentage of conclusions relied on model grading.

### 4.3 Dual-Run and Non-Discriminating Logic

1. **Both Sides Run**: Neither side is skipped if the other fails.
2. **Classification**:
   - An assertion that passes on both sides ($P_{\text{with}} = 1.0, P_{\text{without}} = 1.0$) is labeled `non_discriminating_pass`. It is reported as measuring baseline model capability rather than prompt effectiveness.
   - Such assertions are candidates for redesign or removal, not proof of prompt quality.

## 5. Execution, CLI & Verification Integration

### 5.1 Standalone Runner Entry Point

- Command: `npm run eval:prompts` via `scripts/evaluate-prompts.mjs`.
- Arguments:
  - `--case=<id>`: Run a specific evaluation case.
  - `--trials=<n>`: Number of repetitions per variant (default: 3).
  - `--replay`: Run recorded fixtures using deterministic replay provider without calling network APIs.
  - `--update-baseline`: Record current results to baseline fixture files.

### 5.2 Failure on Missing Credentials

When run without `--replay` and in the absence of required environment credentials (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`), the runner terminates immediately with exit code 1 and a clear error message:
`Error: Prompt evaluation requires model credentials in environment (or run with --replay for deterministic fixtures).`

### 5.3 Verification Exclusion

`npm run verify` does not invoke `npm run eval:prompts`. Instead, `npm test` runs deterministic unit and fixture tests in `tests/prompt-evaluations.test.ts` verifying all mechanical rules, discrimination classifications, spread calculations, and error conditions using mock/recorded observations.

## 6. Authorization Statement

Every generated evaluation report and related documentation carries the following normative statement:

> *This suite measures prompt behavior and discrimination on chosen test cases. A passing run demonstrates that the prompt outperforms the empty baseline on declared assertions; it does not constitute mathematical or universal proof of prompt correctness on arbitrary inputs.*
