# Universal Result Contract v1

The universal result contract is the public, host-neutral outcome envelope for
Mestre Yoda runtime operations. It gives humans, agents, adapters, and
automation the same deterministic answer: what happened, why it happened,
which evidence supports it, whether state changed, and how to recover.

This document specifies the contract before the workflow runtime consumes it.
Its presence does not make the current smoke bundle a usable SDD runtime.

## Authoritative artifacts

Version 1 is owned by four checked artifact families:

- [`result.v1.schema.json`](../../schemas/result.v1.schema.json) closes the
  result envelope;
- [`reason-catalog.v1.schema.json`](../../schemas/reason-catalog.v1.schema.json)
  closes reason policy entries;
- [`reason-codes.v1.json`](../../packages/contracts/catalogs/reason-codes.v1.json)
  preserves the immutable 76-reason revision 1.0 policy;
- [`reason-codes.v1.1.json`](../../packages/contracts/catalogs/reason-codes.v1.1.json)
  adds six contract-family compatibility reasons;
- [`reason-codes.v1.2.json`](../../packages/contracts/catalogs/reason-codes.v1.2.json)
  adds `runtime.node_unsupported`;
- [`reason-codes.v1.3.json`](../../packages/contracts/catalogs/reason-codes.v1.3.json)
  is the current revision and adds `runtime.orientation_ok`;
- [`fixtures/result-contract/v1`](../../fixtures/result-contract/v1) provides
  one canonical example for every exit class.

Run `npm run result:check` to validate the schemas, the frozen predecessor
inventory, the frozen revision-1.0 inventory of 76 reason entries, the six examples, canonical ordering, and
output-safety rules without network access.

## Result fields

Every result contains exactly these fields in this order:

| Field | Meaning |
| --- | --- |
| `contractVersion` | Immutable result-contract version; v1 is `1.0.0` |
| `status` | `success`, `failure`, or `blocked` |
| `exitCode` | Stable process category from 0 through 5 |
| `reasonCode` | Stable catalog key for the exact outcome |
| `summary` | Safe, single-line human explanation |
| `why` | Ordered, unique causal explanations |
| `evidence` | Ordered, unique references to supporting evidence |
| `stateChanged` | Whether the completed operation committed canonical state |
| `retryable` | Whether the catalog permits retry after its recovery action |
| `recovery` | Exact next action, or `null` only for success |

Unknown properties are rejected. Failure and blocked results require at least
one `why` entry. A successful result is never retryable and has no recovery
instruction.

## Exit and status policy

| Exit | Status | Meaning | Compatibility |
| --- | --- | --- | --- |
| 0 | `success` | The operation completed or produced a compatible non-blocking orientation or warning | Preserves predecessor success and warning behavior |
| 1 | `failure` | Input or stored-value validation failed | Preserves predecessor validation failure |
| 2 | `failure` | Usage, environment, or contract execution failed | Preserves predecessor usage and environment failure |
| 3 | `blocked` | A gate or policy refused the transition | Preserves predecessor gate and policy refusal |
| 4 | `blocked` | State integrity requires explicit recovery | TypeScript-only additive category |
| 5 | `blocked` | A lease, revision, or concurrency conflict exists | TypeScript-only additive category |

Exits 0 through 3 retain the Go v3 process categories. Exits 4 and 5 are new
runtime categories and must not be attributed to the predecessor.

The predecessor exposed several reason names only inside nested decision,
loop, guard, or completion payloads, so those names did not always have one
process exit across every caller. Version 1 preserves every name but establishes
one host-neutral result mapping for future operations. Blocking decision and
policy reasons map to exit 3; the explicitly non-blocking
`guard.external_path` and `guard.uninspectable` warnings retain exit 0. This is
the compatibility boundary that removes the predecessor ambiguity.
The public `brain_migration_pending` layout failure retains its observed exit 1
and directs callers to the explicit migration command.

## Reason catalog

Catalog revision 1.0 contains all 71 frozen Go v3 reason names unchanged plus
five TypeScript runtime reasons:

