# Task 7 Report: Persist runtime-selected phase execution

## Status

Completed. Host-driven phase results are now bound to the exact agent-output
bytes and current runtime assignment. Direct CLI results persist an honest
unknown observation, while stale or mismatched results fail before append.

## Delivered

- Extended the 1.1 adapter request with the existing `phaseExecution` shape and
  propagated it through real and fake host adapters. Other adapter message
  variants remain closed to that top-level field.
- Added the boundary-only `PhaseExecutionObservation` with exactly
  `assignmentDigest`, `model`, `effort`, and `provenance`; event projection uses
  only `observedIdentity`.
- Bound non-empty `agent record` stdin to the exact operation, correlation,
  agent-output ref, inspected SHA-256, and phase assignment digest. Malformed or
  mismatched envelopes fail before agent content is read.
- Re-hash the agent output after reading it, resolve config/run/catalog before
  reading host-reported content, resolve again after observation, and revalidate
  the assignment immediately before applying the append plan.
- Compare every non-null host-reported model/effort and the reported host with
  the canonical assignment. Missing host fields remain null. Empty stdin forces
  unknown provenance and null model/effort, regardless of CLI `--model`.
- Construct `resolvedAssignment` and sanitized `observedIdentity` inside
  workflow decisions for `agent.record` and accepted/completed transitions.
  Agent-output contracts and prompts were not changed.

## TDD evidence

### RED

The trust-boundary tests were added before production changes:

```text
npm test -- tests/model-role-workflow.test.ts \
  tests/workflow-state-machine.test.ts tests/agent-output-contract.test.ts \
  tests/cli-composition.test.ts tests/contract-schemas.test.ts \
  tests/host-adapter-contract.test.ts
Test Files 4 failed | 2 passed
Tests 13 failed | 181 passed
```

Failures showed that adapter requests dropped `phaseExecution`, runtime events
trusted the CLI identity, malformed stdin still reached agent content, and
stale/mismatched observations were accepted.

A separate race test was then written before the final pre-append check:

```text
npm test -- tests/model-role-workflow.test.ts -t "immediately before append"
Test Files 1 failed
Tests 1 failed
received trail.ok/stateChanged:true instead of model.assignment_stale/false
```

### GREEN

```text
focused contract/workflow matrix
Test Files 6 passed
Tests 200 passed

required workflow/event/transaction matrix
Test Files 6 passed
Tests 227 passed

all workflow/model/event/agent/CLI/transaction-named suites
Test Files 50 passed
Tests 1628 passed
```

Negative integration cases compare both `events.jsonl` and the replay snapshot
bytes before/after refusal and prove no agent-output artifact was committed.

## Quality gates

```text
npm run contracts:check
33 schemas; 14 legacy profiles; generated types current

npm run typecheck
exit 0

npm run lint -- --quiet
exit 0

Prettier check for every changed TypeScript, JSON, and Markdown file
All matched files use Prettier code style!

git diff --check
exit 0
```

An additional repository-wide `npm test` run exposed six failures inherited
from the received HEAD, outside this task: two architecture inventory/rule
failures, two stale distribution-manifest expectations, and two legacy init
fixtures without the now-required 1.1 model routing. A focused reproduction
reported 135 passing and 6 failing tests. The two affected fixtures inside the
requested workflow/CLI matrix were updated to 1.1 and are included here; the
unrelated architecture, distribution, objective, and package-verifier files
were left unchanged.

## Trust-boundary self-review

- Runtime config, run revision, host catalog, and canonical assignment are the
  only sources of persisted assignment. Agent prose and unknown JSON claims do
  not participate.
- The adapter envelope is structurally validated and command-bound before the
  reply body is read; the inspected and read body digests must both match.
- `model.assignment_stale` covers digest/config/run/catalog drift;
  `model.execution_mismatch` covers host, model, or effort disagreement.
- Unknown provenance always produces `{ model: null, effort: null }`. No CLI
  flag or agent claim can upgrade it to a host observation.
- Event fields are owned by workflow decisions. The agent-output schema still
  rejects `resolvedAssignment`, `observedIdentity`, and `phaseExecution`.
- Search confirmed there are no duplicate `observedModel` or `observedEffort`
  DTO fields, and the diff contains no prompt-policy changes.
