# Issue #142 stack-profile evidence

Date: 2026-08-29
Issue: #142 (`SDD-17`)
Scope: typed project commands, paths, conventions, rendering, diagnostics, and
host relay parity

## Acceptance map

| Criterion | Executable evidence |
| --- | --- |
| Initialization persists one typed profile with closed command, path, and convention groups | `tests/contract-schemas.test.ts`, `tests/project-profile.test.ts`, `tests/init-answers.test.ts`, and `tests/init-command.test.ts` validate all three leaf states, closed objects, complete persistence, and fresh unresolved leaves. |
| Explicit answers override persisted values, omitted leaves are preserved, and explicit unresolved clears one leaf | `tests/project-profile.test.ts` exercises the pure fieldwise resolver; `tests/init-command.test.ts` exercises two-run composition, preservation, override, and clearing through the real command. |
| Commands remain exact inert project-root data | `tests/contract-schemas.test.ts` covers command limits; `tests/doctor-command.test.ts` persists `touch doctor-command-ran`, runs doctor, and proves the target remains absent. No init or doctor boundary exposes command execution. |
| Paths, convention text, and implementation-language labels enforce their published safety limits | `tests/contract-schemas.test.ts` rejects absolute, drive-qualified, backslash, traversal, URI, control-character, overlong, empty, and duplicate forms. |
| Stack detection stays offline, root-entry-only evidence and supplies no inferred profile defaults | `tests/init-stack-profile.test.ts` covers recognized, unrecognized, and multi-stack roots; `tests/init-command.test.ts` proves a fresh detected Node project still persists unresolved profile leaves. |
| Generated Markdown is a deterministic projection of typed state, stack evidence, and language policy | `tests/init-skeleton.test.ts` pins literal bytes for recognized, unrecognized, and multi-stack profiles, escaping, not-applicable rendering, language policy, and unresolved placeholders. `tests/init-command.test.ts` proves second-run byte idempotence. |
| Pre-profile configurations require explicit migration and preserve existing state | `tests/config-migration.test.ts` covers the ordered `1.0.0` → `1.1.0` → `1.2.0` → `1.3.0` chain, persisted roles/language, migration answers, unresolved new leaves, exact plans, rollback, and `profile.config_migration_required`. `tests/doctor-command.test.ts` proves doctor preserves that reason for each published predecessor. |
| Doctor passes only for matching bytes with no unresolved leaves | `tests/diagnostics.test.ts` exercises the pure classifier and `tests/doctor-command.test.ts` exercises the composed command against matching complete and all-not-applicable profiles. |
| Doctor warns actionably for unresolved keys, a missing document, or byte drift | `tests/diagnostics.test.ts` pins warning details. `tests/doctor-command.test.ts` requires typed key paths and regeneration guidance from the real command without parsing Markdown, and its Node-filesystem regression proves raw invalid UTF-8 cannot pass through replacement-character decoding. |
| Doctor fails for unreadable/non-file destinations or invalid authoritative state | `tests/diagnostics.test.ts` pins failure classification; `tests/doctor-command.test.ts` requires blocked exit 4 and bounded public detail for all three cases. |
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

Task 4 will append the final complete `npm run verify` outcome after the full
repository gate runs on the committed implementation.
