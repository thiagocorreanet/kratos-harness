# Schema Registry and Validation Boundary Design

Issue [#19](https://github.com/thiagocorreanet/kratos-harness/issues/19)
(`RUN-04`). Epic
[#15](https://github.com/thiagocorreanet/kratos-harness/issues/15). Depends on
[#12](https://github.com/thiagocorreanet/kratos-harness/issues/12) (`CMP-04`) and
[#16](https://github.com/thiagocorreanet/kratos-harness/issues/16) (`RUN-01`).

## Problem

The repository already publishes a versioned contract manifest, JSON Schemas,
generated TypeScript declarations, and valid fixtures. Runtime consumers do not
yet share a validation boundary. Tests compile individual schemas directly,
project discovery accepts an injected provisional configuration validator, and
future state, adapter, persistence, and output paths would otherwise be free to
invent their own lookup, version, and diagnostic rules.

That duplication would make malformed state a domain input, allow schema
versions to be interpreted inconsistently, and expose unstable Ajv messages as
public behavior. It would also leave hashing and differential comparisons to
serialize logically equal values differently when object insertion order
changes.

## Goal

Provide one version-aware runtime registry for every current state and host
contract. The registry validates unknown input before domain use and validates
typed values again before persistence or publication. It returns stable,
JSON-Pointer-level diagnostics and uses a pure canonical JSON serializer for
hashing and comparisons.

The registry is self-contained: every schema is selected from the committed
manifest and embedded in the runtime bundle. Validation never reads a schema
from the project, searches the filesystem, or accesses the network.

## Non-goals

- Adding workflow commands or changing the CLI inventory.
- Implementing atomic writes, the event store, locks, Git classification, or
  dry-run policy. Issues `RUN-05` through `RUN-09` own those capabilities.
- Changing any published schema, generated declaration, compatibility window,
  reason policy, or legacy migration profile from `CMP-04`.
- Granting parity to any frozen Go v3 inventory row. This issue supplies runtime
  infrastructure but no legacy differential or end-to-end evidence.
- Loading arbitrary caller-provided schemas, supporting runtime plugin
  registration, or resolving remote JSON Schema references.
- Canonicalizing non-JSON JavaScript values such as `undefined`, `bigint`,
  functions, symbols, non-finite numbers, cyclic objects, or sparse arrays.

## Decisions

### D1: The domain owns the validation vocabulary, not the validator engine

The runtime domain exposes closed contract identities and inert result types:

```ts
type ContractId =
  | "host.adapter-message"
  | "state.approval"
  | "state.event"
  | "state.evidence"
  | "state.lock"
  | "state.migration"
  | "state.project-config"
  | "state.snapshot";

interface ContractRequest<I extends ContractId> {
  readonly id: I;
  readonly version: unknown;
  readonly value: unknown;
}

interface ValidationDiagnostic {
  readonly contract: ContractId;
  readonly version: string | null;
  readonly pointer: string;
  readonly keyword: string;
  readonly reasonCode: string;
  readonly recovery: string;
}

type ValidationResult<T> =
  | { readonly kind: "valid"; readonly value: T }
  | {
      readonly kind: "invalid";
      readonly diagnostics: readonly ValidationDiagnostic[];
    };

interface SchemaRegistry {
  validate<I extends ContractId>(
    request: ContractRequest<I>,
  ): ValidationResult<ContractValue<I>>;
}
```

`ContractValue<I>` maps each closed identifier to its generated TypeScript
declaration. Domain consumers depend only on these types. Ajv, compiled schema
functions, schema documents, and engine-specific errors remain in
`infra/schema`.

This follows the existing runtime layering: domain defines what validation
means, infrastructure supplies the implementation, and composition selects the
real implementation. A caller cannot receive a typed value without crossing
the registry boundary.

Rejected: putting Ajv-backed validators in `@mestre-yoda/contracts`. That
package is the host-neutral source of public types and compatibility constants;
making it execute a validation engine would couple every type consumer to
runtime machinery.

Rejected: exposing Ajv validators directly. Their error shape, ordering, and
message text are implementation details and are not a stable public contract.

### D2: One immutable embedded catalog is the source of runtime lookup

The implementation imports the committed contract manifest and exactly the
eight current state and host schemas listed by that manifest. Startup builds an
immutable index keyed by `(id, version)`. Every entry is checked for a unique
key, a matching manifest path and family, the expected version field, and a
schema identifier consistent with the catalog.

The index is constructed once in composition and reused. It performs no lazy
filesystem reads and no dynamic network access. Ajv is configured for the
repository's JSON Schema dialect, strict checking, complete error collection,
and deterministic format behavior. External reference loading is disabled;
every allowed reference must resolve from the embedded catalog during
initialization.

Registry initialization throws only for programmer or package-integrity errors:
duplicate keys, malformed embedded schemas, unresolved references, inconsistent
manifest metadata, or compilation failure. These are not invalid user payloads
and cannot be recovered by changing project state, so failing fast is safer than
returning a misleading validation result.

Rejected: discovering schemas by scanning `schemas/` at runtime. The shipped
plugin executes outside the checkout and its three-file distribution contract
forbids checkout-relative assets.

Rejected: build-generated standalone validators for this iteration. They can
reduce runtime engine size, but introduce a second generation pipeline and
additional drift surface before the registry behavior is settled. A later
optimization may replace the infrastructure implementation without changing
the domain interface or diagnostics.

### D3: Contract and version selection precede structural validation

Validation follows one order:

1. Require a known closed contract identifier.
2. Classify the requested version with the compatibility rules from `CMP-04`.
3. Resolve exactly one embedded schema for the identifier and accepted version.
4. Validate the unknown payload.
5. Normalize and sort diagnostics, or return the correspondingly typed value.

Unknown, future, unsupported, and migration-only versions are rejected before
Ajv sees the payload. The existing compatibility classifier and reason policies
remain authoritative; the registry does not widen compatibility or invent a
second version parser.

Every successful result carries the original value by reference. Validation
does not coerce types, add defaults, remove fields, mutate objects, or clone the
payload. Schema defaults are documentation only. A value either already
satisfies the contract or is rejected.

### D4: Diagnostics are stable, sanitized data

Invalid payloads return diagnostics rather than throw. Each diagnostic contains
only the requested contract, a valid requested version or `null`, normalized
JSON Pointer, validation keyword, a stable reason code, and recovery text
obtained from the committed reason policy.

Ajv messages, schema paths, rejected values, property contents, absolute paths,
and JavaScript exception text never cross the boundary. For keywords such as
`required` and `additionalProperties`, the missing or unexpected property is
represented by an escaped JSON Pointer segment rather than copied into prose.
If that segment cannot be represented safely, the diagnostic remains at the
nearest safe parent pointer.

Diagnostics are deduplicated and sorted by pointer, keyword, reason code, and
contract identity. Repeated validation of the same value therefore produces
deeply equal results across runs, independent of Ajv's traversal order.

Structural schema failures use the existing contract-corruption policies
appropriate to the requested boundary. Version-classification failures retain
the established compatibility reason. This issue does not add or modify a
reason-code catalog entry.

### D5: The project configuration seam becomes a registry adapter

`RUN-03` deliberately introduced `ConfigurationValidator` as a narrow temporary
seam. Production composition now adapts it to one registry request:

```ts
registry.validate({
  id: "state.project-config",
  version: CONTRACT_IDENTITIES.state,
  value,
});
```

The adapter maps a valid registry result to the existing
`ConfigurationValidator` success shape and any invalid result to its existing
sanitized invalid shape. Project discovery continues to classify JSON syntax
and `stateContract` compatibility before invoking this adapter, preserving the
failure order established by `RUN-03`.

Tests may still inject a deterministic `ConfigurationValidator` directly into
the pure discovery boundary. Production composition alone owns the Ajv-backed
adapter, so domain tests do not need the validation engine.

### D6: Boundary helpers make revalidation explicit

The registry provides validation only. Small composition helpers make the two
required directions visible:

```text
unknown external or persisted input
  -> validate
  -> typed domain value

typed domain output
  -> validate again
  -> canonical serialize
  -> persist, publish, hash, or compare
```

There is no unchecked `as ContractValue` escape in production composition.
Future persistence, event, and host-adapter issues must call the same registry
before domain entry and immediately before their effect boundary. Architecture
tests enforce that Ajv remains in infrastructure/composition and never enters
domain or ports.

This issue integrates the already existing project-configuration input path and
adds reusable output helpers. It does not invent state writers or adapter
commands merely to demonstrate revalidation; the owners of those effects will
consume the helpers in later issues.

### D7: Canonical JSON is pure, strict, and deterministic

`canonicalizeJson(value)` accepts only values representable by the supported
JSON data model and returns UTF-8-independent canonical JSON text:

- object keys are sorted lexicographically by Unicode code point;
- array order is preserved;
- strings use JSON escaping with no locale-sensitive transformation;
- booleans and `null` use their JSON literals;
- finite numbers use one deterministic ECMAScript JSON representation, with
  negative zero serialized as `0`;
- object properties with unsupported values are rejected rather than omitted;
- unsupported array members and sparse positions are rejected rather than
  converted to `null`;
- cyclic input is rejected with a sanitized error that contains no payload;
- the result has no insignificant whitespace and no trailing newline.

The function lives in the domain because it has no effects, runtime engine, or
Node dependency. It is used only after successful validation when a contract
value is being persisted, published, hashed, or compared. Canonicalization does
not replace schema validation: it proves stable representation, not contract
membership.

## Testing and Evidence

### Registry construction

- Compile every current manifest entry from the embedded catalog offline.
- Refuse duplicate identifiers, duplicate `(id, version)` keys, inconsistent
  versions, malformed schemas, and unresolved local references.
- Prove no runtime filesystem or network capability is present.

### Validation corpus

- Run every committed valid state and host fixture through the registry.
- For every contract, reject a missing version field, a future version, an
  unsupported version, an unexpected property, and a representative malformed
  field.
- Assert that successful values retain identity and that validation never
  coerces or mutates them.
- Assert exact stable diagnostics, JSON Pointer escaping, ordering,
  deduplication, reason policy, and absence of payload contents.

### Boundary integration

- Prove production project discovery uses the registry-backed configuration
  adapter while pure tests can still inject the seam.
- Prove output boundary helpers validate before canonical serialization and do
  not invoke serialization after a failed validation.
- Extend architecture tests so domain and ports cannot import Ajv, schema JSON,
  or infrastructure implementations.

### Canonical serialization

- Property-test idempotence: parsing canonical output and canonicalizing again
  returns identical text.
- Property-test key-order independence across generated nested objects.
- Cover Unicode, escaped strings, finite numeric edge cases, negative zero,
  nested arrays and objects, empty containers, and repeated runs.
- Reject non-finite numbers, `undefined`, `bigint`, functions, symbols, sparse
  arrays, unsupported object properties, and cyclic references.

### Repository verification

Run focused tests during each red-green-refactor cycle, then run
`npm run verify`. Preserve 100% statements, branches, functions, and lines.
Inspect the staged plugin to prove it has no external imports, schema files,
checkout-relative reads, or network dependency. Parity remains
`0 / 400 (0.00%)` until dedicated differential and end-to-end evidence exists.

## Delivery

The implementation is delivered in one pull request that closes issue #19. The
PR records the design choices, exact verification commands, observed TDD failure
evidence, package compatibility impact, and an independent review result. Only
after that PR is merged does work proceed to issue #20.
