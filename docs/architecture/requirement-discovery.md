# Requirement Discovery and Action Framing

The requirement document starts from an observed problem, not from whichever
solution happened to be named first. It uses two optional techniques in one
fixed order:

```text
5 Whys  -> establish the problem
5W2H    -> frame a possible action after the problem is clear
```

This phase produces content and reasoning. It does not add a gate fact, approve
a hypothesis, or block a run. Workflow gates retain sole authority to stop a
transition.

## Demand classification

Every incoming demand records exactly one runtime-owned classification:

| Classification | Meaning |
| --- | --- |
| `stated-problem` | The request leads with an observed problem |
| `proposed-solution` | The request leads with a solution whose problem is not established |
| `defect` | Existing behavior differs from an established expectation |
| `improvement` | Existing behavior should improve without being defective |
| `refactor` | The request leads with an internal structural change |
| `external-obligation` | A legal, regulatory, contractual, or other external duty drives the work |

The schema closes this set. A host cannot add a seventh category in a prompt or
silently map an unknown value to the nearest category.

## Adaptive 5 Whys

Apply 5 Whys when a request proposes a solution without stating the problem or
when the causal mechanism remains unclear. Each investigation item carries one
question and answer. The schema requires at least one item when applied but
sets no target of five: stop when the probable cause surfaces, continue beyond
five when it does not.

Skip it for a well-specified simple operation, a small visual change, a clear
legal obligation, a trivial defect with a known cause, or a demand already
explicit about problem, impact, metric, and scope. A skipped investigation has
zero items and a non-empty `skipReason`.

A person is never an accepted cause category. When an answer assigns blame,
ask both questions before rewriting it:

1. What allowed the omission to happen?
2. What would have caught it?

The resulting cause must be categorized as process, system, rule, flow,
communication, architecture, or operating context. Those categories describe
something a requirement can address.

## 5W2H after discovery

5W2H may run only after the validated problem is stated. When applied, it
records What, Why, Who, Where, When, How, and How Much. `howMuch` means effort,
complexity, operational impact, or uncertainty. It never requires a financial
estimate and a missing number must not be invented.

Skip 5W2H for small, trivial, or already well-structured work and record the
reason. A neat seven-field description is not evidence for the requester's
original solution. If that is its only support, problem discovery is not done.

The record keeps these statements independent:

- `validatedProblem`: what is established as wrong or needed;
- `solutionHypothesis`: one uncommitted explanation of what may help;
- `actionPlan`: the uncommitted next action or experiment.

## Machine-readable record

The PRD embeds exactly one JSON value between the
`KRATOS-REQUIREMENT-DISCOVERY-V1` delimiters. The pure extractor distinguishes
an absent block, a duplicate or unterminated block, invalid JSON, and a found
value. Found unknown data crosses the existing schema registry as
`state.requirement-discovery@1.0.0` before domain use.

The record is persisted inside the PRD rather than as a host message. Both
Claude Code and Codex therefore relay the same Markdown and the same schema;
neither host owns classification, applied/skip invariants, or field meaning.
The runtime performs no model call and adds no filesystem or network access.

## Worked example

The original request is “Build an incident dashboard.” It is classified as a
`proposed-solution`, so discovery asks why until it finds that incident intake
has no ownership rule. The validated problem becomes “new incidents can remain
unowned,” while a visible owner remains only a solution hypothesis. Only then
does 5W2H frame a cross-team experiment and express How Much as medium process
and integration effort with data uncertainty.

The complete human-readable sections and valid embedded record are in the
[`vague-solution.md`](../../fixtures/requirement-discovery/vague-solution.md)
fixture. [`simple-skip.md`](../../fixtures/requirement-discovery/simple-skip.md)
shows both techniques skipped with reasons, and
[`both-applied.md`](../../fixtures/requirement-discovery/both-applied.md) proves
that applied discovery and applied framing remain independent sections.
