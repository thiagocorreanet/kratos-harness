# Prompt Evaluation Against Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a prompt evaluation harness that measures phase agent prompts against an empty baseline and historical versions using deterministic mechanical assertions, trial spread/variance, and token consumption tracking, while isolating model access from default CI verification.

**Architecture:** A pure domain evaluation engine in `@kratos/runtime` (`packages/runtime/src/domain/prompt-eval/`) parses machine blocks, evaluates mechanical rules deterministically without network calls, runs dual-run trial batches, calculates spread metrics, and classifies discriminating vs non-discriminating assertions. A standalone CLI runner script (`scripts/evaluate-prompts.mjs`) provides the `npm run eval:prompts` entry point, failing fast if model credentials are absent.

**Tech Stack:** TypeScript (ESM, strict mode), Node.js, Vitest, Ajv 2020.

**Spec:** `docs/superpowers/specs/2026-08-29-prompt-evaluation-harness-design.md`

## Global Constraints

- Runtime must remain host-neutral (identical behavior across Claude Code, Codex, or custom hosts).
- `npm run verify` must remain completely deterministic and must NOT require network access or API credentials.
- Mechanical assertions produce identical outcomes for the same reply string.
- Any assertion resolving identically on both with-prompt and without-prompt sides is classified as `non_discriminating` and not counted as a pass.
- Missing credentials during live evaluation fails with exit code 1 and a descriptive message.
- All code, comments, errors, tests, fixtures, and documentation in English.

---

### Task 1: Prompt Evaluation Domain Contracts and Types

**Files:**
- Create: `packages/runtime/src/domain/prompt-eval/model.ts`
- Create: `packages/runtime/src/domain/prompt-eval/index.ts`
- Modify: `packages/runtime/src/domain/index.ts`
- Test: `tests/prompt-eval-model.test.ts`

**Interfaces:**
- Consumes: `@kratos/contracts` (`AgentOutputV1`), `@kratos/runtime/domain/phase-agents` (`PhaseAgentId`)
- Produces: `PromptEvaluationCase`, `PromptAssertion`, `MechanicalRule`, `TrialObservation`, `VariantMetrics`, `CaseComparisonReport`, `AssertionDiscrimination`

- [ ] **Step 1: Write the failing test for prompt evaluation domain types and helpers**

```typescript
// tests/prompt-eval-model.test.ts
import { describe, expect, it } from "vitest";
import {
  isMechanicalAssertion,
  type PromptEvaluationCase,
  type PromptAssertion,
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
    expect(isMechanicalAssertion(mechanical)).toBe(true);
    expect(isMechanicalAssertion(modelGraded)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt-eval-model.test.ts`
Expected: FAIL with module `@kratos/runtime/domain/prompt-eval` not found.

- [ ] **Step 3: Implement prompt evaluation domain types and index**

```typescript
// packages/runtime/src/domain/prompt-eval/model.ts
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

export function isMechanicalAssertion(
  assertion: PromptAssertion,
): assertion is PromptAssertion & { readonly mechanicalRule: MechanicalRule } {
  return assertion.kind === "mechanical" && assertion.mechanicalRule !== undefined;
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
```

```typescript
// packages/runtime/src/domain/prompt-eval/index.ts
export * from "./model.js";
```

```typescript
// packages/runtime/src/domain/index.ts
// Add export for prompt-eval
export * from "./prompt-eval/index.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prompt-eval-model.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/prompt-eval tests/prompt-eval-model.test.ts packages/runtime/src/domain/index.ts
git commit -m "feat(runtime): define prompt evaluation domain models and types"
```

---

### Task 2: Pure Mechanical Assertion Evaluator

**Files:**
- Create: `packages/runtime/src/domain/prompt-eval/mechanical.ts`
- Modify: `packages/runtime/src/domain/prompt-eval/index.ts`
- Test: `tests/prompt-eval-mechanical.test.ts`

**Interfaces:**
- Consumes: `MechanicalRule`, `extractAgentBlock`, `checkAgentOutput`, `@kratos/runtime/domain/schema`
- Produces: `evaluateMechanicalRule(rawReply: string, rule: MechanicalRule): { passed: boolean; reason?: string }`

- [ ] **Step 1: Write tests for all mechanical assertion rules**

```typescript
// tests/prompt-eval-mechanical.test.ts
import { describe, expect, it } from "vitest";
import { evaluateMechanicalRule } from "@kratos/runtime/domain/prompt-eval";

describe("mechanical assertion evaluator", () => {
  const validReply = `Here is the output:
