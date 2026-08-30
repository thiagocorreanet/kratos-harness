# Issue #140 curated team memory evidence

Date: 2026-08-29

This record supplies local, deterministic evidence for issue #140. It does not
create or push a pull request, and it makes no claim about remote CI.

## Delivered boundary

Automatic failed-tool capture and manual `memory capture` place sanitized,
deduplicated candidates only in the machine-local ignored inbox. The committed
authority is `state.curated-memory@1.0.0` at
`.brain/03-memory/curated-memory.json`; `gotchas.md` is its deterministic
SHA-256-bound Markdown projection. Digest-bound human preview/apply commands
are the only route to confirmed lessons. Claude Code and Codex relay the same
runtime policy and exact code/review memory observation.

The public command grammar, proposals, limits, Git classification, recovery,
and acknowledgement rules are documented in the [command reference](../user/commands.md),
[state guide](../user/configuration-and-state.md), [migration guide](../user/migration-and-recovery.md),
and [host guide](../user/hosts.md). Contract evolution is recorded in the
[compatibility guide](../compatibility/contract-versioning.md).

## Issue #140 deliverables — 8 of 8 checked

| Status | Deliverable from issue #140 | Exact executable evidence | Artifact or outcome |
| --- | --- | --- | --- |
| - [x] | Separate captured candidates from confirmed lessons so capture cannot pollute the curated section | `tests/state-ignore-rules.test.ts`, `tests/init-skeleton.test.ts`, and `tests/workflow-hook-runtime.test.ts` | Ignored `.brain/03-memory/candidates/*.json`; committed `state.curated-memory@1.0.0` ledger and projection. |
| - [x] | Capture tool failures automatically with deduplication and no model call | `tests/workflow-hook-domain.test.ts`, `tests/workflow-hook-runtime.test.ts`, and `tests/memory-capture-distribution.test.ts` | Conservative normalized identity; automatic capture stays local and model-free. |
| - [x] | Provide human-reviewed promotion into a confirmed lesson | `tests/curated-memory-runtime.test.ts` and `tests/cli-commands.test.ts` | Read-only preview followed by digest-bound `--yes` apply. |
| - [x] | Require a lesson to explain why and how to apply it | `tests/curated-memory-reasons.test.ts` and `tests/curated-memory-runtime.test.ts` | Missing `why` or `apply` is `memory.lesson_incomplete`, exit 2. |
| - [x] | Provide merge and archive curation | `tests/curated-memory-domain.test.ts` and `tests/curated-memory-runtime.test.ts` | Exact-union merge, reasoned archive tombstones, and active-memory limits. |
| - [x] | Make implementer and reviewer phases read confirmed memory | `tests/memory-phase-binding.test.ts`, `tests/agent-output-recording.test.ts`, and `tests/phase-agent-relay-distribution.test.ts` | v1.2 handoff/output carries the exact `gotchas.md` observation for code and review. |
| - [x] | Keep shared memory committed and readable | `tests/init-skeleton.test.ts`, `tests/curated-memory-domain.test.ts`, and `tests/state-ignore-rules.test.ts` | Deterministic Markdown projection; 24 active lessons and 48 KiB rendered-byte limits. |
| - [x] | Provide manual capture for traps without a tool failure | `tests/workflow-hook-runtime.test.ts` and `tests/cli-commands.test.ts` | `memory capture` enters the same candidate inbox and cannot promote. |

## Issue #140 acceptance criteria — 6 of 6 checked

| Status | Acceptance criterion from issue #140 | Exact executable evidence | Artifact or outcome |
| --- | --- | --- | --- |
| - [x] | The same failure occurring twice produces one candidate | `tests/workflow-hook-domain.test.ts` and `tests/workflow-hook-runtime.test.ts` | Identical and volatile-only near-identical failures deduplicate. |
| - [x] | A candidate never reaches confirmed memory without explicit promotion | `tests/workflow-hook-runtime.test.ts` and `tests/curated-memory-runtime.test.ts` | Capture only plans a candidate; confirmation requires preview, digest, time, and `--yes`. |
| - [x] | A confirmed entry missing its reasoning is refused | `tests/curated-memory-reasons.test.ts` and `tests/curated-memory-runtime.test.ts` | Stable `memory.lesson_incomplete` refusal. |
| - [x] | Curation preserves the substance of merged entries | `tests/curated-memory-domain.test.ts` and `tests/curated-memory-runtime.test.ts` | Merge retains every `why`, `apply`, and candidate-provenance value. |
| - [x] | Capture makes no model call or network access | `tests/memory-capture-distribution.test.ts` and `tests/workflow-hook-distribution.test.ts` | Both packaged hosts run with no model/network dependency; capture also executes no project command. |
| - [x] | Implementation and review demonstrably read confirmed memory | `tests/memory-phase-binding.test.ts`, `tests/agent-output-recording.test.ts`, and `tests/phase-agent-relay-distribution.test.ts` | Matching v1.2 acknowledgement is required before recording code/review output. |

