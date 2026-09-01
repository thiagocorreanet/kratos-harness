# SDD-12a Shadow Gate Selection Evidence

## Acceptance criteria

| Criterion | Evidence test |
| --- | --- |
| Lifecycle: the guides publish `shadow -> measure -> warn -> enforce`. | `tests/contract-documentation.test.ts` — `documents the selectable shadow rollout across operator and registry guides`; `tests/gate-policy-modes.test.ts` — `aggregates %s and %s by the most severe outcome` |
| Initialization and preservation: the selected partial map is persisted, omitted input preserves it, and `{}` clears it. | `tests/init-answers.test.ts` — `selects, clears, defaults, or preserves per-gate modes`; `tests/init-command.test.ts` — `preserves gate modes when a re-initialization omits them` |
| Handoff and doctor publish effective findings without host policy authority. | `tests/host-adapter-contract.test.ts` — `relays the same mixed gate decision bytes through Claude Code and Codex`; `tests/doctor-command.test.ts` — `reports shadow gate findings in human and JSON doctor output` |
| A predecessor or unsupported state is refused before schema validation or mutation. | `tests/project-configuration.test.ts` — `rejects %s before schema validation` |
| Fixtures validate at their exact revisions while published predecessor schemas remain immutable. | `tests/schema-registry-fixtures.test.ts` — `accepts the committed $id fixture`; `tests/contract-schemas.test.ts` — `keeps the published %s schema byte-identical` |

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

After translating the scratch Task 1 report, `npm run english:check` exited 0.
The final `npm run verify` exited 0 at
`2e1d29f docs: explain shadow gate rollout`. It passed formatting, spellcheck,
English, lint, and typecheck; the complete suite passed 233 files and 5,535
tests in 433.06 seconds. The coverage suite also passed 233 files and 5,535
tests in 731.07 seconds, with 91.96% statements, 87.15% branches, 95.95%
functions, and 93.10% lines.

The remaining final gates passed with these reported values: mutation 4/4
(100.00%); gap calibration found all 10 planted gaps with no false gaps;
performance reported 1,544,487 / 1,600,000 runtime source bytes and 329,148 /
330,000 contract-schema bytes; the public oracle verified 12 surfaces, four PRD
anchors, and three binaries; contract checking verified 68 schemas and 14
legacy profiles; package verification passed for Codex, Claude Code, and
Antigravity. The benchmark reported seven samples, help P95 257.796662 ms,
version P95 163.623569 ms, handshake P95 147.302928 ms, and 2,071,950 bundle
bytes.

## Contract, state, security, and host-parity impact

This slice changes documentation, indexes, and documentation assertions only.
It adds no schema, runtime decision path, state mutation, permission, secret,
network operation, or dependency. Hosts continue to submit initialization input
or render runtime-owned effective modes; they do not choose a gate decision.