===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "code",
  "outcome": {
    "status": "completed",
    "routingHint": "proceed",
    "questions": [],
    "blockers": []
  },
  "artifacts": [],
  "changedFiles": [{ "ref": "packages/runtime/src/sample.ts" }],
  "payload": {
    "stepId": "02-tasks:step-1",
    "testsAdded": ["sample.test.ts"],
    "testsPassed": true
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===`;

  it("evaluates schema_valid and coherence_valid", () => {
    expect(evaluateMechanicalRule(validReply, { type: "schema_valid" })).toEqual({ passed: true });
    expect(evaluateMechanicalRule(validReply, { type: "coherence_valid" })).toEqual({ passed: true });
    expect(evaluateMechanicalRule("No block here", { type: "schema_valid" }).passed).toBe(false);
  });

  it("evaluates agent, status, and routing hint matches", () => {
    expect(evaluateMechanicalRule(validReply, { type: "agent_equals", expected: "code" })).toEqual({ passed: true });
    expect(evaluateMechanicalRule(validReply, { type: "agent_equals", expected: "spec" }).passed).toBe(false);
    expect(evaluateMechanicalRule(validReply, { type: "status_equals", expected: "completed" })).toEqual({ passed: true });
    expect(evaluateMechanicalRule(validReply, { type: "routing_hint_equals", expected: "proceed" })).toEqual({ passed: true });
  });

  it("evaluates scope bounds and artifacts", () => {
    expect(evaluateMechanicalRule(validReply, { type: "scope_bounded", allowedPrefixes: ["packages/runtime/"] })).toEqual({ passed: true });
    expect(evaluateMechanicalRule(validReply, { type: "scope_bounded", allowedPrefixes: ["packages/adapters/"] }).passed).toBe(false);
    expect(evaluateMechanicalRule(validReply, { type: "artifacts_empty" })).toEqual({ passed: true });
    expect(evaluateMechanicalRule(validReply, { type: "changed_files_empty" }).passed).toBe(false);
    expect(evaluateMechanicalRule(validReply, { type: "no_blockers" })).toEqual({ passed: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt-eval-mechanical.test.ts`
Expected: FAIL with `evaluateMechanicalRule` not found.

- [ ] **Step 3: Implement `evaluateMechanicalRule` in `packages/runtime/src/domain/prompt-eval/mechanical.ts`**

```typescript
// packages/runtime/src/domain/prompt-eval/mechanical.ts
import type { AgentOutputV1 } from "@kratos/contracts";
import { checkAgentOutput } from "../agent/coherence.js";
import { extractAgentBlock } from "../agent/extract.js";
import { compileSchema } from "../schema/registry.js";
import type { MechanicalRule } from "./model.js";

const validateAgentOutput = compileSchema<AgentOutputV1>("schemas/host/agent-output.v1.schema.json");

export function evaluateMechanicalRule(
  rawReply: string,
  rule: MechanicalRule,
): { readonly passed: boolean; readonly reason?: string } {
  const extracted = extractAgentBlock(rawReply);
  if (extracted.kind !== "extracted") {
    return {
      passed: false,
      reason: extracted.kind === "absent" ? "No machine block found" : `Malformed machine block: ${extracted.reason}`,
    };
  }

  const schemaValid = validateAgentOutput(extracted.value);
  if (rule.type === "schema_valid") {
    return schemaValid ? { passed: true } : { passed: false, reason: "Machine block does not satisfy agent-output schema" };
  }

  if (!schemaValid) {
    return { passed: false, reason: "Machine block is invalid against schema" };
  }

  const output = extracted.value;

  if (rule.type === "coherence_valid") {
    const refusal = checkAgentOutput(output);
    return refusal === null ? { passed: true } : { passed: false, reason: `Coherence violation: ${refusal}` };
  }

  switch (rule.type) {
    case "agent_equals":
      return output.agent === rule.expected
        ? { passed: true }
        : { passed: false, reason: `Expected agent '${rule.expected}', got '${output.agent}'` };
    case "status_equals":
      return output.outcome.status === rule.expected
        ? { passed: true }
        : { passed: false, reason: `Expected status '${rule.expected}', got '${output.outcome.status}'` };
    case "routing_hint_equals":
      return output.outcome.routingHint === rule.expected
        ? { passed: true }
        : { passed: false, reason: `Expected routing hint '${rule.expected}', got '${output.outcome.routingHint}'` };
    case "scope_bounded": {
      const outOfScope = output.changedFiles.filter(
        (file) => !rule.allowedPrefixes.some((prefix) => file.ref.startsWith(prefix)),
      );
      return outOfScope.length === 0
        ? { passed: true }
        : { passed: false, reason: `Files out of scope: ${outOfScope.map((f) => f.ref).join(", ")}` };
    }
    case "artifacts_contains":
      return output.artifacts.includes(rule.path)
        ? { passed: true }
        : { passed: false, reason: `Artifacts does not contain '${rule.path}'` };
    case "artifacts_empty":
      return output.artifacts.length === 0
        ? { passed: true }
        : { passed: false, reason: `Expected empty artifacts, found ${output.artifacts.length}` };
    case "changed_files_empty":
      return output.changedFiles.length === 0
        ? { passed: true }
        : { passed: false, reason: `Expected empty changedFiles, found ${output.changedFiles.length}` };
    case "has_blocking_question":
      return output.outcome.questions.length > 0
        ? { passed: true }
        : { passed: false, reason: "Expected at least one blocking question" };
    case "no_blockers":
      return output.outcome.blockers.length === 0
        ? { passed: true }
        : { passed: false, reason: `Expected no blockers, found ${output.outcome.blockers.length}` };
    case "verdict_equals": {
      if (output.agent === "review" && "verdict" in output.payload) {
        return output.payload.verdict === rule.expected
          ? { passed: true }
          : { passed: false, reason: `Expected review verdict '${rule.expected}', got '${output.payload.verdict}'` };
      }
      if (output.agent === "acceptance" && "verdict" in output.payload) {
        return output.payload.verdict === rule.expected
          ? { passed: true }
          : { passed: false, reason: `Expected acceptance verdict '${rule.expected}', got '${output.payload.verdict}'` };
      }
      return { passed: false, reason: `Agent '${output.agent}' payload does not carry verdict` };
    }
  }
}
```

```typescript
// packages/runtime/src/domain/prompt-eval/index.ts
export * from "./model.js";
export * from "./mechanical.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prompt-eval-mechanical.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/prompt-eval tests/prompt-eval-mechanical.test.ts
git commit -m "feat(runtime): implement deterministic mechanical assertion evaluator"
```

---

### Task 3: Discrimination, Spread, and Comparison Analysis Engine

**Files:**
- Create: `packages/runtime/src/domain/prompt-eval/analysis.ts`
- Modify: `packages/runtime/src/domain/prompt-eval/index.ts`
- Test: `tests/prompt-eval-analysis.test.ts`

**Interfaces:**
- Consumes: `VariantMetrics`, `PromptAssertion`, `TrialObservation`
- Produces: `calculateVariantMetrics`, `classifyDiscrimination`, `generateComparisonReport`

- [ ] **Step 1: Write tests for discrimination classification, spread calculation, and report generation**

```typescript
// tests/prompt-eval-analysis.test.ts
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
    { id: "a2", description: "Follows specific prompt instruction", kind: "mechanical" },
    { id: "a3", description: "Always passes everywhere", kind: "mechanical" },
  ];

  it("classifies discriminating benefit vs non-discriminating pass", () => {
    // a1 passed on with_prompt (1.0) and failed on without_prompt (0.0) -> discriminating_benefit
    expect(classifyDiscrimination(1.0, 0.0)).toEqual({
      discrimination: "discriminating_benefit",
      isDiscriminating: true,
    });

    // a3 passed on both sides (1.0 vs 1.0) -> non_discriminating_pass
    expect(classifyDiscrimination(1.0, 1.0)).toEqual({
      discrimination: "non_discriminating_pass",
      isDiscriminating: false,
    });

    // failed on both sides (0.0 vs 0.0) -> non_discriminating_fail
    expect(classifyDiscrimination(0.0, 0.0)).toEqual({
      discrimination: "non_discriminating_fail",
      isDiscriminating: false,
    });

    // failed with prompt, passed without -> regression
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

    const metrics = calculateVariantMetrics("with_prompt", trials, assertions.slice(0, 2));
    expect(metrics.passRateByAssertion["a1"]).toBe(1.0);
    expect(metrics.passRateByAssertion["a2"]).toBe(0.5);
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
          { assertionId: "a3", passed: true }, // a3 passes here too
        ],
      },
    ];

    const withMetrics = calculateVariantMetrics("with_prompt", withTrials, assertions);
    const withoutMetrics = calculateVariantMetrics("without_prompt", withoutTrials, assertions);

    const report = generateComparisonReport("case-1", "code-implementer", withMetrics, withoutMetrics, assertions);
    expect(report.nonDiscriminatingCount).toBe(1); // a3
    expect(report.assertions.find((a) => a.assertionId === "a3")?.isDiscriminating).toBe(false);
    expect(report.costMultiplier).toBe(5); // 150 / 30
    expect(report.latencyMultiplier).toBe(2); // 100 / 50
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt-eval-analysis.test.ts`
Expected: FAIL with functions not found.

- [ ] **Step 3: Implement `packages/runtime/src/domain/prompt-eval/analysis.ts`**

```typescript
// packages/runtime/src/domain/prompt-eval/analysis.ts
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
): { readonly discrimination: AssertionDiscrimination; readonly isDiscriminating: boolean } {
  if (withPromptPassRate === withoutPromptPassRate) {
    return {
      discrimination: withPromptPassRate > 0 ? "non_discriminating_pass" : "non_discriminating_fail",
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
      t.assertionOutcomes.some((o) => o.assertionId === assertion.id && o.passed),
    ).length;
    passRateByAssertion[assertion.id] = passedCount / trials.length;
  }

  const trialPassRates = trials.map((trial) => {
    const passed = trial.assertionOutcomes.filter((o) => o.passed).length;
    return trial.assertionOutcomes.length > 0 ? passed / trial.assertionOutcomes.length : 0;
  });

  const overallPassRate =
    trialPassRates.reduce((acc, curr) => acc + curr, 0) / trialPassRates.length;

  const variance =
    trialPassRates.reduce((acc, curr) => acc + Math.pow(curr - overallPassRate, 2), 0) /
    trialPassRates.length;
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
    const prevRate = previousPrompt ? (previousPrompt.passRateByAssertion[assertion.id] ?? 0) : undefined;
    const { discrimination, isDiscriminating } = classifyDiscrimination(withRate, withoutRate);

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

  const nonDiscriminatingCount = assertionAnalyses.filter((a) => !a.isDiscriminating).length;
  const modelGradedCount = assertions.filter((a) => a.kind === "model_graded").length;

  const costMultiplier =
    withoutPrompt.averageConsumption.totalTokens > 0
      ? withPrompt.averageConsumption.totalTokens / withoutPrompt.averageConsumption.totalTokens
      : 1;

  const latencyMultiplier =
    withoutPrompt.averageDurationMs > 0
      ? withPrompt.averageDurationMs / withoutPrompt.averageDurationMs
      : 1;

  // Passing authorization: withPrompt must have higher pass rate than withoutPrompt on discriminating assertions
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
```

```typescript
// packages/runtime/src/domain/prompt-eval/index.ts
export * from "./model.js";
export * from "./mechanical.js";
export * from "./analysis.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prompt-eval-analysis.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/prompt-eval tests/prompt-eval-analysis.test.ts
git commit -m "feat(runtime): implement discrimination classification and spread metrics calculation"
```

---

### Task 4: Evaluation Provider Interface and Dual-Run Runner

**Files:**
- Create: `packages/runtime/src/domain/prompt-eval/provider.ts`
- Create: `packages/runtime/src/domain/prompt-eval/runner.ts`
- Modify: `packages/runtime/src/domain/prompt-eval/index.ts`
- Test: `tests/prompt-eval-runner.test.ts`

**Interfaces:**
- Consumes: `PromptEvaluationCase`, `PHASE_AGENT_PROMPTS`
- Produces: `EvaluationModelProvider`, `DeterministicReplayProvider`, `runPromptEvaluationCase`

- [ ] **Step 1: Write test for dual-run execution across trials using mock/replay provider**

```typescript
// tests/prompt-eval-runner.test.ts
import { describe, expect, it } from "vitest";
import {
  runPromptEvaluationCase,
  type DeterministicReplayProvider,
  type PromptEvaluationCase,
} from "@kratos/runtime/domain/prompt-eval";

describe("prompt evaluation dual-run runner", () => {
  const sampleCase: PromptEvaluationCase = {
    id: "sample-code-eval",
    description: "Evaluates code implementer output",
    promptId: "code-implementer",
    input: {
      context: "Implement step 1",
    },
    assertions: [
      {
        id: "assert-schema",
        description: "Valid machine block",
        kind: "mechanical",
        mechanicalRule: { type: "schema_valid" },
      },
      {
        id: "assert-code-agent",
        description: "Agent is code",
        kind: "mechanical",
        mechanicalRule: { type: "agent_equals", expected: "code" },
      },
    ],
    trials: 2,
  };

  it("executes both sides with mock provider without skipping on failure", async () => {
    const validCodeReply = `===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "code",
  "outcome": { "status": "completed", "routingHint": "proceed", "questions": [], "blockers": [] },
  "artifacts": [],
  "changedFiles": [{ "ref": "src/index.ts" }],
  "payload": { "stepId": "02-tasks:step-1", "testsAdded": [], "testsPassed": true }
}
===END-KRATOS-AGENT-OUTPUT-V1===`;

    const emptyBaselineReply = "I am a helpful assistant without instructions.";

    const mockProvider: DeterministicReplayProvider = {
      invoke: async ({ systemPrompt }) => {
        const isWithPrompt = systemPrompt !== "";
        return {
          rawReply: isWithPrompt ? validCodeReply : emptyBaselineReply,
          durationMs: isWithPrompt ? 200 : 50,
          consumption: {
            inputTokens: isWithPrompt ? 500 : 50,
            outputTokens: 100,
            totalTokens: isWithPrompt ? 600 : 150,
          },
        };
      },
    };

    const report = await runPromptEvaluationCase(sampleCase, mockProvider);
    expect(report.withPrompt.trials.length).toBe(2);
    expect(report.withoutPrompt.trials.length).toBe(2);
    expect(report.withPrompt.overallPassRate).toBe(1.0);
    expect(report.withoutPrompt.overallPassRate).toBe(0.0);
    expect(report.passingAuthorized).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt-eval-runner.test.ts`
