# Issue #131 requirement discovery evidence

Date: 2026-08-18

## Scope

This evidence closes [issue #131](https://github.com/thiagocorreanet/kratos-harness/issues/131).
The change makes the PRD classify every incoming demand, apply or explicitly
skip adaptive 5 Whys, and only then apply or skip 5W2H. A host-neutral embedded
record validates as `state.requirement-discovery@1.0.0`; no discovery result is
a workflow gate.

## Acceptance evidence

| Acceptance criterion | Evidence |
| --- | --- |
| A solution-shaped request triggers discovery and produces a distinct validated problem | `fixtures/requirement-discovery/vague-solution.md` starts from “Build an incident dashboard,” classifies it as `proposed-solution`, runs three why steps, and validates the unowned-incident problem separately. |
| Explicit or trivial work records skips with reasons | `fixtures/requirement-discovery/simple-skip.md` skips both techniques with non-empty reasons and null 5W2H fields. |
| Discovery precedes action framing | The canonical template and all three PRD fixtures place `Problem discovery (5 Whys)` before `Action framing (5W2H)`; `tests/requirement-discovery.test.ts` asserts the order. |
| A person cannot be the root-cause category | The schema admits only process, system, rule, flow, communication, architecture, and operating context. Tests reject `person`; template and architecture guidance state both conversion questions. |
| Applied/skip records validate conditionally | The schema requires investigation items and a null skip reason when 5 Whys runs, zero items and a non-empty reason when it is skipped, and equivalent exclusive states for all seven 5W2H fields. |
| 5 Whys is adaptive | The focused suite validates one, three, and six investigation steps; no exact-five rule exists. |
| Problem, hypothesis, and plan remain separate | The schema requires `validatedProblem`, `solutionHypothesis`, and `actionPlan` as three independent fields, and the applied fixture gives each a distinct value. |
| 5W2H does not ratify the original solution | Template and architecture guidance reject seven-field fit as evidence and define How Much as effort, complexity, operational impact, or uncertainty without a required financial estimate. |
| Discovery never blocks a run | No gate model, evaluator, reason code, workflow decision, command, approval, or event contract changed. The extractor only classifies block shape and the existing schema registry validates found data. |

## Verification commands

Focused verification:

```text
npx vitest run tests/requirement-discovery.test.ts tests/feature-documents.test.ts tests/contract-manifest.test.ts tests/contract-schemas.test.ts tests/schema-registry-fixtures.test.ts tests/schema-registry-types.test.ts tests/contract-type-generation.test.ts --reporter=verbose

Test Files  7 passed (7)
Tests       178 passed (178)
Exit code   0
```

Complete repository gate:

```text
npm run verify

Test Files  150 passed (150)
Tests       4024 passed (4024)
Statements  94.26%
Branches    90.37%
Functions   94.34%
Lines       94.55%
Mutation    3 / 3 (100.00%)
Contracts   18 schemas; 14 legacy profiles
Package     passed for Codex and Claude Code
Exit code   0
```

The complete run also passed formatting, spelling, English-only enforcement,
lint, type checking, gap calibration, performance budgets, oracle and parity
verification, result and contract checks, differential self-tests, build,
package verification, and benchmarks.

## Impact

- **Compatibility:** Adds one current state schema and generated type without
  changing the `1.0.0` state compatibility window. Existing schemas, reason
  codes, host messages, approvals, digests, and commands are unchanged.
- **State:** Existing PRDs are not migrated or rewritten. New template copies
  carry a placeholder block that remains part of the already-detected untouched
  template until an author replaces it.
- **Security:** Adds no dependency, network access, filesystem authority, or
  host-specific logic. Extraction is pure and schema validation uses the
  existing embedded fail-closed registry.
