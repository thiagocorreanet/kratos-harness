# Repair Loop Stop-Loss Design

Date: 2026-08-30
Status: Approved
Approval source: GitHub issue #141 and the user's approved brainstorming design

## Outcome

Kratos counts rejected acceptance verdicts per stable `AC-*` identifier. A
rejection below the configured ceiling returns the run to code repair. A
rejection at the ceiling blocks the run, records whether the fault is in code
or specification, and preserves a written diagnosis. Token exhaustion remains
an independent, distinguishable stop-loss trigger.

## Decisions

- `acceptanceAttemptCeiling` is an optional positive project setting. Its
  documented and executable default is 3, and there is no unbounded value.
- The counter belongs only to acceptance criteria. Review finding identifiers
  are outside this feature.
- Every rejected acceptance verdict increments every failed criterion in task
  document order. A pass or plain resume never resets a counter.
- Every criterion reaching the ceiling in one verdict requires its own
  `code | specification` classification and diagnosis from the judge.
- A person resolves each code stop explicitly; only that criterion resets. The
  run returns to `code` after all active code stops are resolved.
- After every active code stop is explicitly resolved, resolving a
  specification stop preserves the blocked run and creates a new run that
  starts at `spec`, requires a new approval, and begins with zero attempts. A
  corrected declaration receives a new AC identifier. A spec-first request is
  refused so it cannot strand code stops on the source run.
- `objective.budget.tokens` is the single token ceiling source. The objective
  command can declare it, and the value is frozen when a run starts.
- Counters, stops, and resolutions derive from the run event stream. Hosts
  relay the same contracts and never own transition policy.

## Contracts

`state.project-config@1.4.0` adds optional
`acceptanceAttemptCeiling`. `host.init-answers@1.4.0` accepts an integer to set
the override, null to clear it, or absence to preserve it during
reinitialization. Existing project configuration requires the explicit
`1.3.0 -> 1.4.0` migration; historical events and artifacts are not rewritten.

`host.agent-output@1.1.0` introduced optional rejected-acceptance `faults`;
current `@1.2.0` additionally rejects whitespace-only diagnoses. Runtime
semantic validation requires faults exactly for criteria
whose next rejection reaches the ceiling. Each fault carries `criterionId`,
`classification`, and a bounded diagnosis.

`state.event@1.2.0` carries closed acceptance-decision metadata, and
`state.event@1.3.0` carries repair-resolution metadata. Failed criterion
identifiers and resulting attempt numbers are event data. Full diagnoses live
in immutable, digest-bound `state.repair-loop-stop@1.1.0` artifacts referenced
by the event; its predecessor remains readable.

`workflow-v2` reconstructs attempt counts, active repair stops, and the frozen
token ceiling. It accepts mixed streams only after a persisted
`run.policy_upgraded` boundary freezes the chosen limits; the legacy prefix
contributes empty attempt state, and replay never infers limits.

## Workflow

Recording an accepted acceptance verdict preserves the acceptance phase. A
rejected verdict below the ceiling atomically records verdict artifacts and
returns the run to `code`. A verdict at the ceiling records
`run.stop_loss.repeated_rejection`, writes the stop artifact, and leaves the
run blocked. A verdict missing a required diagnosis is refused without any
effect.

`repair resolve <AC-ID> --run <RUN> --resolved-by <ID> --observation <TEXT>
[--next-run <RUN>]` is the only repair-loop release operation. Runtime policy
chooses the action from the recorded classification. `code` forbids a next run
and selectively resets the named counter. `specification` requires a next run,
requires every code stop to have been resolved first, records a restart ticket,
and causes that new run to start in `spec`.

Plain `start` and `continue` calls cannot release an active repair stop.
`unlock stop-loss` remains the independent token-budget release and never
changes rejection attempts.

Recovery observation validates exact artifact schemas and digests, source and
target bindings, retired identifiers, and the successor run's event/snapshot
cross-links. A missing or changed artifact or successor fails closed. Duplicate
correlations are unchanged only when their full semantic recovery payloads
match; divergent retries conflict.

## Failure and security policy

The gate aggregates active stop-loss triggers in stable order and distinguishes
`blocked.stop_loss_rejections`, `blocked.stop_loss_budget`, and
`blocked.stop_loss_flag`. A stop may expose bounded classification and
diagnosis metadata through typed status and handoff views. Events and public
results reference evidence instead of embedding prompts, source content,
absolute paths, or unrestricted diagnostics.

## Verification

Tests cover default and configured ceilings, the first through ceiling
rejections, simultaneous criteria, missing diagnosis refusal, selective reset,
specification restart, plain resume, frozen token ceilings, mixed-version
replay, corruption, idempotency, host parity, and distinguishable stop reasons.
Focused tests run before `npm run contracts:check`, `npm run result:check`, and
the full `npm run verify` gate.
