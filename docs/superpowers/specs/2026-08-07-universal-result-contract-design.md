# Universal Result, Reason, and Exit Contract Design

<!-- cspell:words divergente -->

- Status: Approved
- Decision date: 2026-08-07
- Tracking issue: [#11](https://github.com/thiagocorreanet/kratos-harness/issues/11)
- Parent epic: [#8](https://github.com/thiagocorreanet/kratos-harness/issues/8)
- Depends on: [Go v3 oracle](../../compatibility/go-v3-v0.6.5-baseline.md) and [parity inventory](../../compatibility/parity-inventory.md)
- Approval basis: maintainer-authorized autonomous recommendation

## 1. Purpose

Every runtime operation must produce one host-neutral, machine-valid result.
Humans need a concise explanation; agents and adapters need stable status, exit,
reason, evidence, mutation, retry, and recovery semantics. The result must never
require parsing localized prose to decide what happened.

This issue specifies the public contract and validates examples. It does not
implement the future state machine, host adapters, persistence, or localized
message catalog.

## 2. Source authority and compatibility

The frozen Go v3 `v0.6.5` behavior remains the compatibility baseline. Its 71
closed reason strings and process exits 0 through 3 keep their exact spelling
and meaning. The target contract wraps those outcomes without copying private
source or changing the PRD process.

The issue explicitly adds exit 4 for corruption/recovery and exit 5 for
concurrency/conflict. They are additive TypeScript-era categories, not claims
that the Go binary emitted them. Legacy operations retain their observed exit
mapping. New runtime-only reason codes use 4 or 5 when the future architecture
detects event/snapshot corruption, an unfinished transaction requiring explicit
recovery, a fenced-lease conflict, or a concurrent state revision.

When authorities disagree, accepted ADRs and this versioned contract take
precedence, followed by the approved architecture, parity matrix, and private
oracle observations.

## 3. Options considered

| Approach | Strength | Limitation | Decision |
| --- | --- | --- | --- |
| One schema containing every reason definition | One file to load | Duplicates catalog metadata inside schema conditionals and is difficult to review | Rejected |
| TypeScript types as source with generated JSON Schema | Strong future implementation ergonomics | Introduces a generator and runtime API before the runtime exists | Rejected |
| Layered schema, reason catalog, examples, and offline verifier | Separates shape from policy, is consumable without TypeScript, preserves a reviewable reason ledger | Requires coordinated files and cross-validation | Selected |

The layered contract is intentionally data-first. Later runtime types may be
generated from or checked against it, but cannot silently become a second
authority.

## 4. Public files

```text
schemas/
├── result.v1.schema.json
└── reason-catalog.v1.schema.json
packages/contracts/
└── catalogs/
    └── reason-codes.v1.json
fixtures/result-contract/v1/
├── exit-0-success.json
├── exit-1-validation.json
├── exit-2-contract.json
├── exit-3-policy.json
├── exit-4-recovery.json
└── exit-5-conflict.json
scripts/
├── check-result-contract.mjs
└── lib/result-contract.mjs
tests/
├── result-contract-schema.test.ts
├── result-contract-catalog.test.ts
└── result-contract-rendering.test.ts
docs/compatibility/
└── result-contract.md
```

Both schemas use JSON Schema draft 2020-12 and immutable HTTPS `$id` values.
The result carries `contractVersion: "1.0.0"`. Catalog schema and catalog data
carry the same semantic version.

## 5. Canonical result

Every result is a closed object with exactly these fields:

| Field | Contract |
| --- | --- |
| `contractVersion` | Exact semantic contract version, initially `1.0.0` |
| `status` | `success`, `failure`, or `blocked` |
| `exitCode` | Integer 0 through 5 with the fixed category in Section 6 |
| `reasonCode` | Stable catalog key; never localized and never free-form |
| `summary` | Safe single-line human explanation; localization may change it |
| `why` | Ordered safe explanation lines, with no duplicate entries |
| `evidence` | Ordered references only; no embedded artifact, prompt, stdout, or secret payload |
| `stateChanged` | Whether canonical project state committed before the result |
| `retryable` | Whether repeating after the named recovery can be valid |
| `recovery` | Safe actionable text for non-success; `null` for success |

An evidence reference is also closed:

```json
{
  "kind": "artifact",
  "ref": ".brain/02-features/login/00-prd.md",
  "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
}
```

`kind` is one of `artifact`, `event`, `approval`, `test`, or `observation`.
`ref` is a repository-relative logical reference or a stable public identifier;
absolute paths, traversal, credentials, private URLs, control characters, and
inline content are rejected. `sha256` is optional only when the evidence class
has no content artifact. Evidence order is semantic and must be deterministic.

Schema conditionals and catalog cross-validation enforce:

- exit 0 => `status: success`, `stateChanged` may be true or false,
  `retryable: false`, `recovery: null`;
- exits 1 or 2 => `status: failure`, nonempty `why`, non-null recovery;
- exits 3, 4, or 5 => `status: blocked`, nonempty `why`, non-null recovery;
- `reasonCode` must exist in the catalog and declare the same exit, status,
  evidence requirement, retry policy, and state-change allowance.

Schema validates shape; the offline verifier enforces catalog membership,
cross-field catalog policy, safety, ordering, and uniqueness.

## 6. Exit categories

| Exit | Status | Meaning | Default retry semantics |
| ---: | --- | --- | --- |
| 0 | `success` | Requested operation completed or produced an intentional compatible no-op/orientation result | Not retryable; no recovery |
| 1 | `failure` | User/project data failed validation while the invocation contract itself was understood | Retryable only after correcting named input/evidence |
| 2 | `failure` | Usage, environment, adapter, or contract failure prevented a valid operation | Catalog-specific; never blind retry |
| 3 | `blocked` | A deterministic gate or policy refused advancement | Retryable only after the named gate/evidence/policy recovery |
| 4 | `blocked` | Integrity corruption or an incomplete transaction requires explicit audit/recovery | Never automatic; retryable only after verified recovery |
| 5 | `blocked` | Lease, fencing, revision, or concurrent-writer conflict prevented a safe commit | Retryable after reloading state or waiting for the valid lease |

Process exit and JSON `exitCode` are identical. Adapters may translate transport
envelopes but may not reinterpret the category. The same logical outcome must
use the same reason and exit across CLI, Claude Code, Codex, and future hosts.

The predecessor's `guard.external_path` warning and `guard.uninspectable`
notice remain intentional non-blocking exit 0 outcomes. Other guard refusal or
layout reasons retain exit 2.

Some frozen reason names appeared only in nested predecessor decisions and did
not own a universal process exit. The v1 catalog keeps those names but assigns
one result exit across commands and hosts: blocking decision and policy reasons
use exit 3. This normalization is explicit rather than a claim that every old
nested reason already had that process behavior.

## 7. Reason catalog

The catalog is a closed, sorted array. Each entry contains:

```json
{
  "code": "trail.gate_divergente",
  "description": "The supplied gate does not equal the active pending gate.",
  "status": "blocked",
  "exitCode": 3,
  "evidence": "required",
  "stateChanged": false,
  "retryable": true,
  "recovery": "Reload status and repeat the decision with the exact pending gate."
}
```

`evidence` is `required`, `optional`, or `forbidden`. `recovery` is `null` for
exit-0 reasons and a nonempty instruction for every other reason.
`stateChanged` is a
boolean maximum: `false` forbids claiming mutation; `true` allows it only when
the concrete operation actually committed state. Codes are lowercase ASCII
tokens separated by dots/underscores and are never renamed or reused.

The first catalog contains all 71 frozen codes from the parity inventory plus
five original universal-runtime codes:

- `runtime.internal_failure` (2): sanitized unexpected failure;
- `runtime.state_corrupt` (4): snapshot/event integrity failed;
- `runtime.recovery_required` (4): durable transaction recovery is pending;
- `runtime.lease_conflict` (5): another valid fenced lease owns mutation;
- `runtime.revision_conflict` (5): state changed since the decision input.

Every entry has a condition-specific description, evidence policy, retry rule,
and, when non-successful, recovery instruction. Group templates may aid
authoring but cannot replace entry-specific meaning.

## 8. Human and JSON rendering

JSON mode emits exactly one canonical compact JSON object plus `\n` on stdout
for every logical outcome, including failures. Stderr remains empty unless the
runtime cannot construct or serialize a valid universal result. Human mode
prints success summaries to stdout. It prints failure/blocked summary, ordered
`why`, reason code, evidence references, and recovery to stderr. Human rendering
never changes exit, reason, retry, evidence, or mutation semantics.

Ordering is fixed: summary, why entries, reason code, evidence entries,
state-change statement, retry statement, recovery. JSON object property order
is the canonical field order in Section 5; evidence object order is `kind`,
`ref`, `sha256`.

Normal output never includes stack traces, exception names, environment dumps,
tokens, credentials, private clone URLs, absolute paths, or raw user/agent
payloads. Unknown exceptions map to `runtime.internal_failure`; their diagnostic
details belong only in a separately authorized redacted diagnostic bundle.

## 9. Versioning and backward compatibility

Within major version 1:

- existing required fields, status values, exit meanings, reason codes, and
  catalog semantics cannot change;
- a new reason code is additive only when older consumers can treat the result
  as an unknown v1 reason without unsafe recovery; emitters do not use it until
  their declared catalog version includes it;
- new optional fields require a minor version and must be ignored by consumers,
  but v1 emitters continue producing the closed `1.0.0` shape until a successor
  schema explicitly permits them;
- removing/renaming fields or codes, changing an exit mapping, loosening
  redaction, or changing mutation/retry semantics requires a new major version,
  migration guidance, differential evidence, and maintainer approval.

The checked catalog digest is recorded by tests so accidental mutation fails.
The catalog version is not inferred from the package version.

## 10. Validation and tests

The offline checker loads both schemas with Ajv in strict mode, validates the
catalog, validates every example, and applies cross-file invariants:

1. all 71 parity reason keys occur exactly once;
2. all five runtime-only codes occur exactly once;
3. codes and catalog entries are sorted and unique;
4. result reason/exit/status/retry/state/evidence claims obey the catalog;
5. examples cover each exit 0 through 5 exactly once;
6. unsafe metadata, duplicate why/evidence, unknown properties, invalid
   digests, and false state/retry claims fail;
7. exact canonical JSON and human rendering assertions are deterministic and
   safe.

Tests start RED for absent schemas/catalog/checker, then exercise representative
success, validation, usage/contract, gate/policy, recovery, and conflict
outcomes. Mutation tests replace a reason exit, omit a legacy code, inject a
stack trace/private path/credential, claim state mutation against a forbidding
reason, and mismatch JSON/process exit; each mutation fails.

`npm run result:check` becomes part of `npm run verify` before the build.

## 11. Documentation and publication boundary

The compatibility guide publishes field definitions, all six exit categories,
rendering/redaction rules, catalog lifecycle, example commands, and the
difference between legacy exits and additive runtime-only exits. README links
the final contract and replaces its illustrative uppercase reason with a real
cataloged example.

All schemas, catalog descriptions, examples, verifier code, and prose are
original public work. The Go predecessor contributes only stable reason names
and observed categories already authorized as compatibility metadata. No
private implementation, schema body, prompt, fixture payload, binary, path, or
credential is published.

## 12. Autonomous approval decision

The maintainer explicitly authorized autonomous progress using the recommended
choice without another approval prompt. The selected layered design minimizes
premature runtime code, preserves the frozen PRD/result boundary, and provides
machine evidence for every acceptance criterion. This written specification is
therefore approved for implementation planning after self-review.
