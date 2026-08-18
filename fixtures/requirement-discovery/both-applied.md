# Requirements

## Problem

Order exports time out unpredictably during month-end reconciliation.

## Affected users

Finance operations and platform operators.

## Goals

Make reconciliation data available within the operational window.

## Non-goals

Committing to a queue or a new export interface before validation.

## Scope boundary

Month-end order export generation and delivery.

## Success metrics

Ninety-nine percent of month-end exports become available within five minutes.

## Open questions

None.

## Problem discovery (5 Whys)

5 Whys ran adaptively and stopped after the third answer exposed synchronous
aggregation as the probable architectural cause.

## Action framing (5W2H)

After the problem was validated, 5W2H framed an experiment without committing
to the asynchronous solution hypothesis.

<!-- KRATOS-REQUIREMENT-DISCOVERY-V1
{
  "contractVersion": "1.0.0",
  "stateContract": "1.0.0",
  "originalRequest": "Refactor order exports to use a queue.",
  "classification": "refactor",
  "problemDiscovery": {
    "applied": true,
    "skipReason": null,
    "decisionReason": "The requested refactor names an implementation but the timeout mechanism is not yet established.",
    "investigation": [
      { "question": "Why should exports use a queue?", "answer": "Month-end exports time out before reconciliation begins." },
      { "question": "Why do month-end exports exceed the timeout?", "answer": "Each request aggregates the full period synchronously." },
      { "question": "Why is the full aggregation synchronous?", "answer": "The export boundary was designed only for small interactive ranges." }
    ],
    "causeCategory": "architecture",
    "probableRootCause": "The interactive export boundary synchronously aggregates ranges larger than it was designed to handle."
  },
  "validatedProblem": "Month-end order ranges exceed the synchronous export boundary and miss the reconciliation window.",
  "solutionHypothesis": "Separating export submission from generation may keep large ranges within an observable processing budget.",
  "successMetric": "Ninety-nine percent of month-end exports become available within five minutes.",
  "wrongCauseRisk": "Database contention rather than synchronous orchestration may dominate the timeout.",
  "actionFraming": {
    "applied": true,
    "skipReason": null,
    "decisionReason": "The work crosses finance operations and platform boundaries and has material uncertainty.",
    "what": "Measure and test a bounded large-range export path.",
    "why": "Provide reconciliation data inside the month-end operating window.",
    "who": "The orders team owns generation; finance operations validates availability.",
    "where": "The order export boundary and its month-end workload.",
    "when": "Before the next month-end rehearsal.",
    "how": "Instrument the current path, test the hypothesis, and compare a decoupled generation path.",
    "howMuch": "High integration complexity and moderate operational risk; queue semantics remain uncertain."
  },
  "actionPlan": "Run a measured large-range export experiment, then choose the smallest design that satisfies the five-minute target."
}
KRATOS-END-REQUIREMENT-DISCOVERY-V1 -->
