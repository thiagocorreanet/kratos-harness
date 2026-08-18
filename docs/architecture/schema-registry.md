# Schema Registry and Validation Boundary

Issue [#19](https://github.com/thiagocorreanet/kratos-harness/issues/19)
(`RUN-04`) supplies the validation infrastructure for the deterministic runtime
epic [#15](https://github.com/thiagocorreanet/kratos-harness/issues/15). It does not
add a workflow or state command. The staged CLI still supports only `help`,
`version`, and `handshake`.

The registry is the one boundary through which unknown contract data becomes a
typed domain value. The inverse boundary validates a typed value again before
canonical serialization. Ajv and schema documents stay behind the domain
interface and are embedded in the runtime bundle.

## Closed contract catalog

Callers select one of eighteen identifiers. `ContractValues` maps each identifier
to the declaration generated from its committed schema; it is not an open
string registry.

| Contract identifier | Family | Current version | Generated TypeScript value |
| --- | --- | --- | --- |
| `host.adapter-message` | host | `1.0.0` | `AdapterMessageV1` |
| `host.agent-output` | host | `1.0.0` | `AgentOutputV1` |
| `host.gap-proposal` | host | `1.0.0` | `GapProposalV1` |
| `host.init-answers` | host | `1.0.0` | `InitAnswersV1` |
| `host.operation-message` | host | `1.0.0` | `HostOperationMessageV1` |
| `state.approval` | state | `1.0.0` | `ApprovalV1` |
| `state.event` | state | `1.0.0` | `EventV1` |
| `state.evidence` | state | `1.0.0` | `EvidenceV1` |
| `state.feature` | state | `1.0.0` | `FeatureStateV1` |
| `state.gap` | state | `1.0.0` | `GapRecordV1` |
| `state.gates` | state | `1.0.0` | `GateFactsV1` |
| `state.lock` | state | `1.0.0` | `LockLeaseV1` |
| `state.migration` | state | `1.0.0` | `MigrationV1` |
| `state.project-config` | state | `1.0.0` | `ProjectConfigV1` |
| `state.requirement-discovery` | state | `1.0.0` | `RequirementDiscoveryV1` |
| `state.snapshot` | state | `1.0.0` | `SnapshotV1` |
| `state.transaction-manifest` | state | `1.0.0` | `TransactionManifestV1` |
| `state.transaction-progress` | state | `1.0.0` | `TransactionProgressV1` |

In TypeScript, `ContractId` is exactly `keyof ContractValues`, and
`ContractValue<I>` selects `ContractValues[I]`. A successful validation result
therefore carries the type associated with the requested identifier. The
registry returns the original value by reference; it does not clone or mutate
it.

## Selection before validation

The registry processes a request in a fixed order:

1. resolve the closed contract identifier and its family;
2. classify the requested version with the published compatibility policy;
3. select the one embedded schema for that identifier and accepted version;
4. require inert JSON data without observing accessors or proxy traps;
5. validate the unknown value structurally;
6. return the typed value or normalized diagnostics.

Ajv never sees a payload whose version is invalid, unsupported, future, or
migration-only. Version failures use the existing compatibility reason and a
`version` keyword diagnostic. The state migration-only classification is not
accepted as a current registry schema; it is reported through the existing
unsupported-state policy.

Structural validation uses one caller-selected reason code from the existing
catalog:

| Reason code | Intended boundary |
| --- | --- |
| `guard.config_corrupt` | persisted project configuration |
| `runtime.state_corrupt` | persisted runtime state |
| `trail.uso` | invalid operation input |
| `trail.output_invalido` | invalid operation output |

This choice preserves the meaning of the boundary that found the malformed
value. The registry does not create a second reason policy and does not expose
Ajv's wording.

## Stable diagnostics

An invalid result contains only these fields:

| Field | Meaning |
| --- | --- |
| `contract` | one closed contract identifier |
| `version` | the syntactically valid requested version, or `null` |
| `pointer` | normalized JSON Pointer into the value |
| `keyword` | the structural keyword, or `version` |
| `reasonCode` | the selected existing policy code |
| `recovery` | recovery text from the committed reason catalog |

Required property names are escaped as JSON Pointer segments. Diagnostics are
deduplicated, then sorted by pointer and keyword; reason code and contract are
fixed inputs for one normalization request. Repeated validation is therefore
independent of Ajv traversal order.

Engine messages, schema paths, rejected values, property contents, absolute
paths, and JavaScript exception text never cross the boundary. Invalid user
data returns diagnostics; registry integrity failures throw the single
sanitized error `Embedded schema registry is invalid`.

## Embedded and offline initialization

The infrastructure imports the committed contract manifest, the eight catalog
schemas, and their shared result-schema dependency as build inputs. The catalog
is deeply frozen. Initialization checks its length and order against the
manifest, unique `(identifier, version)` keys, unique schema identifiers,
family, version, manifest path, expected schema identifier, and declared
contract version. It then compiles every entry in strict Ajv 2020 mode.

Duplicate or inconsistent entries, malformed schemas, unresolved references,
and compilation failures are programmer or package-integrity errors. The
packaged process compiles the catalog at startup, before dispatching an
orientation command, so a damaged catalog cannot masquerade as invalid project
state.

Composition constructs one production registry instance when its schema module
is evaluated. The same instance serves startup and project discovery: the entry
point evaluates the composition module for its integrity check, and discovery
reuses a cached configuration adapter built from that registry. Tests still
inject a registry into `configurationValidator` and `runCommandLine`, or a
validator into `discoverProject`; domain code never locates an ambient service.

The build embeds Ajv and every schema document in `kratos.core.mjs`. Runtime
validation does not scan a `schemas/` directory, open a checkout-relative
schema file, resolve an external module, or fetch a reference from the network.
Package verification and distribution tests copy only `manifest.json`,
`kratos.core.mjs`, and `kratos.mjs` outside the checkout and collectively exercise
all three current commands with module lookup influences cleared.

## Input and output boundaries

Unknown input is validated before domain use:

```text
external or persisted unknown value
  -> select contract and version
  -> reject non-inert data
  -> validate
  -> typed domain value
```

The inert-data guard recursively inspects own data descriptors rather than
reading property values. It accepts ordinary and null-prototype objects plus
dense ordinary arrays, while rejecting accessors, inherited or custom
prototypes, proxies, cycles, symbol keys, sparse arrays, and unsupported JSON
values. The runtime also compares `Object.prototype`, `Function.prototype`,
`Function.prototype.call`, and the Array intrinsic graph with a clean realm.
Pollution present before startup fails the launcher preflight; later pollution
rejects input without invoking a hostile getter or replacement intrinsic.

Typed output is not trusted merely because TypeScript accepted it. The
`prepareContract` helper crosses the same registry again and serializes only a
valid result:

```text
typed domain output
  -> revalidate
  -> canonical JSON
  -> future persistence, publication, hashing, or comparison boundary
```

If revalidation fails, the helper returns diagnostics and never invokes the
serializer. The existing `adapter-message@1.0.0` handshake crosses
`prepareContract` with the current host identity before any effect plan or
stdout write. Its canonical text is the published payload representation in
both invocation modes; an invalid adapter payload produces only the sanitized
internal failure and applies no effect. This issue deliberately does not add a
state writer, host effect, or publication command.

## Canonical JSON

`canonicalizeJson` is a pure domain function with no Node, filesystem, network,
or Ajv dependency. It enforces this supported JSON model:

- object keys are sorted lexicographically by Unicode code point and array
  order is preserved;
- strings use JSON escaping without locale-sensitive transformation;
- booleans and `null` use their JSON literals;
- finite numbers use the deterministic JSON number representation, with
  negative zero encoded as `0`;
- ordinary and null-prototype objects are supported;
- enumerable string-keyed object properties and array indices must be own data
  descriptors; accessor-backed members are rejected before a getter can run;
- symbol and non-enumerable properties remain outside the serialized JSON
  object and are ignored without being evaluated;
- unsupported enumerable properties and array members are rejected rather than
  omitted or converted to `null`;
- sparse arrays, non-finite numbers, `undefined`, `bigint`, functions, symbols,
  non-plain objects, and cycles are rejected;
- output has no insignificant whitespace or trailing newline.

Canonicalization does not establish contract membership. It runs only after
registry validation and supplies stable bytes for later persistence, hashing,
or comparison work.

## Project discovery adapter

Project discovery retains its narrow `ConfigurationValidator` seam. Production
composition adapts it to one fixed request for `state.project-config` at the
current state contract with the `guard.config_corrupt` structural policy. A
valid registry result becomes the existing validated-configuration result; any
invalid registry result becomes the existing sanitized invalid result.

JSON syntax and `stateContract` compatibility are still classified before this
adapter runs. Tests may inject the seam directly, while production defaults to
the cached adapter backed by the one embedded registry. See the
[project discovery contract](project-discovery.md) for the complete failure
order and root-selection behavior.

## Scope and compatibility

The registry performs no schema discovery, network access, payload coercion,
default insertion, property removal, cloning, or project mutation. It does not
implement event persistence, migrations, locks, host adapters, workflow state
commands, or their effects. Those later consumers must cross the input and
output boundaries described here when they are implemented.

This infrastructure adds no legacy differential or end-to-end evidence. Parity
remains exactly `0 / 400 (0.00%)`.

The 100% statement, branch, function, and line coverage gate includes the
complete `packages/runtime/src/infra/schema/**` implementation, in addition to
the domain and composition allowlist.
