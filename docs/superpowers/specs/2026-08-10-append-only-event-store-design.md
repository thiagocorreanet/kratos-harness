# Append-Only Event Store and Hash Chain Design

Issue [#21](https://github.com/thiagocorreanet/mestre-yoda/issues/21)
(`RUN-06`). Epic
[#15](https://github.com/thiagocorreanet/mestre-yoda/issues/15). Depends on
[#19](https://github.com/thiagocorreanet/mestre-yoda/issues/19) (`RUN-04`) and
[#20](https://github.com/thiagocorreanet/mestre-yoda/issues/20) (`RUN-05`).

## Problem

The runtime has a version-aware schema registry, canonical JSON, injected
SHA-256 digests, and recoverable multi-file transactions. It still refuses the
`append_event` effect because no component owns event construction, chain
verification, replay, or the atomic relationship between accepted history and
derived state.

The event stream must become the authoritative history without creating a
second mutation protocol. A caller must not be able to insert, replace,
reorder, or truncate accepted events; derive a snapshot from unverified input;
or commit an event while leaving its materialized state at another cursor.

The existing state schemas and compatibility window are already published and
immutable. This issue must implement their semantics without changing
`stateContract: 1.0.0`, widening its exact compatibility window, or inventing a
parallel event envelope.

## Goals

- Seal `EventV1` records with canonical SHA-256 hashes linked to the preceding
  accepted record.
- Parse and verify canonical JSON Lines streams before domain use.
- Detect gaps, duplicated or reordered revisions, truncation, mutation,
  unsupported contracts, malformed records, and snapshot drift.
- Replay verified records through pure reducers so equal seed, stream, and
  reducer version produce equal materialized state.
- Commit one exact-prefix event append and its derived `SnapshotV1` through the
  existing recoverable transaction boundary.
- Exclude source content, prompt text, secrets, absolute paths, and unbounded
  payloads from the event store by construction.
- Expose deterministic evidence suitable for audit, diagnosis, and later
  workflow integrations.

## Non-goals

- Workflow-specific objective, gate, approval, or phase transition policy.
  Issues `SDD-02` through `SDD-09` own those reducers and operations.
- Lease acquisition, renewal, stale-owner recovery, or fencing. `RUN-07` owns
  concurrent-writer authority.
- Git repository classification. `RUN-08` owns it.
- A public repair command. This issue supplies typed inspection and replay
  operations; later command work may expose them without redefining integrity
  rules.
- Authenticating an event author. The chain proves internal consistency, not
  identity. Signed attestations remain post-1.0 work.
- Changing any published state schema or compatibility rule.

## Alternatives

### A. Contract-preserving transactional append protocol (selected)

Treat `events.jsonl` as append-only at the event-store boundary while using an
atomic file replacement as the transaction manager's physical publication
primitive. The prepared result must contain the exact previously verified byte
prefix followed by exactly one canonical event line. The same transaction
publishes the replayed snapshot.

This reuses the failure injection, manifest, precondition fingerprints,
roll-forward recovery, and destination verification from `RUN-05`. It adds no
second durability protocol and changes no public schema. Physical replacement
does not grant rewrite semantics: only exact-prefix extension is accepted by
the event-store API.

### B. Add a first-class append operation to transaction manifests (rejected)

An `append_file` manifest operation would model the filesystem action directly,
but it would change the immutable transaction schema and generated contracts.
It would require a new state-contract version, compatibility policy, migration,
and recovery corpus that exceed this issue. Portable crash behavior for a
partially written append would also need a truncate or copy-on-write recovery
mechanism.

### C. Store one immutable file per event and derive JSON Lines (rejected)

Per-event files make physical immutability straightforward, but they replace the
published `events.jsonl` state surface and introduce another index or manifest.
That contradicts the accepted architecture and requires contract migration.

## Authoritative layout

Each run owns one stream and one materialized snapshot:

```text
.brain/runs/<run-id>/
|-- events.jsonl
`-- state.json
```

`<run-id>` must satisfy the existing `EventV1` identifier constraints. The
event store derives both paths from the validated run identifier; callers do
not supply arbitrary destinations. The provisional root-level
`.brain/events.jsonl` constant is removed when `append_event` is wired.

The transaction manager continues to own
`.brain/transactions/<transaction-id>/`. Its staged event-log and snapshot
payloads are removed after a committed or aborted transaction according to the
existing cleanup rules.

## Components and boundaries

### Event domain

`packages/runtime/src/domain/events/` contains pure code only:

- `model.ts` defines an `EventDraftV1` that is exactly `EventV1` without
  `previousHash` and `eventHash`, verified-event and chain-cursor types, and
  stable integrity classifications.
- `seal.ts` validates a draft, adds the verified predecessor hash, hashes the
  canonical unsigned envelope, adds `eventHash`, and validates the final
  `EventV1` before returning it.
- `parse.ts` parses canonical JSON Lines with fixed record and stream limits,
  rejects blank or unterminated records, and never returns unvalidated values.
- `verify.ts` validates contract identity, canonical bytes, revision
  continuity, predecessor hashes, and current hashes in one ordered pass.
- `reduce.ts` folds verified events through a pure reducer and produces the
  cursor that must be bound into the snapshot.
- `redaction.ts` enforces the closed metadata-only event surface before a draft
  can be sealed.

The event domain imports no Node builtin and performs no I/O. Hashing and schema
validation arrive as function or domain-interface arguments. Architecture tests
continue to enforce the existing layer rules.

### Event-store composition

`packages/runtime/src/composition/events.ts` owns I/O orchestration:

1. derive the run-scoped stream and snapshot paths;
2. inspect both destinations through `DurableFileSystem`;
3. read the existing stream and snapshot without following unsafe paths;
4. validate the snapshot through the schema registry;
5. parse and verify the complete event chain;
6. replay the verified chain from the reducer's immutable seed;
7. require the replayed cursor and snapshot to equal the persisted snapshot;
8. seal exactly one next event against the verified tail;
9. replay the extended chain and prepare the next `SnapshotV1`;
10. normalize an exact-prefix event-log write and snapshot write into one
   `ManagedMutationPlan`; and
11. execute that plan through `executeManagedMutation`.

The composition API accepts a closed reducer registry with an immutable seed,
one pure reducer for each supported `policyVersion`, and one snapshot
materializer. Workflow packages may register reducer definitions later.
Production composition selects the reducer from the version recorded in each
verified event; it never discovers one from environment state or persisted
prose.

The store replays from the seed on every append in this foundation issue. This
keeps correctness simple and makes snapshot drift independently detectable.
Checkpoint optimization, if measurements later justify it, must preserve the
same replay result and integrity checks.

### Effect-plan integration

`append_event` changes from an opaque serialized string to a structured,
validated event draft plus a run identifier. The draft's `policyVersion`
selects one exact reducer from the configured closed registry. `applyPlan`
snapshots that input before its first asynchronous boundary, delegates event
preparation to the event-store composition, and submits the event-log and
snapshot writes as part of the same managed transaction as other `.brain/`
effects.

At most one `append_event` is accepted in one plan. Multiple state decisions
must be separate plans so every event has one observable predecessor and one
snapshot cursor. A plan cannot also write or delete the selected run's
`events.jsonl` or `state.json`; those destinations belong exclusively to the
event store.

`emit` effects still run only after the transaction commits. A failed append,
verification, reducer, or snapshot preparation emits nothing.

## Event sealing and canonical bytes

The hash input is the canonical JSON representation of every `EventV1` field
except `eventHash`, including `previousHash`. The final stored line is canonical
JSON for the complete validated `EventV1`, followed by exactly one line-feed
byte (`0x0a`). No byte-order mark, carriage return, indentation, blank record,
or unterminated final line is accepted.

For the first record, `previousHash` is `null`, `priorRevision` is `0`, and
`resultingRevision` is `1`. Every later record must satisfy:

```text
event.previousHash == prior.eventHash
event.priorRevision == prior.resultingRevision
event.resultingRevision == event.priorRevision + 1
```

The event hash is lower-case hexadecimal SHA-256. Verification recalculates it
from canonical unsigned bytes and performs exact string comparison. The hash
chain detects protected-content mutation; it does not claim collision
resistance beyond SHA-256 or authenticate the observed identity.

The sealed line itself is the golden-hash input contract. Any future change to
canonicalization or hash coverage requires a new versioned artifact and
migration evidence.

## Replay and snapshot binding

A reducer registry contains:

```ts
interface EventReducerRegistry<State> {
  readonly seed: State;
  readonly reducers: Readonly<
    Record<string, (state: State, event: EventV1) => State>
  >;
  materialize(
    state: State,
    cursor: EventChainCursor,
  ): SnapshotV1;
}
```

Each reducer receives only the prior immutable state and one verified event.
It cannot read the filesystem, clock, environment, Git, host, or network.
Composition deep-snapshots the seed and each reducer result so mutation after
return cannot change a prepared commit. A missing reducer for a recorded
`policyVersion` is unsupported state, not permission to use the nearest known
version.

The snapshot materializer must bind:

- `eventCursor` to the final `resultingRevision`;
- `eventHash` to the final event hash;
- `policyVersion` to the final event policy version; and
- `updatedAt` to the final event timestamp.

The schema registry validates and canonicalizes the materialized
`SnapshotV1`. The store replays the persisted stream and compares canonical
snapshot bytes before appending. A mismatch is `runtime.state_corrupt`; it is
never silently overwritten.

The determinism claim is scoped precisely: the same canonical seed, closed
policy-version reducer registry, and verified event bytes must produce
identical canonical snapshot bytes. Workflow reducers must encode every
state-changing input in the event's existing normalized metadata or immutable
referenced artifacts; they may not consult ambient input during replay.
This is conditional on caller-supplied reducers and materializer being pure and
free of ambient mutable state. The double-run comparison is diagnostic only;
it is not proof against adversarial paired outputs that agree for two calls.

## Transaction and recovery semantics

The event store prepares two managed writes:

1. the old canonical stream bytes plus one sealed canonical line; and
2. the canonical snapshot produced by replay of that extended stream.

Both writes carry destination fingerprints observed after verification. The
existing transaction manager rechecks them before publication, stages and
syncs both payloads, durably authorizes publication, and rolls forward after
the first published destination. Normal readers already refuse incomplete
transactions before loading canonical state.

The event log may become visible before the snapshot, or the snapshot before
the event log, during a publishing transaction. That mixed state is never
consumable because the durable incomplete marker blocks ordinary loads. After
recovery reaches `committed`, both files equal the manifest. Before publication,
recovery aborts without changing either destination.

No event is reported as accepted until the transaction receipt is
`committed`. Retrying the same stale plan after another append fails its
precondition as `runtime.revision_conflict`; the caller must reload and derive a
new draft from the current cursor.

## Integrity classifications

Public failures continue to use the existing reason catalog:

| Observation | Reason code | Evidence |
| --- | --- | --- |
| Unsupported or malformed state contract | Existing `contract.state_*` result | Run stream or snapshot reference |
| Invalid event or snapshot structure | `runtime.state_corrupt` | Exact project-relative managed reference |
| Non-canonical JSON Lines bytes | `runtime.state_corrupt` | Event stream reference |
| Gap, duplicate revision, reordering, bad predecessor, or bad hash | `runtime.state_corrupt` | Event stream reference |
| Snapshot differs from replay | `runtime.state_corrupt` | Stream and snapshot references |
| Destination changed after verification | `runtime.revision_conflict` | Changed managed reference |
| Incomplete durable transaction | `runtime.recovery_required` | Transaction progress reference |
| Unexpected implementation exception | `runtime.internal_failure` | No private exception text |

Detailed internal classifications remain typed test and inspection output; no
new public reason code is invented. Diagnostics never echo rejected event
content, hashes supplied by an attacker, absolute paths, stack traces, or
schema-engine wording.

Truncation is detectable when a bound snapshot exists: the snapshot cursor and
hash cannot match a shortened but otherwise valid prefix. An empty stream is
valid only before its first snapshot. Once a snapshot exists, a missing or
empty stream is corruption.

## Redaction and bounded input

`EventV1` is the only persisted event envelope. It has no arbitrary payload,
message, prompt, source-content, environment, or exception field. The event
store therefore does not accept raw command input and attempt to redact it
afterward.

The draft boundary enforces:

- all identifier fields satisfy the existing 128-character schema bound;
- artifact and evidence references satisfy the existing safe relative-reference
  schema and event-store count limits;
- observed identity is the host-provided identifier or `null`, never a prompt
  or credential blob;
- event type, effect, reason, and policy values come from structured decision
  metadata; and
- referenced sensitive evidence is stored by its owning component with digest
  and classification metadata, not copied into the event.

The parser limits each canonical record to 64 KiB, a stream to 64 MiB, and the
event count to 100,000 records. Limits are measured over UTF-8 bytes before
unbounded allocation or replay. Exceeding a limit is a sanitized integrity
failure. These bounds are deliberately above the closed schema's normal
metadata envelope while preventing a malformed local file from consuming
unbounded memory.

The store does not use heuristic secret scanning as an integrity boundary.
Secret prevention comes from the closed event shape and the absence of any
free-form content capability.

## Testing strategy

### Pure unit and golden tests

- Commit golden vectors for the unsigned canonical bytes, predecessor hash,
  event hash, and final JSON Lines bytes.
- Prove object-key insertion order and repeated runs do not change a hash.
- Prove every protected field changes the hash.
- Prove the first-event and successor revision rules.
- Prove parsing accepts only canonical, line-feed-terminated records.

### Property and model tests

- Generate bounded event sequences and prove seal then verify succeeds.
- Replay identical streams repeatedly and under cloned seeds; require identical
  canonical snapshots.
- Mutate one protected byte, delete each record position, duplicate and swap
  records, alter revisions, predecessor hashes, or final snapshot bindings; each
  case must produce the stable expected classification.
- Model stale concurrent appends and require at most one destination
  precondition to commit.

### Transaction and filesystem tests

- Run the event store against the shared fake and real Node durable-filesystem
  implementations.
- Inject failures before and after every staged write, sync, progress replace,
  event-log publication, and snapshot publication.
- Verify pre-publication abort, post-publication roll-forward, idempotent
  recovery, staged-payload cleanup, and no consumable mixed state.
- Exercise missing run roots, files in place of directories, symlinks, special
  files, case collisions, and unsafe run identifiers.

### Contract, security, and bundle tests

- Validate every written event and snapshot through the embedded registry.
- Seed prompt text, tokens, absolute paths, URLs, control characters, oversized
  references, non-canonical JSON, accessors, proxies, and mutable inputs; verify
  refusal without reflected private content.
- Confirm the bundle performs append, verification, and replay with no checkout
  schema files, runtime network access, or project-local dependencies.
- Preserve architecture, typecheck, lint, formatting, coverage, package, and
  differential verification gates.

## Documentation and evidence

`docs/architecture/event-store.md` will document the public integrity model,
hash coverage, replay rules, transaction relationship, limits, redaction
boundary, and recovery behavior. A verification record will list exact commands
and fault/corruption campaigns. Compatibility parity remains unchanged unless
an existing inventory row receives executable Go-oracle evidence.

The implementation PR must link issue #21, describe the physical-replacement
and semantic-append distinction, enumerate contract and security impact, and
include reproducible verification commands. No issue checkbox is treated as
complete solely because a unit test exists; the corresponding integration or
fault evidence must also pass.
