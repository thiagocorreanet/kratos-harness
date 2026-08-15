# Dry-Run Plans and Decision Explanation

Issue [#47](https://github.com/thiagocorreanet/mestre-yoda/issues/47)
(`RUN-09`) lets a caller compute what a mutation would do without doing any of
it. It does not add a public command, and it does not add a `--dry-run` flag —
see **Why there is no flag yet**.

## One code path, two exits

`applyPlan` already ran the decision and the commit in sequence. Everything up
to and including normalization is the decision:

```text
freeze caller input
preflight managed transactions
prepare the event append          (reads only)
observe every destination
normalize into one ordered plan
--------------------------------- decision ends
commit the durable transaction
emit structured and human output
```

`previewPlan` is that prefix and `applyPlan` is the prefix plus the commit.
They share one function, `decideMutation`, which is the entire point.

A preview produced by separate code walking the effect plan would duplicate
every normalization rule — synthesized parent directories, collision detection,
no-op collapse, fingerprint derivation. Each copy would agree with the commit on
the day it was written and drift quietly afterwards. People trust a preview,
which makes a drifting one worse than having none.

## What a preview reports

```ts
type MutationPreview =
  | { kind: "noop" }
  | { kind: "ready"; operations: readonly PreviewOperation[]; planDigest: string }
  | { kind: "blocked"; reasonCode: string; evidence: readonly EvidenceRef[] };
```

`PreviewOperation` carries the operation identifier, the kind, the destination
path, the fingerprint that destination held when the decision was made, and the
fingerprint it would end at. It never carries content.

`planDigest` is the digest the transaction manifest records for the same plan,
so a preview and the manifest that follows it can be compared directly rather
than trusted.

A blocked project is reported, not thrown. A preview a caller cannot render is
a preview that helps nobody at the moment it matters most.

## Proving nothing was written

`readOnlyPorts(ports)` returns the same boundaries with every state-changing
primitive replaced by one that refuses, naming itself in the error. Preview
tests run against it, so a write added later is a failing test rather than a
review someone has to catch.

Three refusals are less obvious than the file writes and each has its own
reason:

- `syncDirectory` changes no content, but nothing a preview computes is ever
  waiting to be made durable, so a call there means a write it does not know
  about already happened.
- the lease operations mutate durable state as surely as a file write does,
  while `locks.inspect` passes through.
- `ids.next()` refuses because consuming an identifier for a preview advances a
  sequence the real apply then skips.

The clock is readable. A decision may depend on the current time; what a
preview must not do is record one.

`preflightManagedTransactions` takes a `reconcile` flag, and a preview passes
`false`. That step clears unmarked transaction residue on its way through:
performing it would make a read-only operation mutate, and skipping the check
entirely would promise a commit that cannot happen. The preview reports the
blocked verdict instead, naming the transaction to recover.

## Applying what was previewed

An apply does not replay a plan. It re-decides from current state, which is
what keeps it correct — and also means a caller who previewed, showed the
preview to a person, and then applied could commit something that person never
saw.

`ApplyPlanOptions.expectPreview` closes that. When the preview is passed back,
the apply compares the decision it reached against it and refuses with
`runtime.revision_conflict`, naming the destination that diverged. The
comparison includes the precondition, not only the outcome: a destination
somebody else rewrote can still end at the same bytes, and the only trace of
their write is the state the decision started from.

Passing it back is optional. An apply with no preview behaves as it always has.

## Explanation

`previewResult(preview)` projects a decision into the universal result
envelope rather than inventing an output family. A ready preview reports the
destination count, states that nothing was published, carries the plan digest,
and names every destination once as evidence with the digest of what it would
become. A no-op says the project already holds the requested state. A blocked
preview carries its own reason code and the artifact to act on.

Every previewed result reports `stateChanged: false`. Evidence is sorted by
path, so two renderings of one decision are byte-identical and a person can
compare the preview they read yesterday against the one in front of them.

Redaction is the same rule the result contract already enforces: references and
digests travel, bytes and prompt text do not.

## Result mapping

| Situation | Reason |
| --- | --- |
| A decision was computed, or nothing needed doing | `trail.ok` |
| An incomplete transaction blocks any commit | `runtime.recovery_required` |
| The decision no longer matches the preview shown | `runtime.revision_conflict` |
| An effect aims outside the managed scope | `guard.outside_allow` |
| A plan violates a normalization rule | `runtime.state_corrupt` |

Every one of these is surfaced from the shared path rather than invented here.

## Why there is no flag yet

The frozen `go-v3-v0.6.5` inventory has exactly two global flags, `--expect`
and `--require-contract`, and none of its 59 command flags is `--dry-run`. The
string does not appear in the discovery inventory at all.

This repository already refused `--require-contract`, a flag that *is* frozen,
because the evidence did not establish which contract family it pinned:
accepting it would have invented a compatibility rule. A flag with no frozen
evidence is the clearer case of the same rule.

The staged bundle also exposes no mutating command, so a global `--dry-run`
today would be a flag accepted with nothing to preview. The flag belongs to
whichever issue introduces the first mutating command, which is also the issue
that can prove it against a real decision. Parity stays 0 / 400.