- `runtime.internal_failure`;
- `runtime.state_corrupt`;
- `runtime.recovery_required`;
- `runtime.lease_conflict`;
- `runtime.revision_conflict`.

Each reason entry owns its unique trigger description, status, exit code,
evidence policy, state-mutation allowance, retry policy, and recovery text.
Results must agree with their catalog entry. In particular, a blocked or failed
result cannot claim a state mutation, and a retryable result cannot invent a
different recovery procedure.

Catalog versioning is independent of package versioning. Published v1 reason
meaning cannot be silently reassigned. A breaking field, status, exit, or reason
semantic change requires a new contract version; additive package work may keep
using contract `1.0.0` when its existing meaning remains unchanged.

Catalog revision 1.1 preserves those 76 entries byte-for-byte and adds six
`contract.*_version_invalid` or `contract.*_version_unsupported` reasons for
the independently versioned plugin, state, and host families. Their exact
compatibility windows and recovery policy are documented in the
[contract versioning guide](contract-versioning.md).

Catalog revision 1.2 preserves those 82 entries byte-for-byte and adds
`runtime.node_unsupported`, reported when the interpreter running the plugin
runtime is older than the supported minimum. It is the only reason emitted
before the runtime bundle loads, so the plugin entry point embeds its text
verbatim; see the [runtime distribution contract](runtime-distribution.md).

Catalog revision 1.3 preserves those 83 entries byte-for-byte and adds
`runtime.orientation_ok`, reported when an operation publishes orientation
output such as usage text or a version identifier. No frozen reason described a
successful read-only operation: `trail.ok` requires evidence and represents a
committed mutation, so orientation output had no truthful reason to report.

## Evidence references

Evidence is referenced, never embedded:

| Field | Requirement |
| --- | --- |
| `kind` | `artifact`, `event`, `approval`, `test`, or `observation` |
| `ref` | Safe project-relative or stable logical reference |
| `sha256` | Optional 64-character lowercase digest |

Absolute Unix, Windows, and UNC paths; traversal; URLs; credentials; control
characters; private source; prompt or schema bodies; fixture payloads; binaries;
clone URLs; and customer data are not publishable evidence references. The
catalog says whether evidence is `required`, `optional`, or `forbidden` for each
reason.

## Rendering

JSON mode emits one compact, newline-terminated object on stdout in canonical
field order. It emits no human commentary around that object.

Human mode emits a successful summary only on stdout. Failure and blocked
results emit nothing on stdout and write labeled lines to stderr in this order:
summary, each `why`, reason, each evidence reference, state-change claim,
retry policy, and recovery. Semantic array order is preserved.

Both renderers validate before producing output. Stack traces, credential-like
text, private URLs, absolute local paths, control characters, inline evidence
content, unknown fields, and catalog contradictions are rejected rather than
redacted after partial output.

## Canonical examples

Successful state change:

```json
{
  "contractVersion": "1.0.0",
  "status": "success",
  "exitCode": 0,
  "reasonCode": "trail.ok",
  "summary": "The current specification was approved and advanced to implementation.",
  "why": [],
  "evidence": [
    {
      "kind": "event",
      "ref": ".brain/runs/0001-login/events.jsonl",
      "sha256": "1111111111111111111111111111111111111111111111111111111111111111"
    }
  ],
  "stateChanged": true,
  "retryable": false,
  "recovery": null
}
```

Blocked policy transition:

```json
{
  "contractVersion": "1.0.0",
  "status": "blocked",
  "exitCode": 3,
  "reasonCode": "trail.gate_divergente",
  "summary": "The supplied gate did not match the active pending gate.",
  "why": [
    "The approval targeted a gate other than the currently pending gate."
  ],
  "evidence": [
    {
      "kind": "approval",
      "ref": ".brain/runs/0001-login/approvals.jsonl",
      "sha256": "3333333333333333333333333333333333333333333333333333333333333333"
    }
  ],
  "stateChanged": false,
  "retryable": true,
  "recovery": "Reload the active pending gate and submit the decision for that exact gate."
}
```

The checked fixture directory is authoritative if prose and examples ever
diverge. The other four fixtures cover validation failure, contract failure,
integrity recovery, and concurrency conflict.
