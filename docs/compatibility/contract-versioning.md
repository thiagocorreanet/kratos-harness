# Contract Family Versioning

Kratos versions installed plugin assets, persisted project state, and host
adapter messages independently. Publishing these schemas establishes the
fail-closed wire boundary; the runtime, migration, and adapter services consume
that boundary and implement the behavior described below.

## Authoritative artifacts

The closed
[`contract-families.v1.json`](../../packages/contracts/catalogs/contract-families.v1.json)
manifest owns compatibility policy. Its current format is checked by
[`contract-manifest.v1.7.schema.json`](../../schemas/contracts/contract-manifest.v1.7.schema.json);
the published predecessors
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
| Contract-manifest schema | `v1.7` | Contract-family manifest format |
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

- Current `state.project-config` writes `1.4.0`, including the granular
  language policy introduced in `1.2.0` and the typed project profile
  introduced in `1.3.0`. Its optional `acceptanceAttemptCeiling` is a positive
  safe integer; omitted current values resolve to `3` only at runtime.
- `state.event@1.4.0` is the additive successor for the explicit legacy-policy
  upgrade boundary. Repair resolution and specification restart continue to
  write `state.event@1.3.0`; ordinary starts and acceptance decisions continue
  to write `state.event@1.2.0`.
- `state.repair-loop-stop@1.1.0` and `state.repair-resolution@1.1.0` reject
  whitespace-only diagnoses and human observations. Their `1.0.0`
  predecessors remain readable and byte-preserved.
- Role-aware `state.event` and `state.migration` payloads continue to write
  their registered `1.1.0` revisions.
- `state.curated-memory`, `state.beat`, and `state.narration` write their
  additive registered `1.0.0` revisions.
- Unchanged state payloads `state.acceptance-criteria-snapshot`,
  `state.acceptance-verdict`, `state.approval`, `state.evidence`,
  `state.failure-candidate`, `state.feature`, `state.feature-scope`,
  `state.gap`, `state.gates`, `state.guardrails`, `state.lock`,
  `state.requirement-discovery`, `state.run-usage`,
  `state.session-telemetry`, `state.snapshot`,
  `state.transaction-manifest`, and `state.transaction-progress` continue to
  write their registered `1.0.0` revision.

State `0.9.0` is a synthetic previous fixture and `go-v3@0.6.5` is the frozen
predecessor family; both are `migration-only`. Ordinary operations must not
treat them as current state or mutate them. An explicit migration planner owns
their inspection and recovery. A project configuration at `1.0.0`, `1.1.0`,
  `1.2.0`, or `1.3.0` is readable only to that planner and returns
`profile.config_migration_required` before an ordinary operation can treat it
as current state.

The host family's current global revision is also `1.4.0`, with `1.0.0`
through `1.4.0` accepted for their registered payloads. Exact writes again
follow `CONTRACT_VERSIONS`:

- Current `host.init-answers` writes `1.4.0` with optional partial
  `projectProfile` answers and set/clear/preserve support for
  `acceptanceAttemptCeiling`.
- Current `host.phase-handoff` and `host.agent-output` write their cumulative
  `1.3.0` revisions with memory binding and runtime-derived repair-loop
  context. Memory capture, change, and migration retain `1.2.0`.
- `host.adapter-message` continues to write its registered `1.1.0` revision.
- Unchanged host payloads `host.gap-proposal`,
  `host.hook-observation`, `host.operation-message`, and `host.pre-tool-use`
  continue to write their registered `1.0.0` revision.

Model routing, memory-aware handoff/output, execution observation, and
initialization therefore select the exact registered payload revision, not a
forced revision change to unrelated contracts. Host `0.9.0`, unknown earlier
versions, and future versions require an adapter upgrade. Host compatibility
is not inferred from a shared major version.

For all three families, classification happens before payload validation or
mutation. Missing, non-string, malformed, and untrimmed values are `invalid`.
Well-formed values outside the exact window are `unsupported`. A future value
never selects the nearest known schema.

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
typed project profile and requires explicit migration. It is the stable
ordinary-operation refusal for every pre-`1.3.0` project configuration;
`model.config_migration_required` remains published predecessor history rather
than the current migration diagnosis.

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
[`blocked.stop_loss_rejections`](../../packages/contracts/catalogs/reason-codes.v1.11.json),
the blocked / exit 3 gate outcome for one active repeated-rejection stop. The
gate may emit the same stable reason once per stopped criterion, in task-document
order, while token exhaustion remains `blocked.stop_loss_budget`.

The repeated-rejection reason is independent of the existing budget and flag
reasons. A gate can return all three from the same context. Repair resolution
releases only the repeated-rejection stop, while the confirmed budget-unlock
flow releases only the budget latch. No warning receipt or warning state exists.

Every rejection renders through the
[universal result contract](result-contract.md), reports `stateChanged: false`,
and uses catalog-owned recovery text. Public output does not echo the supplied
version value.

## Current payload schemas

Current state schemas include project configuration, requirement
discovery, workflow facts, snapshots, events, approvals, evidence metadata,
feature scope, guardrails, lock leases, migrations, and transaction records.
Host schemas cover adapter messages, phase-agent output, gap proposals,
initialization answers, operation delivery, and normalized pre-tool mutation
requests, plus phase handoff. All are JSON Schema 2020-12 documents with closed
objects and exact family identities.

The `1.1.0` additions are role-aware revisions of `state.project-config`,
`state.event`, `state.migration`, `host.init-answers`, `host.adapter-message`,
and `host.phase-handoff`. `host.agent-output@1.1.0` adds optional bounded fault
reports to rejected acceptance output, while `host.phase-handoff@1.2.0` carries
the runtime-derived attempt ceiling, ordered attempts, required fault IDs, and
active faults. The `1.2.0` project-configuration and initialization
revisions add granular language policy. Their `1.3.0` revisions add the typed
project profile. `state.project-config@1.4.0` and
`host.init-answers@1.4.0` add the optional acceptance attempt ceiling. The
explicit `1.3.0 -> 1.4.0` configuration migration preserves predecessor bytes;
the default is not serialized into an unset configuration.

`host.agent-output@1.3.0` and `host.phase-handoff@1.3.0` combine memory binding
with repair-loop context and require diagnoses to contain a non-whitespace
character. The runtime preserves the original non-blank text.
`state.repair-loop-stop@1.1.0` and `state.repair-resolution@1.1.0` apply the
same rule to persisted recovery evidence.

`state.event@1.2.0` records run-frozen limits and closed acceptance-decision
metadata. `state.repair-loop-stop@1.1.0` holds the complete bounded diagnosis,
while its event reference carries only the typed binding. `state.event@1.3.0`
adds digest-bound repair resolutions and specification restart references;
`state.repair-resolution@1.1.0` and `state.repair-restart@1.0.0` are additive
artifacts. `state.event@1.4.0` persists `run.policy_upgraded`, the only boundary
that freezes chosen limits for a legacy run before v2 continuation. Replay
never infers those limits. A mixed event stream is valid only with that explicit
boundary: each line selects its exact registered schema before the continuous
revision and hash chain is verified.
Migration changes only `.brain/config.json` and its audit bundle; it does not
rewrite historical events, snapshots, documents, approvals, or evidence.

`state.requirement-discovery@1.0.0` is additive. Existing PRDs and state remain
readable, no migration rewrites them, and no approval or gate contract changes.
The embedded record is host neutral and carries no new I/O or trust authority.

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
