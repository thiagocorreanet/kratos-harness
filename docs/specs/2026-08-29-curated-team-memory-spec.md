# Objective Spec: Curated Team Memory

Date: 2026-08-29
Status: APPROVED
Approval source: GitHub issue #140 and the approved curated-memory design

## 1. Problem and desired outcome

The runtime captures exact tool failures but provides no path to turn them
into durable, reviewed knowledge. The completed feature keeps automatic and
manual capture cheap, makes promotion explicitly human and digest-bound, keeps
shared memory readable, and proves code and review phases consumed it.

## 2. Scope boundary

In scope:

- local automatic and manual candidate capture with exact and conservative
  near-duplicate deduplication;
- committed structured curated memory and deterministic Markdown projection;
- previewed promotion, lossless merge, archive, and readability limits;
- lossless adoption of legacy free-form memory;
- code/review phase memory digest delivery and acknowledgement;
- host-neutral contracts, runtime policy, documentation, and evidence.

Out of scope:

- automatic promotion;
- cross-project memory;
- model-assisted capture, deduplication, summarization, or curation;
- configurable Git policy or readability limits.

## 3. Acceptance criteria

- [ ] Repeating an identical or volatile-only near-identical failure creates
  exactly one candidate.
- [ ] A substantively different failure remains a distinct candidate.
- [ ] Manual capture enters the same candidate inbox and cannot promote.
- [ ] Confirmed memory changes only after digest-bound explicit promotion.
- [ ] Promotion without causal reasoning or application rules is refused.
- [ ] Merging lessons retains every source `why`, `apply`, and provenance item.
- [ ] Archiving removes a lesson from the active section and records why.
- [ ] More than 24 confirmed lessons or 48 KiB of Markdown requires curation.
- [ ] Candidate files are machine-local; the ledger and Markdown are committed.
- [ ] Existing free-form memory is migrated without silently dropping content.
- [ ] Code and review outputs are refused unless they acknowledge the exact
  curated-memory digest supplied by the runtime.
- [ ] Capture performs no model call, network access, or project command.
- [ ] Claude Code and Codex relay equivalent memory contracts and decisions.

## 4. Test strategy and failure modes

- Domain tests cover normalization boundaries, identity stability, lossless
  unions, limits, ordering, and exact rendering.
- Runtime tests cover manual/hook capture, preview/apply, stale state,
  transaction interruption, migration, rollback, and phase acknowledgement.
- Contract tests cover schemas, fixtures, generated declarations, catalogue
  immutability, stable reasons, and explicit version selection.
- Distribution tests execute both hosts and prohibit model/network/process
  escape from capture paths.
- Final evidence runs focused suites and `npm run verify`.

## 5. Compatibility, state, and security

New schemas and reason codes are additive. Predecessor bytes remain immutable.
Fresh projects receive the new committed state; existing projects require an
explicit, reversible memory migration. Candidate diagnostics remain bounded
and sanitized, unsafe filesystem entries are refused by existing ports, and
all canonical writes use managed transactions with preconditions.
