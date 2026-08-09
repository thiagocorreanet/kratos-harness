# Atomic Filesystem Transactions and Crash Recovery Design

Issue [#20](https://github.com/thiagocorreanet/mestre-yoda/issues/20)
(`RUN-05`). Epic
[#15](https://github.com/thiagocorreanet/mestre-yoda/issues/15). Depends on
[#18](https://github.com/thiagocorreanet/mestre-yoda/issues/18) (`RUN-03`) and
[#19](https://github.com/thiagocorreanet/mestre-yoda/issues/19) (`RUN-04`).

## Problem

The runtime already separates pure decisions from effects, but `applyPlan`
applies filesystem effects one at a time and deliberately leaves an applied
prefix behind when a later effect fails. That is sufficient to prove the
runtime boundary and unsafe for persisted workflow state. A process stopped
between a new approval record, an appended event, and an advanced snapshot can
leave `.brain/` describing mutually incompatible histories.

A single rename can publish one file atomically. No portable filesystem API can
make several independent renames appear simultaneously. The runtime therefore
needs recoverable transaction semantics: before any managed destination changes,
it must durably describe the complete intended result; while publication is in
progress, it must leave an unambiguous marker; and after an interruption, it
must refuse normal mutation until an explicit operation validates and completes
that exact transaction.

This boundary is also a security boundary. A transaction must not turn a safe
project-relative effect into a write through a symlink, a special file, a
case-colliding alias, an undeclared parent creation, or an unrelated user-owned
path.

## Goals

- Convert an ordered, previewable mutation plan into a durable transaction
  without introducing a second decision path for dry-run.
- Confine every managed destination in this issue to `.brain/` and reserve the
  transaction metadata namespace for the transaction manager itself.
- Publish each individual destination atomically and make a partially published
  multi-file transaction diagnosable and deterministically recoverable.
- Require explicit recovery when a durable incomplete marker exists.
- After the first destination is published, recover by rolling forward to the
  exact manifest result. Before that point, abort without changing a managed
  destination.
- Share one behavioral contract between the real Node adapter and the
  deterministic fault-injectable fake.
- Preserve evidence without retaining staged sensitive content after commit or
  abort.

## Non-goals

- A public CLI spelling for recovery. This issue exports typed inspection and
  recovery operations. The command-owning workflow can expose them without
  redefining transaction semantics.
- Event-chain behavior. `RUN-06` will implement `append_event` and route it
  through this transaction boundary.
- Lease expiry, fencing, or concurrent-writer ownership. `RUN-07` owns locks.
  This issue detects changed preconditions but does not claim that hash checks
  replace a write lease.
- Git classification or approved source-change scope. `RUN-08` owns those
  policies.
- Mutating `.claude/`, `.codex/`, application files, plugin files, or arbitrary
  paths supplied by a caller. Host integrations must add explicit managed-file
  contracts in their owning issues.
- General backup and rollback. Migration rollback belongs to the migration
  contract. A transaction that has started publication rolls forward.
- Silent repair of a malformed marker or unexpected destination. Ambiguity is a
  blocked integrity condition, not permission to guess.

## Decisions

### D1: Pure transaction state machine, durable-filesystem port

Transaction policy lives in `domain`. It defines immutable plan and manifest
types, legal phases, precondition evaluation, publication decisions, and
recovery classification without importing Node or calling a port.

A dedicated durable-filesystem port exposes the narrow primitives whose
outcomes the state machine observes. These include exclusive transaction
directory creation, no-follow inspection, staged writes, atomic file
replacement, file removal, atomic progress replacement, file synchronization,
directory synchronization, and cleanup. The Node adapter implements the effects;
the in-memory adapter implements the same contract and supports deterministic
failure injection.

Composition owns the driver loop: observe, ask the pure state machine for the
next action, apply one primitive, and observe again. The loop does not decide
whether an interrupted operation is complete. It feeds facts back to the state
machine, which compares them with the manifest.

Rejected: implementing the complete manager independently in Node and fake.
That would duplicate the most important recovery decisions at the exact boundary
the fake is meant to prove.

Rejected: adding one opaque `applyTransaction` method to the existing
`FileSystem`. A coarse method would hide failure boundaries, make ambiguous
post-effect failures difficult to model, and mix durable mutation semantics into
the simple project-scoped read/write port.

### D2: The existing effect plan is normalized into an exact managed mutation plan

The domain continues to return `EffectPlan`. Before dry-run output or execution,
composition normalizes its managed filesystem effects into a
`ManagedMutationPlan` containing only:

- `create_directory`;
- `write_file`; and
- `delete_file`.

Normalization preserves declared order. If a write requires a missing parent,
the normalized plan contains an explicit preceding `create_directory`; the
executor never creates a destination parent as a hidden side effect. Duplicate
or contradictory destinations, parent-after-child dependencies, deletion of a
directory through `delete_file`, and overlapping file/directory targets are
rejected before mutation.

After read-only observation, normalization removes operations whose result is
already satisfied. A plan containing only satisfied operations returns a no-op
result and creates no transaction. Consequently, every operation in a durable
manifest has observably different precondition and result fingerprints, which
keeps recovery classification unambiguous.

`emit` remains outside the transaction and runs only after commit. `append_event`
is rejected by this issue's executor until `RUN-06` supplies its canonical
append operation. This prevents a placeholder append implementation from
creating a second durability protocol.

Dry-run returns this exact ordered plan plus observed preconditions and writes
nothing. Execution re-observes those preconditions, rejects drift, allocates the
transaction identity, and binds the same canonical plan digest into the durable
manifest.

Execution also carries a root mode. `existing` is the default and refuses a
missing or unusable `.brain` directory. The explicitly selected `initialize`
mode may create only the empty `.brain/` and `.brain/transactions/` directories,
then synchronize their parents before creating `begun`. Directory creation is a
single idempotent bootstrap effect, not accepted workflow state. If the process
stops there, a later initialization sees empty reserved directories and retries;
no state file exists outside a manifest. No other operation may select this
mode.

### D3: Versioned immutable manifest and atomic progress document

Each transaction owns this project-local directory:

```text
.brain/transactions/<transaction-id>/
|-- manifest.json
|-- progress.json
`-- staging/
    `-- <operation-index>.payload
```

The transaction manager owns `.brain/transactions/**`. A caller cannot target,
delete, or shadow that namespace through an effect plan.

The empty transaction namespace is bootstrap metadata, not a managed operation
supplied by the caller. Outside explicit initialization, the transaction manager
requires both `.brain/` and its reserved namespace to be real, no-follow
directories before it creates a transaction identifier.

`manifest.json` is written once and becomes immutable before the transaction
enters `prepared`. Its versioned schema contains:

- contract and state-contract versions;
- transaction identifier;
- canonical plan digest;
- creation timestamp from the injected clock;
- ordered operations with stable operation identifiers;
- project-relative destination paths;
- expected destination kind, presence, size, and SHA-256 digest where
  applicable;
- resulting kind, size, and SHA-256 digest where applicable; and
- relative staged-payload references for writes.

The manifest contains no payload bytes, absolute paths, raw prompts, secrets,
host identity, or environment values. The schema registry from `RUN-04`
validates the document before any recovery decision uses it. Canonical
serialization from `RUN-04` produces its digest.

`progress.json` is a small versioned document replaced through write, file sync,
atomic rename, and directory sync. It records the current phase, the published
operation indexes known at the last durable observation, durability capability
facts, and timestamps. It is a hint backed by destination inspection, not an
authority that can overrule manifest hashes. A crash after publishing a target
but before advancing progress is resolved by observing that the destination
already equals the manifest result.

An empty transaction directory or an interrupted `begun` marker is recoverable
only when its identifier and contents match the reserved transaction layout.
Unexpected content blocks as corruption rather than being recursively removed.

### D4: Five monotonic phases

The legal phases are:

```text
begun -> prepared -> publishing -> committed
   |          |
   `----------+------------------> aborted
```

- `begun`: the exclusive transaction directory and initial progress identity
  exist. Managed destinations have not changed.
- `prepared`: every path and precondition is valid; every write payload and the
  immutable manifest are durable; managed destinations have not changed.
- `publishing`: publication was durably authorized before the first destination
  mutation. One or more destinations may already equal the manifest result.
- `committed`: every destination has been inspected and equals the manifest
  result.
- `aborted`: no destination was published, and payload cleanup is safe.

`committed` and `aborted` are terminal. No transition returns to an earlier
phase. Only `begun` and `prepared` can abort. Once `publishing` is durable,
recovery must complete the manifest or block on an unexpected observation.

### D5: Publication preserves plan order and records facts after each effect

The normal sequence is:

1. Reject any existing incomplete transaction before canonical state is loaded
   for a mutating operation.
2. Normalize and render the managed mutation plan.
3. Inspect every destination and bind its precondition.
4. In explicit initialization mode only, create and synchronize the empty
   managed root and transaction namespace if absent.
5. Create the transaction directory exclusively and persist `begun`.
6. Write, hash, and synchronize every payload in staging.
7. Persist and synchronize the immutable manifest.
8. Reinspect all preconditions and persist `prepared`.
9. Persist `publishing` before the first destination mutation.
10. Apply operations in manifest order. Before each operation, revalidate its
   target and parent. After it, synchronize the affected directory, inspect the
   result, and atomically advance progress.
11. Reinspect every destination against the manifest, persist `committed`, and
    remove staged payload bytes.

Writes use an atomic rename from a staged file on the same `.brain` filesystem.
Deletes remove only a regular file whose precondition matches the manifest.
Directory creation is explicit and idempotent only when the observed directory
matches the operation's expected state.

The result is recoverable multi-file atomicity, not simultaneous visibility.
While `publishing` is present, ordinary commands cannot consume possibly mixed
canonical state. They report recovery required before loading it.

### D6: Explicit recovery rolls forward after publication

Inspection is read-only and returns a classified transaction summary. Recovery
requires the exact transaction identifier and manifest digest so a stale
operator action cannot recover a replacement transaction accidentally.

Recovery behavior is deterministic:

| Observation | Recovery |
| --- | --- |
| `begun` or `prepared`, no destination equals a new result | Persist `aborted` and remove staged payloads |
| `publishing`, an operation still equals its precondition and its payload exists | Apply that operation and continue |
| `publishing`, a destination already equals its result | Record it as published and continue |
| `committed` with leftover staged payloads | Verify all results and finish cleanup |
| `aborted` with leftover staged payloads | Finish cleanup without touching destinations |
| Destination equals neither precondition nor result | Block; preserve marker and evidence |
| Staged payload or manifest digest is wrong | Block; preserve marker and evidence |

Recovery is idempotent. The adapter can fail before an operation, after the
filesystem performed it, or after synchronization; every retry begins with a
fresh observation and derives the next action from facts rather than assuming
the previous call failed before taking effect.

Normal mutation never invokes recovery implicitly. Finding an incomplete marker
returns `runtime.recovery_required`. Diagnostic operations may inspect and
report the marker but may not load mixed state as canonical. The explicit
recovery operation is the only path that may advance or abort it.

### D7: Durability is capability-aware and evidence-backed

For every staged or progress file, the Node adapter writes all bytes, flushes
the file handle, closes it, publishes it by atomic rename, and synchronizes the
containing directory when the platform supports directory synchronization.
Target publication follows the same file and directory durability sequence.

Atomic same-filesystem rename is mandatory. File synchronization is mandatory.
Directory synchronization is attempted and classified as `supported` or
`unsupported` only for explicitly recognized platform errors. An unexpected
sync error fails the operation; it is not downgraded to an unsupported
capability. The capability observation is recorded in progress and the final
receipt so evidence states the guarantee actually achieved.

The design does not advertise that unsupported directory sync has occurred.
Cross-platform tests own the accepted error classification. Adding a platform
exception requires a focused contract change, not a broad catch.

### D8: Managed-path policy is stricter than ordinary reads

Every destination must be a normalized relative path below `.brain/` and must
not be below `.brain/transactions/`. Absolute, drive-qualified,
backslash-bearing, empty, control-character, traversing, special-file, and
case-colliding targets are refused.

The Node adapter anchors inspection at the canonical `.brain` directory. Before
staging and immediately before publication, it uses no-follow metadata checks
for every existing component and rejects mutation through a symlink, even when
that symlink currently resolves inside the project. This stricter write policy
prevents aliases and destination substitution; it does not change the existing
read-side project-discovery contract.

An existing destination must be a regular file for `write_file` or
`delete_file`, and a directory for an already-satisfied `create_directory`.
Sockets, devices, FIFOs, and other special entries are never read, replaced, or
removed. Unexpected entries remain untouched.

### D9: Stable failure mapping uses the existing result catalog

Transaction internals return typed failures. Composition maps them to the
existing universal reasons:

| Condition | Reason |
| --- | --- |
| Incomplete durable transaction blocks a normal operation | `runtime.recovery_required` |
| Destination changed between plan observation and preparation | `runtime.revision_conflict` |
| Invalid marker, manifest, progress, payload digest, or ambiguous recovery destination | `runtime.state_corrupt` |
| Requested destination is outside the `.brain/` allowlist or inside the reserved transaction namespace | `guard.outside_allow` |
| Unexpected filesystem failure before `publishing`, with no destination change | `runtime.internal_failure` |
| Filesystem failure after `publishing` leaves a valid incomplete marker | `runtime.recovery_required` |

Errors never include staged content or absolute paths in universal output.
Evidence may reference the relative transaction directory, transaction
identifier, manifest digest, failed operation identifier, phase, and durability
capabilities. An unexpected failure after `begun` preserves the marker unless
the state machine proves that no destination changed and cleanup is safe.

`stateChanged: false` means no new canonical transaction was committed. A
partially published filesystem is never reported as accepted state: the durable
marker makes it unavailable to ordinary state consumers until explicit
recovery reaches `committed` or proves a safe pre-publication abort.

This issue does not add a new public reason merely to mirror an implementation
exception. A future need for observably distinct recovery policy requires a
versioned result-catalog decision.

### D10: Successful cleanup keeps a compact receipt, not payload bytes

After commit or abort, staged payloads and incomplete temporary files are
removed. The transaction directory is compacted to validated metadata containing
the immutable manifest, terminal progress, plan digest, terminal phase, and
durability capability facts. Payload content is not retained.

These receipts make tests, diagnosis, and later event integration reproducible.
Retention and archival policy are not invented here. A later evidence or
retention issue may move or prune terminal receipts through its own managed
transaction; it may not reinterpret them.

## Component boundaries

The intended dependency direction is:

```text
EffectPlan
    |
    v
pure normalization/validation ---> ManagedMutationPlan (dry-run output)
    |                                      |
    | execute                              | no writes
    v                                      v
transaction driver <--- pure transaction state machine
    |
    v
DurableFileSystem port
    |
    +-- Node adapter
    `-- fault-injectable memory adapter
```

Suggested units, with final names settled during planning:

- `domain/transactions/model`: plan, manifest, progress, observation, and
  failure types;
- `domain/transactions/normalize`: effect-plan normalization and path policy;
- `domain/transactions/transition`: legal phase transitions and next-action
  decisions;
- `domain/transactions/recovery`: pure recovery classification;
- `ports`: durable-filesystem interface and capability types;
- `composition/transactions`: driver, failure mapping, inspection, and recovery
  entry points;
- `infra/node/transactions`: Node filesystem primitives;
- `infra/fake/transactions`: model adapter and failure-injection controller.

The exact file split should keep each unit focused; the design does not require
one file per bullet.

## Public internal API shape

The transaction boundary exposes three operations to composition consumers:

```ts
planManagedMutation(
  effectPlan: EffectPlan,
  observation: ManagedPathObservation,
): ManagedMutationPlan;

executeManagedMutation(
  plan: ManagedMutationPlan,
  options: { readonly rootMode: "existing" | "initialize" },
  ports: TransactionPorts,
): Promise<TransactionReceipt>;

recoverManagedMutation(
  request: {
    transactionId: string;
    manifestDigest: string;
  },
  ports: TransactionPorts,
): Promise<TransactionReceipt>;
```

Inspection remains a read-only composition operation that lists and validates
transaction summaries without returning payload content. The detailed types are
versioned internal contracts until an owning public command exposes them.

## Verification strategy

### Pure unit and property tests

- Every legal and illegal phase transition.
- Plan normalization preserves order and makes implicit parent creation
  explicit.
- Already-satisfied operations disappear, and an all-satisfied plan creates no
  transaction marker.
- Duplicate, overlapping, contradictory, outside-allowlist, reserved, and
  unsafe paths are rejected.
- `existing` mode never creates `.brain/`; `initialize` mode creates only the
  empty managed root and reserved namespace before `begun`.
- Canonical plan and manifest digests are stable under repeated serialization.
- Random valid plans plus a crash at every action boundary satisfy the model:
  before publication, destinations remain at preconditions; after explicit
  recovery from publication, every destination equals the manifest result.
- Repeated inspection and recovery produce the same terminal result.

### Shared adapter contract

The Node and memory adapters run the same assertions for:

- exclusive transaction directory creation;
- no-follow kind and digest observation;
- complete writes and file synchronization;
- atomic replacement;
- directory synchronization capability classification;
- regular-file deletion;
- atomic progress replacement;
- cleanup; and
- identical safe path refusal.

### Fault-injection campaign

The fake can fail immediately before and immediately after every primitive. The
campaign covers open, write, partial write, file sync, close, rename, directory
sync, metadata inspection, permission refusal, synthetic disk-full, delete, and
cleanup. Post-effect failures are mandatory because they prove that recovery
does not equate a rejected promise with an unapplied effect.

For every injected point, tests assert the marker phase, destination facts,
stable failure classification, lack of sensitive output, and idempotent explicit
recovery.

### Real-filesystem and process tests

- Temporary-project integration tests exercise creation, replacement, deletion,
  Unicode, spaces, long paths within platform limits, case behavior, and
  same-filesystem rename.
- Security tests cover traversal, absolute and drive paths, escaping and
  internal symlinks, symlink substitution between observations, special files
  where the platform supports them, and the reserved transaction namespace.
- Child-process tests stop the process at deterministic barriers before and
  after publication primitives, then invoke inspection and recovery in a fresh
  process.
- Platform CI records whether directory sync is supported and verifies only the
  narrow accepted unsupported errors on Linux, Windows, and macOS.

Synthetic permission and disk-full failures provide deterministic coverage on
every platform. Focused native tests supplement them where the operating system
can produce the condition safely; the suite never fills the host disk or changes
global permissions.

### Repository verification

Narrow tests run first. Before review, the branch runs the repository's exact
Node/npm toolchain and complete `npm run verify` suite. The PR records exact
commands, transaction fault-matrix counts, platform capability observations,
and the final CI links.

## Security and privacy review

- Staged content exists only under the project-owned `.brain/transactions/`
  boundary and is removed after a terminal outcome.
- Manifests and receipts contain hashes and relative paths, not payload bytes or
  absolute user paths.
- Recovery never trusts marker-provided paths before schema, lexical, namespace,
  and filesystem-boundary validation.
- Cleanup enumerates only a validated transaction layout and never performs an
  unconstrained recursive removal.
- A manifest cannot authorize its own transaction metadata as a managed
  destination.
- Universal errors are catalog-backed and sanitized.

## Delivery sequence and dependency handling

Implementation starts only after `RUN-04` is merged or the branch is rebased
onto its accepted schema registry and canonical serialization boundary. This
issue reuses those capabilities; it does not ship a parallel validator or JSON
canonical serializer.

Recommended implementation slices are:

1. versioned transaction schemas and pure model;
2. mutation-plan normalization and managed-path policy;
3. pure state and recovery decisions;
4. durable-filesystem port plus fake contract;
5. transaction driver and fault campaign;
6. Node adapter and real-filesystem tests;
7. process-termination tests, result mapping, receipts, and documentation; and
8. complete repository verification and PR evidence.

The implementation plan will decompose these slices into test-first tasks after
this design is accepted.

## Acceptance mapping

| Issue requirement | Design evidence |
| --- | --- |
| Staged writes, flush, atomic rename, verification, cleanup | D3, D5, D7, adapter contract |
| Begin, prepare, commit, abort markers and recovery inspection | D3, D4, D6 |
| Reject writes outside allowlisted project-owned paths | D2, D8 |
| Expose a dry-run transaction plan | D2 and public internal API |
| Old state or diagnosable recoverable transaction at every boundary | D4-D6 and fault campaign |
| Idempotent repeated recovery | D6 and property tests |
| Never overwrite a user-owned path without a managed-file contract | `.brain/`-only policy, reserved namespace, D8 |
| Fault-inject filesystem and termination scenarios | Verification strategy |
| Real-filesystem integration on supported systems | Real-filesystem and process tests |
