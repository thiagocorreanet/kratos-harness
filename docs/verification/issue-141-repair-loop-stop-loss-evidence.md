# Issue 141 repair-loop stop-loss evidence

This document provides the acceptance and verification evidence for issue 141.
It depends on the stable acceptance-criterion identifiers from #132 and
the existing token-budget stop-loss and usage boundary from #128.

## Compatibility, state, and security impact

- Compatibility: `state.project-config@1.4.0` and
  `host.init-answers@1.4.0` add an optional acceptance attempt ceiling. The
  explicit `1.3.0 -> 1.4.0` migration preserves predecessor bytes and does not
  serialize the default. `state.event@1.2.0` remains byte-preserved;
  `state.event@1.3.0`, `state.event@1.4.0`,
  `state.repair-loop-stop@1.1.0`, `state.repair-resolution@1.1.0`, and
  repair-restart records are additive. Mixed `workflow-v1` and `workflow-v2`
  replay requires the persisted `run.policy_upgraded` boundary, which freezes
  chosen limits once before continuation, and selects each event's
  registered schema without rewriting history.
- State: every workflow-v2 run freezes the resolved attempt ceiling (default
  `3`) and optional `objective.budget.tokens` ceiling at start. Attempt counts,
  active repair stops, and resolutions are replayed from the append-only event
  stream. Specification resolution preserves the source run, starts a fresh
  run at `spec`, and retires all affected source AC identifiers.
- Security: the stop artifact contains a bounded classification and diagnosis;
  events carry only typed attempt facts, artifact references, and digests.
  Resolution requires a validated human identity and a 1–2,048-character
  control-character-free observation. Invalid, missing, duplicate, or
  unexpected fault data is refused before any effect. Hosts relay runtime data
  and never decide policy. Recovery observation revalidates exact artifact
  digests and source/successor bindings before accepting idempotent retries.

## Acceptance-criterion mapping

