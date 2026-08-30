# Issue #142 stack-profile evidence

Date: 2026-08-29
Issue: #142 (`SDD-17`)
Scope: typed project commands, paths, conventions, rendering, diagnostics, and
host relay parity

## Acceptance map

| Criterion | Executable evidence |
| --- | --- |
| Initialization persists one typed profile with closed command, path, and convention groups | `tests/contract-schemas.test.ts`, `tests/project-profile.test.ts`, `tests/init-answers.test.ts`, and `tests/init-command.test.ts` validate all three leaf states, closed objects, complete persistence, and fresh unresolved leaves. |
| Explicit answers override persisted values, omitted leaves are preserved, and explicit unresolved clears one leaf | `tests/project-profile.test.ts` exercises the pure fieldwise resolver; `tests/init-command.test.ts` exercises two-run composition, preservation, override, clearing, and a concurrent unrelated profile update that returns `runtime.revision_conflict` without stale or partial writes. |
| Commands remain exact inert project-root data | `tests/contract-schemas.test.ts` covers command limits; `tests/doctor-command.test.ts` persists `touch doctor-command-ran`, runs doctor, and proves the target remains absent. No init or doctor boundary exposes command execution. |
| Paths, convention text, and implementation-language labels enforce their published safety limits | `tests/contract-schemas.test.ts` rejects absolute, drive-qualified, backslash, traversal, URI, control-character, overlong, empty, and duplicate forms. |
| Stack detection stays offline, root-entry-only evidence and supplies no inferred profile defaults | `tests/init-stack-profile.test.ts` covers recognized, unrecognized, and multi-stack roots plus input-order-independent composed/decomposed Unicode evidence; `tests/init-command.test.ts` proves a fresh detected Node project still persists unresolved profile leaves. |
| Generated Markdown is a deterministic projection of typed state, stack evidence, and language policy | `tests/init-skeleton.test.ts` pins literal bytes for recognized, unrecognized, and multi-stack profiles, control-safe evidence escaping, not-applicable rendering, language policy, and unresolved placeholders. `tests/init-command.test.ts` proves second-run byte idempotence and exercises a hostile suffix-marker filename through the real filesystem. |
| Pre-profile configurations require explicit migration and preserve existing state | `tests/config-migration.test.ts` covers the ordered `1.0.0` → `1.1.0` → `1.2.0` → `1.3.0` chain, persisted roles/language, profile-only and explicit role overlays for both custom v1.1 host maps, all ten terminal-safe preview leaves, exact plans, rollback, and `profile.config_migration_required`. `tests/doctor-command.test.ts` proves doctor preserves that reason for each published predecessor. |
| Doctor passes only for matching bytes with no unresolved leaves | `tests/diagnostics.test.ts` exercises the pure classifier and `tests/doctor-command.test.ts` exercises the composed command against matching complete and all-not-applicable profiles. |
| Doctor warns actionably for unresolved keys, a missing document, or byte drift | `tests/diagnostics.test.ts` pins warning details. `tests/doctor-command.test.ts` requires typed key paths and regeneration guidance from the real command without parsing Markdown, and its Node-filesystem regression proves raw invalid UTF-8 cannot pass through replacement-character decoding. |
| Doctor fails for unreadable/non-file destinations or invalid authoritative state | `tests/diagnostics.test.ts` pins failure classification and points invalid authority at `.brain/config.json`; `tests/doctor-command.test.ts` requires blocked exit 4 and bounded public detail for all three cases. |
| Claude Code and Codex ask and relay the same profile values | `tests/project-profile-relay-distribution.test.ts` imports both built relays, executes the same ten questions and controlled answers, runs both embedded runtimes, compares persisted typed values, and requires byte-identical rendered profiles. |
| Release packages enforce relay behavior rather than only asset text | `tests/package-verifier.test.ts` recomputes a tampered host-assets digest and still requires verification to reject changed questions, mappings, and conditional array corruption. `scripts/verify-package.mjs` exercises valid scalar, array, not-applicable, and unresolved leaves, then feeds the actual relay result through installed initialization and checks persisted values plus rendered output. |
| Public compatibility and recovery prose names the current contracts and stable migration reason | `docs/compatibility/contract-versioning.md` publishes manifest v1.4 with explicit v1.3, v1.2, and v1.1 predecessors; architecture and user guides name state/host `1.3.0`, reason catalog `1.9.0`, and `profile.config_migration_required`. |

## Task 3 command evidence

The Task 3 slice recorded these focused outcomes with npm `11.16.0`:

| Command | Outcome |
| --- | --- |
| `npx --yes npm@11.16.0 test -- --run tests/diagnostics.test.ts tests/doctor-command.test.ts --reporter=verbose` | PASS: 2 files, 20 tests |
| Profile, initialization, migration, doctor, and contract-documentation narrow suite | PASS: 10 files, 231 tests |
| `npx --yes npm@11.16.0 test -- --run tests/project-profile-relay-distribution.test.ts --reporter=verbose` | PASS: 1 file, 3 tests |
| `npx --yes npm@11.16.0 test -- --run tests/package-verifier.test.ts --reporter=verbose` | PASS: 1 file, 6 tests, including tamper rejection |
| `npx --yes npm@11.16.0 run contracts:check` | PASS: 37 schemas, 14 legacy profiles, generated types current |
| `npx --yes npm@11.16.0 run build` followed by `npx --yes npm@11.16.0 run package:verify` | PASS: Codex and Claude Code packages |

