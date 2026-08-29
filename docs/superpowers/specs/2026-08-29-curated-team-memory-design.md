# Curated Team Memory Design

Date: 2026-08-29
Status: APPROVED
Approval source: GitHub issue #140 and the approved brainstorming design

## 1. Outcome

A tool or manual failure enters a local candidate inbox without a model or
network call. Only a digest-bound human promotion can turn candidates into a
committed lesson. Implementing and reviewing agents receive and acknowledge
the exact curated-memory digest before their work is recorded.

## 2. State boundary

`.brain/03-memory/candidates/*.json` remains the authoritative candidate
inbox. It is machine-local and ignored by Git. The committed authority is a
versioned curated-memory ledger, with `gotchas.md` as its deterministic human
projection. The runtime updates both committed artifacts in one managed
transaction and refuses drift.

The ledger holds at most 24 confirmed lessons and 48 archive tombstones. A
confirmed lesson has a stable identifier, title, one or more causal `why`
items, one or more actionable `apply` items, candidate provenance, reviewer,
and confirmation time. The rendered Markdown may not exceed 48 KiB. Archive
tombstones retain the lesson identity, title, provenance, reviewer, reason,
time, and optional replacement identity; older tombstones remain in Git
history after the rolling 48-entry window.

## 3. Capture and deduplication

Automatic hook capture and `memory capture` share one pure reducer. Manual
capture uses tool family `other`, failure class `unknown`, and a null exit
code. Both paths sanitize to the existing 2 KiB diagnostic limit.

The candidate identifier hashes tool family, failure class, exit code, and a
conservatively normalized diagnostic. Normalization removes ANSI/control
noise, collapses whitespace, and replaces ISO timestamps, UUIDs,
temporary-path nonces, and line/column coordinates. Case, substantive numbers,
project-relative paths, commands, and test names remain significant. Existing
v1 candidates are scanned and assigned the same in-memory normalization key,
so adoption needs no candidate migration.

## 4. Promotion and curation

`memory promote`, `memory merge`, and `memory archive` accept closed structured
proposals. The first invocation is read-only and prints the exact resulting
change, plan digest, plan time, and apply command. Apply requires `--yes`, the
same digest, and the same time. Candidate, proposal, ledger, or projection
drift invalidates authorization.

Promotion requires at least one candidate plus title, reviewer, nonempty
`why`, and nonempty `apply`. After the committed ledger and projection publish,
promoted local candidates are deleted. Merge accepts two or more lessons,
unions every causal item, application item, and provenance identifier with
exact deduplication, creates a replacement lesson, and archives the sources.
Archive requires an obsolescence reason. Promotion over either readability
limit is blocked until curation reduces the active surface.

## 5. Existing projects

Fresh initialization writes an empty ledger and its Markdown projection.
Existing free-form `gotchas.md` is never parsed heuristically. `migrate memory`
binds the legacy digest and requires each non-template, nonblank content line
to be covered exactly once by a validated lesson mapping. Preview/apply,
backup, receipt, and rollback use the existing migration conventions. Until
adoption, code and review handoffs return a stable migration-required result.

## 6. Phase consumption

The current phase-handoff and agent-output contracts gain v1.2 variants. Code
and review carry a memory observation containing the `gotchas.md` reference,
SHA-256 digest, and confirmed lesson identifiers; other phases carry null.
Canonical implementer and evaluator prompts require reading the confirmed
section and returning the same observation. `agent record` rejects missing,
mismatched, or stale acknowledgement before accepting phase output.

The runtime owns state, validation, normalization, rendering, migration,
reason codes, and phase checks. Claude Code and Codex only render and relay the
same runtime values.

## 7. Failure and compatibility policy

The additive reason catalogue distinguishes incomplete lessons, required
curation, missing candidates, projection drift, stale confirmation, stale
phase context, and required migration. Malformed persisted state retains
`runtime.state_corrupt`. Predecessor schemas and catalogues remain byte-stable;
new contract variants are selected explicitly.

Transactions publish the ledger and projection together. Interruption leaves
the previous pair intact or a recoverable transaction. No failed transaction
deletes a candidate. Capture imports no model or network client, opens no
socket, and executes no project command.

## 8. Verification

Evidence covers identical and near-identical deduplication, distinct-failure
separation, legacy candidates, manual capture, explicit promotion, required
reasoning, lossless merge, archive and size limits, golden projection bytes,
drift refusal, lossless migration and rollback, transaction faults, phase
digest acknowledgement, and cross-host parity. Focused suites run before
`npm run verify`.
