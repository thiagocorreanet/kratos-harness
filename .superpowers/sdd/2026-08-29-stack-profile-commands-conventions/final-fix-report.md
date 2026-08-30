# Final fix report

Date: 2026-08-29

Implementation commit: `c24fa1e` (`fix(runtime): close final stack profile review gaps`)

## Outcome

The single consolidated final-review wave addressed all four Important and two
Minor findings. Initialization now binds the authoritative configuration bytes
used for profile resolution to the exact `.brain/config.json` write
precondition. Version 1.1 profile-only migration preserves persisted custom
role maps and derives hosts from the final overlay. Stack evidence uses a
locale-neutral total order and visibly encodes hostile filename controls before
Markdown escaping. Migration preview emits all ten profile leaves in stable
order with terminal-safe scalar, list, and reason representations. Invalid
authoritative configuration diagnostics point to `.brain/config.json`.

Published predecessor schemas and reason catalogs were not changed. Configured
commands remain inert data; no implementation path executes them.

## Test-first evidence

| Gate | Exact outcome |
| --- | --- |
| Focused RED: `npx --yes npm@11.16.0 test -- tests/init-command.test.ts tests/config-migration.test.ts tests/init-skeleton.test.ts tests/init-stack-profile.test.ts tests/diagnostics.test.ts` | Exit 1: 5 files, 8 failing and 160 passing tests. Each reviewer finding was reproduced before production edits. |
| Focused GREEN: the RED command plus `tests/command-observation.test.ts` | Exit 0: 6 files and 172 tests passed. |
| Broader affected suite | Exit 0: 9 files and 207 tests passed across init answers, profile resolution, rendering, stack selection, initialization, migration, diagnostics, doctor, and observation contracts. |
| Focused quality | Exit 0 for format, spelling, English-only source, lint, typecheck, and contracts; 37 schemas, 14 legacy profiles, and generated current types verified. |
| Build and package | Exit 0; Codex and Claude Code package verification passed. |

## Required full verification

`npx --yes npm@11.16.0 run verify` completed with exit 0 on implementation
commit `c24fa1e`.

- Tests: 179/179 files and 4,736/4,736 tests passed.
- Coverage: 93.29% statements, 88.69% branches, 95.58% functions, and 94.04%
  lines.
- Mutation: 3/3, 100%.
- Gap calibration: 10/10 planted gaps found, no false gaps.
- Contracts: 37 schemas, 14 legacy profiles, and generated current types.
- Packages: Codex and Claude Code passed.
- Benchmarks: help p95 257.463539 ms, version p95 277.874562 ms,
  handshake p95 247.797344 ms, bundle 1,447,719 bytes.

The first exact-verify attempt stopped in the uninstrumented test phase with
178/179 files and 4,735/4,736 tests passing because the unchanged spawn-heavy
contract-compatibility case exceeded its 5-second timeout while several sibling
workspaces were concurrently CPU-saturated. Its isolated rerun passed 6/6 in
2.94 seconds (2.57 seconds in test bodies). The exact full command was then
rerun without changing the timeout and completed successfully as recorded
above.

## Concerns

No open functional concerns remain. Node emitted its existing
`stripTypeScriptTypes` experimental warning during mutation and build; both
gates passed. No push or merge was performed.
