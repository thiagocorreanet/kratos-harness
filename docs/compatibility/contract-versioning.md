# Contract Family Versioning

Kratos versions installed plugin assets, persisted project state, and host
adapter messages independently. Publishing these schemas establishes the
fail-closed wire boundary; the runtime, migration, and adapter services consume
that boundary and implement the behavior described below.

## Authoritative artifacts

The closed
[`contract-families.v1.json`](../../packages/contracts/catalogs/contract-families.v1.json)
manifest owns compatibility policy. Its current format is checked by
[`contract-manifest.v1.9.schema.json`](../../schemas/contracts/contract-manifest.v1.9.schema.json);
the published predecessors
[`contract-manifest.v1.8.schema.json`](../../schemas/contracts/contract-manifest.v1.8.schema.json),
[`contract-manifest.v1.7.schema.json`](../../schemas/contracts/contract-manifest.v1.7.schema.json),
[`contract-manifest.v1.6.schema.json`](../../schemas/contracts/contract-manifest.v1.6.schema.json),
[`contract-manifest.v1.5.schema.json`](../../schemas/contracts/contract-manifest.v1.5.schema.json),
[`contract-manifest.v1.4.schema.json`](../../schemas/contracts/contract-manifest.v1.4.schema.json),
[`contract-manifest.v1.3.schema.json`](../../schemas/contracts/contract-manifest.v1.3.schema.json),
[`contract-manifest.v1.2.schema.json`](../../schemas/contracts/contract-manifest.v1.2.schema.json),
[`contract-manifest.v1.1.schema.json`](../../schemas/contracts/contract-manifest.v1.1.schema.json),
and the v1 schema remain byte-preserved.
The manifest registers every current payload schema, its generated type, and
the metadata-only Go v3 migration profiles.

| Identity | Current | Owner |
| --- | --- | --- |
| Contract-manifest schema | `v1.9` | Contract-family manifest format |
| `pluginVersion` | `0.0.0-development` | One coherent installed plugin bundle |
| `stateContract` | `1.4.0` | Persisted `.brain/` configuration and history |
| `hostContract` | `1.4.0` | Cross-process adapter request and response messages |

These identities are exact strings. They do not inherit the package version,
and the numeric `schema_version` field inside a legacy payload is not converted
to SemVer.

## Compatibility windows

Plugin assets support only the exact `pluginVersion` in the manifest. The
runtime, adapters, schemas, skills, and templates are one release unit. A mixed
installation must be replaced or rolled back as a complete bundle.

The state family's current global revision is `1.4.0`, and its readable window
contains `1.0.0` through `1.4.0`. This family identity is used for bundle
compatibility and negotiation; it is not a blanket write revision for every
payload. Each new payload uses the exact revision in `CONTRACT_VERSIONS`:

- Current `state.project-config` writes `1.4.0`. It keeps `policyMode` as the
  inherited default and requires the closed partial `gateModes` override map,
  in addition to the granular language policy from `1.2.0` and typed project
  profile from `1.3.0`.
- Current `state.event` writes `1.2.0` with the ordered effective-mode trace in
  `gateFailures`. Role-aware `state.migration` continues to write its registered
  `1.1.0` revision.
- `state.curated-memory`, `state.beat`, and `state.narration` write their
  additive registered `1.0.0` revisions.
- Unchanged state payloads `state.acceptance-criteria-snapshot`,
  `state.acceptance-verdict`, `state.approval`, `state.evidence`,
  `state.failure-candidate`, `state.feature`, `state.feature-scope`,
  `state.gap`, `state.gates`, `state.guardrails`, `state.lock`,
  `state.phase-measurement`, `state.requirement-discovery`, `state.run-usage`,
  `state.session-telemetry`, `state.snapshot`,
  `state.transaction-manifest`, and `state.transaction-progress` continue to
  write their registered `1.0.0` revision.