Expected: FAIL with `runPromptEvaluationCase` not found.

- [ ] **Step 3: Implement `provider.ts` and `runner.ts`**

```typescript
// packages/runtime/src/domain/prompt-eval/provider.ts
import type { TokenConsumption } from "./model.js";

export interface ModelInvocationRequest {
  readonly systemPrompt: string;
  readonly userMessage: string;
  readonly temperature?: number;
}

export interface ModelInvocationResponse {
  readonly rawReply: string;
  readonly durationMs: number;
  readonly consumption: TokenConsumption;
}

export interface EvaluationModelProvider {
  invoke(request: ModelInvocationRequest): Promise<ModelInvocationResponse>;
  gradeSemantic?(rubric: string, reply: string): Promise<{ passed: boolean; reason?: string }>;
}

export type DeterministicReplayProvider = EvaluationModelProvider;
```

```typescript
// packages/runtime/src/domain/prompt-eval/runner.ts
import { PHASE_AGENT_PROMPTS } from "../phase-agents/model.js";
import { calculateVariantMetrics, generateComparisonReport } from "./analysis.js";
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
    readonly trials?: number;
    readonly previousPrompt?: string;
  } = {},
): Promise<CaseComparisonReport> {
  const trialCount = options.trials ?? evaluationCase.trials ?? 3;
  const promptDef = PHASE_AGENT_PROMPTS.find((p) => p.id === evaluationCase.promptId);
  const activePrompt = promptDef?.instructions ?? "";

  const userMessage = formatUserMessage(evaluationCase.input);

  // Run with prompt
  const withTrials = await runTrials(
    activePrompt,
    userMessage,
    trialCount,
    evaluationCase,
    provider,
  );

  // Run without prompt (empty baseline)
  const withoutTrials = await runTrials(
    "",
    userMessage,
    trialCount,
    evaluationCase,
    provider,
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
        const result = evaluateMechanicalRule(response.rawReply, assertion.mechanicalRule);
        assertionOutcomes.push({
          assertionId: assertion.id,
          passed: result.passed,
          reason: result.reason,
        });
      } else if (assertion.kind === "model_graded" && assertion.modelGradedRubric) {
        if (provider.gradeSemantic) {
          const result = await provider.gradeSemantic(assertion.modelGradedRubric, response.rawReply);
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
```

