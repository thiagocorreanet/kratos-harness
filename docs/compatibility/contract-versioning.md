# Contract Family Versioning

Kratos versions installed plugin assets, persisted project state, and host
adapter messages independently. Publishing these contracts does not make the
harness runtime usable: it establishes the fail-closed boundary that later
runtime, migration, and adapter work must consume.

## Authoritative artifacts

The closed
[`contract-families.v1.json`](../../packages/contracts/catalogs/contract-families.v1.json)
manifest owns compatibility policy. Its current format is checked by
[`contract-manifest.v1.2.schema.json`](../../schemas/contracts/contract-manifest.v1.2.schema.json);
the published
[`contract-manifest.v1.1.schema.json`](../../schemas/contracts/contract-manifest.v1.1.schema.json)
predecessor and v1 schema remain byte-preserved.
The manifest registers every current payload schema, its generated type, and
the metadata-only Go v3 migration profiles.

| Identity | Current | Owner |
| --- | --- | --- |
| `pluginVersion` | `0.0.0-development` | One coherent installed plugin bundle |
| `stateContract` | `1.0.0` | Persisted `.brain/` configuration and history |
| `hostContract` | `1.0.0` | Cross-process adapter request and response messages |

These identities are exact strings. They do not inherit the package version,
and the numeric `schema_version` field inside a legacy payload is not converted
to SemVer.

## Compatibility windows

Plugin assets support only the exact `pluginVersion` in the manifest. The
runtime, adapters, schemas, skills, and templates are one release unit. A mixed
installation must be replaced or rolled back as a complete bundle.

State contract `1.0.0` is readable and writable. State `0.9.0` is a synthetic
previous fixture and `go-v3@0.6.5` is the frozen predecessor family; both are
`migration-only`. Ordinary operations must not read them as current state or
mutate them. An explicit migration planner owns their inspection and recovery.

Host contract `1.0.0` is accepted. Host `0.9.0`, unknown earlier versions, and
future versions require an adapter upgrade. Host compatibility is not inferred
from a shared major version.

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

Every rejection renders through the
[universal result contract](result-contract.md), reports `stateChanged: false`,
and uses catalog-owned recovery text. Public output does not echo the supplied
version value.

## Current payload schemas

Seventeen persisted state schemas include project configuration, requirement
discovery, workflow facts, snapshots, events, approvals, evidence metadata,
feature scope, guardrails, lock leases, migrations, and transaction records.
Six host schemas cover adapter messages, phase-agent output, gap proposals,
initialization answers, operation delivery, and normalized pre-tool mutation
requests. All are JSON Schema 2020-12 documents with closed objects and exact
family identities.

`state.requirement-discovery@1.0.0` is additive. Existing PRDs and state remain
readable, no migration rewrites them, and no approval or gate contract changes.
The embedded record is host neutral and carries no new I/O or trust authority.

The schemas constrain wire shape; they do not implement event replay, lock time
evaluation, migration execution, or host transport. Those services remain
separate backlog work.

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