State `0.9.0` is a synthetic previous fixture and `go-v3@0.6.5` is the frozen
predecessor family; both are `migration-only`. Ordinary operations must not
treat them as current state or mutate them. An explicit migration planner owns
their inspection and recovery. A project configuration at `1.0.0`, `1.1.0`,
or `1.2.0` is readable only to that planner and returns
`profile.config_migration_required` before an ordinary operation can treat it
as current state. A `1.3.0` project configuration now receives the same refusal
until its adjacent `1.4.0` migration is applied.

The host family's current global revision is `1.4.0`, with `1.0.0` through
`1.4.0` accepted for their registered payloads. Exact writes again
follow `CONTRACT_VERSIONS`:

- Current `host.init-answers` writes `1.5.0` with optional partial
  `projectProfile` answers and an optional closed `gateModes` map. Its
  `hostContract` remains `1.4.0`. `host.adapter-message` continues to write
  its registered `1.1.0` revision.
- `host.doctor-report@1.0.0` is the structured read-only diagnostic payload;
  it carries the recorded gate failures and their effective modes.
- Memory-aware `host.phase-handoff`, `host.agent-output`,
  `host.memory-capture`, `host.memory-change`, and `host.memory-migration`
  write their registered `1.2.0` revisions.
- Unchanged host payloads `host.gap-proposal`,
  `host.hook-observation`, `host.operation-message`, `host.phase-lifecycle`, and
  `host.pre-tool-use`
  continue to write their registered `1.0.0` revision.

Model routing, memory-aware handoff/output, execution observation, and
initialization therefore select the exact registered payload revision, not a
forced revision change to unrelated contracts. Host `0.9.0`, unknown earlier
versions, and future versions require an adapter upgrade. Host compatibility
is not inferred from a shared major version. Per-gate state does not give a
host policy authority: it conveys an initialization map or renders the
runtime-resolved effective modes.

For all three families, classification happens before payload validation or
mutation. Missing, non-string, malformed, and untrimmed values are `invalid`.
Well-formed values outside the exact window are `unsupported`. A future value
never selects the nearest known schema. An older runtime that cannot support a
persisted current state revision refuses before mutation with
`contract.state_version_unsupported`; it does not downgrade or reinterpret the
state.

## Stable failures

The additive
[`reason-codes.v1.1.json`](../../packages/contracts/catalogs/reason-codes.v1.1.json)
catalog preserves all 76 entries from revision 1.0 and adds:

| Reason | Exit | Meaning |
| --- | --- | --- |
| `contract.plugin_version_invalid` | 2 | Plugin identity is absent or malformed |
| `contract.plugin_version_unsupported` | 2 | Plugin identity is outside the exact bundle version |
| `contract.host_version_invalid` | 2 | Host identity is absent or malformed |
| `contract.host_version_unsupported` | 2 | Host identity is outside the accepted window |
| `contract.state_version_invalid` | 4 | Persisted state identity cannot be trusted |
| `contract.state_version_unsupported` | 4 | Persisted state needs explicit migration or recovery |

The additive
[`reason-codes.v1.2.json`](../../packages/contracts/catalogs/reason-codes.v1.2.json)
catalog preserves all 82 entries from revision 1.1 and adds:

| Reason | Exit | Meaning |
| --- | --- | --- |
| `runtime.node_unsupported` | 2 | The interpreter running the plugin runtime is older than the supported minimum |

Revision `1.3.0` preserves those 83 entries and adds
[`runtime.orientation_ok`](../../packages/contracts/catalogs/reason-codes.v1.3.json)
for successful read-only orientation output. The
`runtime.node_unsupported` reason remains the one reason a caller can receive
before the runtime bundle has loaded at all, so the plugin entry point embeds
its summary and recovery text verbatim from the catalog. It is documented in
full by the [runtime distribution contract](runtime-distribution.md).

