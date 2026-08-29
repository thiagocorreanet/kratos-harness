# Issue #136 model role per phase evidence

Date: 2026-08-28

## Scope and approved clarification

This record covers issue #136 and work item `FND-07`. The runtime owns the
fixed phase-to-role map, canonical model resolution, assignment digests,
independence enforcement, and persisted execution metadata. Host adapters
publish host-native catalogs and relay runtime decisions without selecting a
role or changing a verdict.

The owner-approved design removed the issue's contradictory one-time warning
criterion. If the configured implementer and judge aliases resolve to the same
canonical model, the runtime refuses with `model.independence_violation`. It
does not emit warning state and does not continue once.

This is local deterministic evidence. No pull request was created or pushed,
and this record makes no claim that remote CI is green.

## Canonical run identity

The canonical implementation verification run in this record is
`final-2be3556`:

- Observed HEAD: `2be355614c4f4736d17156d0323489d49a0fcdad`
- Commit subject: `fix: apply runtime model assignments in host relays`
- Invocation date: 2026-08-28, America/Sao_Paulo
- Command: `npm run verify`
- Result: exit 0

All full-gate summaries and benchmark values below come from that one run.
Earlier implementation and documentation runs are not used as final acceptance
evidence.

## Acceptance evidence

`A` is the focused acceptance command and `B` is the focused load-bearing
command shown in [verification commands](#verification-commands).

| # | Acceptance criterion | Exact test evidence | Command | Result |
| --- | --- | --- | --- | --- |
| 1 | Bare and object assignments validate and normalize identically | `tests/model-role-resolution.test.ts` — `normalizes the bare and object forms identically`; `tests/contract-schemas.test.ts` — `publishes closed current model-role schema shapes` | `A` | PASS — 9 files, 278 tests |
| 2 | Object assignments reject extra keys and invalid identifiers | `tests/contract-schemas.test.ts` — `publishes closed current model-role schema shapes` | `A` | PASS — 9 files, 278 tests |
| 3 | All six phases use the fixed role map | `tests/model-role-resolution.test.ts` — `binds prd to planner`, `binds spec to planner`, `binds plan to planner`, `binds code to implementer`, `binds review to judge`, and `binds acceptance to judge` | `A` | PASS — 9 files, 278 tests |
| 4 | A missing host or mapped role stops and identifies what is absent | `tests/model-role-resolution.test.ts` — `refuses a host without a role map` and `refuses a missing mapped role instead of using a catalog default`; `tests/model-role-workflow.test.ts` — `names the missing mapped role without writing anything`; `tests/init-command.test.ts` — `names the host and role for distinct model-routing refusals` | `A` | PASS — 9 files, 278 tests |
| 5 | Aliases resolving implementer and judge to one canonical model are refused | `tests/model-role-resolution.test.ts` — `rejects aliases whose canonical implementer and judge are equal`; `tests/model-role-workflow.test.ts` — `refuses aliases that resolve the implementer and judge to one canonical model` | `A` | PASS — 9 files, 278 tests |
| 6 | Unknown, ambiguous, and unsupported-effort resolution has no fallback | `tests/model-role-resolution.test.ts` — `refuses an unknown configured alias`, `refuses an alias that identifies more than one catalog model`, and `refuses an effort unsupported by the canonical model`; `tests/model-role-workflow.test.ts` — `refuses an unknown alias without mutation` and `refuses an unsupported effort without mutation` | `A` | PASS — 9 files, 278 tests |
| 7 | Both adapters publish complete defaults with distinct canonical implementer and judge models | `tests/host-adapter-contract.test.ts` — `HostAdapter contract: Codex > publishes a frozen catalog for its configuration host`, `HostAdapter contract: Claude Code > publishes a frozen catalog for its configuration host`, `keeps Codex implementer and judge defaults distinct`, and `keeps Claude Code implementer and judge defaults distinct` | `A` | PASS — 9 files, 278 tests |
| 8 | The assignment digest binds configuration, run/revision, phase, host, role, model, and effort | `tests/model-role-resolution.test.ts` — `binds assignment digests deterministically` and each `changes the digest when ... changes` case | `A` | PASS — 9 files, 278 tests |
| 9 | A stale assignment digest or known execution mismatch prevents both event append and state transition | `tests/model-role-workflow.test.ts` — `blocks stale digest without changing event or snapshot bytes`, `blocks wrong observed model without changing event or snapshot bytes`, and `blocks wrong observed effort without changing event or snapshot bytes` | `A` | PASS — 9 files, 278 tests |
| 10 | Unknown host observation remains null | `tests/model-role-workflow.test.ts` — `writes runtime resolution and excludes forged agent prose` and `keeps direct CLI --model diagnostic-only and records unknown execution`; `tests/host-adapter-contract.test.ts` — `publishes a closed model catalog and nullable observed execution` | `A` | PASS — 9 files, 278 tests |
| 11 | The event writer uses runtime resolution even when agent text claims other execution | `tests/model-role-workflow.test.ts` — `writes runtime resolution and excludes forged agent prose` | `A` | PASS — 9 files, 278 tests |
| 12 | Historical and current events verify in one chain and replay by their declared revision | `tests/event-chain.test.ts` — `verifies one hash chain across 1.0.0 and 1.1.0 events` and `dispatches each mixed record by its own declared revision` | `A` | PASS — 9 files, 278 tests |
| 13 | Configuration migration preserves every non-configuration byte and rollback restores exact bytes | `tests/config-migration.test.ts` — `migrates only config and preserves every historical byte` and `writes a verified receipt and rollback restores exact original bytes` | `A` | PASS — 9 files, 278 tests |
| 14 | Claude Code and Codex apply the runtime handoff through equivalent packaged relays, refuse unavailable exact selection before launch, and preserve the assignment digest through `agent record` | `tests/phase-agent-relay-distribution.test.ts` — the shared built-package relay suite, including exact handoff/record CLI transport, launch tuple, digest transport, and pre-launch refusal; `tests/host-adapter-contract.test.ts` — the shared Codex and Claude Code adapter suites | `C`, `A` | PASS — both packaged hosts exercised |

## Required evidence and load-bearing contracts

| Requirement | Exact test evidence | Command | Result |
| --- | --- | --- | --- |
| Accepted simple/object forms and closed schema shapes | `tests/contract-schemas.test.ts` — `publishes closed current model-role schema shapes`; `tests/contract-type-generation.test.ts` — `rejects phase execution metadata on schema-forbidden adapter variants` | `A`, `B` | PASS |
| Canonical equality is checked before phase assignment | `tests/model-role-resolution.test.ts` — `checks implementer and judge independence before planner assignment` | `A` | PASS |
| Migration begins from historical state, is preview-bound, and leaves failed paths unchanged | `tests/config-migration.test.ts` — `migrates only config and preserves every historical byte`, `refuses changed source instead of silently replanning after preview`, and `writes a verified receipt and rollback restores exact original bytes` | `A` | PASS |
| Rejected execution cannot write event, snapshot, or agent output | `tests/model-role-workflow.test.ts` — each `blocks ... without changing event or snapshot bytes` case | `A` | PASS |
| Domain dependency direction and event inventory remain exhaustive | `tests/architecture.test.ts` — `keeps transaction domain and durable ports free of Node.js builtins`, `has no dependency-direction violation`, and `sweeps every event-domain module` | `B` | PASS — 6 files, 166 tests |
| Distributed bundles publish the current reason, state, and host contracts | `tests/runtime-distribution.test.ts` — `binds the codex manifest to its runtime and host` and `binds the claude-code manifest to its runtime and host` | `B` | PASS — 6 files, 166 tests |
| Objective and package-verifier initialization use current host model routing | `tests/objective-command.test.ts` — `records the demand and activates its feature`; `tests/package-verifier.test.ts` — `proves both host packages and project flows` | `B` | PASS — 6 files, 166 tests |
| Pull requests reserve deterministic compatibility, state/security, evidence, and exact-command fields | `tests/github-contribution-contract.test.ts` — `separates deterministic evidence from model evaluations` | `B` | PASS — 6 files, 166 tests |
| Packaged host relays apply the selected model/effort before launch and preserve the assignment digest | `tests/phase-agent-relay-distribution.test.ts` — built Codex and Claude Code wrappers, literal CLI transport, exact launch tuple, digest-bound record, and refusal before launch | `C` | PASS — 6 files, 199 tests |

## Compatibility, state, migration, rollback, and security impact

- **Compatibility:** Current state and host family identities are `1.1.0`; the
  current reason catalog is `1.7.0`. The role-aware project configuration,
  event, migration, adapter-message, initialization-answer, and phase-handoff
  payloads use their registered `1.1.0` revisions. Unchanged payloads continue
  to use their exact registered `1.0.0` revisions. Historical state/host
  `1.0.0` payloads remain readable where the compatibility manifest permits
  them, but model-role operations require the current role-aware contracts.
  Mixed event histories remain one verified hash chain. Configuration is the
  explicit migration exception: a historical project configuration must be
  migrated before a model-role handoff or phase result can proceed.
- **State and migration:** Initialization writes explicit host-specific
  assignments for all three roles. Migration replaces only
  `.brain/config.json` after an authorized, digest-bound preview; it does not
  rewrite event history, snapshots, agent output, or other project bytes.
  Current operations then write selected assignment and separately observed
  execution metadata in current events.
- **Rollback:** The migration receipt and backup are verified before rollback.
  Rollback restores the exact historical configuration bytes and leaves
  historical state untouched.
- **Security:** Resolution fails closed for missing roles, missing/ambiguous
  aliases, unsupported effort, canonical implementer/judge equality, stale
  digests, and known observed mismatches. There is no cross-role or
  cross-model fallback. The assignment digest binds the selected run and
  configuration to phase, host, role, model, and effort. Agent prose is
  untrusted; a host that cannot observe model or effort records `null` instead
  of inventing identity. The packaged host relays obtain the runtime handoff,
  require exact model/effort selection before launch, and carry the assignment
  digest into `agent record`. Adapters remain transport/catalog boundaries and
  do not own workflow policy. Proprietary host launch APIs are represented by
  an injected launcher seam in repository tests; no signed-in proprietary-host
  E2E result is claimed.

## Verification commands

Focused acceptance command (`A`):

```text
npm test -- tests/model-role-resolution.test.ts tests/model-role-workflow.test.ts tests/config-migration.test.ts tests/contract-manifest.test.ts tests/contract-schemas.test.ts tests/host-adapter-contract.test.ts tests/init-command.test.ts tests/event-chain.test.ts tests/contract-documentation.test.ts

Test Files  9 passed (9)
Tests       278 passed (278)
Duration    7.94s
Exit code   0
```

Focused load-bearing command (`B`):

```text
npm test -- tests/architecture.test.ts tests/runtime-distribution.test.ts tests/objective-command.test.ts tests/package-verifier.test.ts tests/contract-type-generation.test.ts tests/github-contribution-contract.test.ts

Test Files  6 passed (6)
Tests       166 passed (166)
Duration    20.17s
Exit code   0
```

Focused final-review command (`C`):

```text
npm test -- tests/phase-agent-relay-distribution.test.ts tests/init-command.test.ts tests/event-sealing.test.ts tests/event-chain.test.ts tests/model-role-resolution.test.ts tests/model-role-workflow.test.ts

Test Files  6 passed (6)
Tests       199 passed (199)
Exit code   0
```

Canonical implementation repository gate (`final-2be3556`):

```text
npm run verify

Format       all matched files use Prettier style
Spelling     202 files checked, 0 issues
English      English-only source check passed
Lint         passed with 0 warnings
Type check   passed
Test Files   172 passed (172)
Tests        4620 passed (4620)
Test time    272.03s
Coverage     172 files and 4620 tests passed in 421.92s
Statements   93.42% (7379/7898)
Branches     89.00% (5619/6313)
Functions    95.41% (1268/1329)
Lines        94.21% (6725/7138)
Mutation     3 / 3 (100.00%)
Gaps         10 / 10 found, 0 false gaps
Performance  1,087,219 / 1,500,000 runtime bytes
Schemas      134,443 / 250,000 bytes
Oracle       12 surfaces, 4 PRD anchors, 3 binaries verified
Parity       discovery verified; 0 / 400 parity gaps
Results      76 reasons, exits 0-5, 6 examples verified
Contracts    33 schemas, 14 legacy profiles, generated types current
Differential 2 / 2 self-test scenarios equal
Build        Codex and Claude Code artifacts produced
Packages     Codex and Claude Code verification passed
Benchmark    help 115.167781 ms; version 110.140648 ms; handshake 112.239955 ms
Bundle       1,296,976 bytes
Exit code    0
```

Diff hygiene:

```text
git diff --check

Output      none
Exit code   0
```

## Exact pull request verification section

The following text is ready to copy into a pull request description. It does
not imply that a pull request exists.

```markdown
Closes #136

Work ID: `FND-07`

### Approved clarification

The owner-approved strict-independence design removes the contradictory
one-time-warning criterion. Canonically equal implementer and judge aliases are
refused with `model.independence_violation`; no warning state is introduced.

### Compatibility impact

State and host family identities advance to `1.1.0`, and role-aware payloads
use their registered `1.1.0` revisions. Unchanged payloads retain their exact
registered `1.0.0` revisions. The reason catalog advances to `1.7.0`,
historical compatible records remain readable, and historical project
configuration requires the explicit model-role migration.

### State, migration, and rollback impact

Initialization and migration persist explicit host-specific planner,
implementer, and judge assignments. Migration replaces only the configuration,
preserves history, emits a verified receipt/backup, and supports exact rollback.
Selected and nullable observed execution are recorded separately in new events.

### Security impact

Role resolution, canonical independence, digest-bound handoff, and known
execution mismatches fail closed without fallback. Agent prose does not supply
model identity, and unobservable host execution remains null. Both packaged
host relays require the runtime-selected model and effort before launch and
preserve the assignment digest into `agent record`. Proprietary signed-in host
APIs remain outside local deterministic evidence.

### Deterministic verification

- Acceptance evidence record:
  `docs/verification/issue-136-model-role-evidence.md`
- Focused verification: `npm test -- tests/model-role-resolution.test.ts tests/model-role-workflow.test.ts tests/config-migration.test.ts tests/contract-manifest.test.ts tests/contract-schemas.test.ts tests/host-adapter-contract.test.ts tests/init-command.test.ts tests/event-chain.test.ts tests/contract-documentation.test.ts` — PASS, 9 files and 278 tests
- Load-bearing verification: `npm test -- tests/architecture.test.ts tests/runtime-distribution.test.ts tests/objective-command.test.ts tests/package-verifier.test.ts tests/contract-type-generation.test.ts tests/github-contribution-contract.test.ts` — PASS, 6 files and 166 tests
- Host relay verification: `npm test -- tests/phase-agent-relay-distribution.test.ts tests/init-command.test.ts tests/event-sealing.test.ts tests/event-chain.test.ts tests/model-role-resolution.test.ts tests/model-role-workflow.test.ts` — PASS, 6 files and 199 tests
- Full repository verification: `npm run verify` — PASS for canonical run `final-2be3556` at observed HEAD `2be355614c4f4736d17156d0323489d49a0fcdad`, exit 0; 172 files and 4,620 tests; coverage and all remaining gate summaries are in the evidence document
- Diff hygiene: `git diff --check` — PASS, no output, exit 0
- Remote CI: not observed; no green-CI claim is made
```