## Issue #140 required tests and evidence — 3 of 3 checked

| Status | Required test from issue #140 | Exact executable evidence | Artifact or outcome |
| --- | --- | --- | --- |
| - [x] | Deduplication across repeated identical and near-identical failures | `tests/workflow-hook-domain.test.ts` and `tests/workflow-hook-runtime.test.ts` | Normalization boundary and repeated-delivery cases. |
| - [x] | Promotion is required and cannot be implicit | `tests/workflow-hook-runtime.test.ts` and `tests/curated-memory-runtime.test.ts` | Capture cannot promote; confirmation is explicit and digest-bound. |
| - [x] | Merge retains both original meanings | `tests/curated-memory-domain.test.ts` and `tests/curated-memory-runtime.test.ts` | Exact union of the original causal and application guidance. |

## Required test and contract coverage

The 17 explicit issue rows above are deliberately separate from the broader
13-item objective-spec acceptance list. The domain suite covers ordering, projection bytes/digests, bounded active
memory, lossless merge, and overflow. The runtime suite covers read-only
preview, confirmed apply, stale proposal/ledger/projection/candidate state,
transaction interruption/recovery, candidate cleanup retention, archive, and
merge. Migration tests cover classification, source coverage, preview/apply,
receipt/backup, rollback, and recovery races. Phase tests cover v1.2 schema
selection, empty and populated observations, legacy migration refusal,
projection drift, null non-code/review observations, and exact acknowledgement.

`tests/contract-manifest.test.ts`, `tests/contract-schemas.test.ts`,
`tests/contract-type-generation.test.ts`, `tests/contract-reason-catalog.test.ts`,
`tests/schema-registry-fixtures.test.ts`, and
`tests/schema-registry-types.test.ts` prove the closed schemas, generated
declarations, appended reason catalogue, fixtures, and explicit version
selection. `corepack npm run contracts:check` verifies 41 schemas, 14 legacy
profiles, and generated declaration drift without rewriting the checkout.
Predecessor schema and reason bytes are separately compared with merge base
`ebbced0`; the audit result appears in the final verification record below.

## Compatibility, state, and security impact

Compatibility is additive: state and host families advance to v1.2, and the
reason catalogue advances to v1.9. `state.curated-memory@1.0.0` and the three
memory proposal contracts are new; v1.2 handoff/output contracts are selected
explicitly. Existing versioned schemas and reason catalogues are immutable.

Fresh projects receive an empty ledger and deterministic projection. Existing
custom Gotchas content is migration-required, not heuristically parsed. A
digest-bound `migrate memory` preview maps every qualifying legacy line once;
apply stores the original bytes, receipt, authorization, rollback, and
verification artifacts beneath `.brain/migrations/`. `migrate rollback` checks
the current ledger/projection and backup before restoring exact original bytes.

Candidates are bounded sanitized local diagnostics; they are ignored by Git.
The ledger and projection are committed and publish together under managed
preconditions. Capture does not call a model, access a network/socket, or run a
project command. Curation is human-authorized and digest-bound; capture cannot
promote. Hosts relay rather than decide memory policy.

## Shared temporary-build race baseline

The repository has a historical shared-build hazard: legacy packaged-runtime
tests used the fixed `/tmp/kratos-plugin-vitest-build` output. Concurrent
worktrees could replace that directory between a suite's build and manifest
read, producing two `tests/runtime-distribution.test.ts` failures at the
parameterized `binds the <host> manifest to its runtime and host` assertion
(one Codex and one Claude Code) even when source and manifest expectations
were correct. This work reproduced the race during the second full gate while
another worktree built concurrently: `scripts/build.mjs --output
/tmp/kratos-plugin-vitest-build` failed with `ENOENT` opening
`.runtime-template/source/packages/runtime/src/domain/cli/migration.js`.