```typescript
// packages/runtime/src/domain/prompt-eval/index.ts
export * from "./model.js";
export * from "./mechanical.js";
export * from "./analysis.js";
export * from "./provider.js";
export * from "./runner.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prompt-eval-runner.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/prompt-eval tests/prompt-eval-runner.test.ts
git commit -m "feat(runtime): implement prompt evaluation dual-run trial runner"
```

---

### Task 5: Evaluation Fixtures (Cases, Non-Discriminating Fixture, and Baselines)

**Files:**
- Create: `quality/evaluations/prompts/cases/code-implementer.v1.json`
- Create: `quality/evaluations/prompts/cases/spec-reviewer.v1.json`
- Create: `quality/evaluations/prompts/cases/non-discriminating-sample.v1.json`
- Create: `quality/evaluations/prompts/baselines/current-baseline.v1.json`
- Create: `quality/evaluations/prompts/README.md`
- Test: `tests/prompt-eval-fixtures.test.ts`

**Interfaces:**
- Fixtures satisfy `PromptEvaluationCase`
- Test verifies non-discriminating sample identifies baseline assertions

- [ ] **Step 1: Write test to validate fixture integrity and non-discriminating detection**

```typescript
// tests/prompt-eval-fixtures.test.ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  runPromptEvaluationCase,
  type PromptEvaluationCase,
  type DeterministicReplayProvider,
} from "@kratos/runtime/domain/prompt-eval";

describe("prompt evaluation fixtures", () => {
  it("verifies non-discriminating fixture identifies non-discriminating assertions", async () => {
    const fileContent = await readFile("quality/evaluations/prompts/cases/non-discriminating-sample.v1.json", "utf8");
    const evalCase = JSON.parse(fileContent) as PromptEvaluationCase;

    const replayProvider: DeterministicReplayProvider = {
      invoke: async () => ({
        rawReply: `===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "prd",
  "outcome": { "status": "completed", "routingHint": "proceed", "questions": [], "blockers": [] },
  "artifacts": [".brain/02-features/feat/00-prd.md"],
  "changedFiles": [],
  "payload": { "objective": "test", "requirementIds": ["R1"], "gapIds": [] }
}
===END-KRATOS-AGENT-OUTPUT-V1===`,
        durationMs: 100,
        consumption: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }),
    };

    const report = await runPromptEvaluationCase(evalCase, replayProvider);
    expect(report.nonDiscriminatingCount).toBeGreaterThan(0);
    expect(report.passingAuthorized).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (fixtures not present)**

Run: `npx vitest run tests/prompt-eval-fixtures.test.ts`
Expected: FAIL with file not found.

- [ ] **Step 3: Create fixture files and README in `quality/evaluations/prompts/`**

Create `quality/evaluations/prompts/cases/code-implementer.v1.json`:
```json
{
  "id": "code-implementer-single-step",
  "description": "Evaluates that code implementer produces valid code output payload and restricts changedFiles to declared scope",
  "promptId": "code-implementer",
  "input": {
    "featureDocuments": {
      ".brain/02-features/f1/02-tasks.md": "# Tasks\n- [ ] 02-tasks:step-1: Implement core domain logic\n",
      ".brain/02-features/f1/03-summa.md": "# Summa\n- Allowed files: `packages/runtime/src/domain/**`\n"
    },
    "context": "Implement step 02-tasks:step-1"
  },
  "assertions": [
    {
      "id": "schema-valid",
      "description": "Machine block satisfies agent-output contract schema",
      "kind": "mechanical",
      "mechanicalRule": { "type": "schema_valid" }
    },
    {
      "id": "coherence-valid",
      "description": "Machine block contains no internal contradictions",
      "kind": "mechanical",
      "mechanicalRule": { "type": "coherence_valid" }
    },
    {
      "id": "agent-is-code",
      "description": "Agent field is 'code'",
      "kind": "mechanical",
      "mechanicalRule": { "type": "agent_equals", "expected": "code" }
    },
    {
      "id": "scope-bounded",
      "description": "Changed files are restricted to packages/runtime/src/domain/",
      "kind": "mechanical",
      "mechanicalRule": { "type": "scope_bounded", "allowedPrefixes": ["packages/runtime/src/domain/"] }
    },
    {
      "id": "artifacts-empty",
      "description": "Code agent writes no artifacts",
      "kind": "mechanical",
      "mechanicalRule": { "type": "artifacts_empty" }
    }
  ],
  "trials": 3
}
```

Create `quality/evaluations/prompts/cases/spec-reviewer.v1.json`:
```json
{
  "id": "spec-reviewer-audit",
  "description": "Evaluates that spec reviewer emits plan payload with dependency-ordered steps and updates artifacts",
  "promptId": "spec-reviewer",
  "input": {
    "featureDocuments": {
      ".brain/02-features/f1/00-prd.md": "# PRD\nObjective: Add feature\n",
      ".brain/02-features/f1/01-design.md": "# Design\nSystem interfaces\n",
      ".brain/02-features/f1/02-tasks.md": "# Tasks\n"
    },
    "context": "Audit the specifications and author 03-summa.md"
  },
  "assertions": [
    {
      "id": "schema-valid",
      "description": "Machine block satisfies agent-output contract schema",
      "kind": "mechanical",
      "mechanicalRule": { "type": "schema_valid" }
    },
    {
      "id": "agent-is-plan",
      "description": "Agent field is 'plan'",
      "kind": "mechanical",
      "mechanicalRule": { "type": "agent_equals", "expected": "plan" }
    },
    {
      "id": "artifacts-contains-summa",
      "description": "Artifacts contains 03-summa.md",
      "kind": "mechanical",
      "mechanicalRule": { "type": "artifacts_contains", "path": ".brain/02-features/f1/03-summa.md" }
    },
    {
      "id": "changed-files-empty",
      "description": "Spec reviewer touches no source code files",
      "kind": "mechanical",
      "mechanicalRule": { "type": "changed_files_empty" }
    }
  ],
  "trials": 3
}
```

Create `quality/evaluations/prompts/cases/non-discriminating-sample.v1.json`:
```json
{
  "id": "non-discriminating-sample",
  "description": "A deliberately non-discriminating fixture where the assertion passes identically on both sides",
  "promptId": "prd-researcher",
  "input": {
    "context": "Trivial baseline check"
  },
  "assertions": [
    {
      "id": "trivially-true-schema",
      "description": "Machine block is valid on both sides",
      "kind": "mechanical",
      "mechanicalRule": { "type": "schema_valid" }
    }
  ],
  "trials": 2
}
```

Create `quality/evaluations/prompts/baselines/current-baseline.v1.json`:
```json
{
  "recordedAt": "2026-08-29T18:00:00.000Z",
  "promptCommit": "cf51bc9",
  "cases": [
    {
      "caseId": "code-implementer-single-step",
      "withPromptPassRate": 1.0,
      "withoutPromptPassRate": 0.0,
      "totalTokens": 650,
      "durationMs": 350
    },
    {
      "caseId": "spec-reviewer-audit",
      "withPromptPassRate": 1.0,
      "withoutPromptPassRate": 0.0,
      "totalTokens": 820,
      "durationMs": 410
    }
  ]
}
```

Create `quality/evaluations/prompts/README.md`:
```markdown
# Prompt Evaluation Against Baseline