| Acceptance criterion | Concrete evidence |
| --- | --- |
| A failed `AC-*` below its ceiling advances its counter and returns the run to `code`. | `tests/workflow-v2-reducer.test.ts` covers “returns a below-ceiling acceptance rejection to code”; `tests/repair-loop-acceptance-recording.test.ts` covers the atomic recorded transition. |
| A failed `AC-*` at its ceiling blocks the run and records its identifier, classification, and diagnosis. | `tests/workflow-v2-reducer.test.ts` covers a stop at the ceiling; `tests/repair-loop-acceptance-recording.test.ts` covers missing-diagnosis refusal and persisted simultaneous stops; `tests/workflow-v2-replay.test.ts` proves events omit diagnoses while referenced stop artifacts retain them. |
| Every simultaneously tripping criterion is represented in document order. | `tests/workflow-v2-reducer.test.ts` covers every simultaneously tripping stop in event order; `tests/repair-loop-acceptance-recording.test.ts` records the complete stop set in task-document order. |
| Plain resume, accepted outcomes, and repeated commands do not reset attempts. | `tests/workflow-v2-reducer.test.ts` covers accepted outcome and plain-resume preservation; `tests/repair-resolution-reducer.test.ts` covers plain-resume refusal; `tests/workflow-state-machine.test.ts` covers repeated correlation no-op behavior. |
| An active repair stop or specification restart blocks resume, phase advance, and completion independently of caller gate facts. | `tests/workflow-state-machine.test.ts` covers the six producer combinations; `tests/workflow-v2-reducer.test.ts` rejects the same six forged event combinations during reduction. |
| Code resolution resets only the selected criterion and specification resolution starts a new run at `spec` with new approval authority. | `tests/repair-resolution-reducer.test.ts` covers selective code reset and fresh specification start; `tests/repair-loop-acceptance-recording.test.ts` covers same-run code recovery and the fresh spec run; `tests/repair-resolve-command.test.ts` validates the explicit command inputs. |
| A specification resolution cannot strand an active code stop. | `tests/repair-resolution-reducer.test.ts` rejects a forged spec-first resolution; `tests/repair-loop-acceptance-recording.test.ts` proves the spec-first command has no effects and the code-first sequence succeeds. |
| Event replay reconstructs identical attempts and active stops, including mixed `workflow-v1/v2` history. | `tests/workflow-v2-replay.test.ts` seals a persisted legacy-upgrade boundary and proves direct/replayed equivalence; it and `tests/workflow-v2-reducer.test.ts` reject v2 continuation without that frozen boundary; `tests/repair-resolution-reducer.test.ts` replays selective resolution state. |
| Missing project configuration resolves to ceiling 3 rather than unbounded behavior. | `tests/project-configuration.test.ts` covers the omitted-setting default; `tests/workflow-run-lineage.test.ts` proves the default is frozen only after valid configuration is resolved; `tests/init-answers.test.ts` covers set, clear, and preserve initialization behavior. |
| The objective token ceiling is frozen per run and produces a stop reason distinguishable from repeated rejection. | `tests/objective-command.test.ts` covers positive `--token-ceiling`; `tests/workflow-v2-reducer.test.ts` and `tests/workflow-run-lineage.test.ts` cover frozen limits; `tests/repair-loop-host-integration.test.ts` covers distinct aggregated token and rejection stop reasons. Token measurement remains outside the objective command. |
| Current-run hooks and projections remain bound to the replayed token ceiling after the objective budget is added, removed, raised, or lowered. | `tests/workflow-hook-runtime.test.ts` exercises all four mutations plus bounded and unbounded starts; `tests/workflow-run-lineage.test.ts` and `tests/repair-loop-host-integration.test.ts` cover replay and host behavior. |
| Recovery evidence and idempotency fail closed on deletion, tamper, missing or divergent successors, and divergent retries. | `tests/repair-loop-acceptance-recording.test.ts` deletes and tampers with resolution/restart artifacts, removes successor events, diverges the successor snapshot, and changes target or human input under a reused correlation. Exact duplicate retries remain unchanged. |
| Whitespace-only diagnoses and observations are rejected without trimming valid text. | `tests/repair-loop.test.ts`, `tests/repair-loop-contracts.test.ts`, and `tests/repair-resolution-contracts.test.ts` cover runtime and additive current schemas; predecessor schemas remain byte-preserved. |
| Published predecessor schemas remain byte-identical. | `tests/contract-schemas.test.ts` verifies golden SHA-256 digests, including manifest v1.4 `43eff27f...`, manifest v1.5 `7607416b...`, and event v1.2/v1.3 `c91746a...`/`4597757c...`. |
| Claude Code and Codex relay equivalent inputs and results. | `tests/repair-loop-host-integration.test.ts` compares both host relays with the same handoff and `host.agent-output@1.3.0` result; `tests/phase-agent-relay-distribution.test.ts` checks packaged relay distribution. |
| Public behavior, migration, compatibility, state, and security impact are documented with no placeholder text. | This document; `docs/user/commands.md`, `docs/user/configuration-and-state.md`, `docs/user/migration-and-recovery.md`, `docs/user/hosts.md`; `docs/architecture/workflow-state-machine.md`, `docs/architecture/gates-approvals-evidence.md`, and `docs/architecture/host-adapter-protocol.md`; `docs/compatibility/contract-versioning.md`; `fixtures/README.md`; and `schemas/README.md`. `npm run spellcheck`, `npm run english:check`, `npm run format:check`, and the recorded placeholder scan validate the documentation gate. |

## Required tests and commands

The final repair wave used two focused commands so each execution retained its
complete exit and count evidence:

```text
npx --yes npm@11.16.0 test -- tests/workflow-hook-runtime.test.ts tests/workflow-run-lineage.test.ts tests/repair-loop-host-integration.test.ts tests/workflow-state-machine.test.ts tests/workflow-v2-replay.test.ts tests/workflow-v2-reducer.test.ts tests/repair-resolution-reducer.test.ts tests/repair-loop-acceptance-recording.test.ts tests/repair-resolve-command.test.ts
npx --yes npm@11.16.0 test -- tests/contract-schemas.test.ts tests/contract-manifest.test.ts tests/contract-type-generation.test.ts tests/schema-registry-fixtures.test.ts tests/schema-registry-types.test.ts tests/repair-loop.test.ts tests/repair-loop-contracts.test.ts tests/repair-resolution-contracts.test.ts tests/phase-agent-relay-distribution.test.ts tests/model-role-workflow.test.ts tests/runtime-composition.test.ts tests/cli-contracts.test.ts
```

