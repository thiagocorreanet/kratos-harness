# Model Role per Phase Design

Date: 2026-08-28
Status: APPROVED
Issue: #136 (`FND-07`)
Approval source: the user's approved brainstorming design

## 1. Problem and outcome

The stable project configuration cannot state which model plans, implements,
or judges a run. The runtime therefore cannot prevent a judging phase from
using the implementation model, cannot fail closed when a role is absent, and
cannot prove after the fact which assignment it selected. Agent prompts cannot
provide this guarantee because prompts describe behavior but do not own policy.

Kratos will add host-specific model assignments for three runtime-owned roles:
`planner`, `implementer`, and `judge`. The runtime will bind every workflow
phase to one role, resolve the host-native model identity, enforce independence
before handoff and again before persistence, and record selected and observed
execution metadata separately.

This design deliberately chooses strict independence. A configuration whose
implementer and judge resolve to the same canonical model is invalid and
blocked. The issue's earlier one-time-warning requirement is superseded by this
approved strict refusal; no warning receipt or warning state is introduced.

## 2. Authority and host neutrality

The runtime owns all policy:

- the closed role set;
- the fixed phase-to-role mapping;
- required-role checks;
- canonical-identity comparison;
- stale-assignment and observed-execution checks;
- stable refusal reasons; and
- the event fields persisted for phase execution.

Host adapters own only host-native facts and transport:

- concrete default model assignments;
- alias-to-canonical-model resolution;
- supported effort identifiers for a model;
- observation of the model and effort actually used, when the host exposes
  them; and
- exact relay of the assignment selected by the runtime.

Adapters cannot remap phases, select another role, downgrade effort, advance
workflow state, or turn a failed resolution into a fallback. Prompts receive no
new policy. Model names, role names, or effort values written by an agent in
prose or in `host.agent-output` are untrusted and do not enter resolution or
event construction.

## 3. Configuration contract

The next project configuration revision adds `modelRoles`. It is keyed by the
existing project host identifiers, `claude` and `codex`. Every enabled host has
exactly the three closed role keys:

```json
{
  "modelRoles": {
    "claude": {
      "planner": "model-a",
      "implementer": {
        "model": "model-b",
        "effort": "high"
      },
      "judge": {
        "model": "model-c",
        "effort": "medium"
      }
    },
    "codex": {
      "planner": "model-d",
      "implementer": "model-e",
      "judge": "model-f"
    }
  }
}
```

A role assignment is either:

```text
ModelAssignment = ModelName | { model: ModelName, effort: EffortName }
```

`ModelName` and `EffortName` use the repository's bounded identifier grammar.
They remain host-native identifiers rather than a shared enum. The object is
closed. A bare model name normalizes to the object form with `effort: medium`,
so `"model-e"` and `{ "model": "model-e", "effort": "medium" }` have
identical resolved meaning.

The schema closes host and role keys. Semantic validation then requires every
enabled host to have all three roles and reports the missing host or role
without collapsing it into a generic corrupt-config error. Configuration does
not expose phase remapping. The non-empty `modelRoles` key set is the
authoritative enabled-host set, so configuration does not duplicate that fact
in a second field that could drift.

## 4. Fixed phase bindings

The runtime owns this immutable map:

| Workflow phase | Model role |
| --- | --- |
| `prd` | `planner` |
| `spec` | `planner` |
| `plan` | `planner` |
| `code` | `implementer` |
| `review` | `judge` |
| `acceptance` | `judge` |

The map is a pure domain constant used by handoff, phase-result recording, and
workflow transition composition. A caller supplies a phase observation, never
a role selection. There is no cross-role fallback when a mapped assignment is
missing or cannot be resolved.

## 5. Host model catalog and canonical resolution

The host boundary publishes a versioned, closed model-routing capability. It
contains concrete role defaults and enough host-native catalog data to resolve
an accepted model name to one canonical identity and to validate the requested
effort. The runtime snapshots and validates that data through the host contract
before using it.

Resolution receives the current host, phase, project configuration, and host
catalog. It returns either a failure or this immutable value:

```json
{
  "phase": "review",
  "role": "judge",
  "model": "canonical-judge-model",
  "effort": "high"
}
```

The configured alias is not the security identity. The runtime compares the
canonical implementer and judge identities for the same host using exact byte
equality. Equal identities fail with `model.independence_violation`, even when
the configured aliases differ. An unknown alias, ambiguous resolution, absent
canonical identity, or unsupported effort fails closed.

