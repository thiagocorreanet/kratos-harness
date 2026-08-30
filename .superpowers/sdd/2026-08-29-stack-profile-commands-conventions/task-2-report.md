# Task 2 report: initialization merge, rendering, and migration

## Outcome

Task 2 is complete on top of Task 1 (`c1f820e`). Initialization now resolves the
typed project profile field by field, persists project configuration 1.3.0, and
renders a deterministic stack-profile document from root-entry stack evidence,
the resolved project profile, and the existing language policy. A current 1.3.0
profile is preserved when answers omit individual leaves; an explicit
`unresolved` leaf clears the persisted value.

Initialization does not silently upgrade configuration 1.2.0. It refuses with
`profile.config_migration_required`. The explicit configuration migration now
upgrades 1.0.0, 1.1.0, and 1.2.0 state to 1.3.0, preserving existing state and
using unresolved profile leaves unless migration answers supply profile values.

## TDD evidence

RED was captured before production changes:

- Literal renderer assertions for recognized, unrecognized, and multi-stack
  roots failed because the previous renderer emitted only stack evidence.
- Fresh-profile persistence, current-profile fieldwise merge, explicit override,
  explicit clearing, and second-initialization idempotence assertions failed
  against the 1.2.0 initialization path.
- Migration and compatibility assertions failed because configuration 1.2.0 was
  still classified as current and the new reason catalog revision did not exist.

GREEN verification after implementation:

- `npx --yes npm@11.16.0 test -- tests/init-skeleton.test.ts tests/init-command.test.ts tests/config-migration.test.ts tests/configuration-classification.test.ts tests/project-configuration.test.ts tests/contract-reason-catalog.test.ts tests/contract-manifest.test.ts tests/contract-compatibility.test.ts`
  — 8 files and 172 tests passed.
- Impacted regression selection covering workflow, discovery, packaging, and
  documentation — 15 files and 154 tests passed.
- `tests/package-verifier.test.ts` — 5 tests passed in isolation.
- `npx --yes npm@11.16.0 run contracts:check` — 37 schemas, 14 legacy
  profiles, generated types current.
- `npx --yes npm@11.16.0 run typecheck` — passed.
- `npx --yes npm@11.16.0 run lint` — passed with zero warnings.
- `npx --yes npm@11.16.0 run format:check` — passed.
- `git diff --check` — passed.

An earlier full `npm test` run reached 4,692 passing tests and six failures. Four
were stale Task 2 expectations and were corrected, then covered by the green
focused/impacted runs above. The other two occurred when package verification
and runtime-distribution tests concurrently rebuilt the same temporary package
directory; both affected suites pass independently. Task 4 owns the repository's
final full verification gate.

## Implementation notes

- Added `renderStackProfile(stack, projectProfile, languagePolicy)` and made
  `skeletonEffects` its sole caller for the managed Markdown artifact.
- Rendering has stable section and field order, literal unresolved markers,
  explicit not-applicable reasons, Markdown escaping for human-provided values,
  and no defaults inferred from stack detection.
- Initialization observes and validates `.brain/config.json` before resolving
  answers. Only current 1.3.0 state contributes a persisted profile.
- Configuration output and host metadata now identify contract 1.3.0.
- Added `upgradeProjectConfigurationV1_3`; no-answer migration creates the
  complete unresolved profile, while supplied migration answers can populate it.
- Added append-only reason catalog 1.9.0 and contract manifest schema v1.4. The
  contract-family manifest now points to reason catalog 1.9.0.
- Published manifests v1 through v1.3 and reason catalog v1.8 were not modified.
  Their verified SHA-256 values remain:
  - manifest v1: `0de8cb9096adbe984b729cb511d57f8c9aa0e3f50f6ec09b9bc39cf5b022cff6`
  - manifest v1.1: `7693411838fa4629ca524fd0053de08372201d2d3ffd44e9e2e3c69f5d91d9bf`
  - manifest v1.2: `2356781cab1977eb06efd3864c2c553eb77de058e9d5530c1424080a599311ad`
  - manifest v1.3: `8a1d74451b62386e478b6dea41c2bdb670974f5a8c1b7a76908dc58a7e8d57dd`
  - reason catalog v1.8: `c23aa8566cfa0b16c33c575bca85225097552e5f9964a5e0d20fed274ab9a940`

## Self-review

- Confirmed merge precedence is explicit answer, then current persisted profile,
  then unresolved; the nullary `unresolved` object remains an explicit answer
  and therefore clears rather than falls through.