Revision `1.4.0` preserves those 84 entries and adds
[`gate.prd_untouched`](../../packages/contracts/catalogs/reason-codes.v1.4.json)
and `gate.prd_section_missing`. Both are additive, fail-closed gate outcomes;
the latter carries the missing canonical section name in the gate failure
detail.

Revision `1.5.0` preserves all 86 entries from `1.4.0` and appends eleven
fail-closed `gate.ac_*` reasons in
[`reason-codes.v1.5.json`](../../packages/contracts/catalogs/reason-codes.v1.5.json)
for identified acceptance criteria. State and host contract identities remain
`1.0.0`; the two new persisted payload schemas are additive, while `EventV1`
remains unchanged.

Revision `1.6.0` preserves all 97 entries from `1.5.0` and appends
[`guard.path_escape` and `guard.target_uninspectable`](../../packages/contracts/catalogs/reason-codes.v1.6.json).
They are blocked / exit 3 inspection failures for a structured pre-write
request. Existing write and scope reasons retain their published failure / exit
2 policy. `state.feature-scope@1.0.0` and `host.pre-tool-use@1.0.0` are
additive schemas, and the optional `writeBlocks` field keeps an existing
`state.guardrails@1.0.0` record valid. No state migration is required.

Revision `1.7.0` preserves those 99 entries and appends eight fail-closed model
role outcomes in
[`reason-codes.v1.7.json`](../../packages/contracts/catalogs/reason-codes.v1.7.json):

| Reason | Exit | Meaning |
| --- | ---: | --- |
| `model.role_missing` | 3 | The mapped role is absent for the active host |
| `model.host_missing` | 3 | The active host has no role map |
| `model.resolution_unavailable` | 3 | The catalog cannot produce one canonical model |
| `model.effort_unsupported` | 3 | The canonical model does not support the requested effort |
| `model.independence_violation` | 3 | Implementer and judge resolve to the same canonical model |
| `model.assignment_stale` | 3 | The digest-bound handoff no longer matches current state |
| `model.execution_mismatch` | 3 | Known host execution differs from the selected assignment |
| `model.config_migration_required` | 4 | The project configuration predates explicit role assignments |

Revision `1.8.0` preserves those 107 entries and appends two language policy outcomes in
[`reason-codes.v1.8.json`](../../packages/contracts/catalogs/reason-codes.v1.8.json):

| Reason | Exit | Meaning |
| --- | ---: | --- |
| `policy.language_incomplete` | 3 | A supplied language policy is incomplete and missing required fields |
| `policy.language_convention_mismatch_advisory` | 0 | The evaluated artifact language differs from the declared language policy |

Revision `1.9.0` preserves those 109 entries and appends
[`profile.config_migration_required`](../../packages/contracts/catalogs/reason-codes.v1.9.json),
the blocked / exit 4 refusal used when a project configuration predates the
typed project profile and requires explicit migration. The reason was
introduced for that pre-`1.3.0` profile boundary and is now the stable
ordinary-operation refusal for every pre-`1.4.0` project configuration,
including `1.3.0`, whose adjacent migration adds `gateModes: {}`.
`model.config_migration_required` remains published predecessor history rather
than the current migration diagnosis.

Revision `1.10.0` preserves those 110 entries and appends the phase-measurement
outcomes in
[`reason-codes.v1.10.json`](../../packages/contracts/catalogs/reason-codes.v1.10.json):

| Reason | Exit | Meaning |
| --- | ---: | --- |
| `metrics.phase_not_started` | 3 | No active assignment-bound measurement exists |
| `metrics.phase_assignment_conflict` | 3 | The open measurement has another assignment |
| `metrics.log_invalid` | 4 | The local measurement log is invalid |
| `metrics.refresh_ok` | 0 | The validated rollup was refreshed |
| `metrics.calibration_insufficient` | 0 | Calibration lacks completed samples |

