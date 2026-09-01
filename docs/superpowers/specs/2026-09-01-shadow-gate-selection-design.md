# Shadow Gate Selection Completion Design

- Issue: SDD-12a, follow-up to #128
- Dependency already delivered: #143 / SDD-18
- Status: Approved design
- Date: 2026-09-01

## 1. Purpose

Projects must be able to select the evaluator's existing `shadow` mode during
initialization, then observe the resulting findings in both human and machine
readable diagnostics. Shadow findings are evaluated and persisted, but do not
warn or block. This enables the rollout sequence `shadow -> measure -> warn ->
enforce` without changing what any gate decides.

SDD-18 has already established the governing architecture:

- `policyMode` is the inherited project default, with `standard -> warn` and
  `strict -> enforce`;
- `gateModes` is the closed per-gate override map and accepts `shadow`, `warn`,
  and `enforce`;
- `state.project-config@1.4.0` and `state.event@1.2.0` already persist the
  selected modes and effective failure traces.

This change completes that architecture. It does not add `shadow` to the global
`policyMode`, add a gate, or change a gate condition.

## 2. Selected approach

Initialization accepts the same partial `gateModes` map already owned by
project configuration. Omission resolves to `{}`, preserving all current
defaults. The runtime copies the validated map into `.brain/config.json`
without expanding inherited entries; effective mode expansion remains owned by
the existing pure `resolveGateModes` boundary.

Diagnostics expose the existing ordered gate-failure trace instead of deriving
a second representation. Each reported finding contains the canonical
`gateId`, `reasonCode`, effective `mode`, `priority`, `evidenceRefs`, and
nullable `detail`. `handoff` and `doctor` use the same immutable projection, so
human and JSON output cannot disagree about the selected mode.

Rejected alternatives are:

- adding `shadow` to `policyMode`, which duplicates the per-gate axis and makes
  every integrity gate silently permissive too easily;
- accepting command-line mode overrides, which would let callers bypass
  project-owned policy;
- reporting only prose, which would force hosts and tests to parse display
  text.

## 3. Contracts and runtime behavior

### Initialization answers

Publish `host.init-answers@1.5.0` as an additive payload revision. It adds an
optional `gateModes` property with the same closed gate IDs and
`shadow | warn | enforce` values as `state.project-config@1.4.0`.
`contractVersion` becomes `1.5.0`; `hostContract` remains the current host
family identity because no host capability or trust boundary changes.
Predecessor answer schemas remain immutable and registered.

Resolution treats an omitted property as `{}` and lists `gateModes` among the
disclosed defaults. Skeleton generation persists exactly the resolved partial
map. Reinitializing an existing current project preserves its configured map
when the answers document omits `gateModes`; an explicitly supplied map
replaces it. This follows the existing preservation rule for persisted
configuration authority and prevents a routine re-init from silently erasing a
rollout.

Unknown gate IDs, unknown modes, and malformed maps fail answers-schema
validation before any filesystem mutation. Prompts, agents, and host adapters
cannot add or override modes after validation.

### Handoff reporting

Publish `host.phase-handoff@1.4.0`. It adds required `gateFailures`, using the
same bounded item shape and canonical ordering as current event failures.
`blockers` is retained for compatibility and continues to contain every failed
gate ID, including shadow findings; it is not redefined as enforce-only.

Human handoff output adds one stable line per failure:

```text
Gate finding: gaps-closed shadow gate.gaps_abertos
```

The headline remains `Gate outcome: pass | warn | block`. Therefore a
shadow-only decision is visibly `pass` while still naming the shadow finding.
JSON emits the typed `gateFailures` array and requires no prose parsing.

### Doctor reporting

Publish `host.doctor-report@1.0.0` for successful `doctor --json` output. It
contains the existing overall `health` and ordered `checks`, plus the same
required `gateFailures` projection used by handoff. Non-zero diagnostic
failures continue to use the universal `result@1.0.0` envelope, consistent with
the CLI's existing error path.

Human doctor output includes the effective mode and reason code beneath the
`gates` check for every finding. A shadow finding keeps the diagnostic check at
`warn` because it is observed, while the gate decision itself remains `pass`;
this preserves the distinction between workflow enforcement and diagnostic
visibility.

Both diagnostic payloads are prepared and schema-validated at the composition
boundary before publication. They copy the evaluator-owned trace and never
recompute mode, severity, ordering, or primary failure.

## 4. Compatibility and failure behavior

`state.project-config@1.4.0` already introduced `gateModes` under the published
state-versioning rules, so this completion does not revise project state. A
runtime predating SDD-18 recognizes only state `1.3.0`; it classifies a `1.4.0`
configuration carrying a shadow override as `unsupported` and returns
`contract.state_version_unsupported` before payload validation or mutation. It
must never drop `gateModes`, choose the nearest schema, or downgrade `shadow`
to `warn`.

A current project with omitted initialization `gateModes` resolves to its
persisted map on re-init, or `{}` for a new project. A new project with `{}`
behaves exactly as today: `standard` warns and `strict` enforces. Configuration
read failures retain the current fail-closed all-enforce behavior.

The new host payload revisions are selected exactly by version. Older answer
documents remain readable through their registered schemas and resolve with no
gate override. Consumers that only know the predecessor handoff or doctor
payload must reject the newer payload revision rather than guessing its shape.

## 5. Test strategy and evidence

Implementation proceeds test-first in contract, domain, and composition
slices.

- Table-test one identical blocking finding under `shadow`, `warn`, and
  `enforce`: all three evaluate and persist the finding; workflow continuation
  outcomes are respectively pass/continue, warn/continue, and block/stop.
- Validate init answers with every gate and every mode, reject unknown keys and
  values, default new projects to `{}`, preserve an existing map when omitted,
  and replace it when explicitly supplied.
- Assert generated configuration contains the selected partial map while an
  omitted mode retains byte-equivalent current default behavior.
- Assert human and JSON `handoff` report a shadow finding and its effective
  mode while the headline outcome is `pass`.
- Assert human and JSON `doctor` report the same shadow finding and mode while
  workflow state remains unblocked.
- Validate positive and negative fixtures for the new init, handoff, and doctor
  contracts; regenerate declarations and update contract catalog and
  documentation assertions without modifying predecessor schemas.
- Against a frozen predecessor state compatibility window, assert that a
  `state.project-config@1.4.0` document containing a shadow override is refused
  as `unsupported` with `contract.state_version_unsupported` and no state
  change.
- Run focused init, gate, workflow, diagnostics, schema, and compatibility
  suites, followed by `npm run verify`.

Acceptance evidence is recorded in
`docs/verification/issue-12a-shadow-gate-selection-evidence.md`, mapping each
criterion to exact commands and outputs.

## 6. Documentation and completion

Update the user configuration guide with initialization examples and the
rollout sequence:

1. configure one new gate as `shadow`;
2. measure persisted findings through events, `handoff`, and `doctor`;
3. promote it to `warn` once the signal is trustworthy;
4. promote it to `enforce` only after warnings are actionable and expected.

The change is complete when selectable initialization, reporting parity,
predecessor-runtime refusal, focused tests, full verification, and reproducible
evidence all pass, with no changes to individual gate decisions.
