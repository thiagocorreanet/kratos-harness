# Universal Dry-Run Plans and Decision Explanation Design

Issue [#47](https://github.com/thiagocorreanet/mestre-yoda/issues/47)
(`RUN-09`). Epic
[#15](https://github.com/thiagocorreanet/mestre-yoda/issues/15). Depends on
[#16](https://github.com/thiagocorreanet/mestre-yoda/issues/16) (`RUN-01`),
[#17](https://github.com/thiagocorreanet/mestre-yoda/issues/17) (`RUN-02`),
[#20](https://github.com/thiagocorreanet/mestre-yoda/issues/20) (`RUN-05`), and
[#21](https://github.com/thiagocorreanet/mestre-yoda/issues/21) (`RUN-06`).

## Problem

A person about to let an agent rewrite their project needs to see what it
decided before it acts. Initialization, migration, repair, and approvals are
all worth less if the only way to learn what a command will do is to let it do
it.

The runtime is already shaped for this. The domain returns an `EffectPlan` and
never calls a port, and `applyPlan` normalizes that plan into one exact ordered
`ManagedMutationPlan` before committing it. What is missing is a way to stop at
the decision and render it — and, more importantly, a guarantee that stopping
there writes nothing at all.

The tempting implementation is a second function that walks the effect plan and
describes it. That is the failure this design exists to avoid. A preview
derived by separate code is a preview that drifts: it agrees with the committed
behavior on the day it is written and diverges quietly afterwards, which is
worse than no preview, because people trust it.

## Goals

- Compute the exact decision a command would commit, without writing anything.
- Render that decision in human and JSON modes through the existing result
  envelope.
- Connect each decided operation to its reason code, evidence references, and
  the observed preconditions it depends on.
- Prove zero mutation mechanically, at the port boundary, rather than by
  reviewing that no write was called.
- Make an unchanged plan apply to the described effects, and a changed
  precondition invalidate it.

## Non-goals

- No `--dry-run` flag. See **Compatibility boundary**.
- No persisted plan artifact and therefore no new state contract.
- No new command. The staged bundle still exposes `help`, `version`, and
  `handshake`.
- No parity credit. This issue delivers runtime semantics, not a surface.

## Approved choices and alternatives

### A. Stop the real path before its first write (selected)

`applyPlan` already runs the decision and the commit in sequence. Extract the
decision prefix into `previewPlan()`, and have `applyPlan` call it and then
commit its result. One code path, two exits.

The preview is not a description of what would happen. It is the same object
the commit consumes.

### B. A parallel planner over `EffectPlan` (rejected)

Walking the effect plan separately to produce a report is less code today and
duplicates every normalization rule: synthesized parent directories, collision
detection, no-op collapse, fingerprint derivation. Each rule then has two
implementations that must be kept in agreement by hand, with nothing failing
when they stop agreeing.

### C. Commit into a scratch copy and diff it (rejected)

Copying the project, applying, and diffing would produce a faithful preview at
the cost of doing the whole mutation, needing disk proportional to the project,
and being wrong the moment an effect reaches outside the copy. It also cannot
preview a decision that fails a precondition, which is exactly the case where a
preview matters most.

## Where the decision already lives

`applyPlan` runs this sequence:

```text
snapshotApplyInput      freeze caller input
preflightManagedTransactions   reconcile orphans, reject incomplete   <-- writes
prepareEventAppend      derive stream and snapshot writes (inspect only)
expandAppendEffect      fold those writes into the effect plan
observeManagedPaths     read every destination fingerprint
normalizeManagedMutationPlan   pure: noop or one ordered plan
------------------------------------------------------------------ decision ends
executeManagedMutation  durable transaction
emit                    structured and human output
```

Everything above the line is the decision. `previewPlan()` is that prefix,
returning what `normalizeManagedMutationPlan` produced together with the
observations it was derived from.

One step in the prefix writes: `preflightManagedTransactions` reconciles
unmarked transaction directories before rejecting incomplete ones. A preview
must not perform that cleanup, and must not pretend it happened either — a
project holding an incomplete transaction is a project where the real apply
would stop. The preview therefore inspects without reconciling and reports the
blocked verdict, naming the transaction to recover. Silently clearing residue
would make a read-only operation mutate; silently skipping the check would make
the preview promise a commit that cannot happen.

## Preview shape

```ts
export type MutationPreview =
  | { readonly kind: "noop"; readonly observed: readonly ObservedPath[] }
  | {
      readonly kind: "ready";
      readonly operations: readonly PreviewOperation[];
      readonly observed: readonly ObservedPath[];
      readonly emits: readonly PreviewEmit[];
      readonly planDigest: string;
    }
  | { readonly kind: "blocked"; readonly reasonCode: string; readonly evidence: readonly EvidenceRef[] };
```

`PreviewOperation` carries the operation identifier, kind, destination path, the
expected fingerprint, and the resulting fingerprint. It does not carry content.

`planDigest` is the digest of the canonical plan the commit would submit — the
same value the transaction manifest records — so a preview and the manifest that
follows it can be compared by a person rather than by trust.

## Proving zero mutation

The acceptance criterion is that a dry run causes no filesystem, Git, lock,
event, timestamp, or state mutation. Asserting that by inspecting the code is
how it stays true until someone adds a call.

`readOnlyPorts(ports)` returns the same `RuntimePorts` with every mutating
durable primitive replaced by one that throws. The preview runs against those
ports in the tests, so a future write is a failing test rather than a review
comment. Read primitives pass through untouched.

Timestamps are the subtle case. The preview reads the clock, because a decision
may depend on the current time, but it records no timestamp anywhere and creates
no identifier: `ids.next()` is never called, since consuming an identifier for a
preview would advance a sequence the real apply then skips.

## Preconditions and invalidation

This section claimed no new machinery was needed, and the property test written
against it proved that wrong. The reasoning was that every `ManagedOperation`
already carries the `expected` fingerprint its destination held, and the
transaction boundary already refuses a plan whose destinations moved.

Both facts are true and neither closes the gap. An apply does not replay a
plan; it re-decides from current state, which is what keeps it correct. So a
destination that moved after the preview simply produces a *different* valid
decision, and the apply commits that one — silently substituting work a person
never saw for the work they approved. Nothing conflicts, because nothing is
being compared.

`ApplyPlanOptions` therefore accepts the preview the caller was shown. When it
is present, the apply compares the decision it just reached against that
preview and refuses with `runtime.revision_conflict`, naming the destination
that diverged. Comparing plan digests is enough: they are derived from the same
canonical operations the manifest records, so any change in destination, order,
precondition, or content changes them.

The comparison includes the precondition, not only the outcome. A destination
somebody else rewrote can still end at the same bytes, and the only trace of
their write is the state the decision started from.

Passing the preview back is optional. An apply with no preview in hand behaves
exactly as it did before, which keeps every existing caller correct.

## Redaction

`ManagedOperation` carries `content` for a write. The preview never renders it.
It renders the path, the operation kind, and both fingerprints — size and
SHA-256 — which is enough to answer "what changes, and to what" and not enough
to leak a secret a command was about to persist.

This follows the rule the result contract already enforces: evidence carries
references and digests, never raw bytes or prompt text.

## Explanation primitives

An explanation connects a decided operation to why it was decided. The existing
`Result` envelope already carries `reasonCode`, `why`, and `evidence`, so
explanation is a projection of the preview into that envelope rather than a new
output family:

- each blocked preview maps to its reason code with the artifact to act on;
- each ready preview reports the operation count, the plan digest, and the
  destinations as evidence references; and
- a no-op preview reports that the requested state already holds, which is a
  decision worth naming rather than an empty result.

JSON mode emits exactly one object, as every other command does. Human mode
renders the same content as a stable ordered list, sorted by destination path so
two runs of the same decision are byte-identical.

## Compatibility boundary

The issue asks for universal `--dry-run` rendering. The frozen `go-v3-v0.6.5`
inventory has exactly two global flags, `--expect` and `--require-contract`, and
none of its 59 command flags is `--dry-run`. The string does not appear in the
discovery inventory at all.

The repository already refused `--require-contract`, a flag that *is* frozen,
because the evidence did not establish which contract family it pinned:
accepting it would have invented a compatibility rule. A flag with no frozen
evidence is the clearer case of the same rule.

The bundle also exposes no mutating command yet. A global `--dry-run` today
would be a flag accepted with nothing to preview.

This issue therefore delivers the primitives and leaves the public flag to
whichever issue introduces the first mutating command, which is the issue that
can also prove the flag against a real decision. Parity stays 0 / 400.

## Failure and result mapping

| Situation | Reason |
| --- | --- |
| An incomplete transaction blocks any commit | `runtime.recovery_required` |
| A destination moved between preview and apply | `runtime.revision_conflict` |
| An effect aims outside the managed scope | `guard.outside_allow` |
| A plan violates a normalization rule | `runtime.state_corrupt` |

Every one of these is a code the preview surfaces from the shared path, not a
code it invents.

## Testing strategy

**Pure normalization.** Property tests that the preview of a plan equals the
plan the commit submits, over generated effect plans: same operation count,
same order, same fingerprints, same digest.

**Zero mutation.** Every preview test runs against `readOnlyPorts`. A single
mutating call fails the test with the primitive that was called.

**Invalidation.** Preview, apply, and compare the manifest digest. Then preview,
mutate a destination, apply, and assert `runtime.revision_conflict` naming it.

**Redaction.** A plan writing a known sentinel string produces a rendered
preview, in both modes, that does not contain the sentinel and does contain its
digest.

**Blocked previews.** A project holding an incomplete transaction previews as
blocked, names the transaction, and leaves the transaction directory
byte-identical.

## Delivery boundary

This issue adds no command, no flag, no schema, and no persisted artifact. It
adds one exported preview function, a read-only port wrapper, and the rendering
and explanation projections over the existing result envelope.