Strict refusal replaces the earlier contradictory one-time-warning proposal by
owner decision. No warning receipt or warning state exists.

Revision `1.10.0` preserves every `1.9.0` entry and appends the curated-memory
outcomes below. `state.curated-memory@1.0.0`,
`host.memory-capture@1.2.0`, `host.memory-change@1.2.0`, and
`host.memory-migration@1.2.0` are additive. `host.phase-handoff@1.2.0` and
`host.agent-output@1.2.0` add a phase-constrained memory observation. Existing
schema and catalogue bytes remain unchanged; writers select the explicit
version rather than widening an old contract.

| Reason | Exit | Meaning |
| --- | ---: | --- |
| `memory.lesson_incomplete` | 2 | A promotion lacks required causal or application guidance |
| `memory.curation_required` | 3 | The active confirmed surface exceeds its readability limits |
| `memory.candidate_missing` | 2 | A requested local candidate no longer exists |
| `memory.projection_drift` | 4 | The committed ledger and Markdown projection disagree |
| `memory.confirmation_stale` | 3 | The preview values no longer authorize the requested apply |
| `memory.phase_context_stale` | 3 | A code/review acknowledgement differs from its handoff |
| `memory.migration_required` | 4 | Legacy Gotchas require explicit lossless adoption |

Revision `1.11.0` preserves every `1.10.0` entry and appends
`blocked.stop_loss_rejections`, the fail-closed outcome used when repeated
acceptance rejection reaches the run-frozen attempt ceiling.

Deterministic memory curation adds `state.failure-candidate@1.1.0`,
`state.curated-memory@1.1.0`, `host.memory-change@1.4.0`,
`host.memory-curation@1.4.0`, and `host.memory-migration@1.4.0`. All predecessor
schema bytes remain importable. The old ledger remains readable for phases and
explicit adjacent migration, while scoring fails closed with
`memory.migration_required` until observation metadata is supplied. Manual
`host.memory-change@1.2.0` merge and archive operations remain supported.

Every rejection renders through the
[universal result contract](result-contract.md), reports `stateChanged: false`,
and uses catalog-owned recovery text. Public output does not echo the supplied
version value.

## Current payload schemas

Current state schemas include project configuration, requirement discovery,
phase measurements, workflow facts, snapshots, events, approvals, evidence
metadata, feature scope, guardrails, lock leases, migrations, and transaction
records.
Host schemas cover adapter messages, phase-agent output, gap proposals,
initialization answers, operation delivery, and normalized pre-tool mutation
requests, plus phase handoff. All are JSON Schema 2020-12 documents with closed
objects and exact family identities.

The `1.1.0` additions are role-aware revisions of `state.project-config`,
`state.event`, `state.migration`, `host.init-answers`, `host.adapter-message`,
and `host.phase-handoff`. The `1.2.0` project-configuration and initialization
revisions add granular language policy. Their `1.3.0` revisions add the typed
project profile. `state.project-config@1.4.0` adds the required closed partial
`gateModes` map while `state.event@1.2.0` adds a required ordered
`gateFailures` trace containing each failure's effective mode.

A mixed event stream is valid: each line selects its exact registered schema
before the continuous revision and hash chain is verified. `state.event@1.0.0`,
`state.event@1.1.0`, and `state.event@1.2.0` may coexist without upgrading or
rewriting old bytes. Migration changes only `.brain/config.json` and its audit
bundle; it does not rewrite historical events, snapshots, documents,
approvals, or evidence.

The adjacent `1.3.0` to `1.4.0` configuration migration adds
`gateModes: {}` and advances only the configuration/state contract constants.
It preserves `policyMode`, language policy, managed state, model roles, project
profile, and all historical artifacts. For equal gate facts, resolving the old
global default and resolving the migrated empty override map produce
byte-identical canonical `GateDecision` values. `standard` remains warn,
`strict` remains enforce, and existing approval challenge bytes remain valid
because the authorized gate receives the same effective mode.

