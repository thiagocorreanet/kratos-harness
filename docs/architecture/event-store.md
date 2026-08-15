# Append-Only Event Store Integrity

Issue [#21](https://github.com/thiagocorreanet/mestre-yoda/issues/21)
(`RUN-06`) provides an internal event-store boundary for the deterministic
runtime. It does not add a public command: the staged bundle still exposes only
`help`, `version`, and `handshake`.

## Run ownership and layout

A run belongs to the feature that opened it, and owns exactly two event-store
destinations beneath it:

```text
.brain/02-features/<feature>/runs/<run-id>/events.jsonl
.brain/02-features/<feature>/runs/<run-id>/state.json
```

The event-store composition derives both paths from a validated run location —
the feature and the run identifier together. It cannot derive them from the run
identifier alone, which is why a caller names both.

Issue [#108](https://github.com/thiagocorreanet/mestre-yoda/issues/108)
(`RUN-06a`) moved them here. `RUN-06` shipped `.brain/runs/<run-id>/`, a path
that appears nowhere in the frozen discovery snapshot and that no parity row
covers, while eleven frozen rows place every run artifact under its feature.
Two layouts for one run would have meant the trail's history living somewhere
the frozen contract never names.

Callers never supply event-store destinations, and no caller effect may write
or delete either selected path. `events.jsonl` is the accepted history;
`state.json` is its replayed, validated snapshot. Transaction staging and
progress remain owned by the separate `.brain/transactions/` boundary.

A run identifier keeps its own grammar. The feature is constrained to the
grammar `state.feature` declares, so a location the store accepts is one the
feature contract could have produced.

## Canonical history

The store accepts only canonical JSON Lines. Every persisted record is one
canonical JSON object followed by exactly one LF byte. It rejects a byte-order
mark, CRLF, blank records, non-canonical bytes, and an unterminated final
record.

`eventHash` is the lower-case SHA-256 digest of canonical unsigned event bytes.
Those bytes contain every `EventV1` field except `eventHash`, including
`previousHash`. The complete validated event, including its `eventHash`, is the
stored line.

The first event has `previousHash: null`, `priorRevision: 0`, and
`resultingRevision: 1`. Every successor must meet all of these invariants:

```text
event.previousHash == prior.eventHash
event.priorRevision == prior.resultingRevision
event.resultingRevision == event.priorRevision + 1
```

The prepared stream is an `exact-prefix` extension: it contains the verified
old canonical bytes followed by exactly one sealed canonical line. The
transaction manager physically publishes files by replacement, but that
physical replacement is not rewrite permission. The event-store API permits
only semantic append-only exact-prefix extension.

SHA-256 chaining supplies tamper evidence for protected event content and
ordering. It is not authentication of an author or of `observedIdentity`; the
event store does not sign events or establish authority.

## Replay and snapshot binding

Before an append, composition verifies the complete persisted stream, replays
it from the reducer registry's immutable seed, and compares the resulting
canonical snapshot with `state.json`. Each verified event selects one exact,
closed reducer by `policyVersion`. Reducers receive only prior state and a
verified event; replay does not read a filesystem, clock, environment, Git,
host, or network.

The snapshot materializer binds the final replay cursor and event data:

- `eventCursor` equals the final `resultingRevision`.
- `eventHash` equals the final event hash.
- `policyVersion` equals the final event policy version.
- `updatedAt` equals the final event timestamp.

The same canonical seed, closed reducer registry, and verified event bytes
must produce the same canonical snapshot bytes. A missing reducer is unsupported
state, not permission to select a nearby policy. A persisted snapshot that
does not equal replay is corruption and is never overwritten.

That determinism guarantee is conditional: caller-supplied reducers and
materializer are pure and free of ambient mutable state. Replay invokes each
callback twice and compares canonical outputs, but the double-run comparison is
diagnostic, not proof against adversarial paired outputs that deliberately agree
for those two invocations. Reducer and materializer authors remain responsible
for encoding all state-changing inputs in the verified event or immutable
referenced artifacts.

## Transaction and recovery relationship

One prepared append produces two managed writes: the exact-prefix stream and
the replayed snapshot. Their preconditions are fresh fingerprints observed
after verification. The existing transaction manager stages and synchronizes
both payloads, records durable progress, and rechecks destinations before
publication.

During normal commit, both writes become the committed pair before an event is
reported accepted. Before publication, recovery aborts and preserves the old
pair. After durable publication authorization, recovery rolls forward to the
new pair. A mixed pair can be briefly visible on disk during publishing, but an
incomplete transaction marker blocks ordinary state consumption until recovery
reaches a terminal phase.

A stale prepared append whose destination changed after verification fails as
`runtime.revision_conflict`; the caller must reload and derive a new event from
the current cursor. An incomplete durable transaction maps to
`runtime.recovery_required` and requires explicit recovery. No event is
accepted merely because preparation succeeded.

## Corruption and public results

Malformed event or snapshot structure, non-canonical record bytes, revision
gaps, duplicates, reordering, predecessor drift, digest drift, and
snapshot-replay mismatch map to `runtime.state_corrupt`. Unsupported or
malformed state contracts retain the existing `contract.state_*` result mapping.
Unexpected implementation or injected-capability failures map to
`runtime.internal_failure` without private error content.

Diagnostics use project-relative managed references only. They do not echo
rejected event content, attacker-supplied hashes, absolute paths, stack traces,
schema-engine wording, or private exception text. A valid shorter tail can be a
valid prefix in isolation; when a snapshot is present, its cursor and hash bind
the expected tail and make stale truncation `runtime.state_corrupt`.

## Bounded metadata boundary

Only the closed metadata-only `EventV1` envelope is persisted. It has no raw
payload, source content, exception, environment, credential, or message field;
there are no raw prompts in the event store. The draft boundary copies only the
closed fields, safe relative references, and observed identity metadata before
sealing. Sensitive evidence remains with its owning component and is referenced
by approved metadata rather than copied into history.

The parser measures UTF-8 bytes before replay and refuses a record over
64 KiB, a stream over 64 MiB, or more than 100,000 events. These limits and the
closed shape prevent unbounded or free-form input from becoming persisted event
history; heuristic secret scanning is not the integrity boundary.