The adapter may evolve its catalog as models change without changing the
shared role contract. It may not map two configured names to falsely distinct
canonical identities when the host identifies them as the same model.

## 6. Handoff and assignment binding

`kratos handoff` remains read-only. In addition to its current phase and gate
orientation, it returns the resolved assignment and an `assignmentDigest` over
the canonical serialization of:

```text
configDigest + runId + revision + phase + host + role + model + effort
```

The host relays exactly that assignment when launching the phase agent and
returns the digest through the host protocol with the resulting phase output.
The digest is host metadata, not an agent-output field.

Before recording a phase result or transition, composition re-observes the
configuration and run, resolves the assignment again, and recomputes the
digest. A changed configuration, run, revision, phase, host, role, model, or
effort produces `model.assignment_stale` and no event. This prevents a handoff
resolved under one assignment from authorizing output under another.

If the host reports a canonical model or effort and either differs from the
resolved assignment, the runtime produces `model.execution_mismatch` and no
phase transition. Missing host observation does not authorize inference: it is
represented by `null` and preserved as unknown.

## 7. Event contract and provenance

The next phase-execution event revision separates selected policy from observed
execution:

```json
{
  "resolvedAssignment": {
    "phase": "review",
    "role": "judge",
    "model": "canonical-judge-model",
    "effort": "high"
  },
  "observedIdentity": {
    "host": "codex",
    "model": "canonical-judge-model",
    "effort": "high"
  }
}
```

When the host exposes neither execution value, the event records:

```json
{
  "observedIdentity": {
    "host": "codex",
    "model": null,
    "effort": null
  }
}
```

`resolvedAssignment` is constructed inside the runtime from validated project
configuration, phase state, and canonical host resolution. `observedIdentity`
is constructed only from a validated host message. Agent output cannot provide
or override either value.

The event schema permits `resolvedAssignment` only on phase-scoped events, and
domain policy requires it for phase-output recording and the transition based
on that output. Infrastructure events such as lease, recovery, and transaction
events do not fabricate a model role. Starting a run does not claim that the
first phase agent already executed.

Canonical hashing covers the new fields. Replay reducers consume the workflow
facts they already own and preserve the execution metadata in history without
letting it become a model-authored transition decision.

## 8. Stable refusals

The additive reason catalog introduces these failures:

| Reason code | Condition | Recovery direction |
| --- | --- | --- |
| `model.role_missing` | The current host lacks the phase's required role | Configure the named role for the named host |
| `model.host_missing` | The active host has no role configuration | Add that host's complete role map |
| `model.resolution_unavailable` | The adapter cannot produce one canonical model | Correct the model name or update the adapter catalog |
| `model.effort_unsupported` | The canonical model does not support the configured effort | Select a supported effort explicitly |
| `model.independence_violation` | Implementer and judge canonical identities are equal | Configure a distinct judging model |
| `model.assignment_stale` | The returned handoff digest no longer matches current state | Request a fresh handoff and rerun the phase |
| `model.execution_mismatch` | Known observed execution differs from the resolved assignment | Correct host routing and rerun the phase |
| `model.config_migration_required` | A pre-role project configuration is active | Preview and authorize the configuration migration |

Reason codes remain data-independent. Human and structured results name the
relevant host, role, or phase in bounded explanatory text. No invalid
caller-supplied model value is echoed into public output.

## 9. Initialization

The next initialization-answer revision accepts explicit per-host role
assignments. For an omitted host assignment, initialization requests concrete
defaults from that host's adapter catalog. The runtime normalizes bare names,
resolves every assignment canonically, applies `medium` only where effort was
omitted, and validates implementer/judge independence before planning any
write.

Initialization fails without effects when an enabled host lacks complete,
resolvable, and independent defaults. The success result lists the host/role
answers supplied by adapter defaults, following the existing rule that
defaults are disclosed rather than silently merged. The generated project
configuration contains the resulting explicit assignments, so later commands
do not depend on whatever defaults a newer adapter happens to publish.

The shared runtime contains no concrete Claude Code or Codex model name.

## 10. Contract evolution and mixed history

Published `1.0.0` schemas remain byte-identical. State `1.1.0` and host `1.1.0`
become the current family revisions. The compatibility manifest keeps `1.0.0`
readable so existing events, snapshots, approvals, evidence, and agent outputs
remain consumable. New schema registrations select their validator by the
payload's exact family revision rather than applying the current schema to old
bytes.

