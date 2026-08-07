# Contract Family Versioning Design

- Issue: [#12](https://github.com/thiagocorreanet/mestre-yoda/issues/12)
- Epic: [#8](https://github.com/thiagocorreanet/mestre-yoda/issues/8)
- Dependencies: [#10](https://github.com/thiagocorreanet/mestre-yoda/issues/10), [#11](https://github.com/thiagocorreanet/mestre-yoda/issues/11)
- Status: Approved for implementation under the maintainer's standing autonomous-approval instruction
- Date: 2026-08-07

## 1. Purpose and scope

Mestre Yoda needs independent compatibility identities for installed plugin
assets, persisted project state, and host-adapter messages. A package release
must not silently reinterpret `.brain/` data, and a host protocol revision must
not force a state migration.

This issue publishes the contract layer before the runtime consumes it. It
defines:

- `pluginVersion`, `stateContract`, and `hostContract` identities;
- one checked compatibility manifest and deterministic version classifier;
- closed schemas for configuration, snapshots, events, approvals, evidence,
  locks, migration records, and adapter messages;
- version fixtures for current, previous, future, malformed, and missing
  identifiers;
- schema-derived TypeScript declarations and an offline drift check;
- stable universal-result reasons for invalid or unsupported contract families;
- a clean-room compatibility boundary for all 14 frozen Go v3 schema names,
  with special protection for the PRD process.

It does not implement project discovery, schema-registry runtime loading,
transactions, event replay, leases, migration execution, or real host adapters.
Those remain owned by issues #18, #19, #21, #22, #35, and #41 through #43.

## 2. Source authority and provenance

The accepted architecture and ADRs own new TypeScript behavior. The frozen Go
v3 `v0.6.5` oracle owns legacy compatibility observations. The private oracle
has no MIT publication grant, so implementation must not copy predecessor
schema text, descriptions, fixtures, source, prompts, templates, or binaries.

Public compatibility work uses only:

- the approved hash-and-metadata oracle;
- the 14 public discovery keys and their parity rows;
- independently authored schemas, examples, prose, and tests;
- authorized private validation that reports only equality, mismatch category,
  and aggregate evidence.

The Go schemas remain migration inputs, not current TypeScript state contracts.
Their payloads keep their existing `schema_version` fields during discovery and
migration. A versioned outer migration or adapter envelope identifies the
legacy payload contract without changing its bytes.

## 3. Options considered

### 3.1 Copy predecessor schemas

This would maximize textual similarity but violate the established provenance
boundary. It is rejected even though the local predecessor is available to the
maintainer.

### 3.2 Publish only the eight requested shapes

This is small, but it leaves no authoritative compatibility registry, no
schema/type drift proof, and no safe account of legacy PRD and agent-output
payloads. It is rejected as incomplete.

### 3.3 Layered registry with clean-room legacy profiles — selected

JSON Schema remains the wire-shape source of truth. A manifest separates the
three version families and lists every current schema plus every frozen legacy
profile. Type declarations are generated from the schemas and checked into the
contracts package. Legacy payloads remain byte-preserving nested inputs to
versioned envelopes until differential migration work proves conversion.

This approach satisfies the issue without implementing later runtime services
ahead of schedule, and it protects the PRD process without publishing private
content.

## 4. Version identities

All identifiers are exact SemVer strings. Numeric `schema_version` values are
legacy payload fields and are never coerced into SemVer.

| Identity | Owner | Current value | Meaning |
| --- | --- | --- | --- |
| `pluginVersion` | Installed plugin manifest | `0.0.0-development` | Version-coherent runtime, schemas, adapters, skills, and templates |
| `stateContract` | Project `.brain/` payloads | `1.0.0` | Current persisted state and event family |
| `hostContract` | Adapter request/response envelopes | `1.0.0` | Host-neutral invocation and response protocol |

The checked compatibility manifest additionally versions its own format as
`contractVersion: 1.0.0` and records the current result contract and reason
catalog revision.

Version identity rules are exact and deterministic:

- a missing field is distinct from malformed SemVer;
- prerelease/build syntax is valid SemVer but supported only when explicitly
  listed;
- no numeric or whitespace coercion occurs;
- a future version never falls back to the nearest known schema;
- version classification completes before payload validation or mutation.

## 5. Compatibility windows

### 5.1 Plugin

Installed assets must have exactly the manifest's `pluginVersion`. Mixed plugin
assets are unsupported because the bundle, schemas, adapters, skills, and
templates form one release unit. Recovery is reinstalling or rolling back the
complete coherent plugin, never selecting individual files.

### 5.2 State

`stateContract: 1.0.0` is readable and writable. The frozen legacy
`go-v3@0.6.5` family is discoverable and migration-only: ordinary operations do
not load or mutate it. The synthetic previous-version fixture `0.9.0` models a
known predecessor that is readable only by the explicit migration planner; it
is not claimed as a released public TypeScript contract.

Unknown earlier versions, malformed or missing versions, and all future
versions fail closed before mutation. Forward state compatibility is never
assumed because unknown state semantics can invalidate history.

### 5.3 Host

`hostContract: 1.0.0` is accepted. The synthetic previous fixture `0.9.0` is
classified as upgrade-required and is not dispatched. Future host versions are
rejected until their exact schema and capability negotiation are published.
This conservative window prevents adapters from smuggling unknown fields into
the decision engine.

The later host-protocol issue may add compatible minor versions, but it must
update this manifest and fixtures rather than widening the rule in prose.

## 6. Contract manifest

`packages/contracts/catalogs/contract-families.v1.json` is the single registry
for compatibility policy. Its closed schema is
`schemas/contracts/contract-manifest.v1.schema.json`.

The manifest contains:

```json
{
  "contractVersion": "1.0.0",
  "pluginVersion": "0.0.0-development",
  "resultContract": "1.0.0",
  "reasonCatalog": "1.1.0",
  "stateContract": {
    "current": "1.0.0",
    "readable": ["1.0.0"],
    "migrationOnly": ["0.9.0", "go-v3@0.6.5"]
  },
  "hostContract": {
    "current": "1.0.0",
    "accepted": ["1.0.0"]
  },
  "schemas": [],
  "legacyProfiles": []
}
```

Each schema entry records a stable ID, family, version, repository-relative
path, persistence/cross-process classification, and generated type name. Each
legacy profile records one of the 14 frozen discovery names, its oracle ID,
numeric schema version where observed, migration-only status, and parity row.
It contains no private field lists or schema prose.

Manifest arrays are sorted and unique. Paths may reference only checked public
files beneath `schemas/` or generated declarations beneath
`packages/contracts/`.

## 7. Canonical schemas

All new schemas use JSON Schema 2020-12, stable HTTPS `$id` values, closed
objects, exact `contractVersion: 1.0.0`, safe bounded strings, and no implicit
defaults. State-family payloads require `stateContract: 1.0.0`; host messages
require `hostContract: 1.0.0`.

### 7.1 Project configuration

`schemas/state/project-config.v1.schema.json` contains the three version
identities, language/policy mode, and explicit managed-state settings. It does
not duplicate host wiring or runtime assets. Secrets and absolute paths are not
valid configuration values.

### 7.2 State snapshot

`schemas/state/snapshot.v1.schema.json` represents derived current state. It
binds project/run identity, lifecycle status, current step, event cursor and
hash, policy version, lineage digests, and timestamps. It cannot exist without
the event identity from which it was derived.

### 7.3 Event

`schemas/state/event.v1.schema.json` is one append-only hash-chain record. It
contains event ID/type/time, normalized operation, contract/policy versions,
prior and resulting state identities, reason code, effect summary, artifact and
evidence references, observed host/model identity, previous hash, and event
hash. It never embeds source, prompts, secrets, or raw evidence.

### 7.4 Approval

`schemas/state/approval.v1.schema.json` binds an explicit human decision to the
active gate, PRD/spec digests, policy version, approver observation, challenge,
and timestamp. Approval is content-bound; changing lineage makes the record
stale rather than silently updating it.

### 7.5 Evidence

`schemas/state/evidence.v1.schema.json` stores metadata and digests for an
authorized evidence item. Content is referenced through a safe project-relative
or logical reference. Classification and redaction status are explicit.

### 7.6 Lock lease

`schemas/state/lock.v1.schema.json` records resource, owner, lease ID, acquired
and expiry times, fencing token, and state revision. A fencing token is a
non-negative integer encoded without lossy coercion. The schema does not grant
authority after expiry; the later lock service owns time evaluation.

### 7.7 Migration receipt

`schemas/state/migration.v1.schema.json` records source contract/oracle,
destination contract, plan digest, authorization evidence, backup digest,
status, ordered conversions, verification evidence, rollback reference, and
timestamps. It represents a plan or receipt but performs no migration.

### 7.8 Adapter message

`schemas/host/adapter-message.v1.schema.json` defines request and response
envelopes with message ID, host, operation, capabilities, observed identity,
payload-contract identifier, safe payload/reference boundary, and correlation
ID. Responses carry the universal result. Adapters translate transport but do
not change result or policy semantics.

## 8. PRD and legacy schema compatibility

The 14 frozen schema names are all registered as migration-only profiles:

- `code-output.schema.json`;
- `config.schema.json`;
- `dashboard.schema.json`;
- `eval-output.schema.json`;
- `feature-state.schema.json`;
- `guardrails.schema.json`;
- `partition-proposal.schema.json`;
- `prd-output.schema.json`;
- `review-output.schema.json`;
- `run-gaps.schema.json`;
- `run-plan.schema.json`;
- `run-state.schema.json`;
- `scope.schema.json`;
- `spec-output.schema.json`.

The PRD profile is mandatory P0 behavior. Its payload remains byte-preserving
during discovery and declares numeric `schema_version: 1` internally. A current
adapter or migration envelope identifies it as
`go-v3.prd-output@1`. No wrapper changes the inner fields or their meaning.

Differential fixtures in issue #13 must cover the already approved PRD cases:

- sufficient context and completed PRD;
- insufficient context and blocking questions;
- 5 Whys applied or explicitly skipped with a reason;
- 5W2H applied or explicitly skipped with a reason;
- root cause, validated problem, solution hypothesis, success metric, and risks;
- deferred open questions;
- invalid structured output;
- lineage drift, specification revision, and content-bound approval.

Until those fixtures pass against the private oracle, the manifest reports the
PRD profile as `migration-only`, never `parity`. This issue protects the exact
process boundary without falsely claiming behavioral completion.

## 9. Unsupported-version results

Six additive reason codes extend reason catalog revision `1.1.0`:

- `contract.plugin_version_invalid` — exit 2;
- `contract.plugin_version_unsupported` — exit 2;
- `contract.host_version_invalid` — exit 2;
- `contract.host_version_unsupported` — exit 2;
- `contract.state_version_invalid` — exit 4;
- `contract.state_version_unsupported` — exit 4.

Invalid covers missing, non-string, malformed, and untrimmed identifiers.
Unsupported covers well-formed versions outside the exact manifest window.
Every outcome has `stateChanged: false`, no sensitive input echo, and one
family-specific recovery. State-contract failures use recovery exit 4 because
they require explicit inspection or migration; plugin/host negotiation failures
use contract exit 2.

The existing 76-entry reason catalog remains preserved as revision `1.0.0`.
Revision `1.1.0` is a new immutable file containing the six additive codes. The
compatibility manifest selects the current revision; old files and digests are
not overwritten.

## 10. Type generation and drift prevention

JSON Schema is canonical. The development-only
`json-schema-to-typescript@15.0.4` generator emits declarations under
`packages/contracts/src/generated/`. Generated files carry a source schema ID
and digest header and are exported by `@mestre-yoda/contracts`.

`npm run contracts:generate` writes deterministic output. Public verification
runs the generator in a temporary directory and compares byte-for-byte with the
committed declarations; it never rewrites a contributor's checkout. Any schema
change without regenerated types, any manual type edit, an unregistered schema,
or a digest mismatch fails `npm run contracts:check`.

The generator is absent from the runtime bundle. Generated declarations contain
types only and cannot create runtime behavior.

## 11. Version classifier and data flow

The offline compatibility library accepts a family plus an unknown identifier:

1. check presence and primitive type;
2. validate exact SemVer syntax without coercion;
3. load only the checked compatibility manifest;
4. classify as `current`, `migration_required`, `invalid`, or `unsupported`;
5. return the stable family-specific reason and recovery for non-current input;
6. select a payload schema only for `current`;
7. validate/round-trip without mutation.

No caller-supplied path, version value, payload, stack trace, or secret appears
in normal errors. Classification is pure and offline.

## 12. Fixtures and tests

`fixtures/contracts/v1/` contains independently authored examples for all eight
payload schemas plus a table of version-classification cases:

- current `1.0.0`;
- synthetic previous `0.9.0`;
- future `2.0.0`;
- malformed `1.x`;
- missing version.

Tests prove:

- all schemas compile in strict Ajv 2020 mode;
- the manifest is closed, sorted, unique, path-safe, and complete;
- every state/cross-process fixture declares the correct family version;
- all current fixtures validate and survive JSON round-trip unchanged;
- previous/future/malformed/missing versions fail before any mutation claim;
- the exact stable reason, exit, retry, and recovery policy matches catalog
  revision `1.1.0`;
- unknown fields and contradictory nested data fail;
- generated declarations match schemas byte-for-byte;
- all 14 frozen legacy names and parity rows are present once;
- the PRD profile is `migration-only` and tied to the frozen PRD schema digest,
  without publishing private content.

Private maintainer verification may compare the clean-room classification and
PRD profile against `v0.6.5`, but public CI remains offline and needs no private
repository.

## 13. Documentation and compatibility guarantees

The public guide will explain family ownership, support windows, unsupported
version recovery, manifest evolution, generated types, legacy migration-only
profiles, and the PRD parity gate. README status remains honest: these are
contracts and verification infrastructure, not a usable runtime.

Breaking a schema field, changing a reason/exit, widening a compatibility
window, changing canonicalization, or changing PRD meaning requires a new
versioned artifact and explicit migration/differential evidence. Existing
versioned schemas, catalogs, fixtures, and generated declarations are immutable.

## 14. Completion evidence

Implementation is complete only when:

- all issue deliverables and acceptance criteria have executable tests;
- every new schema and fixture is registered and checked;
- the six unsupported-version reasons render through the universal contract;
- schema/type generation is reproducible offline after `npm ci`;
- PRD compatibility remains explicitly migration-only pending issue #13;
- focused and full repository verification pass;
- independent review has no unresolved Critical or Important findings;
- the PR documents provenance and compatibility impact and closes issue #12.
