# Issue #133 pre-write scope guard evidence

Date: 2026-08-27

## Scope

This evidence closes [issue #133](https://github.com/thiagocorreanet/kratos-harness/issues/133).
It records the executable pre-write policy for structured host file mutations,
not a prompt instruction. The reviewer summary supplies a checked scope record;
the host synchronously relays the runtime's result before invoking a supported
filesystem tool.

## Acceptance evidence

| Acceptance criterion | Evidence |
| --- | --- |
| Nested globs, ordered negation, and deny-over-allow semantics are deterministic | `tests/write-guard.test.ts` table-tests `*`, `?`, `**`, character classes, later negation, re-enablement, and feature deny before allow. |
| Reviewer prose and stored scope agree, and deliberate drift fails closed | `tests/write-guard.test.ts` exercises the exact code-formatted summary grammar, one parser/renderer round trip, malformed bullets, fences, nested headings, and drift. `tests/write-guard-operations.test.ts` proves `scope record` creates exact state, rejects malformed prose without state, preserves a differing `scope.json`, detects both forms of concurrent creation and an exact-content race, and reports unchanged only after stable revalidation. |
| Outside-root paths, symlink escapes, and uninspectable targets are refused before mutation | `tests/write-guard-operations.test.ts` covers lexical escapes, existing symlink escape, dangling links, canonical in-root aliases, inspection errors, lexical/canonical policy identities, and unchanged trees. `tests/write-guard-path-safety.test.ts` additionally proves Node's not-a-directory error and a non-directory nearest ancestor fail closed. |
| Empty allowlists do not restrict; deny and outside-allow paths refuse with stable reasons | `tests/write-guard.test.ts` covers an empty allowlist, deny-over-allow, the `.brain/` descendant bypass, exact `.brain` exclusion, project blocks, immutable defaults, and `guard.outside_allow`. `tests/write-guard-operations.test.ts` checks normalized first-refusal order, source-before-destination move order, and delete/move requests for the exact state root. |
| A project with no scope file behaves as before | The `tests/write-guard-operations.test.ts` case `has no feature allow or deny restriction when scope.json is absent` permits `src/new.ts` while retaining immutable `.env` and project `private/**` blocks. The focused command below runs this case. |
| Specification and state descendants remain writable under a non-empty allowlist | `tests/write-guard.test.ts` covers the `.brain` membership bypass; `tests/pre-tool-relay-parity.test.ts` runs the `specification path bypasses allow membership` and `state path bypasses allow membership` normalized cases through both hosts. |
| Invalid policy fails closed, with only bounded `.brain/` descendant repair | `tests/write-guard-operations.test.ts` covers corrupt guardrails, corrupt scope, malformed/drifted reviewer state, blocks before corrupt state, all-`.brain/` repair, exact `.brain` root exclusion, canonical alias rejection, and an explicit valid-state `.brain/**` deny. |
| Scope, guardrails, and host pre-tool contracts remain closed and compatible | `tests/pre-write-scope-contracts.test.ts` validates project-relative scope globs, the normalized mutation schema, additive `writeBlocks`, and generated type/registry registration. Runtime composition semantically validates project blocks through the same `isPathGlob` domain grammar, with malformed-class, reversed-range, slash-range, and unsafe-character regressions in `tests/write-guard-operations.test.ts`. |
| Claude Code and Codex produce identical normalized runtime result identity | `tests/pre-tool-relay-parity.test.ts` executes every shared `PRE_TOOL_RELAY_CASES` input and requires equal complete `operationResult` values. `tests/claude-code-pre-tool-relay.test.ts`, `tests/codex-pre-tool-relay.test.ts`, and `tests/pre-tool-relay-hardening.test.ts` cover extraction, the Codex environment preamble, missing/empty/relative/malformed native roots on both hosts, one runtime call for recognized malformed input, and pass-through for unrelated tools. |
| Packaged reviewer-to-code workflow records scope before guarded implementation | `tests/pre-tool-relay-distribution.test.ts` requires an identical `scope record` activation section in both shipped skills and executes each packaged bridge to create `scope.json` before its packaged hook denies an outside-scope code target without mutation. It also verifies native matchers, executable hook assets, the synchronous runtime deadline, and denial rendering. |
| Published documentation stays attached to executable contracts | `tests/contract-documentation.test.ts` requires the configuration, reviewer scope, host relay, and result-compatibility guides to publish the grammar, policy ordering, immutable defaults, repair boundary, supported tools, host-neutral result identity, time-of-check/time-of-use limit, and reason/exit compatibility. It indexes current manifest schema v1.2 and immutable predecessor v1.1; `tests/acceptance-criterion-contracts.test.ts` pins predecessor bytes. |

## Completed acceptance checklist

- [x] Structured mutations are canonicalized and refused before host mutation on
  an escape, symlink escape, or uninspectable target.
- [x] `scope record` translates only the reviewer summary grammar and refuses
  malformed, drifted, or concurrently changed state without replacing it.
- [x] Both packaged reviewer-to-code skills invoke the runtime's `scope record`
  operation after valid reviewer prose and before implementation.
- [x] Ordered glob matching, feature deny, `.brain` allow bypass, empty allow,
  immutable defaults, and semantically valid additive project blocks have
  deterministic tests; exact `.brain` is not a bypass.
- [x] Invalid policy admits only all-`.brain/` descendant repair; exact `.brain`
  remains excluded.
- [x] Shared normalized cases conform across Claude Code and Codex, while
  recognized calls require an absolute native root and unrelated Bash calls
  pass outside the structured-tool contract.
- [x] Contracts, fixtures, package hooks, public documentation, and stable
  reason/exit behavior have focused executable evidence.

## Verification commands

Focused implementation and contract verification:

```text
npm test -- --run tests/pre-write-scope-contracts.test.ts tests/write-guard.test.ts tests/write-guard-operations.test.ts tests/write-guard-path-safety.test.ts tests/claude-code-pre-tool-relay.test.ts tests/codex-pre-tool-relay.test.ts tests/pre-tool-relay-parity.test.ts tests/pre-tool-relay-hardening.test.ts tests/pre-tool-relay-distribution.test.ts tests/contract-documentation.test.ts tests/acceptance-criterion-contracts.test.ts --reporter=verbose

Test Files  11 passed (11)
Tests       186 passed (186)
Exit code   0
```

Documentation assertion (red then green):

```text
npm test -- --run tests/contract-documentation.test.ts --reporter=verbose

Initial result: failed because the public guides did not contain the new
pre-write scope contract. Correction-round red result: failed because the host
guide did not publish the schema-required `contractVersion` field. Final
result: 1 file passed, 8 tests passed, exit 0.
```

Focused documentation checks:

```text
npx --yes markdownlint-cli2@0.23.2 --no-globs docs/user/configuration-and-state.md docs/architecture/project-initialization.md docs/user/hosts.md docs/compatibility/result-contract.md docs/compatibility/contract-versioning.md docs/verification/issue-133-pre-write-scope-guard-evidence.md schemas/README.md
npx cspell@10.0.1 --no-progress --show-suggestions docs/user/configuration-and-state.md docs/architecture/project-initialization.md docs/user/hosts.md docs/compatibility/result-contract.md docs/compatibility/contract-versioning.md docs/verification/issue-133-pre-write-scope-guard-evidence.md schemas/README.md
node scripts/check-english.mjs
npx prettier@3.9.6 --check tests/contract-documentation.test.ts docs/user/configuration-and-state.md docs/architecture/project-initialization.md docs/user/hosts.md docs/compatibility/result-contract.md docs/compatibility/contract-versioning.md docs/verification/issue-133-pre-write-scope-guard-evidence.md schemas/README.md
git diff --check
```

Architecture and repository contract checks:

```text
npm test -- --run tests/architecture.test.ts tests/package-boundaries.test.ts tests/schema-boundary.test.ts tests/transaction-schema-boundary.test.ts --reporter=verbose
Test Files  4 passed (4)
Tests       145 passed (145)

npm run contracts:check
23 schemas; 14 legacy profiles; generated types current

npm run result:check
76 reasons; exits 0,1,2,3,4,5; 6 examples

npm run parity:check
Parity inventory verified; 0 / 400 drift
```

Consolidated full-suite evidence:

```text
npm test

Test Files  162 passed (162)
Tests       4272 passed (4272)
Exit code   0
```

Additional branch checks:

- [x] `npm run format:check`, `npm run spellcheck`, `npm run english:check`,
  `npm run lint`, and `npm run typecheck` — exit 0.
- [x] `npm run build` and `npm run package:verify` — exit 0; clean-room package
  verification passed for Claude Code and Codex.
- [x] `git diff --check 431112e..HEAD` — exit 0 after the signed fix commit.
- [x] `npm run verify` — exit 0 after final re-review. It passed formatting,
  spelling, English, lint, typecheck, 4,272 tests, coverage (93.48% statements,
  89.33% branches, 94.42% functions, and 93.87% lines), mutation (3/3), gap
  calibration, performance, oracle, parity, result, contracts, differential,
  build, package verification for both hosts, and benchmark gates.

## Impact

- **Compatibility:** `state.feature-scope@1.0.0`,
  `host.pre-tool-use@1.0.0`, and `writeBlocks` are additive. Projects without
  `scope.json` retain no feature allow/deny restriction. Existing valid
  guardrails remain valid. Published write/scope reasons retain failure / exit
  2; new `guard.path_escape` and `guard.target_uninspectable` are blocked /
  exit 3. Host relays deny every non-success result.
- **State and migration:** no existing state is rewritten or migrated. A scope
  file is created only by `kratos scope record` from valid reviewer prose; a
  different pre-existing scope is retained and reported as corrupt/drifted.
  Create-only and exact-content preconditions prevent concurrent scope state
  from being overwritten or reported unchanged from a stale observation.
- **Security:** canonical root and symlink inspection, immutable blocks, and
  bounded evidence references reduce unintended structured writes. The relay
  has no policy authority, requires an absolute native root for recognized
  writes, and deliberately excludes Bash and arbitrary MCP tools. It cannot
  eliminate the time-of-check/time-of-use gap after control returns to an
  external host.

## Prepared pull-request body

````markdown
Closes #133

Dependency context: builds on #130's reviewer document templates and the host
integration boundary from #38.

## Summary

Adds a host-neutral pre-write scope guard for structured Claude Code and Codex
file mutations. The guard translates the reviewer's code-formatted allow/deny
scope, canonicalizes every target, applies immutable and project blocks before
feature policy, and relays one runtime result identity synchronously to both
hosts. Bash and arbitrary MCP tools remain outside this deterministic boundary.

## Compatibility, state, and security impact

The scope and pre-tool contracts are additive; projects without `scope.json`
retain legacy feature-scope compatibility, and valid existing guardrails remain
valid. No migration or state rewrite occurs. Older write/scope reasons retain
failure / exit 2; the new path-inspection reasons are blocked / exit 3. Every
non-success result is denied by the hosts. Canonical inspection and immutable
blocks reduce unsafe structured writes, while the external-host
time-of-check/time-of-use limitation remains explicit.

## Verification

```text
npm test -- --run tests/pre-write-scope-contracts.test.ts tests/write-guard.test.ts tests/write-guard-operations.test.ts tests/write-guard-path-safety.test.ts tests/claude-code-pre-tool-relay.test.ts tests/codex-pre-tool-relay.test.ts tests/pre-tool-relay-parity.test.ts tests/pre-tool-relay-hardening.test.ts tests/pre-tool-relay-distribution.test.ts tests/contract-documentation.test.ts tests/acceptance-criterion-contracts.test.ts --reporter=verbose
11 files passed; 186 tests passed; exit 0.
```

```text
npx --yes markdownlint-cli2@0.23.2 --no-globs docs/user/configuration-and-state.md docs/architecture/project-initialization.md docs/user/hosts.md docs/compatibility/result-contract.md docs/compatibility/contract-versioning.md docs/verification/issue-133-pre-write-scope-guard-evidence.md schemas/README.md
npx cspell@10.0.1 --no-progress --show-suggestions docs/user/configuration-and-state.md docs/architecture/project-initialization.md docs/user/hosts.md docs/compatibility/result-contract.md docs/compatibility/contract-versioning.md docs/verification/issue-133-pre-write-scope-guard-evidence.md schemas/README.md
node scripts/check-english.mjs
npx prettier@3.9.6 --check tests/contract-documentation.test.ts docs/user/configuration-and-state.md docs/architecture/project-initialization.md docs/user/hosts.md docs/compatibility/result-contract.md docs/compatibility/contract-versioning.md docs/verification/issue-133-pre-write-scope-guard-evidence.md schemas/README.md
git diff --check
All focused documentation checks passed.
```

```text
npm test
162 files passed; 4,272 tests passed; exit 0.
```

```text
npm run build
npm run package:verify
Built and clean-room verified both host packages; exit 0.
```

```text
npm run verify
All chained release gates passed; exit 0.
Coverage: 93.48% statements, 89.33% branches, 94.42% functions, 93.87% lines.
Mutation: 3/3 (100%).
Package verification: Codex and Claude Code passed.
```
````
