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

## Fix round 1

Accepted all review findings and preserved the original signed implementation
commit. The follow-up fixes now retain the normalized lexical directory-entry
identity and the canonical referent identity for each target, authorize both in
that order, and always report policy evidence against the original lexical
target. This closes final-symlink delete and move endpoint bypasses while
preserving request and source-before-destination ordering.

Invalid-policy repair now requires both identities of every target to be a
strict `.brain/**` descendant; exact `.brain` is refused for delete and for
either move endpoint. The scope recorder validates its translated reviewer
scope through the registered `state.feature-scope@1.0.0` schema before it can
produce a write plan, including the 256-item array bound.

The Node adapter captures one canonical root device/inode/path identity per
request using the durable filesystem's established capture routine. Each
inspection revalidates that pinned identity without deriving a replacement
root, and the focused seam proves two targets cause one capture. Capture and
session-inspection exceptions both map to bounded
`guard.target_uninspectable` observations without exposing thrown content.

### Fix RED

Before the fixes:

```text
npm test -- tests/write-guard-path-safety.test.ts tests/write-guard-operations.test.ts
# 2 failed files; 9 failed | 30 passed tests
```

The failures were three final-symlink lexical-identity cases, canonical-deny
evidence using the referent instead of the lexical target, two exact `.brain`
repair cases, a non-`.brain` repair alias whose referent was under `.brain`, an
oversized reviewer scope that was recorded, and the absent request-level root
capture API. The allowed-source/forbidden-destination regression already
passed, proving the initial endpoint extraction/order behavior.

### Fix GREEN and verification

Fresh verification after the follow-up:

```text
npm test -- tests/write-guard-path-safety.test.ts tests/write-guard-operations.test.ts tests/init-command.test.ts
# 3 passed files; 61 passed tests

npm run typecheck
npm run lint
npx prettier --write <follow-up Task 3 files>
git diff --check
# All exited 0 / no diagnostics.
```

A fresh full test run proves only the controller-designated Task 1 integration
gap remains:

```text
npm test
# 1 failed | 156 passed files; 1 failed | 4,171 passed tests
```

The exact failure remains `tests/contract-schemas.test.ts:438`: the fixture
directory contains `feature-scope.json`, `guardrails.json`, and
`pre-tool-use.json`, while the prior Task 1 expected enumeration omits them.
That test remains untouched as directed.

### Fix concerns

- A synchronous preflight cannot eliminate a host-side time-of-check/time-of-use
  race after Kratos returns its operation result. The adapter pins and
  revalidates root identity during the request, but executing external host
  mutations inside Kratos is outside this task's scope.
- The published reason-policy compatibility exception recorded above remains
  unchanged by this fix round.

## Fix round 2

The remaining precedence defect was in invalid-policy evaluation: the strict
repair-location predicate ran immediately after each identity's write-block
check. A non-`.brain` lexical alias therefore returned the corrupt-state reason
before its canonical referent could receive the higher-priority immutable or
validated project write-block decision.

The regression was captured before production changes:

```text
npm test -- tests/write-guard-operations.test.ts
# 1 failed file; 2 failed | 36 passed tests
```

Both the immutable-referent and project-blocked-referent alias cases received
`guard.scope_corrupt` with reviewer evidence instead of `guard.write_block`
with lexical-target evidence. An adjacent ordinary non-brain target case
continued to establish the intended corrupt-state refusal.

The minimal correction now completes the ordered lexical/canonical global and
project block pass for each original target before evaluating whether every
identity is a strict `.brain/**` repair descendant. Valid-policy allow/deny
ordering and original multi-target ordering are unchanged. Immediate GREEN:

```text
npm test -- tests/write-guard-operations.test.ts
# 1 passed file; 38 passed tests
```

Fresh final verification:

```text
npm test -- tests/write-guard-path-safety.test.ts tests/write-guard-operations.test.ts tests/init-command.test.ts
# 3 passed files; 64 passed tests

npm run typecheck
npm run lint
npx prettier --check <fix-round-2 files>
git diff --check
# All exited 0 / no diagnostics.
```
