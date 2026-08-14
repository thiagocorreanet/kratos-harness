# Issue 26 Objective Evidence

Verification record for
[#26](https://github.com/thiagocorreanet/mestre-yoda/issues/26) (`SDD-02`).

## Acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Objective lifecycle transitions are pure, deterministic, and replayable | `tests/objective-lifecycle.test.ts` -- the transition table covers all eight cases; "is deterministic for the same facts" asserts the same observation, request, and instant produce the same decision; the instant is an input rather than a read |
| Conflicting creation fails without mutation and gives actionable recovery | `tests/objective-command.test.ts` -- "refuses a divergent objective without --replace" asserts exit 3, `trail.objetivo_divergente`, and a byte-identical project afterwards; the catalog supplies the recovery text |
| Budgets are absent unless explicitly requested | `tests/objective-lifecycle.test.ts` -- "records no budget, because nothing asks for one"; the schema makes `budget` optional and no frozen flag requests one |

## Scope and deliverables

| Deliverable | Evidence |
| --- | --- |
| Model identity, text, status, timestamps, optional budget, and correlation | `schemas/state/feature.v1.schema.json` plus the generated `FeatureStateV1`; correlation is the feature identity, which links the objective to the directory every later artifact lands in |
| Only explicit requests create objectives; only one unfinished objective exists | The command is the only writer, and `.brain/02-features/active` names exactly one feature: "records the demand and activates its feature" and "replaces a divergent objective when told to" |
| Universal results for create, query, conflicting create, and completed replacement | "records the demand...", "is idempotent when the same demand repeats", "refuses a divergent objective without --replace", "reopens after the objective was completed" |
| Match the legacy command surface exactly | `tests/cli-help.test.ts` pins the rendered help; the command declares exactly `--replace` and `--root`, and "refuses a flag this command does not declare" proves nothing else is accepted |

## Required test cases

| Case | Evidence |
| --- | --- |
| State-transition table | `tests/objective-lifecycle.test.ts` -- eight labeled rows over the three observations and both authorizations |
| Randomized command sequences | "never loses the invariant under seed %i" -- five seeded runs of forty steps mixing record, repeat, replace, complete, and empty text, asserting refusals never mutate and exactly one objective exists |
| Identity | Five naming cases plus four that name nothing, and the truncation boundary |
| Rendered artifacts | The document reproduces the text verbatim; the history line has sorted keys |
| Unicode and quoting | "preserves quoted Unicode text exactly" round-trips `"café"`, an em dash, and Japanese through the command |

## Commands run

```text
npx vitest run tests/objective-lifecycle.test.ts   # 34 tests
npx vitest run tests/objective-command.test.ts     # 18 tests
npm test                                           # 3598 tests, 124 files
npm run test:coverage                              # 100% on all four measures
npm run verify
```

## What is not covered

**Objective differential fixtures against Go.** The issue asks for them. No
`objective` capture exists: the inventory carries the command, its two flags,
and its two generated paths under hash-only provenance, with no behavioral
capture behind them. Producing that capture is `CMP-05`, and until it exists
there is nothing to compare a fixture against.

This is why the five objective rows move to `in_progress` rather than `parity`,
and why parity stays `0 / 400 (0.00%)`.

**Events in the canonical event store.** The issue asks for canonical events.
The event store from `RUN-06` writes `.brain/runs/<run-id>/events.jsonl`, and
runs are `SDD-03` work -- an objective has no run yet. The append-only
`objective-history.jsonl` is the frozen inventory's record for this lifecycle
and carries every transition with its lineage; wiring the same transitions into
the sealed event stream belongs with the run lifecycle that gives them a stream
to live in.

## Decisions worth reviewing

**Feature identity is derived from the text.** A counter would be shorter but
would make the identity depend on when the objective was asked for. Two runs of
the same demand would name two features, and a replay would land somewhere the
original never wrote.

**A replacement does not inherit history.** The new feature's history begins
with the line explaining what it displaced. The exception is a reworded demand
that slugs to the same feature, where the history continues because the feature
did not move.

**Unreadable feature state is refused rather than restarted.** Treating it as a
fresh start would silently discard whatever that feature was for.