- Confirmed rendering treats every configured command as inert text and escapes
  table delimiters, inline-code delimiters, angle brackets, and ampersands.
- Confirmed a 1.2.0 configuration cannot reach skeleton effects through init and
  receives the dedicated migration reason instead.
- Confirmed migration preserves language, policy mode, managed-state settings,
  model roles, and plugin version while advancing contract identifiers.
- Confirmed one project-wide command set is persisted and stack detection never
  supplies project-profile values.
- No doctor classification or host relay changes from Task 3 were implemented.

## Concerns and handoff

The only remaining concern is the pre-existing shared temporary package-build
location used by concurrently executing package tests. It can make the full
Vitest run order-sensitive; isolated package and runtime-distribution coverage
is green. Final full-suite verification should avoid concurrent mutation of that
shared directory or run the affected package checks separately.

## Fix Round 1

### Review fixes

- Corrected v1.2 profile-only migration so catalog defaults cannot replace
  persisted custom model-role assignments. Omitted role maps are preserved,
  explicitly supplied host maps override only that host, and a narrowed host
  answer cannot delete another persisted host map. Preview metadata no longer
  describes preserved assignments as defaulted.
- Replaced command table cells with dynamically sized fenced code blocks. The
  command content line is now byte-for-byte the configured single-line command,
  including `&&`, `|`, `<`, `>`, `&`, and arbitrary backtick runs.
- Added complete Markdown prose escaping for not-applicable reasons, paths, and
  conventions. Implementation-language controls are emitted visibly as `\\n`,
  `\\r`, `\\t`, or `\\uNNNN`, so published v1.3 labels cannot alter document
  structure.
- Preserved the published v1.3 host/state schemas byte for byte. The review
  ruling retained their approved 64-character label boundary and assigned
  control safety to deterministic rendering; immutable digest assertions now
  cover both v1.3 profile schemas.

### RED evidence

```sh
npx --yes npm@11.16.0 test -- tests/config-migration.test.ts -t 'preserves both persisted custom role maps|merges explicit role answers'
# 2 expected failures: catalog defaults replaced both custom maps, and a narrowed answer deleted the other host map

npx --yes npm@11.16.0 test -- tests/config-migration.test.ts -t 'merges explicit role answers'
# 1 expected failure: a defaulted omitted host map replaced its persisted custom assignments

npx --yes npm@11.16.0 test -- tests/config-migration.test.ts -t 'preserves both persisted custom role maps'
# 1 expected failure: preview incorrectly marked a preserved custom assignment as defaulted

npx --yes npm@11.16.0 test -- tests/init-skeleton.test.ts -t 'keeps command bytes copyable'
# 1 expected failure: commands were HTML-entity transformed and prose/label Markdown remained structurally active
```

### GREEN evidence

```sh
npx --yes npm@11.16.0 test -- tests/config-migration.test.ts tests/init-skeleton.test.ts tests/contract-schemas.test.ts tests/contract-manifest.test.ts tests/schema-registry-integrity.test.ts
# 5 files passed, 148 tests passed

npx --yes npm@11.16.0 test -- tests/contract-type-generation.test.ts
# 1 file passed, 13 tests passed

npx --yes npm@11.16.0 test -- tests/init-command.test.ts tests/configuration-classification.test.ts tests/project-configuration.test.ts tests/contract-reason-catalog.test.ts tests/contract-compatibility.test.ts
# 5 files passed, 64 tests passed

npx --yes npm@11.16.0 run typecheck
npx --yes npm@11.16.0 run contracts:check
npx --yes npm@11.16.0 run lint
npx --yes npm@11.16.0 run format:check
# all passed; contracts verified 37 schemas, 14 legacy profiles, and current generated types
```

The contract type-generation suite timed out once when run concurrently inside
a six-file Vitest selection; its immediate isolated rerun passed all 13 tests.

### Self-review

- Mutating the migration back to whole-map replacement fails both role-map
  regressions; mutating hostwise merge to include resolved defaults for omitted
  hosts fails the explicit partial-map case.
- Migration lineage and preview hosts now derive from the final persisted maps,
  while default markers exclude role values retained from project state.
- Dynamic fences use one more backtick than the longest configured run, with a
  minimum of three, so command bytes cannot close their own fenced block.
- Markdown punctuation, raw HTML delimiters, entity starts, table separators,
  and controls are neutralized outside command blocks while retaining intended
  rendered text.
- No v1.3 schema/catalog bytes changed, no v1.4 profile contract was introduced,
  and no Task 3 doctor or host-relay work was added.
