# Deterministic Memory Curation Design

Date: 2026-09-01
Status: APPROVED
Approval source: GitHub issue #149 and the approved brainstorming design

## 1. Outcome

Curated-memory merge, archive, and delete proposals are produced by one
published, versioned scoring policy. Given the same ledger, policy, explicit
evaluation date, and dependency observations, the runtime emits byte-identical
ordered proposals without a model or network call. A reviewer decides every
proposal, and the runtime commits all approved changes as one batch.

Merged lessons sum their observation counts. This resolves the issue's
conflicting wording in favor of the required combined-count test while still
guaranteeing that no source observation is discarded.

## 2. Versioned state

`state.failure-candidate@1.1.0` adds `observationCount`, `firstObservedAt`, and
`lastObservedAt`. Repeated capture atomically increments the local candidate
and advances its last observation. A readable v1 candidate has count one and
uses `firstObservedAt` for both dates until its next capture writes v1.1.

`state.curated-memory@1.1.0` adds the same observation facts to confirmed
lessons, plus canonical `technology`, `failureKind`, and `dependency` metadata.
Dependency is either `{ "kind": "path", "path": "..." }` or
`{ "kind": "none" }`. Promotion obtains counts and dates from validated
candidates; the reviewer supplies only the structured classification.

A reinforced lesson accepts only candidate identities already present in its
provenance, sums their new counts, keeps the earliest first observation and the
latest last observation, and does not change content or lesson identity.

## 3. Similarity policy

Policy `memory-curation/1.0.0` uses integer component scores from zero through
10,000 and always rounds down:

```text
similarity = floor(
  (25 * text + 45 * fix + 15 * technology + 15 * failureKind) / 100
)
```

A score of 7,500 or greater produces a merge proposal. `text` is the Jaccard
set similarity of tokens from title and causal guidance. `fix` is the Jaccard
set similarity of tokens from application guidance. Technology and failure
kind score 10,000 for exact equality and zero otherwise.

Tokenization applies Unicode NFKC, Unicode lowercase, extracts maximal runs of
letters or numbers, removes duplicates, and applies no stemming. Empty sets
have zero similarity. The exact stopword set is:

```text
a an and are as at be been by for from has have in into is it of on or that
the this to was were when with
```

The correction has the largest weight because reusable action is the lesson's
core. Descriptive text distinguishes superficially similar fixes. Technology
and failure kind provide enough context for equivalent traps with different
titles. The threshold permits an identical fix in identical context without
title overlap, but not identical description and context with an unrelated
fix.

Merge unions causal guidance, application guidance, and candidate identities;
sums observation counts; and preserves the earliest and latest observations.
The source with the greatest observation count supplies title and scalar
metadata, with lowest lesson identifier as the tie-breaker.

## 4. Obsolescence policy

Curate requires `--as-of YYYY-MM-DD`, interpreted as midnight UTC. Dates before
a lesson's last observation are invalid.

```text
ageDays = floor((asOf - lastObservedAt) / one day)
age = min(10000, floor(10000 * ageDays / 365))
rarity = floor(10000 / observationCount)
dependencyAbsent = 10000 when a declared path is missing, otherwise 0
obsolescence = floor(
  (50 * age + 20 * rarity + 30 * dependencyAbsent) / 100
)
```

A score of 7,000 or greater produces an obsolescence proposal. Count one
proposes delete; count two or greater proposes archive. Age carries half the
evidence so recent dependency churn cannot immediately erase a lesson.
Dependency absence is strong but insufficient by itself. Rarity distinguishes
one-off noise from repeated project history. The policy yields deliberate
review landmarks near 146 days for an absent one-off dependency, 292 days for
frequent absent-dependency history, and 365 days for a one-off whose dependency
still exists.

An archive tombstone retains reason, date, reviewer, and the score/component
snapshot. Delete creates no tombstone; its reviewed result and Git history are
the audit trail.

## 5. Proposal and approval flow

`kratos memory curate --as-of DATE` is read-only. It reports the policy,
evaluation date, input observations, proposal identifiers, token evidence,
component scores, final scores, and plan digest. Proposals sort by descending
score, then merge before archive before delete, then binary lexical source
identifiers.

A closed `host.memory-curation@1.4.0` approval names the reviewer, reviewed plan
digest, and exactly one approve or reject decision for every proposal. Missing,
duplicate, unknown, or overlapping approved sources fail closed. Preview with
that approval regenerates the plan and shows the final ledger plus the exact
apply argv. Apply requires `--yes`, the plan digest, and approval digest.

Ledger, projection, approval, evaluation date, policy, and dependency
observations are content-bound. A dependency path is canonical, project-local,
and observed only as missing, file, or directory. Traversal, symlink, special,
or uninspectable evidence fails closed. The transaction carries read guards so
a dependency cannot change after review and before publication.

All approved reductions run in memory before producing one final ledger and
projection pair. The existing transaction manager publishes that pair once.
Before the commit point interruption preserves the previous ledger; after the
commit point recovery completes the entire batch. No persisted ledger contains
only a subset of approved proposals.

## 6. Compatibility and migration

Predecessor schema and reason-catalog bytes remain unchanged. The global state
and host family identities remain at their current 1.4.0 revisions; only the
registered memory payload revisions advance. Existing manual v1.2 merge and
archive proposals remain supported as explicitly authored administrative
operations, not algorithmic recommendations.

`migrate memory` performs the adjacent curated-memory v1 to v1.1 migration with
human-supplied technology, failure kind, and dependency metadata for each
active lesson. It derives the only defensible historical lower bound:
`observationCount = candidateIds.length` and both observation dates equal
`confirmedAt`. Existing tombstones retain their reason and date and carry null
scoring evidence when it cannot be reconstructed. Preview, backup, receipt,
rollback, and stale-source protections follow the current memory migration.

Scoring operations refuse a v1 ledger with `memory.migration_required`.
Legacy projection reading, migration, and recovery remain available.

## 7. Host and security boundary

Scoring, tokenization, path observation, ordering, approval validation,
reduction, reason codes, and transaction planning live in the shared runtime.
Claude Code, Codex, and other hosts relay argv and render the same runtime
result. Prompts contain no curation decision. Curation imports no model or
network client, opens no socket, executes no project command, and never reads
dependency-file contents.

## 8. Verification

Evidence covers hand-computed score boundaries, tokenizer rules, date
landmarks, deterministic reruns, threshold monotonicity, lossless merge,
candidate reinforcement, explicit complete approval, overlap and stale-review
refusal, path confinement, transaction fault injection, adjacent migration,
golden proposals, predecessor-byte stability, package isolation, and host
parity. Focused suites run before `npm run verify`.
