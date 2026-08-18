# Requirements

## Problem

The request names a dashboard but does not state the decision or failure the
dashboard should address.

## Affected users

Support leads who coordinate incident response.

## Goals

Reduce the time needed to assign an incident owner.

## Non-goals

Choosing a dashboard implementation before the workflow is understood.

## Scope boundary

Incident ownership between intake and first assignment.

## Success metrics

At least 95% of new incidents have an owner within ten minutes.

## Open questions

None.

## Problem discovery (5 Whys)

Original request: “Build an incident dashboard.”

Classification: proposed solution. 5 Whys ran because no problem or metric was
stated. Three questions exposed a handoff problem rather than a visualization
problem. The probable root cause is an ownership rule missing from intake.

## Action framing (5W2H)

5W2H ran after the validated problem was stated. The candidate action is to
make ownership explicit at intake; a dashboard remains only one hypothesis.

<!-- KRATOS-REQUIREMENT-DISCOVERY-V1
{
  "contractVersion": "1.0.0",
  "stateContract": "1.0.0",
  "originalRequest": "Build an incident dashboard.",
  "classification": "proposed-solution",
  "problemDiscovery": {
    "applied": true,
    "skipReason": null,
    "decisionReason": "The request proposes a solution without stating the problem or success measure.",
    "investigation": [
      { "question": "Why is a dashboard needed?", "answer": "Support leads cannot see who owns a new incident." },
      { "question": "Why is ownership not visible?", "answer": "Intake records severity but does not assign an owner." },
      { "question": "Why does intake omit ownership?", "answer": "The intake process has no ownership rule or escalation path." }
    ],
    "causeCategory": "process",
    "probableRootCause": "The intake process has no ownership rule or escalation path."
  },
  "validatedProblem": "New incidents can remain unowned because intake does not establish ownership.",
  "solutionHypothesis": "Assigning and exposing an owner during intake may shorten the unowned interval.",
  "successMetric": "At least 95% of new incidents have an owner within ten minutes.",
  "wrongCauseRisk": "Ownership may already be assigned elsewhere and merely fail to propagate.",
  "actionFraming": {
    "applied": true,
    "skipReason": null,
    "decisionReason": "The cross-team action needs explicit ownership and operational boundaries.",
    "what": "Make incident ownership explicit at intake and visible to support leads.",
    "why": "Reduce the interval in which a new incident has no accountable responder.",
    "who": "Incident operations owns the process; support leads consume the ownership state.",
    "where": "The incident intake and escalation flow.",
    "when": "At creation, before the first escalation window expires.",
    "how": "Define an ownership rule, publish the owner, and measure assignment latency.",
    "howMuch": "Medium process and integration effort with uncertainty around the current handoff data."
  },
  "actionPlan": "Test an intake ownership rule and observable owner field before selecting a presentation surface."
}
KRATOS-END-REQUIREMENT-DISCOVERY-V1 -->