Results: 9 files and 96 tests passed in the workflow/recovery group; 12 files
and 539 tests passed in the contract/host/runtime group.

The contract, result, and documentation checks also passed after the changes:

```text
npx --yes npm@11.16.0 run format:check
npx --yes npm@11.16.0 run spellcheck
npx --yes npm@11.16.0 run english:check
npx --yes npm@11.16.0 run contracts:check
npx --yes npm@11.16.0 run result:check
```

Results: formatting passed; CSpell checked 217 Markdown files with zero issues;
the English-only check passed; contracts verified 53 schemas and 14 legacy
profiles with generated types current; and the result contract verified 76
reasons across exits 0–5.

The complete gate command is:

```text
KRATOS_BUILD_OUTPUT=<unique-temporary-directory> npx --yes npm@11.16.0 run verify
```

The fresh final execution completed successfully with a unique build output:

```text
KRATOS_BUILD_OUTPUT=/tmp/kratos-issue141-final-4VUKx4 npx --yes npm@11.16.0 run verify
```

Results: `npm test` passed 201 files and 4,989 tests in 451.91 seconds;
`test:coverage` passed the same 201 files and 4,989 tests in 552.00 seconds
with 92.83% statements, 88.40% branches, 96.10% functions, and 93.72% lines.
Mutation passed 3/3 (100.00%); gap calibration found all 10 planted gaps with
zero false gaps; performance remained within the 1,500,000-byte runtime and
275,000-byte schema budgets at 1,272,683 and 255,038 bytes, respectively;
the Go v3 oracle, parity inventory, result contract, contracts, differential,
build, Codex and Claude Code package verification, and benchmark all passed.

## Verification-environment history

Two complete-gate attempts were interrupted by shared-worktree interference:

1. The first build/package attempt observed inconsistent transient package
   digests. A fresh isolated `build` followed by `package:verify` passed for
   both Codex and Claude Code, showing no persistent package artifact defect.
2. A later isolated-gate attempt reached coverage after the full test suite
   passed, then Vitest reported that another process had removed
   `coverage/.tmp/coverage-5.json`. This is a shared coverage-directory race;
   no runtime, schema, threshold, or coverage configuration was changed to
   bypass it.

Before the final complete-gate rerun, the active process list was inspected for
other `vitest` coverage processes. The final result above is from the resulting
fresh single-process execution.

## Pull-request text

```text
feat: document repair-loop stop-loss recovery

Closes #141

Depends on #128 and #132. Documents the frozen per-criterion acceptance ceiling,
token-budget distinction, replay-safe recovery, host-neutral relay behavior,
and additive compatibility contracts. State freezes and replays attempts and
limits; a specification restart preserves source history and retires affected
AC identifiers. Diagnoses are bounded, digest-bound artifacts rather than event
payload text. Verification: `npx --yes npm@11.16.0 run test -- tests/init-answers.test.ts tests/project-configuration.test.ts tests/objective-command.test.ts tests/config-migration.test.ts tests/workflow-v2-reducer.test.ts tests/workflow-v2-replay.test.ts tests/repair-loop-acceptance-recording.test.ts tests/repair-loop-host-integration.test.ts tests/repair-resolve-command.test.ts tests/repair-resolution-reducer.test.ts tests/workflow-run-lineage.test.ts tests/contract-documentation.test.ts tests/schema-registry-fixtures.test.ts tests/contract-compatibility.test.ts`; `KRATOS_BUILD_OUTPUT=/tmp/kratos-issue141-final-4VUKx4 npx --yes npm@11.16.0 run verify`.
```