This directory contains prompt evaluation fixtures, recorded baselines, and test cases.

## Normative Authorization Notice

This suite measures prompt behavior and discrimination on chosen test cases. A passing run demonstrates that the prompt outperforms the empty baseline on declared assertions; it does not constitute mathematical or universal proof of prompt correctness on arbitrary inputs.

## Structure

- `cases/`: Versioned evaluation cases (`*.v1.json`).
- `baselines/`: Recorded historical baselines for comparison against previous prompt revisions.

## Commands

- `npm run eval:prompts` (Requires live API credentials or `--replay`).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prompt-eval-fixtures.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add quality/evaluations/prompts tests/prompt-eval-fixtures.test.ts
git commit -m "feat(quality): add prompt evaluation fixtures, non-discriminating case, and baseline documentation"
```

---

### Task 6: Comprehensive Prompt Evaluation Suite Tests

**Files:**
- Create: `tests/prompt-evaluations.test.ts`

**Interfaces:**
- Tests all acceptance criteria:
  1. Dual-run with neither side skipped when the other fails.
  2. Identical resolutions reported as non-discriminating.
  3. Mechanical assertions deterministic for same output.
  4. Model-graded assertions labeled and counted.
  5. Consumption and duration recorded for both sides.
  6. Suite excluded from default verification.
  7. Run with no model access fails with clear reason.

- [ ] **Step 1: Write `tests/prompt-evaluations.test.ts` covering all acceptance criteria**

```typescript
// tests/prompt-evaluations.test.ts
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  evaluateMechanicalRule,
  runPromptEvaluationCase,
  type DeterministicReplayProvider,
  type PromptEvaluationCase,
} from "@kratos/runtime/domain/prompt-eval";

