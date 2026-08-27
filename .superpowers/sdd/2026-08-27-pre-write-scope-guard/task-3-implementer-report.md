# Task 3 implementer report: canonical inspection and runtime guard operations

## Status

Implemented `kratos scope record`, `kratos guard write`, canonical read-only
target inspection, ordered mutation extraction, policy-state loading, repair
semantics, and transactional scope persistence. The task changes are ready for
a DCO-signed conventional commit.

## RED/GREEN evidence

### RED 1: missing runtime operations and target inspector

Command:

```text
npm test -- tests/write-guard-path-safety.test.ts tests/write-guard-operations.test.ts
```

Before production code, the run exited 1 with `2 failed` files and `20 failed |
1 passed` tests. The CLI cases received `trail.uso` because `guard write` and
`scope record` were unregistered, and all four path cases failed because
`nodeTargetInspector` did not exist.

### GREEN 1: canonical inspection and runtime operations

The same command passed after implementation with `2 passed` files and `22
passed` tests. Subsequent TDD cycles extended this suite to 26 passing tests,
covering malformed input, every mutation kind, both move endpoints, scope
recording, corrupt state, repair behavior, and no mutation.

### RED/GREEN 2: first-target ordering

The regression test placed an out-of-allow target first and a dangling symlink
second. It initially failed because the later `guard.target_uninspectable`
replaced the earlier policy refusal. After inspection and policy evaluation
were interleaved per normalized target, the suite returned
`guard.outside_allow` for `outside/first.ts` and passed.

### RED/GREEN 3: lexical drive escape

The drive-absolute case initially received `guard.target_uninspectable` rather
than a lexical escape. After classifying drive-absolute targets before native
path resolution, the path-safety suite passed `5/5` with `kind: "escape"`.

### RED/GREEN 4: policy precedence during repair

Two tests initially received `guard.scope_corrupt` for `.env` and
`private/secret.txt` under reviewer drift. After retaining validated guardrails
with invalid scope state and applying immutable/project write blocks first,
both returned `guard.write_block`; the focused guard suites passed `56/56`.

### RED/GREEN 5: initialized project without an active feature

A fresh initializer leaves the active-feature marker empty. The integration
test first failed with `guard.active_feature_corrupt`; after treating an empty
marker as the established absence state, the path/operation suites passed
`28/28` and guardrails remained active without a feature scope.

### Full-suite integration audit

The first full run exposed two Task 3 integration expectations and one earlier
Task 1 gap. After updating the observing-command enumeration and removing the
forbidden domain-to-application type dependency, the focused architecture set
passed `141/141`.

A fresh second full run proved the remaining issue is isolated:

```text
npm test
# 1 failed | 156 passed files; 1 failed | 4,157 passed tests
```

The sole failure is
`tests/contract-schemas.test.ts:438`: its expected fixture enumeration omits
the already-present Task 1 files `feature-scope.json`, `guardrails.json`, and
`pre-tool-use.json`. Per controller ruling, Task 3 did not modify that prior
task's test.

## Files changed

- Application: `packages/runtime/src/application/write-guard/{index,operations,policy,targets}.ts`
- Ports/Node infrastructure: `packages/runtime/src/ports/{filesystem,index}.ts`,
  `packages/runtime/src/infra/node/{index,target-inspection}.ts`
- Composition: `packages/runtime/src/composition/{cli,index,read-only,write-guard}.ts`
- CLI/domain surface: `packages/runtime/src/domain/cli/{commands,index,spec,write-guard}.ts`
- Package export: `packages/runtime/package.json`
- Tests: `tests/write-guard-{operations,path-safety}.test.ts`,
  `tests/{cli-commands,command-observation,init-command,read-only-ports,runtime-composition}.test.ts`

## Decisions

- The Node inspector resolves the canonical project root, rejects lexical
  escapes, realpaths existing entries, and walks missing paths to the nearest
  existing ancestor before safely reattaching the suffix. A dangling symlink
  is uninspectable rather than absent.
- Mutation targets remain ordered exactly as normalized; move source precedes
  destination. Each canonical target is evaluated before advancing, so a later
  failure cannot replace the first refusal.
- Policy state is validated through the existing schema registry and reviewer
  declarations go through Task 2's sole parser. No command or prompt encodes a
  policy decision.
- Missing `scope.json` removes feature allow/deny restrictions only. Immutable
  and project write blocks remain active.
- Invalid policy permits repair only while every target evaluated so far is
  canonical `.brain/**`; immutable/project blocks still retain their higher
  precedence when they are available.
- `scope record` writes only through the existing effect-plan/transaction
  boundary and refuses malformed prose, corrupt state, or recorded drift.
- Existing published reasons retain their immutable catalog policies:
  `guard.write_block`, `guard.scope_deny`, `guard.outside_allow`, and
  `guard.scope_corrupt` remain failure/exit 2. The new path reasons remain
  blocked/exit 3. Any non-success guard result still denies the host mutation.

## Verification

Fresh final commands all exited 0:

```text
npm test -- tests/write-guard.test.ts tests/write-guard-path-safety.test.ts tests/write-guard-operations.test.ts tests/architecture.test.ts tests/command-observation.test.ts tests/cli-commands.test.ts tests/cli-help.test.ts tests/cli-contracts.test.ts tests/runtime-composition.test.ts tests/read-only-ports.test.ts tests/init-command.test.ts
# 11 passed files; 301 passed tests

npm run contracts:check
# 23 schemas; 14 legacy profiles; generated types current

npm run typecheck
npm run lint
npx prettier --check <Task 3 files and report>
git diff --check
# All completed with no diagnostics; targeted files match Prettier style.
```

## Self-review

Reviewed the implementation against the approved decision order and all Task
3 binding behavior. The domain matcher remains filesystem-neutral; the new
filesystem port is read-only; evidence never echoes an unsafe raw target; all
guard results claim no state change; and target inspection performs no write,
remove, rename, or directory creation.

## Concerns

- The one full-suite failure is the prior Task 1 fixture-enumeration omission
  described above. It is not caused by Task 3 and remains intentionally
  untouched for the Task 1 fix/re-review path.
- The generic spec wording says refusal is blocked/exit 3, but the approved
  compatibility ruling requires preservation of older published reason
  policies. Task 5 will document that exception and final review may decide
  whether a future catalog revision is warranted.
