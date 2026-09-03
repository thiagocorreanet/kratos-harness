# Issue #190 project-profile derivation evidence

Date: 2026-09-02
Issue: #190 (`ADP-08`)
Scope: declarative project profile derivation, provenance tracking, confirmation
distinction, stack profile rendering, doctor diagnostics, operator consent
invariant, and host relay parity

## Acceptance map

| Criterion | Executable evidence |
| --- | --- |
| **AC-1**: Node project with `package.json#scripts.test` derives `projectProfile.commands.test` with evidence `package.json#scripts.test` | `tests/init-profile-derivation.test.ts` exercises pure derivation across Node (`package.json`), Make (`Makefile`), Python (`pyproject.toml`), Rust (`Cargo.toml`), and Go (`go.mod`) with exact single-line provenance strings. `tests/init-command.test.ts` exercises end-to-end initialization on a Node repository fixture, validating that `projectProfile.commands.test` is persisted with `{ status: "derived", value: "npm test", evidence: "package.json#scripts.test" }`. |
| **AC-2**: Derived value recorded as `resolved` only upon human confirmation; record distinguishes `resolved` vs `derived` | `tests/project-profile.test.ts` validates pure fieldwise resolution, preserving `derived` status unless an explicit operator answer/confirmation is supplied. `tests/init-answers.test.ts` and `tests/contract-schemas.test.ts` validate host-answer and state contract schemas (`host.init-answers@1.6.0`, `state.project-config@1.5.0`) distinguishing `resolved`, `derived`, `not-applicable`, and `unresolved`. `tests/project-profile-relay.test.ts` and `tests/project-profile-relay-distribution.test.ts` prove all distribution relays (Codex, Claude Code, Antigravity) shape confirmed answers as `resolved` and unconfirmed candidates as `derived`. |
| **AC-3**: Keys with no evidence remain `unresolved` and initialization succeeds | `tests/init-profile-derivation.test.ts` verifies that missing manifest keys or directory paths remain undefined in derived output. `tests/init-command.test.ts` initializes an empty workspace without manifest or directory evidence and proves initialization completes successfully with status 0, persisting complete typed profiles where missing entries have `{ status: "unresolved" }`. |
| **AC-4**: Derivation reads only declarative manifest sections and directory names, making no network, clock, or execution calls | `tests/init-profile-derivation.test.ts` verifies derivation is a pure in-memory calculation over declarative ASTs and entry names without process spawning, network sockets, or clock access. `tests/command-observation.test.ts` proves command observation inspects static tokens without executing child processes. |
| **AC-5**: Rendered `stack-profile.md` visibly distinguishes `resolved`, `derived`, `not-applicable`, and `unresolved` | `tests/init-skeleton.test.ts` pins exact markdown formatting: resolved values render plainly, derived values render with `(derived from <evidence>)` provenance annotations, not-applicable values render with `Not applicable: <reason>`, and unresolved values render `<UNRESOLVED: <key>>` placeholders. `tests/init-command.test.ts` verifies rendered `stack-profile.md` files written to disk match expected output. |
| **AC-6**: Derivation is deterministic: identical repository $\rightarrow$ identical profile | `tests/init-profile-derivation.test.ts` tests sorting and canonicalization across arbitrary directory entry ordering, producing byte-identical derived output. `tests/init-command.test.ts` proves second-run idempotence and byte-identical results across runs. |
| **AC-7**: `kratos doctor` passes (`pass`) when profile is fully derived/confirmed without unresolved leaves | `tests/diagnostics.test.ts` verifies `deriveStackProfileCheck` classifies fully derived or resolved profiles with matching disk bytes as `pass`. `tests/doctor-command.test.ts` verifies `kratos doctor` exits 0 with `stack-profile: pass` when all leaves are resolved or derived with provenance. |
| **AC-8**: Gates requiring operator consent fail closed on unconfirmed `derived` values with diagnostic reason | `tests/gate-evaluator.test.ts` and `tests/doctor-command.test.ts` verify that when a workflow gate requires explicit operator consent before running a command, unconfirmed `derived` leaves are not accepted as consent and fail closed with diagnostic reason `gate.operator_consent_required`. |

## Verification suite results

The complete quality and verification suite ran with npm `11.16.0` and Node `24.18.0`:

| Command | Outcome |
| --- | --- |
| `npm run lint` | PASS (exit 0): ESLint with `--max-warnings 0` reported 0 errors, 0 warnings across all files. |
| `npm run typecheck` | PASS (exit 0): TypeScript `tsc6 --noEmit` passed with no type diagnostics. |
| `npm run contracts:check` | PASS (exit 0): Verified 70 schemas, 14 legacy profiles, and current generated types. |
| `npm run build && npm run package:verify` | PASS (exit 0): Bundles built and verified for Codex, Claude Code, and Antigravity distributions. |
| `npm run format:check && npm run spellcheck && npm run english:check` | PASS (exit 0): Prettier formatting, CSpell dictionary check (249 files), and English-only repository check passed. |
| `npm test` | PASS (exit 0): 236 test files passed, 5,640 tests passed. |
| Focused profile derivation suite (13 test files) | PASS (exit 0): 13 test files passed, 283 tests passed in 10.69s. |
