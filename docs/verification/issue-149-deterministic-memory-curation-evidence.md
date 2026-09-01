# Issue #149 deterministic memory curation evidence

Date: 2026-09-01

Related: #149 (`SDD-15A`) and dependency #140 (`SDD-15`).

## Acceptance evidence

| Criterion | Executable evidence | Result |
| --- | --- | --- |
| Same input produces the same proposals without a model | `tests/memory-curation-scoring.test.ts`, `tests/memory-curation-runtime.test.ts` | Pure integer scorer and byte-identical repeated CLI output |
| Every proposal reports score and components | `tests/memory-curation-scoring.test.ts`, `fixtures/memory-curation/v1/expected-proposals.json` | Golden merge/delete proposals include totals, components, and token sets |
| No change without explicit approval | `tests/memory-curation-reducer.test.ts`, `tests/memory-curation-runtime.test.ts` | Complete approve/reject set plus digest-bound `--yes` is required |
| Merge retains both meanings and combined count | `tests/memory-curation-reducer.test.ts`, `tests/memory-curation-runtime.test.ts` | Exact cause/fix/provenance union and summed observation count |
| Archive remains findable with reason and date | `tests/memory-curation-reducer.test.ts` | Tombstone retains reviewer, date, reason, score, and components |
| Interrupted batch leaves authority unchanged | `tests/memory-curation-runtime.test.ts` | Injected pre-commit publication failure preserves both prior files |
| Threshold direction is asserted | `tests/memory-curation-scoring.test.ts` | Lower/higher injected thresholds add/remove proposals monotonically |

## Required scoring evidence

Policy `memory-curation/1.0.0` is declared in
`packages/runtime/src/domain/memory/curation.ts`. Similarity uses weights
25/45/15/15 and threshold 7,500. Obsolescence uses weights 50/20/30 and
threshold 7,000. All component and total calculations are integers rounded
down. The scoring suite contains hand-computed 7,590 and 7,465 neighbors,
tokenization/Jaccard tables, date landmarks, deterministic reruns, stable
ordering, and threshold monotonicity.

The exact stopwords are `a an and are as at be been by for from has have in
into is it of on or that the this to was were when with`. Tokenization is
Unicode NFKC, Unicode lowercase, maximal letter/number runs, set deduplication,
and binary lexical ordering without stemming.

## State, compatibility, and security impact

- State: additive candidate and ledger v1.1 contracts store observation facts
  and classification metadata. `migrate memory` upgrades v1 explicitly with a
  backup, receipt, verification record, and rollback.
- Compatibility: every predecessor schema remains registered. Manual v1.2
  promote/merge/archive behavior remains available. Current v1.4 promotion and
  reinforcement use structured metadata. Claude Code and Codex relay the same
  runtime commands and decisions.
- Security: the scorer imports no model or network client and executes no
  project command. Dependency paths are closed, project-relative schema values;
  composition observes only missing/file/directory status and refuses symlinks.
  Approval, ledger, projection, proposal, date, and observed file identities are
  digest/precondition bound.

## Verification commands

```bash
corepack npm run contracts:check
corepack npm test -- --run tests/memory-curation-scoring.test.ts tests/memory-curation-reducer.test.ts tests/memory-curation-runtime.test.ts tests/workflow-hook-domain.test.ts tests/workflow-hook-runtime.test.ts tests/memory-migration-domain.test.ts tests/memory-migration-runtime.test.ts tests/curated-memory-domain.test.ts tests/curated-memory-runtime.test.ts tests/cli-commands.test.ts tests/command-observation.test.ts tests/schema-registry-fixtures.test.ts tests/schema-registry-types.test.ts tests/contract-manifest.test.ts tests/contract-type-generation.test.ts
corepack npm run typecheck
corepack npm run verify
git diff --check
```

## Pull request text

Title: `feat(memory): make curation a deterministic scoring function`

Body:

> Closes #149. Depends on #140.
>
> Publishes deterministic integer similarity and obsolescence policies,
> complete per-proposal human approval, one-batch managed publication,
> observation reinforcement, and explicit curated-memory v1 to v1.1 migration.
>
> Compatibility: additive contracts; predecessor schemas and manual v1.2
> memory changes remain supported. State: candidate/ledger v1.1 requires the
> explicit adjacent migration before scoring. Security: no model, network, or
> project-command authority enters scoring; dependency evidence is metadata
> only and review/apply is digest bound.
>
> Verification: run the exact commands in
> `docs/verification/issue-149-deterministic-memory-curation-evidence.md`.