With non-empty overrides, every failure resolves independently: enforce maps to
block, warn to warn, and shadow to pass. Aggregation orders by outcome severity
(`block` before `warn` before `pass`), then the established priority and gate
ID; `primary` is the first failure and therefore comes from the deciding
outcome. Prompts and host adapters neither resolve these modes nor override the
runtime decision.

The memory contracts independently use their registered `1.0.0` and `1.2.0`
payload revisions; their addition does not rewrite existing configuration or
event history.

`state.requirement-discovery@1.0.0` is additive. Existing PRDs and state remain
readable, no migration rewrites them, and no approval or gate contract changes.
The embedded record is host neutral and carries no new I/O or trust authority.

`state.phase-measurement@1.0.0` is likewise additive. It records only bounded
phase identity, runtime-resolved assignment metadata, timestamps, and gross
token counts; existing state remains readable and no migration is required.
`host.phase-lifecycle@1.0.0` is a separate closed phase-start ingress carried
inside `host.operation-message@1.0.0`; the published hook-observation v1 schema
and its bytes remain unchanged.

The schemas constrain wire shape; runtime services own the corresponding
behavior. Event replay and chain verification are implemented by the
[`domain/events`](../../packages/runtime/src/domain/events/) modules and their
[`composition/events.ts`](../../packages/runtime/src/composition/events.ts)
wiring. Lock-time policy and lifecycle are implemented by
[`domain/locks`](../../packages/runtime/src/domain/locks/) and
[`composition/locks.ts`](../../packages/runtime/src/composition/locks.ts).
Migration planning, receipts, execution, and rollback are implemented by
[`domain/migration`](../../packages/runtime/src/domain/migration/) and
[`composition/migration.ts`](../../packages/runtime/src/composition/migration.ts).
Host negotiation and delivery are implemented by
[`domain/host`](../../packages/runtime/src/domain/host/) and
[`composition/host.ts`](../../packages/runtime/src/composition/host.ts).
Schema validation does not execute those behaviors; these runtime services do.

## Generated declarations

JSON Schema is canonical. The checked TypeScript declarations under
`packages/contracts/src/generated/` are produced with the pinned development
dependency `json-schema-to-typescript@15.0.4`.

Regenerate after an intentional schema change:

```bash
npm run contracts:generate
```

Verify schemas, manifest invariants, registration, and byte-for-byte type drift
without rewriting the checkout:

```bash
npm run contracts:check
```

The checker generates into a temporary directory and compares the result with
the committed declarations. Runtime packages do not depend on the generator.

## Go v3 and PRD protection

All 14 schema names discovered in the frozen Go v3 `v0.6.5` inventory are
registered as metadata-only migration profiles. The public manifest records
names, oracle identity, parity-row ownership, compatibility status, and the
numeric legacy schema version. It contains no predecessor field lists, schema
prose, prompts, templates, fixtures, source, or binaries.

The PRD payload has the migration identity `go-v3.prd-output@1`. Discovery and
migration must keep its inner payload byte-preserving; a current envelope may
identify the payload but may not rewrite its fields or meaning. Its frozen
schema digest is recorded only as compatibility metadata.

PRD behavior remains `migration-only`. The issue #13 differential harness now
tracks 12 planned PRD requirements for sufficient and insufficient context,
`needs_input`, blocking/deferred questions, 5 Whys, 5W2H, probable root cause,
invalid structured output, lineage drift, revision, and content-bound approval.
They deliberately contain no invented golden output and grant no parity. No
current manifest entry claims PRD parity before executable unit, differential,
integration, and E2E evidence exists.

## Evolution rules

Published versioned schemas, catalogs, fixtures, and generated declarations are
immutable. A breaking field change, reason-policy change, wider compatibility
window, different canonicalization rule, or changed PRD meaning requires a new
versioned artifact and explicit migration or differential evidence.
