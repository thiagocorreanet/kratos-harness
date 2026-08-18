# Objective Spec: Requirement Discovery and Action Framing

Date: 2026-08-18
Status: DONE
Approval source: GitHub issue #131 and the user's implementation request

## 1. Problem and desired outcome

- **Context:** A requirement can preserve the requester's proposed solution
  without establishing the problem it solves. Later approvals then bind a
  durable digest to the wrong premise.
- **Outcome:** The PRD records a closed demand classification, adaptively uses
  or explicitly skips 5 Whys, and only then uses or skips 5W2H. A typed,
  machine-readable record keeps the validated problem, solution hypothesis,
  and action plan separate without making any of them a gate decision.

## 2. Scope

### In scope

- Publish the six demand classifications once in the runtime contract.
- Expand the canonical `00-prd.md` template with complete 5 Whys and 5W2H
  authoring guidance, including skip policy and systemic-cause conversion.
- Add a `state.requirement-discovery@1.0.0` schema and generated TypeScript
  type for the machine-readable PRD record.
- Make applied/skip states exclusive and require a skip reason whenever a
  technique is not applied.
- Represent adaptive 5 Whys as one or more investigation steps with no maximum
  count and classify every root cause as a systemic category rather than a
  person.
- Keep 5W2H structurally after discovery and define How Much as effort,
  complexity, operational impact, or uncertainty, never a mandatory financial
  estimate.
- Add vague, simple, and both-applied fixtures plus a worked documentation
  example.
- Provide pure runtime extraction and semantic inspection for the embedded
  record; do not add a workflow gate or host-specific decision.

### Out of scope

- Business gap detection (#128), approval changes, or new blocking behavior.
- Automatic truth assessment of qualitative investigation prose.
- A model prompt or host-specific implementation of the discovery decision.
- Acceptance-criterion identifiers (#132).

## 3. Acceptance criteria

- [x] A proposed solution with no stated problem applies 5 Whys and records a
  validated problem distinct from the original solution.
- [x] An already explicit or trivial demand records each skipped technique and
  its non-empty reason.
- [x] The schema and canonical template place action framing after problem
  discovery.
- [x] Root causes use a closed systemic category, and guidance states the two
  questions that convert personal blame into an addressable cause.
- [x] Applied 5 Whys accepts different positive investigation lengths; skipped
  techniques reject a missing reason and applied techniques reject a skip
  reason.
- [x] The record names the validated problem, solution hypothesis, success
  metric, wrong-cause risk, and action plan independently.
- [x] 5W2H records What, Why, Who, Where, When, How, and non-financial How Much
  when applied, and cannot precede discovery in the canonical artifact.
- [x] Discovery output does not alter gate outcomes or block a run.
- [x] Narrow tests and `npm run verify` pass with zero failures.

## 4. Test strategy and failure modes

- Start with failing tests for schema registration, conditional applied/skip
  validation, adaptive investigation lengths, systemic-cause categories,
  exact template content, record extraction, and fixture semantics.
- Validate three fixtures: vague solution-shaped demand, simple skipped work,
  and a demand where both techniques run independently.
- Test malformed, missing, and duplicate machine blocks without I/O or partial
  acceptance.
- Retain the existing gate tests to prove no discovery result becomes a gate
  fact.
- Run formatting, spelling, English, lint, type checking, all tests, coverage,
  mutation, compatibility, build, package, and benchmark checks through
  `npm run verify`.

## 5. Compatibility and risk

- **Compatibility:** Additive state schema and generated type. Existing state,
  reason codes, commands, event history, approvals, and host contracts remain
  unchanged.
- **State impact:** Existing PRDs remain readable by the current heading gate;
  no migration or automatic rewrite is introduced.
- **Security impact:** Parsing is pure and bounded by the existing schema
  registry. It adds no I/O, dependency, secret, or network authority.
- **Primary risks:** Prose cannot be proven truthful by JSON Schema. The
  contract therefore closes classifications and systemic cause categories,
  while documentation and fixtures demonstrate the qualitative standard.

## 6. Ordered implementation tasks

1. Add failing schema, runtime, template, and fixture tests.
2. Add the requirement-discovery schema, registry entry, and generated type.
3. Implement the pure extraction/inspection contract and canonical PRD
   guidance.
4. Add fixtures, worked documentation, and compatibility notes.
5. Run focused evidence, then the complete verification suite.