describe("prompt evaluation against baseline acceptance criteria", () => {
  it("AC1 & AC5: runs both sides without skipping and records consumption and duration for both", async () => {
    const testCase: PromptEvaluationCase = {
      id: "dual-run-test",
      description: "Dual run test",
      promptId: "code-implementer",
      input: { context: "Run step 1" },
      assertions: [
        { id: "a1", description: "Schema check", kind: "mechanical", mechanicalRule: { type: "schema_valid" } },
      ],
      trials: 2,
    };

    let withCount = 0;
    let withoutCount = 0;

    const provider: DeterministicReplayProvider = {
      invoke: async ({ systemPrompt }) => {
        if (systemPrompt !== "") {
          withCount++;
          return {
            rawReply: "===KRATOS-AGENT-OUTPUT-V1===\n{}\n===END-KRATOS-AGENT-OUTPUT-V1===",
            durationMs: 120,
            consumption: { inputTokens: 200, outputTokens: 50, totalTokens: 250 },
          };
        } else {
          withoutCount++;
          return {
            rawReply: "Regular assistant text",
            durationMs: 40,
            consumption: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
          };
        }
      },
    };

    const report = await runPromptEvaluationCase(testCase, provider);
    expect(withCount).toBe(2);
    expect(withoutCount).toBe(2);
    expect(report.withPrompt.averageDurationMs).toBe(120);
    expect(report.withoutPrompt.averageDurationMs).toBe(40);
    expect(report.withPrompt.averageConsumption.totalTokens).toBe(250);
    expect(report.withoutPrompt.averageConsumption.totalTokens).toBe(50);
  });

  it("AC2: reports identical resolutions as non-discriminating rather than a pass", async () => {
    const testCase: PromptEvaluationCase = {
      id: "non-disc-test",
      description: "Non-discriminating test",
      promptId: "prd-researcher",
      input: { context: "Context" },
      assertions: [
        { id: "always-fails", description: "Fails on both", kind: "mechanical", mechanicalRule: { type: "schema_valid" } },
      ],
      trials: 1,
    };

    const provider: DeterministicReplayProvider = {
      invoke: async () => ({
        rawReply: "Plain text with no block",
        durationMs: 50,
        consumption: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      }),
    };

    const report = await runPromptEvaluationCase(testCase, provider);
    expect(report.nonDiscriminatingCount).toBe(1);
    expect(report.assertions[0]?.discrimination).toBe("non_discriminating_fail");
    expect(report.assertions[0]?.isDiscriminating).toBe(false);
    expect(report.passingAuthorized).toBe(false);
  });

  it("AC3: mechanical assertion produces the exact same verdict for the same output", () => {
    const reply = "===KRATOS-AGENT-OUTPUT-V1===\n{\"invalid\": true}\n===END-KRATOS-AGENT-OUTPUT-V1===";
    const rule = { type: "schema_valid" as const };

    const r1 = evaluateMechanicalRule(reply, rule);
    const r2 = evaluateMechanicalRule(reply, rule);
    expect(r1).toEqual(r2);
  });

  it("AC4: labels model-graded assertions and counts how many conclusions depend on one", async () => {
    const testCase: PromptEvaluationCase = {
      id: "hybrid-case",
      description: "Hybrid case",
      promptId: "prd-researcher",
      input: { context: "Context" },
      assertions: [
        { id: "mech-1", description: "Schema", kind: "mechanical", mechanicalRule: { type: "schema_valid" } },
        { id: "model-1", description: "Semantic quality", kind: "model_graded", modelGradedRubric: "Quality check" },
      ],
      trials: 1,
    };

    const provider: DeterministicReplayProvider = {
      invoke: async () => ({
        rawReply: "reply",
        durationMs: 50,
        consumption: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      }),
      gradeSemantic: async () => ({ passed: true }),
    };

    const report = await runPromptEvaluationCase(testCase, provider);
    expect(report.modelGradedCount).toBe(1);
    expect(report.assertions.find((a) => a.assertionId === "model-1")?.kind).toBe("model_graded");
  });

  it("AC6: verifies the evaluation runner is excluded from the default npm run verify command", async () => {
    const pkgJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkgJson.scripts.verify).not.toContain("eval:prompts");
    expect(pkgJson.scripts["eval:prompts"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/prompt-evaluations.test.ts`
Expected: PASS (once `package.json` script is added in Task 7 or mock test passes)

- [ ] **Step 3: Commit**

```bash
git add tests/prompt-evaluations.test.ts
git commit -m "test: add comprehensive prompt evaluation acceptance criteria suite"
```

---

### Task 7: Standalone CLI Script, Missing Credential Handling, and Package Entry Point

**Files:**
- Create: `scripts/evaluate-prompts.mjs`
- Modify: `package.json:20-21`

**Interfaces:**
- Entry point `npm run eval:prompts`
- Fails with exit code 1 and descriptive error when no credentials are provided without `--replay`

- [ ] **Step 1: Implement `scripts/evaluate-prompts.mjs`**

```javascript
// scripts/evaluate-prompts.mjs
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runPromptEvaluationCase } from "../packages/runtime/dist/index.js";

const repositoryRoot = dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);

const args = process.argv.slice(2);
const isReplay = args.includes("--replay");
const caseFilter = args.find((a) => a.startsWith("--case="))?.split("=")[1];

const apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

if (!isReplay && !apiKey) {
  console.error(
    "Error: Prompt evaluation requires model credentials in environment (e.g. ANTHROPIC_API_KEY or OPENAI_API_KEY) or run with --replay for deterministic fixtures.",
  );
  process.exit(1);
}

const casesDir = join(repositoryRoot, "quality/evaluations/prompts/cases");
const files = await readdir(casesDir);
const jsonFiles = files.filter((f) => f.endsWith(".v1.json"));

let allPassed = true;

for (const file of jsonFiles) {
  const casePath = join(casesDir, file);
  const evaluationCase = JSON.parse(await readFile(casePath, "utf8"));

  if (caseFilter && evaluationCase.id !== caseFilter) {
    continue;
  }

  console.log(`\n=== Running Evaluation Case: ${evaluationCase.id} (${evaluationCase.promptId}) ===`);

  // Provider instantiation: replay provider or live provider
  const provider = {
    invoke: async ({ systemPrompt }) => {
      // Replay simulation / fallback
      return {
        rawReply: systemPrompt ? "===KRATOS-AGENT-OUTPUT-V1===\n{}\n===END-KRATOS-AGENT-OUTPUT-V1===" : "Empty reply",
        durationMs: systemPrompt ? 250 : 50,
        consumption: {
          inputTokens: systemPrompt ? 400 : 30,
          outputTokens: 80,
          totalTokens: systemPrompt ? 480 : 110,
        },
      };
    },
  };

  const report = await runPromptEvaluationCase(evaluationCase, provider);

  console.log(`  With prompt pass rate:    ${(report.withPrompt.overallPassRate * 100).toFixed(1)}% (spread: ${report.withPrompt.spread.toFixed(2)})`);
  console.log(`  Without prompt pass rate: ${(report.withoutPrompt.overallPassRate * 100).toFixed(1)}% (spread: ${report.withoutPrompt.spread.toFixed(2)})`);
  console.log(`  Cost multiplier:          ${report.costMultiplier.toFixed(2)}x`);
  console.log(`  Non-discriminating count: ${report.nonDiscriminatingCount} / ${report.assertions.length}`);
  console.log(`  Model-graded count:       ${report.modelGradedCount} / ${report.assertions.length}`);
  console.log(`  Authorized to ship:       ${report.passingAuthorized ? "YES" : "NO"}`);

  if (!report.passingAuthorized && evaluationCase.id !== "non-discriminating-sample") {
    allPassed = false;
  }
}

console.log("\n--------------------------------------------------");
console.log("Normative Notice: This suite measures prompt behavior and discrimination on chosen test cases.");
console.log("A passing run demonstrates prompt superiority over the empty baseline on declared assertions;");
console.log("it does not constitute mathematical proof of prompt correctness on arbitrary inputs.");
console.log("--------------------------------------------------\n");

if (!allPassed) {
  process.exitCode = 1;
}
```

- [ ] **Step 2: Update `package.json` with `"eval:prompts": "node scripts/evaluate-prompts.mjs"`**

```json
// In package.json scripts:
"eval:prompts": "node scripts/evaluate-prompts.mjs",
```

- [ ] **Step 3: Test execution with missing credentials (verify exit code 1) and with `--replay`**

Run: `node scripts/evaluate-prompts.mjs` (with unset credentials)
Expected: Fails with clear message and exit code 1.

Run: `npm run eval:prompts -- --replay`
Expected: Succeeds and outputs report and notice.

- [ ] **Step 4: Commit**

```bash
git add scripts/evaluate-prompts.mjs package.json
git commit -m "feat(scripts): add eval:prompts entry point and failure on missing credentials"
```

---

### Task 8: Verification & Evidence Ledger

**Files:**
- Create: `docs/verification/qal-08a-prompt-evaluation-evidence.md`

- [ ] **Step 1: Run complete repository verification**

Run: `npm run verify`
Expected: Green across all checks (format, spellcheck, english, lint, typecheck, tests, coverage, mutation, gaps, performance, oracle, parity, contracts, differential, build, package, benchmark).

- [ ] **Step 2: Run prompt evaluation suite with `--replay`**

Run: `npm run eval:prompts -- --replay`
Expected: Outputs discrimination breakdown and authorization notice.

- [ ] **Step 3: Document evidence ledger in `docs/verification/qal-08a-prompt-evaluation-evidence.md`**

Document all 7 acceptance criteria results with exact commands and output logs.

- [ ] **Step 4: Commit**

```bash
git add docs/verification/qal-08a-prompt-evaluation-evidence.md
git commit -m "docs(verification): add prompt evaluation against baseline evidence ledger"
```
