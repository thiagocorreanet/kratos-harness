# Atomic Filesystem Transactions and Crash Recovery

Issue [#20](https://github.com/thiagocorreanet/mestre-yoda/issues/20)
(`RUN-05`) supplies the internal durable mutation boundary for the deterministic
runtime epic [#15](https://github.com/thiagocorreanet/mestre-yoda/issues/15).
It does not add a public state command or complete the SDD trail. The staged CLI
still supports only `help`, `version`, and `handshake`.

The boundary turns one normalized, ordered managed mutation plan into a durable
transaction below `.brain/`. That normalized plan is currently an internal
input to execution. This issue adds no public dry-run wiring; a future command
can render the same plan without creating transaction metadata. A plan whose
results are already present is a no-op and also creates no transaction.

## Managed scope and layout

Caller-owned operations may create directories, write files, or delete regular
files below `.brain/`. The transaction manager exclusively owns
`.brain/transactions/**`; a caller cannot target that namespace, even through a
case variant.

An active or retained transaction uses this bounded layout:

```text
.brain/transactions/<transaction-id>/
|-- manifest.json
|-- progress.json
`-- staging/
    |-- operation-0001.payload
    `-- operation-0002.payload
```

`progress.next` is the only progress scratch name. It is written, synchronized,
renamed over `progress.json`, and removed after an interruption or terminal
cleanup. Staging and scratch entries exist only while needed. A transaction
that aborts before binding a manifest may retain only terminal `progress.json`;
an abort after preparation or a committed transaction retains the immutable
manifest and terminal progress but no staged payload bytes.

The manifest contains the transaction identity, plan digest, creation time,
ordered operation metadata, relative destinations, precondition and result
fingerprints, and relative staged-payload references. It contains no payload
content or absolute path.

## Five monotonic phases

| Phase | Durable meaning | Recovery direction |
| --- | --- | --- |
| `begun` | The exclusive transaction directory and identity progress exist. No managed destination has been published. | Abort after validating the bounded layout and identity. |
| `prepared` | Payloads and the immutable manifest are durable, preconditions were rechecked, and the progress token is bound to the manifest digest. | Abort while destinations still match their preconditions. |
| `publishing` | Roll-forward was durably authorized before the first destination mutation. | Publish or record each exact manifest result in order. |
| `committed` | Every destination was inspected and matches its manifest result. | Finish bounded cleanup and return the same receipt. |
| `aborted` | No managed destination was published. | Finish bounded cleanup without touching destinations and return the same receipt. |

The only legal forward transitions are `begun` to `prepared`, `prepared` to
`publishing`, `publishing` to `committed`, and `begun` or `prepared` to
`aborted`. Terminal phases never transition back.

## Preparation and publication

Execution follows one observable sequence:

1. reject or reconcile existing transaction metadata before loading canonical
   state for mutation;
2. freeze the input and validate every operation, path relationship,
   fingerprint, staged name, and payload digest before I/O;
3. require or explicitly bootstrap the managed roots;
4. create the transaction directory exclusively and persist `begun`;
5. write and synchronize each staged payload, then synchronize staging;
6. write and synchronize the canonical manifest, then synchronize its
   directory;
7. recheck every precondition and persist `prepared`;
8. persist `publishing` before changing the first destination;
9. publish operations in manifest order, synchronizing the affected directory,
   inspecting the result, and atomically advancing progress after each one;
10. inspect all results, persist `committed`, and remove staging and scratch
    entries.

Each file write is published by a same-filesystem atomic rename. A delete
removes only the regular file matching its precondition. Directory creation is
an explicit plan operation and never hides recursive parent creation.

## Recovery identity and direction

Inspection is read-only. It returns relative evidence and the transaction
identifier, phase, manifest digest where one is bound, and recovery token. A
normal mutation that finds a non-terminal marker or terminal cleanup residue
returns `runtime.recovery_required`; it never recovers implicitly or consumes
possibly mixed canonical state.

Explicit recovery must present both the exact transaction identifier and its
recovery token. The `begun` token digests the immutable transaction identity.
The transition to `prepared` replaces it with the manifest digest, after which
it never changes. A stale identifier or token cannot authorize a replacement
transaction.

Before `publishing`, recovery aborts. A regular `manifest.json` with a null
`manifestDigest` is known transaction-manager scratch, not an authority: its
bytes are not parsed and bounded abort cleanup removes it. A directory,
symlink, special entry, unknown layout name, or a manifest referenced by a
non-null digest remains strict corrupt-state evidence and is preserved.

At and after `publishing`, recovery never aborts. It observes each destination
instead of trusting whether the prior promise resolved, then rolls forward
toward `committed` or blocks on unexpected evidence:

- a destination matching its precondition is published next;
- a destination already matching its result is recorded and skipped;
- a destination matching neither fingerprint blocks as corruption;
- a missing or mismatched required payload blocks as corruption; and
- committed or aborted cleanup can be repeated without changing the receipt.

Recovery is therefore idempotent across failures before an effect, after an
effect, after synchronization, or after a terminal cleanup operation.

## Recoverable atomicity

A portable filesystem cannot make several independent destination renames
simultaneously visible. This contract provides recoverable multi-file
atomicity, not simultaneous visibility.

While `publishing` exists, individual destinations may contain a mix of old and
new bytes. Ordinary mutation and canonical-state consumption are blocked until
explicit recovery reaches `committed`. If the observed evidence cannot safely
support roll-forward, recovery blocks and preserves it for diagnosis; it never
aborts a publishing transaction. The durable marker makes the mixed interval
unavailable rather than pretending it did not occur.

## Root bootstrap and synchronization

`existing` is the default root mode. It requires both `.brain/` and
`.brain/transactions/` to be real no-follow directories. It creates neither.

The explicit `initialize` mode may create only a missing empty `.brain/` and
its transaction namespace. A pre-existing `.brain/` must be empty before the
reserved namespace can be bootstrapped. Bootstrap directory creation is
idempotent metadata setup, not accepted workflow state.

File synchronization is mandatory. Directory synchronization is attempted and
recorded as `supported` or `unsupported`. Only the specifically classified
Windows directory-handle error is downgraded to `unsupported`; an unexpected
synchronization error fails the operation. Progress and receipts record the
capability actually observed.

## Stable failures

| Condition | Universal reason |
| --- | --- |
| Incomplete transaction or terminal cleanup residue | `runtime.recovery_required` |
| Destination drift before publication | `runtime.revision_conflict` |
| Invalid marker, bound manifest, progress, payload, layout, or ambiguous destination | `runtime.state_corrupt` |
| Destination outside `.brain/` or inside the reserved namespace | `guard.outside_allow` |
| Unexpected failure before a durable marker exists | `runtime.internal_failure` |

Universal results use catalog text and relative evidence only. They never
interpolate internal error messages, absolute project roots, environment data,
or staged bytes. A partial publication reports `stateChanged: false` because no
new canonical transaction was accepted; explicit recovery must make the
transaction terminal first.

## Path and cleanup safety

Every destination must be one canonical project-relative spelling below
`.brain/`. Absolute, drive-qualified, backslash-bearing, control-character,
traversing, empty, reserved, overlapping, contradictory, and case-colliding
paths are rejected before mutation.

The Node adapter anchors operations to the original canonical project root and
revalidates that root plus every existing path component without following
symlinks. Existing write and delete destinations must be regular files. FIFOs,
devices, sockets, symlinks, and other special entries are observed but never
read, replaced, or removed.

The Node adapter anchors and revalidates observed path identities and refuses
observed symlinks and special entries. Concurrent pathname replacement by a
non-cooperating local process during a filesystem syscall is outside this
portable threat model; a stronger guarantee requires platform-native
directory-handle-relative I/O. This limit does not relax the ordinary observed
path checks above.

Cleanup enumerates only the validated transaction layout. It removes known
payloads, `progress.next`, an unbound regular manifest, and the empty staging
directory. It never performs an unconstrained recursive deletion.

## Verification evidence

The deterministic fake enumerates all 13 `DurableOperation` variants. The
two-write and one-delete campaign reaches 12 variants and 110 operation
occurrences; `read_text` is correctly recorded as unreachable during normal
execution. Injecting both `before` and `after` at every reached occurrence
produces 220 recovery cases. Every case inspects, explicitly recovers when a
marker exists, recovers again, and checks the exact terminal destinations and
receipt.

Synthetic `permission` and `disk_full` labels prove catalog-backed sanitized
results without changing host permissions or consuming disk capacity. Separate
process tests bundle a temporary worker, stop the real Node adapter at 13 IPC
barriers from `begun` through cleanup, and inspect and recover in fresh
processes. The tests use only temporary directories and explicit IPC timeouts;
they never fill a disk, change global permissions, or pass payloads through the
environment.
