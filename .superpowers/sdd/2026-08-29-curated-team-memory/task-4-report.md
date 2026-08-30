# Task 4 — lossless legacy memory migration

## RED

```text
$ npm test -- tests/memory-migration-domain.test.ts
Test Files  1 failed (1)
Tests  4 failed (4)
TypeError: classifyLegacyMemory is not a function
TypeError: reduceLegacyMemoryMigration is not a function

$ npm test -- tests/memory-migration-runtime.test.ts
Test Files  1 failed (1)
Tests  2 failed (2)
expected 0 to be 4
expected 2 to be 0
```

## GREEN

```text
$ npm test -- tests/memory-migration-domain.test.ts tests/memory-migration-runtime.test.ts
Test Files  2 passed (2)
Tests  8 passed (8)

$ npm test -- tests/memory-migration-domain.test.ts tests/memory-migration-runtime.test.ts tests/curated-memory-domain.test.ts tests/curated-memory-runtime.test.ts tests/curated-memory-reasons.test.ts tests/migration-plan.test.ts tests/migration-observability.test.ts tests/config-migration.test.ts tests/contract-compatibility.test.ts
Test Files  9 passed (9)
Tests  137 passed (137)
```

## Implementation and self-review

- Added closed `migrate memory <mapping.json>` preview/apply with mapping,
  source, plan, and plan-time digest binding.
- Does not parse legacy Markdown. It validates only line ranges: positive,
  ordered, non-overlapping, in-bounds, and exact coverage of every nonblank,
  non-template line.
- Produces deterministic synthetic provenance from the exact range bytes and
  range metadata; publishes ledger and rendered projection in one transaction.
- Preserves exact original Gotchas bytes, receipt, rollback manifest, and
  verification record; rollback restores the bytes and removes the migrated
  ledger.
- Classifies structured state, exact stock template, and custom legacy state;
  ordinary memory commands refuse custom legacy state with
  `memory.migration_required`.
- No controller-ledger files were modified. Predecessor schemas and reason
  catalogue entries were not changed.

## Risks / follow-up

- The focused initialization command suite currently has two inherited count
  assertions expecting 28/19 files. The committed Task 1 ledger makes the
  runtime correctly report 29/20. This Task 4 change does not modify
  initialization; the failing assertions need their owner updated separately.

## Fix Round 1

- Bound the migration identity deterministically to proposal digest, source
  digest, and plan time, and included it in the reviewed plan digest.
- Added a fingerprinted delete-effect path and use it for migrated ledger
  removal during rollback; projection drift now reports revision conflict with
  the memory artifact reference.
- Code and review phase assignment now consult the shared legacy-memory
  classifier before creating a handoff and refuse with
  `memory.migration_required`.
- The migration reducer rejects rendered projections over the 48 KiB limit;
  generated apply commands retain and shell-quote `--root` and mapping paths.
- Registry tests now list `migrate memory`.

## Fix Round 2 — recovery and execution races

### RED

```text
$ npm test -- tests/memory-migration-runtime.test.ts
Test Files  1 failed (1)
Tests  3 failed | 8 passed (11)
Error: expected recoverable transaction
AssertionError: rollback recovery left the curated projection, not original bytes

$ npm test -- tests/model-role-workflow.test.ts
Test Files  1 failed (1)
Tests  5 failed | 38 passed (43)
The standard-policy setup was required to advance phases; the initial
memory handoff refusal also exposed model-routing-prefixed rather than
memory-artifact evidence.
```

### GREEN

```text
$ npm test -- tests/model-role-workflow.test.ts tests/memory-migration-runtime.test.ts
Test Files  2 passed (2)
Tests  54 passed (54)

$ npx vitest run [memory + migration focused suite]
Test Files  9 passed (9)
Tests  141 passed (141)

$ npx vitest run [workflow + handoff + CLI + schema focused suite]
Test Files  13 passed (13)
Tests  231 passed (231)

$ npx vitest run [transaction + recovery focused suite]
Test Files  9 passed (9)
Tests  292 passed (292)

$ npm run typecheck
tsc6 --noEmit

$ npm run lint
eslint . --max-warnings 0

$ npm run format:check
All matched files use Prettier code style!

$ npm run build
artifacts: claude-code, codex

$ git diff --check
(clean)
```

### Self-review

- Added failpoint recovery coverage at mid and late publish stages for both
  migration and rollback. Recovery now proves either the intact curated pair
  or the original legacy bytes, according to the safely reached transaction
  state; the backup remains exact throughout migration recovery.
- Extended the immutable verification artifact with the migrated ledger digest
  and require rollback observation to bind it to the current ledger as well as
  the rendered projection. A modified ledger cannot become delete authority.
- Added execution-time races that change the ledger or projection immediately
  after its plan fingerprint is observed. Managed publish refuses with
  `runtime.revision_conflict`, names that exact memory path, and retains the
  changed bytes.
- Added workflow coverage showing `memory.migration_required` precisely for
  code/review handoff, while PRD/spec/plan/acceptance retain their normal
  assignments. Handoff now supplies the actual Gotchas artifact as evidence,
  rather than a synthetic model-routing reference.

### Residual risk

- The inherited Task 1 initialization-count assertions remain outside this
  task's changed surfaces and were not altered.

## Fix Round 2 — canonical migration apply quoting

### RED

```text
$ npm test -- tests/cli-commands.test.ts
Test Files  1 failed (1)
Tests  1 failed | 15 passed (16)
Expected: 'a root'\\''$;$(bad)'
Received: 'a root'"'"'$;$(bad)'
```

### GREEN

```text
$ npm test -- tests/cli-commands.test.ts tests/memory-migration-runtime.test.ts tests/memory-migration-domain.test.ts tests/cli-composition.test.ts tests/cli-contracts.test.ts
Test Files  5 passed (5)
Tests  76 passed (76)

$ npm run typecheck
tsc6 --noEmit

$ npm run lint
eslint . --max-warnings 0

$ npm run format:check
All matched files use Prettier code style!

$ npm run build
artifacts: claude-code, codex

$ git diff --check
(clean)
```

### Self-review

- Replaced migration's divergent quote renderer with the Task 3 canonical
  POSIX transform (`'` becomes `'\\''`) in one shared CLI helper. The same
  helper now covers memory promotion and configuration migration rendering.
- Added a migration-specific Bash execution test whose root and mapping carry
  whitespace, apostrophes, `$`, a semicolon, and `$(bad)`. A shim records the
  exact reconstructed argv and a separate `bad` executable proves no command
  substitution ran.
