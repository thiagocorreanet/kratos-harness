# Verification Evidence: Prompt Evaluation Against Baseline (QAL-08a)

**Issue**: [#56](https://github.com/thiagocorreanet/kratos-harness/issues/56), [#129](https://github.com/thiagocorreanet/kratos-harness/issues/129), [#134](https://github.com/thiagocorreanet/kratos-harness/issues/134)  
**Date**: 2026-08-29  
**Status**: Verified Pass

---

## 1. Executive Summary

This document records verification evidence for the prompt evaluation harness implemented under requirement QAL-08a. The harness evaluates system prompt variants against an empty baseline (and optional previous prompt versions) over multiple randomized or deterministic trials, measuring deterministic mechanical assertions, token consumption, latency, sample variance / spread, and discrimination capability.

---

## 2. Acceptance Criteria Verification Ledger

| Criterion | Description | Status | Evidence / Verification |
| :--- | :--- | :--- | :--- |
| **AC1** | Evaluation runs both sides of the trial (with prompt and without prompt) without skipping when one fails, recording duration and token consumption for both. | **PASS** | Verified via `tests/prompt-evaluations.test.ts` (`AC1 & AC5: runs both sides without skipping...`) and `packages/runtime/src/domain/prompt-eval/runner.ts`. |
| **AC2** | Evaluation cases with identical resolutions on both sides are reported as non-discriminating rather than a pass. | **PASS** | Verified via `tests/prompt-eval-analysis.test.ts`, `tests/prompt-eval-fixtures.test.ts`, and `quality/evaluations/prompts/cases/non-discriminating-sample.v1.json` reporting `isDiscriminating: false` and `passingAuthorized: false`. |
| **AC3** | Every mechanical assertion produces the exact same verdict when evaluated against the same model output. | **PASS** | Verified via `tests/prompt-eval-mechanical.test.ts` (pure determinism across schema, coherence, agent, status, routing hint, scope bounds, artifacts, blockers, and verdicts). |
| **AC4** | Every assertion evaluated by a model is labeled as model-graded, and evaluation summaries report how many conclusions depend on one. | **PASS** | Verified via `tests/prompt-eval-analysis.test.ts`, `CaseComparisonReport.modelGradedCount`, and `scripts/evaluate-prompts.mjs`. |
| **AC5** | Every trial measures latency and token consumption, computing cost and latency multipliers against the empty baseline. | **PASS** | Verified via `packages/runtime/src/domain/prompt-eval/analysis.ts` and `tests/prompt-evaluations.test.ts`. |
| **AC6** | The prompt evaluation runner is excluded from the default `npm run verify` pipeline and provided as `npm run eval:prompts`. | **PASS** | Verified via `tests/prompt-evaluations.test.ts` checking `package.json` scripts and command entry point `npm run eval:prompts`. |
| **AC7** | Test and fixture suites carry the normative limitation notice regarding behavioral superiority vs formal proof. | **PASS** | Verified in `quality/evaluations/prompts/README.md`, `scripts/evaluate-prompts.mjs`, and test suites. |

---

## 3. Verification Command Outputs

### 3.1 Prompt Evaluation Replay Execution (`npm run eval:prompts -- --replay`)

```text
> kratos-harness@0.0.0-development eval:prompts
> node scripts/evaluate-prompts.mjs --replay

=== Running Evaluation Case: code-implementer-single-step (code-implementer) ===
  With prompt pass rate:    100.0% (spread: 0.00)
  Without prompt pass rate: 0.0% (spread: 0.00)
  Cost multiplier:          6.86x
  Non-discriminating count: 0 / 5
  Model-graded count:       0 / 5
  Authorized to ship:       YES

=== Running Evaluation Case: non-discriminating-sample (prd-researcher) ===
  With prompt pass rate:    100.0% (spread: 0.00)
  Without prompt pass rate: 100.0% (spread: 0.00)
  Cost multiplier:          6.86x
  Non-discriminating count: 1 / 1
  Model-graded count:       0 / 1
  Authorized to ship:       NO

=== Running Evaluation Case: spec-reviewer-audit (spec-reviewer) ===
  With prompt pass rate:    100.0% (spread: 0.00)
  Without prompt pass rate: 0.0% (spread: 0.00)
  Cost multiplier:          6.86x
  Non-discriminating count: 0 / 4
  Model-graded count:       0 / 4
  Authorized to ship:       YES

--------------------------------------------------
Normative Notice: This suite measures prompt behavior and discrimination on chosen test cases.
A passing run demonstrates prompt superiority over the empty baseline on declared assertions;
it does not constitute mathematical proof of prompt correctness on arbitrary inputs.
--------------------------------------------------
```

### 3.2 Unit and Acceptance Test Suite Execution (`npx vitest run tests/prompt-eval*.test.ts`)

```text
 ✓ tests/prompt-eval-model.test.ts (3 tests)
 ✓ tests/prompt-eval-mechanical.test.ts (5 tests)
 ✓ tests/prompt-eval-analysis.test.ts (3 tests)
 ✓ tests/prompt-eval-runner.test.ts (2 tests)
 ✓ tests/prompt-eval-fixtures.test.ts (2 tests)
 ✓ tests/prompt-evaluations.test.ts (5 tests)

Test Files  6 passed (6)
Tests       20 passed (20)
```

### 3.3 Fast-Fail on Missing Credentials

Running `node scripts/evaluate-prompts.mjs` without environment credentials:

```text
Error: Prompt evaluation requires model credentials in environment (e.g. ANTHROPIC_API_KEY or OPENAI_API_KEY) or run with --replay for deterministic fixtures.
(Process exit code: 1)
```

---

## 4. Architecture Compliance

1. **Dependency Direction**: Pure domain modules in `packages/runtime/src/domain/prompt-eval` depend only on `@kratos/contracts` and sibling domain packages (`agent`, `schema`, `phase-agents`), fully decoupling from infrastructure `infra/`.
2. **Schema Validation**: Mechanical assertions utilize `SchemaRegistry` port abstraction or pure JSON structural verification.
3. **Exact Optional Properties**: Model contracts and declarations fully comply with TypeScript `exactOptionalPropertyTypes: true`.
