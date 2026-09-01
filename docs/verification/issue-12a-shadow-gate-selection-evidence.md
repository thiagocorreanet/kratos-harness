# SDD-12a Shadow Gate Selection Evidence

## Acceptance criteria

| Criterion | Evidence test |
| --- | --- |
| The operator and registry guides publish the rollout, input, refusal, and diagnostic contract. | `tests/contract-documentation.test.ts` — `documents the selectable shadow rollout across operator and registry guides` |
| Every committed contract fixture is validated against its exact registered revision. | `tests/schema-registry-fixtures.test.ts` — `accepts the committed $id fixture` |

## Three-mode lifecycle

The documented rollout is `shadow -> measure -> warn -> enforce`. The named
test publishes `shadow`, `warn`, and `enforce`; `tests/gate-policy-modes.test.ts`
maps their findings to pass, warn, and block respectively.

## Initialization and reporting

`host.init-answers@1.5.0` accepts the selected partial `gateModes` map while
retaining `hostContract: 1.4.0`. `tests/init-skeleton.test.ts` — `writes a
project configuration the runtime itself accepts` proves that the selection is
persisted in `state.project-config@1.4.0`.

An omitted map on reinitialization preserves the current selection; a supplied
map replaces it. `tests/doctor-command.test.ts` — `reports shadow gate findings
in human and JSON doctor output` verifies effective-mode reporting through
`host.doctor-report@1.0.0`.

## Predecessor compatibility

Project state remains `1.4.0`. No gate decision changed in this documentation
and evidence slice, and no dependency was added. An older unsupported persisted
state revision is refused before mutation as
`contract.state_version_unsupported`; `tests/project-configuration.test.ts` —
`rejects %s before schema validation` covers that refusal. The fixture index
records that new fixtures leave predecessor bytes unchanged.

## Verification commands

The RED command was `npm test -- tests/contract-documentation.test.ts
tests/schema-registry-fixtures.test.ts`; it exited 1 with 445 passing tests and
one expected documentation failure for the missing lifecycle text.

The same focused command later exited 1 with 445 passing tests after the
index-audit assertion exposed the stale `contract-manifest.v1.7` registry
reference. The index was corrected to v1.9 before the final focused run.

After the documentation updates, the same command exited 0 with 446 passing
tests. `npm run contracts:check` exited 0 and reported 68 schemas, 14 legacy
profiles, and current generated types. `npm run format:check` exited 0.
`npm run spellcheck` exited 0 after checking 244 files with zero issues.

`npm run english:check` and `npm run verify` exited 1 before lint or test
execution. Both stopped at the ignored, untracked
`.superpowers/sdd/2026-09-01-shadow-gate-selection/task-1-report.md`, whose
Portuguese words violate the repository English-only check. The checked-out
verification reference was `ea4c53d2b4a53c85404dbed1b9f04404f3b44247`; no
documentation commit was verified because of that external worktree blocker.

## Contract, state, security, and host-parity impact

This slice changes documentation, indexes, and documentation assertions only.
It adds no schema, runtime decision path, state mutation, permission, secret,
network operation, or dependency. Hosts continue to submit initialization input
or render runtime-owned effective modes; they do not choose a gate decision.