The test-only `tests/support/built-plugin.ts` helper now derives
`/tmp/kratos-plugin-vitest-build-<pid>`. It removes only that validated exact
path before each build and from a normal Node `exit` handler, so repeat calls
are safe and normal child exit retains no new build directory. The regression
in `tests/built-plugin-isolation.test.ts` starts two real builds concurrently,
proves that their roots are distinct, and checks that neither root exists after
the child exits. SIGKILL or machine loss cannot run an exit handler; a residual
is confined to that PID-named temporary root and a later owner of the same PID
removes it before building. The helper never sweeps a broad `/tmp` target.

## Verification commands and observed results

Focused Task 6 documentation, contract, memory, and isolation verification:

```text
corepack npm run format:check
corepack npm run spellcheck
corepack npm run english:check
corepack npm run contracts:check
corepack npm run parity:check
corepack npm test -- tests/built-plugin-isolation.test.ts tests/contract-compatibility.test.ts tests/contract-manifest.test.ts tests/contract-reason-catalog.test.ts tests/contract-schemas.test.ts tests/contract-type-generation.test.ts tests/schema-registry-fixtures.test.ts tests/schema-registry-types.test.ts tests/curated-memory-domain.test.ts tests/curated-memory-runtime.test.ts tests/curated-memory-reasons.test.ts tests/memory-migration-domain.test.ts tests/memory-migration-runtime.test.ts tests/memory-phase-binding.test.ts tests/workflow-hook-domain.test.ts tests/workflow-hook-runtime.test.ts tests/memory-capture-distribution.test.ts tests/phase-agent-prompts.test.ts tests/phase-agent-relay-distribution.test.ts tests/agent-output-recording.test.ts tests/cli-commands.test.ts tests/cli-composition.test.ts tests/state-ignore-rules.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/init-fault-campaign.test.ts tests/runtime-distribution.test.ts
```

The focused result is recorded with the Fix Round 1 verification record below.
The command includes the process-isolation regression, exact version-selection
tests, the public-facing memory suites, and the stale initialization-count
coverage repaired on this branch.

The pinned repository gate is:

```text
corepack npm --version
corepack npm run verify
```

Observed npm version and the fresh committed-current-HEAD result are recorded
in the Fix Round 1 task report. This record intentionally does not reuse an
earlier gate as its final or current result. The issue mapping above has 17
explicit checkbox rows: 8 deliverables, 6 acceptance criteria, and 3 required
tests. Diff and predecessor-byte audit results are also recorded in that report.

## Pull-request-ready text

The following is ready to copy into a pull request description; no pull request
has been created.

```markdown
Closes #140

### Compatibility impact

This is an additive v1.2 state/host contract release with a v1.9 reason
catalogue. Existing schema and reason-catalogue bytes remain immutable.

### State and migration impact

Candidates remain local and ignored. The committed curated ledger and
deterministic Gotchas projection publish together. Existing custom Gotchas
requires an explicit lossless, digest-bound migration with backup, receipt,
and verified rollback.

### Security impact

Capture is sanitized, bounded, model-free, network-free, and does not execute
project commands. Promotion is explicit, human-reviewed, and digest-bound.
Both host adapters only relay the runtime's memory decision and phase digest.

### Deterministic verification

- Acceptance evidence: `docs/verification/issue-140-curated-team-memory-evidence.md`
- Focused command: `corepack npm test -- tests/built-plugin-isolation.test.ts tests/contract-compatibility.test.ts tests/contract-manifest.test.ts tests/contract-reason-catalog.test.ts tests/contract-schemas.test.ts tests/contract-type-generation.test.ts tests/schema-registry-fixtures.test.ts tests/schema-registry-types.test.ts tests/curated-memory-domain.test.ts tests/curated-memory-runtime.test.ts tests/curated-memory-reasons.test.ts tests/memory-migration-domain.test.ts tests/memory-migration-runtime.test.ts tests/memory-phase-binding.test.ts tests/workflow-hook-domain.test.ts tests/workflow-hook-runtime.test.ts tests/memory-capture-distribution.test.ts tests/phase-agent-prompts.test.ts tests/phase-agent-relay-distribution.test.ts tests/agent-output-recording.test.ts tests/cli-commands.test.ts tests/cli-composition.test.ts tests/state-ignore-rules.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/init-fault-campaign.test.ts tests/runtime-distribution.test.ts`
- Documentation and contract commands: `corepack npm run format:check`, `corepack npm run spellcheck`, `corepack npm run english:check`, `corepack npm run contracts:check`, and `corepack npm run parity:check`
- Repository gate: `corepack npm --version && corepack npm run verify`
- Diff hygiene: `git diff --check`
```