## Task 3 review-fix evidence

The first review-fix round recorded these outcomes with npm `11.16.0`:

| Command | Outcome |
| --- | --- |
| `npx --yes npm@11.16.0 test -- --run tests/diagnostics.test.ts tests/doctor-command.test.ts tests/init-command.test.ts --reporter=verbose` | PASS: 3 files, 50 tests, including predecessor migration reasons, exact raw-byte drift, and unchanged init refusal |
| `npx --yes npm@11.16.0 test -- --run tests/package-verifier.test.ts tests/project-profile-relay-distribution.test.ts --reporter=dot` | PASS: 2 files, 10 tests, including conditional array-corruption rejection and both installed host flows |
| `npx --yes npm@11.16.0 run contracts:check` | PASS: 37 schemas, 14 legacy profiles, generated types current |
| `npx --yes npm@11.16.0 run build && npx --yes npm@11.16.0 run package:verify` | PASS: Codex and Claude Code package flows |
| `npx --yes npm@11.16.0 run format:check`, `spellcheck`, `english:check`, `lint`, and `typecheck` | PASS |

## Task 4 final verification

The final repository gates ran with npm `11.16.0` on the committed Task 3
implementation:

| Command | Outcome |
| --- | --- |
| `npx --yes npm@11.16.0 run format:check && npx --yes npm@11.16.0 run spellcheck && npx --yes npm@11.16.0 run english:check && npx --yes npm@11.16.0 run lint && npx --yes npm@11.16.0 run typecheck && npx --yes npm@11.16.0 run contracts:check` | PASS, exit 0: formatting, spelling, English-only source, lint, typecheck, and all 37 schemas with 14 legacy profiles and current generated types. |
| `npx --yes npm@11.16.0 test -- --run tests/contract-schemas.test.ts tests/project-profile.test.ts tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/config-migration.test.ts tests/diagnostics.test.ts tests/doctor-command.test.ts tests/project-profile-relay-distribution.test.ts tests/package-verifier.test.ts tests/contract-documentation.test.ts --reporter=dot` | PASS, exit 0: 11 files and 228 tests. |
| `npx --yes npm@11.16.0 run build && npx --yes npm@11.16.0 run package:verify` | PASS, exit 0: Codex and Claude Code packages. |
| `npx --yes npm@11.16.0 run verify` | PASS, exit 0: 179 files and 4,729 tests; coverage 93.12% statements, 88.56% branches, 95.48% functions, and 93.86% lines; mutation, gap calibration, performance, oracle, parity, result contract, contracts, differential, build, package verification, and benchmark gates all passed. |

The complete feature diff from `ebbced0` was audited after the focused gates.
It contains no inferred project commands, no host-specific runtime policy, no
unsafe path bypass, no unreviewed generated-contract drift, and no unresolved
`TODO` or `TBD` implementation placeholders. Configured commands remain inert
data during initialization and diagnostics. The deliberate
`<UNRESOLVED: projectProfile.*>` markers remain visible generated-document
answers, not implementation placeholders.

## Final review fix evidence

The consolidated final-review fix wave recorded these outcomes with npm
`11.16.0`:

| Command | Outcome |
| --- | --- |
| Focused RED: `npx --yes npm@11.16.0 test -- tests/init-command.test.ts tests/config-migration.test.ts tests/init-skeleton.test.ts tests/init-stack-profile.test.ts tests/diagnostics.test.ts` | Expected failure, exit 1: 5 files, 8 failing and 160 passing tests; every final-review finding was reproduced before production edits. |
| Focused GREEN: `npx --yes npm@11.16.0 test -- tests/init-command.test.ts tests/config-migration.test.ts tests/init-skeleton.test.ts tests/init-stack-profile.test.ts tests/diagnostics.test.ts tests/command-observation.test.ts` | PASS, exit 0: 6 files and 172 tests. |
| Broader affected suite | PASS, exit 0: 9 files and 207 tests across initialization answers, profile resolution, rendering, stack detection, init, migration, diagnostics, doctor, and observation contracts. |
| `npx --yes npm@11.16.0 run format:check`, `spellcheck`, `english:check`, `lint`, `typecheck`, and `contracts:check` | PASS, exit 0: formatting, spelling, English-only source, lint, types, 37 schemas, 14 legacy profiles, and current generated declarations. |
| `npx --yes npm@11.16.0 run build && npx --yes npm@11.16.0 run package:verify` | PASS, exit 0: Codex and Claude Code packages. |
| `npx --yes npm@11.16.0 run verify` | PASS, exit 0 on implementation commit `c24fa1e`: 179 files and 4,736 tests; coverage 93.29% statements, 88.69% branches, 95.58% functions, and 94.04% lines; mutation 3/3; calibration, performance, oracle, parity, result, contract, differential, build, package, and benchmark gates passed. |
