# Per-Gate Policy Modes Design

- Issue: [#143](https://github.com/thiagocorreanet/kratos-harness/issues/143)
- Dependencies: [#28](https://github.com/thiagocorreanet/kratos-harness/issues/28), [#128](https://github.com/thiagocorreanet/kratos-harness/issues/128)
- Status: Approved design
- Date: 2026-08-30

## 1. Purpose and scope

Every deterministic gate currently shares one evaluation-wide `GateMode`.
That prevents a judgment-based gate such as `gaps-closed` from being calibrated
in shadow while established measurement-based gates remain enforced.

This change makes the effective mode a property of each gate evaluation. It
keeps `policyMode` as the project default, adds closed per-gate overrides,
aggregates mixed outcomes deterministically, and records every failed gate and
its effective mode in the authoritative event history.

The change does not add or remove gates, alter any gate condition, change a
reason code, or delegate policy to a host or prompt. The runtime remains the
only decision authority. Codex and Claude Code remain equivalent relay and
rendering surfaces.

## 2. Current behavior and constraints

`GateContext.mode` is one `shadow | warn | enforce` value. `evaluateGates`
collects all failures, sorts them by priority and gate ID, selects the first as
`primary`, and then applies the shared mode to the entire decision. Project
configuration exposes `policyMode: standard | strict`; composition maps
`standard` to `warn` and `strict` to `enforce`. `shadow` is currently reachable
only through the evaluator API.

Project configuration is closed, versioned state. Pre-current versions require
explicit migration before ordinary operations may use them. Event streams are
append-only, canonical, hash-chained, and may contain multiple readable event
revisions. Historical records are never rewritten during configuration
migration.

Approvals bind a gate, lineage, workflow policy version, effective policy mode,
objective, and revision into a SHA-256 challenge. A per-gate rollout must not
weaken that binding or invalidate unrelated approvals.

The evaluator must remain pure. It receives inert facts and resolved policy and
does not read the filesystem, Git, the clock, a process, a network, or a host.

## 3. Options considered

### 3.1 Resolve a total gate-mode table before evaluation — selected

A pure resolver converts the project default and partial overrides into an
immutable `Record<GateId, GateMode>`. The evaluator receives only this complete
table. Configuration inheritance stays separate from gate conditions, and a
gate cannot be evaluated without a mode.

### 3.2 Resolve inheritance inside `evaluateGates`

Passing `policyMode` and overrides directly to the evaluator would require
fewer new boundaries, but it would mix project-configuration semantics with
gate evaluation and make the evaluator responsible for two policies. This
option is rejected.

### 3.3 Convert gates into polymorphic evaluator objects

Representing every gate as `{ id, mode, evaluate }` would make ownership
literal, but it would restructure all existing evaluators and expand the change
beyond the requirement. It risks changing individual gate behavior and is
rejected.

## 4. Project policy resolution

`policyMode` remains required and retains its existing values and meaning:

| `policyMode` | Default `GateMode` |
| --- | --- |
| `standard` | `warn` |
| `strict` | `enforce` |

The current project configuration adds a required `gateModes` object. It is a
closed, partial map whose property names are the published `GateId` values and
whose values are `shadow`, `warn`, or `enforce`. An absent property inherits the
default derived from `policyMode`.

For example:

```json
{
  "policyMode": "strict",
  "gateModes": {
    "gaps-closed": "shadow"
  }
}
```

The pure `resolveGateModes` boundary accepts the default and validated
overrides and returns a complete immutable map containing exactly one mode for
every `GateId`. Unknown gate IDs and invalid modes fail schema validation; they
never become runtime fallbacks. A missing, unreadable, or invalid current
configuration resolves at the composition fail-closed boundary to an all-
`enforce` table and an unreadable context, preserving the existing
`context-readable` block.

## 5. Gate evaluation and aggregation

`GateContext` no longer contains a single `mode`. It contains the total resolved
gate-mode map. The existing conditions continue to collect the same gate IDs,
reason codes, priorities, evidence references, and details. The failure builder
adds the effective `mode` selected by the failing gate ID.

Each failure resolves independently:

| Effective mode | Failure outcome |
| --- | --- |
| `enforce` | `block` |
| `warn` | `warn` |
| `shadow` | `pass` |

`aggregateGateFailures` is a separate pure function. It selects the most severe
failure outcome using `block > warn > pass`, and orders all failures by:

1. outcome severity, most severe first;
2. the existing numeric gate priority;
3. `gateId` using the existing deterministic locale comparison.

The first ordered failure is `primary`. With no failures the result is `pass`
and `primary` is `null`. With only shadow failures the result is `pass` and the
highest-priority shadow failure remains primary, preserving the current
uniform-shadow behavior. With mixed modes, primary necessarily belongs to the
outcome that determined the aggregate result.

Failures with the same outcome retain their current priority order. When every
gate has the same effective mode, the complete failure order remains unchanged.
The language-policy advisory collection remains separate and has no effect on
gate aggregation.

`GateDecision` removes the ambiguous singular `mode`. It carries the total
`gateModes`, the ordered failures with their effective modes, the aggregate
outcome, primary failure, criteria states, and existing advisories. This keeps
the effective policy observable even when no gate fails.

## 6. Workflow propagation

Composition observes project configuration and gate facts, resolves the total
mode table, and passes only inert data into `evaluateGates`. It passes the
resulting gate decision into the pure workflow decision boundary.

For a phase-completion action:

- `block` rejects the transition;
- `warn` reports findings and allows the transition;
- `pass` allows the transition, including when shadow failures exist.

Every new workflow event carries the ordered gate failures supplied by the
evaluation that accompanied the operation. An accepted event therefore retains
shadow and warn observations instead of losing them because the run advanced.
A rejected event retains all gate failures while public headline rendering uses
`primary`. Missing artifacts, invalid evidence, explicit rejection, and other
non-gate causes remain in their existing rejection explanation path and are not
misrepresented as gate failures.

Events that do not result from a gate evaluation carry an explicit empty
`gateFailures` array. Host adapters do not select modes, aggregate failures, or
change primary selection. They render or relay the same runtime-owned decision.

## 7. Persisted contracts

### 7.1 Project configuration 1.4.0

The state family advances to `1.4.0`. `state.project-config@1.4.0` requires the
new closed `gateModes` map, keeps `policyMode`, and keeps `hostContract: 1.3.0`
because no host protocol changes. New initialization writes `gateModes: {}`.

The contract manifest, schema registry, generated declarations, fixtures, and
contract documentation register the new revision. The predecessor schemas and
fixtures remain byte-preserved.

### 7.2 Event 1.2.0

`state.event@1.2.0` adds a required `gateFailures` array. Every item records:

- `gateId`;
- `reasonCode`;
- `mode`;
- `priority`;
- `evidenceRefs`;
- `detail`.

The schema bounds the array and every nested string/reference. Runtime semantic
validation additionally requires unique gate IDs, the canonical ordering, the
published priority for each ID, and a valid gate/reason-code pairing. This
prevents structurally valid but semantically forged gate traces from entering
the authoritative history.

Event revisions `1.0.0` and `1.1.0` remain readable. New writers emit `1.2.0`.
Mixed-version streams remain valid and continuous under the existing revision
and hash-chain rules. Configuration migration never rewrites historical event
bytes.

## 8. Configuration migration and compatibility

The adjacent `1.3.0 -> 1.4.0` project-configuration upgrade changes only:

- the configuration, state, and contract versions required for the new state
  family revision;
- the addition of `gateModes: {}`.

It preserves `policyMode`, language policy, managed state, model roles, project
profile, and all historical artifacts. Older configurations traverse the
existing declared upgrade chain and then this new adjacent step. Ordinary
operations classify `1.3.0` as migration-required once `1.4.0` is current.

Compatibility is defined behaviorally and canonically under the new decision
contract: resolving a legacy configuration that contains only `policyMode` and
resolving its migrated form with `gateModes: {}` produce byte-identical
canonical `GateDecision` values for equal gate facts. `standard` continues to
warn and `strict` continues to block. Failure ordering, primary selection,
reason codes, evidence, and criteria remain equal.

## 9. Approval binding

An approval challenge remains bound to the effective policy mode, but the mode
is selected for the gate the approval authorizes rather than from an
evaluation-wide value:

- approval target `spec` binds the `spec-approved` mode;
- approval target `final-acceptance` binds the `final-acceptance` mode;
- a legacy unmapped approval target binds the project default.

Changing the authorized gate's override invalidates the challenge. Changing an
unrelated gate, such as moving `gaps-closed` from shadow to enforce, does not
invalidate a specification approval. With an empty override map, the effective
mode string supplied to the existing challenge algorithm is exactly the same
as today, so existing approval challenge bytes remain valid after a compatible
configuration migration. No approval schema revision is required.

## 10. Event integrity, limits, and security

The event snapshot/redaction boundary explicitly copies only the new closed
gate-failure fields. It never copies a prompt, model response, exception,
environment value, credential, or arbitrary payload. Gate details and evidence
references retain bounded schema constraints, and the total failure count is
bounded by the closed gate catalogue.

Changing a recorded mode changes the canonical event bytes and therefore its
hash. Invalid ordering, priority, reason pairing, duplicate gate ID, unbounded
detail, or unsafe reference fails event validation. Existing event size, stream
size, count, sequence, and replay-determinism protections remain in force.

Fail-closed configuration behavior remains enforced in composition. The pure
resolver and evaluator receive no capabilities, and neither host gains policy
authority.

## 11. Test strategy

Implementation proceeds test-first in small slices.

### 11.1 Policy resolution and aggregation

- Table-test `standard` and `strict` defaults and every supported override.
- Assert that the resolver returns every `GateId`, does not mutate input, and
  returns immutable output.
- Table-test all nine ordered combinations of two failing gates across shadow,
  warn, and enforce and assert the aggregate outcome.
- Assert that a lower-priority enforced failure becomes primary ahead of a
  higher-priority shadow or warn failure.
- Assert that failures with equal outcomes retain the existing priority and
  gate-ID order.
- Use deterministic seeded generation plus relevant input permutations to prove
  aggregation is independent of collection order, following the repository's
  existing property-test style without a new dependency.

### 11.2 Evaluator and workflow

- Prove mixed shadow/enforce evaluation records both failures and blocks because
  of the enforced one.
- Prove shadow-only failures pass, warn failures warn, and enforce failures
  block without changing the underlying gate finding.
- Prove accepted shadow/warn transitions and rejected enforce transitions all
  persist the ordered failures and effective modes.
- Prove public primary rendering selects the failure that determined the
  outcome while retaining the complete failure trace.
- Preserve architecture tests that exclude filesystem, Git, clock, network,
  process, and host imports from the evaluator.

### 11.3 Contracts, history, and migration

- Validate positive and negative fixtures for project configuration 1.4.0 and
  event 1.2.0.
- Reject unknown overrides, invalid modes, duplicate event gate failures,
  incorrect priorities, invalid reason pairings, and non-canonical order.
- Verify mixed 1.0.0, 1.1.0, and 1.2.0 event streams and hash tamper detection.
- Migrate a 1.3.0 configuration to `gateModes: {}` while preserving every
  historical byte.
- Compare canonical decision bytes for the legacy and migrated policy
  resolutions under equal facts.
- Compare approval challenge bytes before and after an empty-override migration
  and prove that changing the authorized gate's override invalidates the
  challenge.
- Verify equivalent structured output for Codex and Claude Code host adapters.

Narrow tests run first. The final verification command is `npm run verify`.

## 12. Documentation and evidence

Implementation updates, in English:

- the gates, approvals, and evidence architecture note;
- project configuration and state migration guidance;
- contract-family versioning documentation;
- contract schemas, fixtures, generated declarations, and their catalogue;
- affected command, diagnostics, evidence-bundle, and dashboard descriptions.

Reproducible acceptance evidence is recorded in
`docs/verification/issue-143-per-gate-policy-modes-evidence.md`. It maps every
acceptance criterion to exact tests and commands, records narrow and full-suite
results, and states compatibility, persisted-state, security, and host-parity
impact. Pull-request text links issue #143 and lists the exact verification
commands.

## 13. Completion conditions

The change is complete only when all issue checkboxes are satisfied, narrow
tests and `npm run verify` pass, CI is green, public behavior and migration are
documented, all acceptance evidence is reproducible, and no placeholder remains
in source, tests, fixtures, prompts, errors, documentation, commit text, or
pull-request text.
