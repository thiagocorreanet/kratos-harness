# SDD ledger — plan: docs/superpowers/plans/2026-08-29-stack-profile-commands-conventions.md

Baseline: `ebbced0`; `npx --yes npm@11.16.0 test` passed 176 files / 4,658 tests.

## Preflight conflict scan

| Tasks | Producer → consumer | Finding |
| --- | --- | --- |
| 1 → 2 | v1.3 schemas, generated types, and `ResolvedProjectProfile` → init merge, renderer, and migration | Compatible; Task 2 must consume the exact closed unions from Task 1. |
| 1 → 3 | unresolved-key helper and current project configuration → doctor readiness | Compatible; doctor consumes typed readiness and must not parse Markdown. |
| 2 → 3 | deterministic renderer and observed persisted profile → expected/actual doctor comparison | Compatible; export the renderer rather than duplicate document construction. |
| 2 → 4 | migrated state and byte-exact fixtures → full verification | Compatible; Task 4 may fix only feature-attributable failures. |
| 3 → 4 | doctor, host relay parity, docs, and evidence → final evidence gate | Compatible; final evidence records actual commands and exit results. |
| 1 | Tests specify schemas and resolver APIs before implementation | Internally consistent. |
| 2 | Tests specify merge/render/migration before implementation | Internally consistent. |
| 3 | Tests specify doctor and relay behavior before implementation | Internally consistent. |
| 4 | Verification consumes the completed preceding slices | Internally consistent. |

Ruling: a current `kratos init` observing project configuration 1.2.0 must refuse with `profile.config_migration_required` rather than silently treating init as migration — the approved spec makes migration explicit; if wrong, existing projects require one extra migration command.

Task 1: fix round 1/5 (3 addressed, 0 open; commits 3423cfa..c1f820e)
Task 1: minor (deferred to Task 3): `docs/compatibility/contract-versioning.md` names v1.1 but not v1.2 as a published predecessor after manifest v1.3 became current.
Task 1: complete (commits ebbced0..c1f820e, review clean with 1 deferred minor)

Task 2: Ruling: do not add host/state profile contract 1.4 solely to reject control-bearing implementation-language labels — the approved spec pins profile contracts at 1.3 and requires labels to be bounded, not byte-exact; render controls visibly escaped instead — if wrong, such labels remain persistable but display escaped rather than being rejected.
Task 2: fix round 1/5 (3 addressed, 0 open; commits 9cb1ccd..53e7668)
Task 2: minor (deferred to Task 3): compatibility guide current-version and predecessor prose is stale after manifest v1.4/reason catalog v1.9.
Task 2: complete (commits c1f820e..53e7668, review clean)

Task 3: fix round 1/5 (4 addressed, 0 open; commits 2f9baac..fdeafc8): preserved migration-required diagnostics, compared exact raw profile bytes, covered every valid relay value shape in package verification, and corrected proof attribution.
Task 3: complete (commits 53e7668..fdeafc8, scoped re-review clean)

Task 4: complete (commit be167f4; full verify exit 0, task review clean)

Final review: fix wave 1/1 (6 addressed, 0 open; implementation commit 4f750d3): bound reinit profile reads to exact config write preconditions; preserved v1.1 roles/hosts in profile-only migration; escaped controls in stack evidence; rendered all profile leaves in migration preview; total-ordered stack evidence; pointed invalid-config doctor evidence at config.
Final review: complete (implementation commit 4f750d3; exact `npx --yes npm@11.16.0 run verify` exit 0 with 179 files / 4,736 tests).
