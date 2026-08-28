# Task 4 Report: Initialize explicit independent model roles

## Status

Completed: initialization now resolves, validates, discloses, and persists
explicit per-host planner, implementer, and judge assignments at state `1.1.0`.

## Delivered scope

- `resolveInitAnswers` is asynchronous and accepts `ModelRouting`; it reads
  catalogs only for enabled hosts, applies a host's defaults only when its role
  map is absent, resolves aliases to canonical model identities, and persists
  closed `{ model, effort }` objects.
- All three roles are resolved through the existing phase resolver before an
  init skeleton is planned. Unsupported effort, absent/unresolvable catalogs,
  and canonical implementer/judge equality return a refusal; no write plan is
  created.
- Omitted role maps produce deterministic `defaulted` paths in canonical host
  order, e.g. `modelRoles.codex.planner`; successful CLI output includes those
  paths.
- The skeleton remains pure and receives resolved answers only. It writes a
  `ProjectConfigV1_1` with `stateContract: "1.1.0"` and explicit `modelRoles`.
  Re-running identical initialization is still a no-op.
- Existing direct skeleton fixtures now supply resolved 1.1 role objects,
  preventing the pure generator from accepting incomplete pre-resolution
  answers.

## TDD evidence

### RED

Added init-answer, skeleton, command, and fault-campaign expectations before
production changes, then ran:

```text
npm test -- tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/init-fault-campaign.test.ts
Test Files 4 failed; Tests 15 failed
```

The expected failures showed that the legacy resolver rejected `1.1.0` answers,
the generated configuration still carried `1.0.0` without `modelRoles`, and
the init command returned a non-zero result for valid 1.1 input.

### GREEN

After the minimum resolver/composition/skeleton integration:

```text
npm test -- tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/init-fault-campaign.test.ts tests/init-managed-section.test.ts
Test Files 5 passed (5)
Tests 69 passed (69)

npm run typecheck
exit 0

npm run lint -- --quiet
exit 0

npx prettier --check [11 changed source/test files]
All matched files use Prettier code style!

git diff --check
exit 0
```

## Files

- `packages/runtime/src/domain/init/answers.ts`
- `packages/runtime/src/domain/init/skeleton.ts`
- `packages/runtime/src/composition/init.ts`
- `packages/runtime/src/domain/cli/init.ts`
- `packages/runtime/src/domain/init/index.ts`
- Initialization tests, plus the two typed skeleton callers that now pass
  resolved 1.1 answers.

## Self-review

- No concrete model identifier was added to shared runtime/domain code; all
  identity knowledge continues to come from the routing port/catalog.
- Explicit role maps replace adapter defaults as a whole; bare assignments use
  only `medium`, and no model, role, or effort fallback is synthesized.
- Each catalog is consulted after schema validation but before destination
  planning. An invalid resolution yields no destinations and a zero-write plan.
- The result's default disclosures are deterministic and configuration stores
  only canonical object assignments, so a repeated run produces byte-identical
  state.

## Fix round 1/5 — deterministic roles, closed skeleton input, and actionable refusals

### RED

Added the review cases before changing production code:

```text
npm test -- tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts
Test Files 2 failed | 1 passed
Tests 3 failed | 52 passed
```

The inverse-host test showed `.brain/config.json` serialized `claude` and
`codex` in supplied-input order. The semantic tests showed model refusals had
no `subject`, and the CLI boundary rendered `runtime.internal_failure` because
the model reason policy requires evidence. The initial negative type assertion
also failed under `npm run typecheck` against the pre-fix public type.

### GREEN

- Resolution retains only normalized `{ model, effort }` objects in a closed
  `ResolvedModelRoles` type. `skeletonEffects` therefore cannot receive raw
  string/alias assignments through its public TypeScript boundary.
- Catalogs are still observed in the caller's enabled-host order, but resolved
  role maps are inserted into persisted state in canonical `claude`, `codex`
  order. Inverse inputs now emit identical configuration bytes.
- The model resolver returns a bounded subject: catalog absence has `host`;
  role resolution, effort, and independence failures include `host` and a
  role (independence names `judge`). The CLI turns that into catalog-owned,
  model-ID-free prose and an observation evidence reference, satisfying the
  result policy rather than being sanitized into an internal failure.

```text
npm test -- tests/init-answers.test.ts tests/init-skeleton.test.ts tests/init-command.test.ts tests/init-fault-campaign.test.ts tests/init-managed-section.test.ts
Test Files 5 passed (5)
Tests 73 passed (73)

npm run typecheck
exit 0
```

### Self-review

- The public resolved type is separate from `ProjectConfigV1_1`'s permissive
  input shape; no cast hides a raw assignment at the skeleton boundary.
- Failure subjects contain only host and role labels. Neither invalid aliases
  nor model IDs are echoed into public prose or evidence.
- The helper used for init resolves each role directly, preserving the exact
  failing role before the canonical implementer/judge independence check.
