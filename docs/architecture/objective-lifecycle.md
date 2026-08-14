# The Objective and Its Lifecycle

The objective is the root of every plan, budget, and piece of evidence that
follows. `yoda objective <text>` records it, and the command's whole job is to
keep that root honest.

## What the command does

```text
yoda objective <text> [--replace] [--root <path>]
```

The text is recorded exactly as supplied, trimmed of surrounding whitespace and
nothing else. Inner spacing, quotes, dashes, and non-ASCII characters survive
unchanged: the demand is the artifact, and a runtime that paraphrases it
quietly changes what was asked for.

Recording an objective writes four destinations in one transaction:

| Destination | Holds |
| --- | --- |
| `.brain/02-features/<feature>/state.json` | The objective's identity, text, status, timestamps, and revision |
| `.brain/02-features/<feature>/objective.md` | The same objective as a person reads it |
| `.brain/02-features/<feature>/objective-history.jsonl` | One append-only line per transition |
| `.brain/02-features/active` | The feature the project is working on |

## Feature identity

The feature is derived from the text and nothing else: folded to ASCII,
lowercased, non-alphanumeric runs collapsed to a single separator, truncated to
sixty-four characters. `Émigré coffee` names `emigre-coffee` on every machine.

A counter or a timestamp would make the identity depend on when it was asked
for rather than on what was asked, and a replay would land somewhere the
original run never wrote.

Text that leaves nothing to name a directory with -- punctuation only, or a
script with no ASCII equivalent -- is refused with `trail.uso` rather than
given a generated name nobody asked for.

## The rules

They apply in this order:

1. **Empty or unnameable text is refused.** Nothing is written.
2. **The same text changes nothing.** Repetition is how a caller confirms where
   they are; it is idempotent whether or not `--replace` was passed.
3. **Divergent text against an active objective is refused** with
   `trail.objetivo_divergente` unless `--replace` was passed. Replacing
   somebody's stated objective silently is how a trail stops describing the
   work it claims to.
4. **Divergent text against a completed objective opens a new one.** There is
   nothing unfinished to protect, so no authorization is required.

Only one unfinished objective exists at a time: `active` names exactly one
feature, and a new objective moves it.

## History belongs to its feature

A replacement usually names a different feature, and that feature's history
starts with the line explaining what it displaced. Inheriting the previous
feature's entries would attribute work to an objective that never asked for it,
and the displaced feature keeps its own directory so the trail can still
explain it.

When a reworded demand happens to name the same feature -- `Ship it` and
`Ship it!` both slug to `ship-it` -- the history gains a line instead of
starting over, because the feature did not move.

Each line is JSON with sorted keys: the transition, the instant, the resulting
revision, the new text, and the text it replaced.

## Determinism

The decision is a pure function of the observation, the request, and the
instant. The instant is supplied by the caller rather than read inside the
decision, so the same facts always produce the same transition -- which is what
makes the lifecycle replayable rather than merely repeatable.

Timestamps therefore appear in state without making it nondeterministic. A
repeated demand writes nothing at all, so a second run does not move them.

## Budgets

The objective can carry an explicit token budget, and never carries one by
default. No frozen flag requests a budget today, so every objective this
runtime records has none. Writing a default would be a limit nobody set.

## Completion

Completion is modeled in the domain and has no command. The frozen surface is
`objective <text>` with two flags, and acceptance semantics arrive with
`SDD-06`. The transition exists here because a completed objective is what
makes a later replacement legal, and a lifecycle that cannot reach its terminal
state cannot be tested against one.

## Result mapping

| Situation | Reason |
| --- | --- |
| Recorded, replaced, or reopened | `trail.ok`, `stateChanged: true` |
| The same objective repeated | `trail.ok`, `stateChanged: false`, nothing written |
| Empty or unnameable text | `trail.uso` |
| Divergent text without `--replace` | `trail.objetivo_divergente` |
| Active feature whose state cannot be read | `runtime.state_corrupt` |

An active feature whose `state.json` is missing, unparseable, or not feature
state is refused rather than started over. Starting over would silently discard
whatever that feature was for.

## What parity this claims

`CLI-OBJECTIVE`, `FLAG-OBJECTIVE-REPLACE`, `FLAG-OBJECTIVE-ROOT`, and the two
generated-file rows move to `in_progress` with unit evidence. None moves to
`parity`.

The inventory establishes the command, the two flag names, and the two
generated paths under hash-only provenance. It does not establish what the
legacy runtime considered divergent, how it derived a feature name, or what its
history lines contained. Those are this runtime's contract, and a parity claim
needs a differential capture to compare against, which is `CMP-05`.

Parity remains `0 / 400 (0.00%)`.
