# Concurrency Locks and Recoverable Work Leases Design

Issue [#22](https://github.com/thiagocorreanet/mestre-yoda/issues/22)
(`RUN-07`). Epic
[#15](https://github.com/thiagocorreanet/mestre-yoda/issues/15). Depends on
[#20](https://github.com/thiagocorreanet/mestre-yoda/issues/20) (`RUN-05`) and
[#21](https://github.com/thiagocorreanet/mestre-yoda/issues/21) (`RUN-06`).

## Problem

The runtime already exposes a thin `Locks` port, but its implementations are
only placeholders. The in-memory adapter derives owner identity from the scope,
and the Node adapter keeps its fencing counter in process memory. Neither
implementation can renew a lease, diagnose its current owner, recover abandoned
work, retain fencing authority across a restart, or stop an old worker from
publishing after a newer owner takes over.

Multiple hosts may operate on the same project concurrently. A lock that relies
on one PID, one process-local counter, or one wall clock would turn a crash,
container restart, or clock disagreement into silent split-brain mutation. The
lock service must instead make durable authority observable and require every
protected transaction to prove that authority again at publication time.

## Goals

- Allow at most one valid writer to commit a protected resource transition.
- Persist owner, lease identity, expiry, state revision, and a monotonic fencing
  token through the existing `LockLeaseV1` contract.
- Support acquisition, renewal, release, conflict inspection, and explicit stale
  takeover through deterministic typed operations.
- Bind every protected transaction to one exact lease and prevent an older
  fencing epoch from publishing or recovering canonical effects.
- Record lifecycle events in a canonical hash-linked stream and atomically bind
  the latest event to the materialized lease record.
- Permit safe read-only operations without acquiring a write lease.
- Provide equivalent fake and Node adapters plus deterministic model and real
  multi-process evidence.

## Non-goals

- Workflow-specific commands or policy transitions. Later SDD issues decide
  which command needs which scope.
- Distributed consensus across independent filesystems or network partitions.
  All cooperating workers operate on the same project-owned filesystem.
- PID liveness as authority. PID and hostname details are neither required nor
  persisted as public lock identity.
- Background daemons, network heartbeats, or a lock server.
- Opportunistic changes to the published state, event, transaction, or result
  contract versions.
- Automatic takeover. Expiry makes a lease eligible for an explicit recovery
  decision; it never grants authority by itself.

## Approved choices and alternatives

### A. Durable lease, exclusive claim, and transactional fencing (selected)

Persist the lease and its hash-linked lifecycle history below `.brain/locks/`.
Use a short-lived exclusive claim only to serialize lock administration and the
transition into transaction publication. Bind normal mutations to the current
lease through reserved managed operations already representable by the v1
transaction manifest.

This approach survives process restarts, produces useful conflict evidence,
reuses the existing transaction and event primitives, and requires no operating
system-specific lock API.

### B. Atomic lock directory only (rejected)

An exclusive `mkdir` is a good acquisition primitive, but a directory alone
does not retain a monotonic fencing token after release. Renewal, stale takeover,
and crash diagnosis would require an additional protocol anyway. Treating the
directory as the whole lease would also make an abandoned directory
indistinguishable from an active remote owner.

### C. Operating-system advisory locks (rejected)

Advisory file locks are efficient but do not provide one portable Node contract
across supported systems, containers, and hosts. They disappear with the
process, leave no durable diagnosis, and cannot by themselves fence a stale
worker that resumes after a newer owner starts.

## Resource scopes

The service supports two closed scope families:

- `run:<run-id>` protects one run and permits independent runs to proceed in
  parallel; and
- `project` protects project-wide mutation such as initialization or migration.

Scope identifiers are normalized before path derivation. Callers never supply a
lock path. A project-scoped holder conflicts with every run-scoped writer, while
different run scopes are independent. Lock ordering is fixed: a caller that
needs project authority acquires only `project`; it never nests run leases.

The resource-to-path mapping is closed and portable: `project` maps to
`.brain/locks/project/`, and `run:<run-id>` maps to
`.brain/locks/runs/<encoded-run-id>/`. The resource separator is removed and
the ASCII schema-valid run identifier is encoded as canonical unpadded
Base64URL. The mapping is reversible and collision-free, uses only portable
filename characters, and expands the 128-character source maximum to at most
171 characters. Run identifiers retain the existing bounded identifier grammar
and cannot select a reserved lock namespace.

An internal admission claim below `.brain/locks/.admission/` serializes only
scope-family changes. Run acquisition checks for an active project lease while
holding admission; project acquisition checks every normalized run scope while
holding the same admission. Admission is released after the lifecycle
transaction becomes durable. This closes the project-versus-run race without
serializing normal work performed under independent run leases.

Read-only operations acquire no lease when all of the following are true:

1. no incomplete managed transaction exists;
2. the relevant state schema, event chain, and snapshot binding validate; and
3. the operation creates no artifact, evidence, cache, view, or other managed
   byte.

An operation that materializes any output is a mutation and requires the
appropriate lease.

## Owner identity

`owner` has the closed form `<host>:<session-id>`. Each component matches
`^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$`, and the complete value remains within the
existing 128-character bound. It identifies a cooperating work session, not a
person, PID, container, hostname, or model claim. `leaseId` is a separate random
or deterministically injected identifier generated for each new fencing epoch.

The fake adapter receives identity and identifiers explicitly. The Node adapter
uses injected `Ids` and normalized host/session input. Conflict output may show
the opaque owner but never expands it into process or environment metadata.

## Durable layout

Each normalized scope owns one bounded directory:

```text
.brain/locks/
|-- .admission/
|   `-- claim/
|       `-- claim.json
|-- project/
|   |-- lease.json
|   |-- events.jsonl
|   `-- claim/
|       `-- claim.json
`-- runs/
    `-- <encoded-run-id>/
        |-- lease.json
        |-- events.jsonl
        `-- claim/
            `-- claim.json
```

`lease.json` validates as `LockLeaseV1`. `events.jsonl` contains canonical,
line-feed-terminated `EventV1` records protected by the existing SHA-256 chain.
`claim/` is an exclusive, ephemeral coordination directory. Its bounded
`claim.json` records `claimId`, `resource`, `owner`, the observed `leaseId`, the
observed token, `acquiredAt`, and `expiresAt`; lease identity fields are `null`
for an empty scope. It is internal recovery metadata, not write authority.
`.admission/` is reserved internal coordination and is never accepted as a
caller resource.

The lease record is retained after release. Release writes an expiry equal to
the release instant and appends a release event, preserving the greatest known
fencing token for the next acquisition. Unknown entries, symlinks, special
files, case collisions, invalid canonical bytes, or mismatched state are
corruption and are never cleaned automatically.

### Lifecycle event binding

Lifecycle operations use the existing `EventV1` envelope:

- `eventType` is `operation` for acquire, renew, and release;
- `eventType` is `recovery` for stale takeover;
- `effect` is `state`;
- `reasonCode` is the existing successful mutation reason `trail.ok`; and
- `operation` uses the closed form
  `lock.<action>.t<fencing-token>.d<lease-digest>`.

The digest is SHA-256 over canonical `lease.json` bytes. The closed operation
form fits the existing 128-character identifier bound, protects the materialized
lease content without adding an arbitrary payload field, and lets verification
recover the action and token from the protected event bytes.

For every accepted lifecycle transition:

- the lifecycle event revision advances independently from the protected state
  revision;
- `lease.stateRevision` equals the canonical protected-state revision observed
  or committed by that lease transition;
- the digest encoded by the event equals the canonical lease digest;
- acquire and takeover increment the previous fencing token by exactly one;
- renew and release preserve the current fencing token; and
- the event append and lease replacement commit through one managed
  transaction.

The event stream is the lifecycle audit history. `lease.json` is its current
materialized authority record. A missing stream paired with a lease, a missing
lease paired with a non-empty stream, or a latest-event mismatch is
`runtime.state_corrupt`.

## Time contract

Production defaults are:

| Setting | Value |
| --- | ---: |
| Lease TTL | 30 seconds |
| Renewal threshold | 10 seconds remaining |
| Clock-skew allowance | 5 seconds after `expiresAt` |
| Minimum caller TTL | 5 seconds |
| Maximum caller TTL | 5 minutes |
| Administrative claim TTL | 30 seconds |

Durations are integer milliseconds and are validated before I/O. An invalid
duration is a typed input failure, not a clamped value.

A lease is usable only while the local instant is strictly before `expiresAt`.
It becomes eligible for explicit takeover only at or after
`expiresAt + 5 seconds`. The interval between those instants is intentionally
neither writable nor recoverable: it absorbs bounded clock disagreement.

Wall-clock expiry never overrides fencing. The durable token and exact lease
identity are the final authority. Injected clocks make every boundary and skew
scenario deterministic in tests.

## Operations

### Acquire

1. Validate the scope, owner, TTL, and supplied state revision without I/O.
2. Create the global admission claim exclusively.
3. Create the scope directory through bounded managed initialization when it is
   absent;
4. Create the scope `claim/` exclusively and persist its canonical claim record.
5. Verify the project-versus-run scope family while admission is held.
6. Inspect and verify the lifecycle stream and lease binding.
7. Return a typed conflict when the latest lease is still active or inside the
   skew allowance;
8. Allow normal acquisition after an explicit release, but require the explicit
   takeover operation when the latest acquire or renewal was abandoned and is
   eligible for recovery;
9. Construct a new lease with a fresh `leaseId` and token `1` for an empty
   history, or the previous token plus one after an explicit release;
10. Transactionally append the acquire event and publish `lease.json`; and
11. Remove the matching scope and admission claims and synchronize their
   parents.

Acquisition never treats an unreadable path or unexpected filesystem exception
as ordinary contention.

### Renew

1. Acquire the administrative claim.
2. Verify exact scope, owner, `leaseId`, fencing token, and expected state
   revision.
3. Reject a lease that is already expired; only takeover can establish a new
   epoch.
4. Extend expiry from the current clock, preserve the token, retain the bound
   canonical state revision for a heartbeat-only renewal, and append a renew
   event in one transaction. A protected state commit instead binds the lease
   to that commit's resulting canonical revision.
5. Remove the matching claim.

Renewal is idempotent only when the caller presents the resulting revision and
canonical lease bytes from the completed attempt. A stale retry conflicts
rather than extending an unknown owner.

### Release

1. Acquire the administrative claim and verify exact current authority.
2. Set `expiresAt` to the release instant, preserve the token and last committed
   canonical state revision, and append a release event in one transaction.
3. Remove the matching claim.

A stale release cannot remove or expire a newer lease. Repeating release with
the exact resulting revision returns the same completed observation; another
identity receives a conflict.

### Explicit stale takeover

The caller supplies the exact observed scope, owner, `leaseId`, fencing token,
state revision, and lease digest. The service:

1. acquires the global admission claim and then the scope claim;
2. replays and verifies the current lifecycle binding;
3. requires the supplied observation to match exactly;
4. requires the skew-adjusted takeover instant to have arrived;
5. verifies the project-versus-run scope family and refuses takeover while any
   managed transaction requires recovery;
6. validates the current canonical protected state, creates a fresh `leaseId`,
   increments the token by exactly one, and records that state revision;
7. appends a `recovery` lifecycle event and replaces the lease atomically; and
8. removes the matching claim.

Two contenders observing the same stale epoch attempt the same exclusive claim.
Only one may advance the lease; the loser reloads the new owner and returns a
conflict. Takeover never silently completes or deletes an incomplete workflow
transaction.

## Claim recovery

The claim serializes only bounded lock administration and the handoff into
transaction publication. A holder must verify the exact claim identity and
current fencing epoch immediately before every state-changing filesystem
operation.

An abandoned claim is recoverable only when its own expiry plus skew allowance
has elapsed and no matching publishing transaction exists. Recovery replaces no
lease authority: it removes only the exact stale claim after revalidation. If a
newer fencing epoch exists, the older claim is inert. A resumed old process must
revalidate and cannot continue from an already observed claim.

As with the transaction and event-store adapters, concurrent pathname
replacement by a non-cooperating local process during one filesystem syscall is
outside the portable Node threat model. Cooperating workers are fenced by
exclusive creation, exact identity checks, no-follow path validation, and
durable epoch revalidation.

## Protected transaction binding

A mutating caller passes a closed `LeaseGuard` containing resource, owner,
`leaseId`, fencing token, state revision, lease fingerprint, and lifecycle
stream fingerprint. Composition snapshots it before the first asynchronous
boundary.

The guard is persisted without changing `TransactionManifestV1`: composition
prepends two reserved managed writes already representable by the v1 manifest:

1. one exact-prefix lifecycle renew event append; and
2. the canonically renewed `lease.json` record.

The reserved paths, expected fingerprints, result fingerprints, and staged
lease bytes therefore survive in the normal manifest and payloads. Recovery can
derive and validate the bound scope, lease identity, token, and revision before
continuing publication. Caller plans cannot directly target `.brain/locks/`.

The transaction path performs lease checks:

1. before creating a durable transaction marker;
2. while holding the matching claim immediately before authorizing
   `publishing`;
3. immediately before each managed destination publication; and
4. before every recovery publication or terminal acceptance.

Once `publishing` is durable, takeover is blocked by the incomplete transaction
marker. If a newer token appears before publication authorization, the old
transaction stops with `runtime.lease_conflict` and publishes no caller effect.
If publication was already authorized, explicit transaction recovery must make
the transaction terminal before lease recovery proceeds.

This ordering establishes the fencing invariant: an operation bound to token
`n` cannot commit after token `n + 1` is authoritative.

## Port shape

The thin `Locks` interface is replaced by explicit operations and typed
outcomes. The domain-facing shape includes:

```ts
interface LeaseIdentity {
  readonly resource: string;
  readonly owner: string;
  readonly leaseId: string;
  readonly fencingToken: number;
  readonly stateRevision: number;
}

interface Locks {
  inspect(resource: string): Promise<LeaseObservation>;
  acquire(request: AcquireLeaseRequest): Promise<LeaseOutcome>;
  renew(request: RenewLeaseRequest): Promise<LeaseOutcome>;
  release(request: ReleaseLeaseRequest): Promise<LeaseOutcome>;
  takeover(request: TakeoverLeaseRequest): Promise<LeaseOutcome>;
}
```

Outcomes distinguish acquired, renewed, released, taken over, conflict,
recovery required, revision conflict, corrupt state, and internal failure. `null`
is no longer overloaded to mean every acquisition refusal.

The fake adapter models the same lifecycle, revisions, clock boundaries, and
execution schedules in memory. The Node adapter owns no policy beyond durable
path and filesystem effect implementation.

## Failure and result mapping

| Observation | Universal reason |
| --- | --- |
| Another valid owner or a newer fencing epoch | `runtime.lease_conflict` |
| Lease or lifecycle fingerprint changed after observation | `runtime.revision_conflict` |
| Incomplete managed transaction or publishing lease transition | `runtime.recovery_required` |
| Invalid lease, lifecycle chain, claim, path, token sequence, or binding | `runtime.state_corrupt` |
| Managed destination outside the closed lock namespace | `guard.outside_allow` |
| Unexpected failure without durable diagnostic state | `runtime.internal_failure` |

A lease conflict identifies the opaque current owner, affected scope, observed
expiry, whether retry is allowed, and the safe next action. Public output and
evidence never contain raw hostnames, PIDs, absolute paths, environment values,
source content, credentials, rejected bytes, stack traces, or attacker-supplied
error text.

`runtime.lease_conflict` retains its published catalog meaning and recovery:
wait for the valid lease to finish or expire, reload canonical state, and request
the mutation again. Takeover is offered only after explicit inspection proves
eligibility.

## Security properties

- Every caller-controlled identifier is closed and bounded before path
  derivation.
- Lock paths are project-relative, no-follow, and confined below
  `.brain/locks/`.
- Symlinks, special files, control characters, traversal, drive paths, case
  aliases, and unknown layout entries fail closed.
- Lifecycle records contain only closed metadata. They contain no prompt,
  source, environment, or exception payload capability.
- Conflict diagnostics expose only schema-safe opaque identity and relative
  evidence references.
- PID reuse, container PID namespaces, process restart, and host disagreement do
  not grant authority.
- A clock decides only whether takeover may be attempted. Fencing decides
  whether publication may commit.
- Lock administration cannot mutate caller-owned paths or bypass the managed
  transaction boundary.

## Testing strategy

### Pure model and property tests

- Enumerate deterministic execution schedules of acquire, renew, release, takeover,
  protected publication, and recovery.
- Prove at most one active authority per conflicting scope family.
- Prove tokens increase exactly on acquisition epochs and never decrease across
  release or restart.
- Prove a token-`n` worker cannot commit after token `n + 1` exists.
- Generate clock positions before expiry, at expiry, inside skew allowance, and
  at takeover eligibility.
- Prove repeated inspect and exact completed-operation retries are idempotent.
- Prove different run scopes remain independent while `project` conflicts with
  every run writer.

### Shared adapter contract

Run one expanded contract suite against fake and Node implementations for:

- canonical scope and identity validation;
- acquisition, contention, renewal, release, and takeover outcomes;
- exact expiry and skew boundaries;
- stale release and stale renewal refusal;
- lifecycle revision, token, digest, and hash-chain binding; and
- sanitized typed failures.

### Real filesystem and multi-process tests

- Start simultaneous contenders and prove only one acquisition or takeover
  succeeds.
- Hold independent run scopes and commit in parallel.
- Kill workers before and after claim creation, lifecycle staging, transaction
  markers, publication authorization, each publication, and cleanup.
- Resume an old worker after takeover and prove every publication path refuses
  its token.
- Inject renewal failure and prove authority is neither silently extended nor
  transferred.
- Exercise readers during free, active, claim-only, prepared, publishing,
  recovery-required, and corrupt states.
- Inject positive and negative clock skew across processes.
- Replace lock components with symlinks, directories, special files, case
  aliases, and unexpected entries and prove fail-closed behavior.

### Repository verification

Run narrow lock and transaction suites first, then the full repository checks:

```bash
npm run format:check
npm run spellcheck
npm run lint
npm run typecheck
npm test
npm run test:coverage
npm run oracle:verify
npm run parity:check
npm run result:check
npm run contracts:check
npm run differential:check
npm run build
npm run package:verify
```

Coverage remains 100% for statements, branches, functions, and lines. The issue
adds internal runtime infrastructure and no public workflow command, so parity
inventory status changes only where a committed fixture explicitly proves an
existing frozen lock surface.

## Delivery boundary

This issue is complete when the typed lock domain, fake and Node adapters,
transaction fencing integration, lifecycle audit stream, explicit recovery,
documentation, and required evidence satisfy the issue acceptance criteria.
Later command issues consume these primitives; they do not redefine lease
authority, fencing, expiry, or takeover.