Project configuration is stricter than historical state: a `1.0.0`
configuration is readable by the migration planner but is not writable or
usable to execute a phase. Configuration classification returns
`model.config_migration_required`. Historical `1.0.0` events remain replayable.

After migration, an event stream may contain both revisions:

```text
state.event@1.0.0 -> state.event@1.0.0 -> state.event@1.1.0
```

Verification dispatches each record to its exact schema, then verifies one
continuous revision and hash chain. Migration never rewrites an old event or
hash. Unchanged state payloads may remain at readable `1.0.0` until an ordinary
runtime operation produces their current revision; compatibility is determined
per payload rather than by pretending all files changed at migration time.

Host adapters used for model routing must speak `1.1.0`. Read-only legacy host
payloads that need no routing may remain readable under the declared host
compatibility window, but a `1.0.0` adapter cannot hand off or record a phase.

## 11. Configuration migration and rollback

`kratos migrate config` previews the `1.0.0` to `1.1.0` configuration upgrade.
It accepts the same host and role answer shape as initialization. Adapter
defaults may fill omitted answers, but every applied value is rendered in the
preview.

The old configuration does not persist enabled hosts. Migration may report
`.claude` and `.codex` surfaces as observations, but it does not infer authority
from them. The migration answers explicitly confirm the enabled hosts.

Apply requires `--yes` authorization bound to the exact plan digest. One
managed transaction:

1. re-observes the source configuration and plan digest;
2. validates every normalized and canonical assignment;
3. stores the source digest and backup;
4. writes only `.brain/config.json`;
5. writes a completed migration receipt and verification evidence; and
6. preserves all event streams, snapshots, documents, approvals, and evidence.

The existing migration rollback surface restores the exact backed-up
configuration only when the receipt and backup digest verify. Preview and apply
are deterministic and idempotent. A current configuration returns unchanged;
an altered source or plan returns a revision conflict rather than replanning
silently.

## 12. Test and evidence strategy

Focused contract and domain tests will prove:

1. bare and object assignments validate and normalize identically;
2. object assignments reject extra keys and invalid identifiers;
3. all six phases resolve to the fixed role shown in this design;
4. a missing host or mapped role stops with an explanation naming it;
5. different aliases resolving to the same implementer/judge canonical model
   fail with `model.independence_violation`;
6. unknown, ambiguous, and unsupported-effort resolutions fail without
   fallback;
7. both adapters provide complete defaults whose canonical implementer and
   judge identities differ;
8. assignment digests change with configuration, revision, phase, host, role,
   model, or effort;
9. a stale digest or known observed mismatch prevents event append and state
   transition;
10. null host observation remains null rather than inheriting configured or
    agent-reported text;
11. the event writer obtains role, model, and effort from runtime resolution
    even when an agent fixture claims different values;
12. old and new events verify as one chain and replay to the expected state;
13. configuration migration preserves every non-configuration byte and has a
    verified rollback; and
14. Claude Code and Codex adapter conformance exercises the same runtime
    decisions and reason codes.

Schema fixtures cover accepted simple and object forms and closed shapes.
Domain fixtures cover equality after canonical resolution. Migration fixtures
begin with an actual `1.0.0` project configuration and non-empty run history.
Negative-path tests assert both the failure and the absence of writes.

Focused suites run before the repository-wide `npm run verify`. Reproducible
acceptance evidence is recorded in
`docs/verification/issue-136-model-role-evidence.md`, with exact commands and
one evidence row for every acceptance criterion.

## 13. Documentation and delivery

Public documentation updates cover project configuration, initialization,
host protocol, event provenance, event-store mixed-version verification,
migration and rollback, architecture, and troubleshooting. No prompt contains
the model independence rule because the runtime enforces it.

The pull request links #136 and states:

- compatibility impact: new state and host revisions with readable historical
  payloads and explicit configuration migration;
- state impact: one authorized configuration replacement, no event-history
  rewrite, and current-version writes thereafter;
- security impact: fail-closed role resolution, canonical independence checks,
  digest-bound handoff, and honest unknown observations;
- exact focused and full verification commands; and
- the evidence document mapping every acceptance criterion to tests and
  artifacts.

## 14. Out of scope

- Choosing concrete project model policy beyond adapter-supplied initialization
  defaults.
- Independent dual-judge orchestration from #65.
- Model-quality scoring, cost policy, token budgets, or automatic model
  upgrades.
- Configurable phase-to-role mappings.
- Inferring model identity from conversation text, prompts, or agent output.
- Retrofitting role metadata into historical events.
