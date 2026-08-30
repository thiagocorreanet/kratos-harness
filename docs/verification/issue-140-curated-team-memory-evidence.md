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

## Acceptance matrix

| Issue acceptance criterion | Exact executable evidence | Artifact or outcome |
| --- | --- | --- |
| Identical and volatile-only near-identical failures make one candidate | `tests/workflow-hook-domain.test.ts` normalization tables; `tests/workflow-hook-runtime.test.ts` repeated hook and manual capture cases | One local candidate; ANSI/control, whitespace, timestamps, UUIDs, accepted temporary nonces, and source locations normalize conservatively. |
| A substantive difference remains distinct | `tests/workflow-hook-domain.test.ts` case, number, relative path, command, test-name, and semantic temporary-path cases | Candidate identity retains substantive values. |
| Manual capture uses the candidate inbox and cannot promote | `tests/workflow-hook-runtime.test.ts` — manual capture leaves curated state without confirmed lessons; `tests/cli-commands.test.ts` | `host.memory-capture@1.2.0`; only a candidate effect is planned. |
| Confirmed memory changes only after digest-bound explicit promotion | `tests/curated-memory-runtime.test.ts` — preview then apply, reviewed-time replay, and stale observations | Apply requires `--yes`, proposal digest, plan digest, and plan time. |
| Promotion without causal or application guidance is refused | `tests/curated-memory-reasons.test.ts`; `tests/curated-memory-runtime.test.ts` | Stable `memory.lesson_incomplete` result, exit 2. |
| Merge retains all source causal, application, and provenance items | `tests/curated-memory-domain.test.ts` — exact merge union; `tests/curated-memory-runtime.test.ts` — real merge and tombstones | Deterministic exact set union; no source item is discarded. |
| Archive removes an active lesson and records why | `tests/curated-memory-runtime.test.ts` — archive preview/apply; `tests/curated-memory-domain.test.ts` rendering golden | Source becomes a reviewer/reasoned archive tombstone. |
| More than 24 lessons or 48 KiB projection requires curation | `tests/curated-memory-domain.test.ts` — 24-lesson and merge-overflow boundaries; `tests/curated-memory-runtime.test.ts` | Stable `memory.curation_required`, exit 3; ledger also bounds archive to 48 tombstones. |
| Candidates are local while the ledger/projection are committed | `tests/state-ignore-rules.test.ts`, `tests/init-skeleton.test.ts`, and `tests/workflow-hook-runtime.test.ts` | `.brain/03-memory/candidates/*.json` is ignored; ledger and projection are initialized/managed state. |
| Free-form Gotchas migrate without silent loss | `tests/memory-migration-domain.test.ts` and `tests/memory-migration-runtime.test.ts` | Exact one-based non-template/non-blank line coverage, backup, receipt, and rollback. |
| Code/review outputs acknowledge the supplied digest | `tests/memory-phase-binding.test.ts`, `tests/agent-output-recording.test.ts`, and `tests/phase-agent-relay-distribution.test.ts` | v1.2 `memory` is required for code/review and null for other phases; stale acknowledgement is `memory.phase_context_stale`. |
| Capture has no model, network, or project-command escape | `tests/memory-capture-distribution.test.ts` and `tests/workflow-hook-distribution.test.ts` | Both packaged hosts capture with `PATH` empty; shipped hook sources reject model/network imports. |
| Claude Code and Codex relay equivalent contracts and decisions | `tests/memory-capture-distribution.test.ts`, `tests/phase-agent-relay-distribution.test.ts`, and `tests/runtime-distribution.test.ts` | Each host is built independently and exercises the same embedded runtime contracts. |

## Required test and contract coverage

The domain suite covers ordering, projection bytes/digests, bounded active
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
`/tmp/kratos-plugin-vitest-build-<pid>`. The regression test
`tests/built-plugin-isolation.test.ts` first failed against the fixed path and
then passed with the process-unique path. The final fresh `verify` did not
encounter the race; its runtime-distribution suite passed as part of the full
184-file result.

## Verification commands and observed results

Focused curated-memory and integration verification:

```text
corepack npm run format:check
corepack npm run spellcheck
corepack npm run english:check
corepack npm run contracts:check
corepack npm run parity:check
corepack npm test -- tests/curated-memory-domain.test.ts tests/curated-memory-runtime.test.ts tests/curated-memory-reasons.test.ts tests/memory-migration-domain.test.ts tests/memory-migration-runtime.test.ts tests/memory-phase-binding.test.ts tests/workflow-hook-domain.test.ts tests/workflow-hook-runtime.test.ts tests/memory-capture-distribution.test.ts tests/phase-agent-prompts.test.ts tests/phase-agent-relay-distribution.test.ts tests/agent-output-recording.test.ts tests/cli-commands.test.ts tests/cli-composition.test.ts tests/state-ignore-rules.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/init-fault-campaign.test.ts tests/runtime-distribution.test.ts
```

Result: 19 files and 216 tests passed in 65.48 seconds.

The stale initialization and contract-inventory repairs were separately
verified with 4 files and 303 tests passing. The process-isolation regression
and packaged distribution suite passed with 7 files and 43 tests.

The final pinned gate was:

```text
corepack npm --version
corepack npm run verify
```

Observed npm version: `11.16.0`. Final result: exit 0. The main test run and
coverage run each passed 184 files and 4,796 tests. Coverage was 92.62%
statements (7,892/8,520), 87.71% branches (6,034/6,879), 94.78% functions
(1,364/1,439), and 93.54% lines (7,217/7,715). Mutation was 3/3 (100%).
Gap calibration found 10/10 planted gaps with zero false gaps. Runtime source
was 1,178,572/1,500,000 bytes; schemas were 163,854/250,000 bytes. The oracle
verified 12 surfaces, 4 PRD anchors, and 3 binaries; parity was 0/400 gaps;
contracts verified 41 schemas and 14 legacy profiles; differential self-tests
were equal; build and package verification passed for both hosts. Benchmark
p95 values were help 275.545075 ms, version 194.980751 ms, and handshake
190.104195 ms; bundle size was 1,490,957 bytes.

The acceptance matrix has 12 rows for the 12 issue checkboxes. Diff and
predecessor-byte audit results are recorded with the Task 6 report.

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
- Focused command: the exact `corepack npm test -- ...` command in this record
- Repository gate: `corepack npm run verify` — PASS, exit 0; 184 files and 4,796 tests
- Contract parity: `corepack npm run contracts:check` and `corepack npm run parity:check`
- Diff hygiene: `git diff --check`
```
