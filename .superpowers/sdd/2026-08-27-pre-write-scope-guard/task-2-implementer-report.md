# Task 2 implementer report: reviewer translation and pure glob policy

## Status

Implemented the host- and filesystem-neutral reviewer scope translator, bounded ordered glob matcher, immutable write-block defaults, and target decision policy. The task changes are committed with a signed conventional commit after this report is added.

## RED/GREEN evidence

### RED 1: new pure policy API

Command:

```text
npm test -- tests/write-guard.test.ts
```

Before production code, Vitest failed at module resolution because
`@kratos/runtime/domain/write-guard` was not exported. This established that
the new test suite exercised a missing public domain surface.

### GREEN 1: glob, summary, and decision behavior

Command:

```text
npm test -- tests/write-guard.test.ts
```

Result after the implementation: `1 passed`, `21 passed`.

### RED 2: reviewer template grammar

Command:

```text
npm test -- tests/feature-documents.test.ts
```

After changing the expected template bytes first, two assertions failed because
the generated model still said only to list paths rather than use exact
code-formatted project-relative glob bullets.

### GREEN 2: model and fixture update

Command:

```text
npm test -- tests/write-guard.test.ts tests/feature-documents.test.ts
```

Result after updating the feature-document model and completed fixture:
`2 passed`, `30 passed`.

### RED/GREEN 3: renderer/parser grammar closure

The test first required `renderSummaryScope` to reject a double-negated glob
that would not be a valid persisted reviewer declaration. It failed with
`expected [Function] to throw an error`; after validation was added, the
focused suite passed with `22 passed`.

## Files changed

- `packages/runtime/src/domain/write-guard/glob-policy.ts`
- `packages/runtime/src/domain/write-guard/scope-document.ts`
- `packages/runtime/src/domain/write-guard/decision.ts`
- `packages/runtime/src/domain/write-guard/index.ts`
- `packages/runtime/package.json`
- `tests/write-guard.test.ts`
- `packages/runtime/src/domain/feature-documents/model.ts`
- `tests/feature-documents.test.ts`
- `fixtures/feature-documents/complete/03-summa.md`

## Decisions

- Implemented the bounded dialect locally because `minimatch` is not a declared
  direct workspace dependency. It is ordered, project-relative,
  slash-sensitive, case-sensitive, and supports `*`, `?`, `**`, character
  classes, and leading `!` replacement semantics.
- The same `parseSummaryScope` and `renderSummaryScope` grammar owns the exact
  code-formatted allow/deny bullets. Ordered arrays are compared directly for
  scope/reviewer agreement.
- Decisions evaluate immutable and project blocks first, then reviewer drift,
  feature denies, `.brain/**` allow bypass, and finally non-empty allow
  membership. An explicit `.brain/**` deny therefore still refuses.
- Immutable defaults protect real `.env` variants except names containing the
  conventional `example`, `sample`, or `template` variant segment; any
  `migrations` path segment and `AGENTS.md`/`CLAUDE.md` basenames are blocked.
  `.codex/**` and `.claude/**` have no default block.
- The feature-document guidance specifies syntax only and does not encode
  policy decisions.

## Verification

Fresh successful commands:

```text
npm test -- tests/write-guard.test.ts tests/feature-documents.test.ts
# 2 passed, 31 passed
npm run typecheck
npm run lint
npx prettier --check packages/runtime/src/domain/write-guard tests/write-guard.test.ts packages/runtime/src/domain/feature-documents/model.ts packages/runtime/package.json tests/feature-documents.test.ts fixtures/feature-documents/complete/03-summa.md
# All matched files use Prettier code style
git diff --check
```

## Self-review

Reviewed the decision order against the approved spec and binding decisions,
including negation replacement, deny-over-allow, empty allow, nested matching,
reviewer drift, `.brain` semantics, defaults, and exception cases. The domain
surface accepts only canonical project-relative targets from its caller; target
inspection, policy document I/O, and host payload extraction intentionally stay
out of this task for Task 3 and Task 4.

## Concerns

`npm run format:check` remains nonzero because four pre-existing unrelated
files are not formatted: `packages/runtime/src/infra/schema/catalog.ts`,
`schemas/contracts/contract-manifest.v1.2.schema.json`,
`tests/contract-reason-catalog.test.ts`, and
`tests/schema-registry-types.test.ts`. The task-owned file set passes a direct
Prettier check, and `git diff --check` passes.
