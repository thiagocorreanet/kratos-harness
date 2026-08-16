# Concurrency Locks and Recoverable Work Leases

Issue [#22](https://github.com/thiagocorreanet/kratos-harness/issues/22)
(`RUN-07`) replaces the placeholder `Locks` port with a durable lease. It does
not add a public command: the staged bundle still exposes only `help`,
`version`, and `handshake`. Claude Code, Codex, a terminal, and automation may
all touch one project at the same time, and this contract decides which of them
may commit.

## Scope

A lease covers one resource, named in exactly one of two shapes:

- `project`, which covers the whole project; or
- `run:<run-id>`, which covers a single run.

The two are not independent. A project lease covers every run beneath it, so a
run lease cannot be taken while a project lease is held, and a project lease
cannot be taken while any run lease is held. Two different runs never conflict
with each other.

Durable state lives under a fixed layout:

| Path | Holds |
| --- | --- |
| `.brain/locks/project` | The project scope |
| `.brain/locks/runs/<encoded-run-id>` | One run scope |
| `<scope>/lease.json` | The current lease |
| `<scope>/events.jsonl` | The hash-linked lifecycle trail |
| `<scope>/claim` | The short administration claim |
| `.brain/locks/.admission` | The claim that serializes scope administration |

`<encoded-run-id>` is the run identifier in unpadded Base64URL. A run
identifier is caller-supplied text; encoding it means no identifier can escape
its scope directory, collide with a sibling on a case-folding filesystem, or
name a reserved entry. The encoding is total and reversible, so the directory
listing remains the authoritative inventory of run scopes.

## Owner identity

An owner is `<host>:<session-id>` — for example `codex:session-01`. Both parts
are constrained to a conservative character set, and neither is a process
identifier.

A PID identifies nothing across a container boundary, a host boundary, or a
reused number. A worker that checks whether a PID is alive learns whether
*some* process holds that number on *this* host, which is not the question.
Expiry and the fencing token answer the real question without asking the
operating system anything.

## Time

Three durations bound the protocol:

| Duration | Value | Meaning |
| --- | --- | --- |
| Lease TTL | 30 seconds | How long a lease stays writable without renewal |
| Renewal interval | 10 seconds | How often a holder should renew while working |
| Skew window | 5 seconds | Grace beyond expiry before takeover is allowed |

A lease is `writable` before its expiry, in `skew` for the five seconds after
it, and `takeover_eligible` beyond that. Nothing may be acquired, renewed,
released, or taken over during the skew window: it exists so that a clock that
disagrees by a second cannot let two workers believe they hold the same
resource.

Wall-clock time never overrides the fencing token. Expiry decides when a
takeover *may* be attempted; the token decides who may commit.

## Fencing tokens

Every lease carries a monotonic fencing token:

- a fresh acquisition on an empty history starts at `1`;
- acquisition after an explicit release increments by exactly one;
- a takeover increments by exactly one; and
- renewal and release preserve the current token.

Tokens are the ordering the protocol actually enforces. Two workers may both
believe they hold a resource — one of them wrong — and the durable token is
what settles it.

## Lifecycle trail

Each transition appends one event to `events.jsonl` whose operation encodes the
action, the resulting token, and the digest of the lease it produced:

```text
lock.<action>.t<fencing-token>.d<lease-digest>
```

The trail is hash-linked, so the action and token of every transition can be
recovered from the protected bytes alone, and a lease file that does not match
the digest its own trail recorded is refused rather than trusted.

## Guarded commits

A caller that intends to mutate protected state prepares a guard:

```ts
const binding = await prepareLeaseGuard(renewal, services);
await executeManagedMutation(plan, { rootMode: "existing", leaseGuard: binding }, services);
```

Preparing the guard takes no durable claim. Holding one across the caller's
whole transaction would wedge the resource whenever a caller died mid-flight,
which is the failure this subsystem exists to prevent. Authority is re-derived
from durable state instead, at every point where refusing still means
publishing nothing.

The guarded transaction publishes, in order:

1. the renewal event appended to the scope's `events.jsonl`;
2. the renewed `lease.json`; and
3. every caller effect, renumbered behind those two.

Publishing the renewal first is what makes the fence hold. Once the renewed
lease is durable, a takeover observes a live lease and its own policy refuses
it, so no third party can slip between the last authority check and the
caller's writes. A caller effect that targets `.brain/locks/**` is refused
outright: reaching in directly would let a caller forge the authority it is
being checked for.

Before every publication the transaction re-derives authority and accepts
exactly two states per lock artifact — the state the guard was prepared over,
and the state this transaction itself published. Any third state means another
writer intervened. Recovery re-derives the same check from the transaction's
own manifest, so fencing survives a crash without adding a manifest property.

Recovery that can still abort is deliberately unguarded. An abort publishes
nothing, and refusing it would strand the very residue the abort exists to
clear.

## Read-only operations

Inspecting a lease takes no claim and writes nothing, so a read-only operation
runs while another worker holds the resource. Inspection reports one of
`empty`, `active`, `released`, `skew`, or `takeover_eligible` together with the
lease and the guard, and refuses a namespace holding an entry no protocol can
interpret.

## Results

| Situation | Reason |
| --- | --- |
| Another valid owner or a newer fencing epoch | `runtime.lease_conflict` |
| A transaction or claim that stalled mid-flight | `runtime.recovery_required` |
| A caller effect aimed outside the allowed scope | `guard.outside_allow` |
| Invalid lease, trail, claim, path, token sequence, or binding | `runtime.state_corrupt` |

A conflict names the current owner, the affected scope, the expiry, whether the
attempt is retryable, and the safe next action. It never carries owner secrets,
absolute paths, or prompt text.

Recovering a stale lease is an **explicit takeover**, never an automatic one. A
worker that finds an expired lease is told it may take over; it is not handed
the resource behind its own back, because the previous holder may still be
alive and about to publish.

## Threat boundary

This contract defends against confusion between cooperating agents on one
machine. It is not an authentication mechanism. Anything that can write to
`.brain/locks/**` outside the protocol can forge a lease, and the durable
integrity checks make that visible rather than impossible.

Concurrent observers are a live boundary, and `tests/lock-process-contention`
holds it with eight real processes rather than one simulated one.

Every read below `.brain/locks` races a publisher. The rule the readers apply
is that a path which is *gone* was published or reclaimed by whoever owned it,
while a path which *exists* and holds something no protocol can interpret is
damage. The distinction matters at the ancestor too: a retirement removes a
generation directory out from under a read that never reaches its target, so
the readers walk the chain up to the namespace before deciding. A record beside
its own tombstone is likewise a retirement in flight — the tombstone is linked
before the record it retires is removed — and only a tombstone naming a
different claim is uninterpretable.

Two gaps remain, tracked by
[#99](https://github.com/thiagocorreanet/kratos-harness/issues/99) and owned by
[#106](https://github.com/thiagocorreanet/kratos-harness/issues/106). A contender
that loses the admission election is still reported rather
than re-elected, so a round can end with no winner at all even though no lease
was published. And because `.brain/locks/.admission` serializes administration
for the whole project, a contender for one run can be refused on account of a
worker administering a different one, which the scope rules above say must
never conflict. Until that lands, treat a conflict naming `admission` as a
report about the administration rather than about the resource.
