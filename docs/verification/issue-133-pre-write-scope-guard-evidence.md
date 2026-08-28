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
| Reviewer prose and stored scope agree, and deliberate drift fails closed | `tests/write-guard.test.ts` exercises the exact code-formatted summary grammar, one parser/renderer round trip, malformed bullets, fences, nested headings, and drift. `tests/write-guard-operations.test.ts` proves `scope record` creates exact state, rejects malformed prose without state, and preserves an existing differing `scope.json`. |
| Outside-root paths, symlink escapes, and uninspectable targets are refused before mutation | `tests/write-guard-operations.test.ts` covers lexical escapes, existing symlink escape, dangling links, canonical in-root aliases, inspection errors, lexical/canonical policy identities, and unchanged trees. |
| Empty allowlists do not restrict; deny and outside-allow paths refuse with stable reasons | `tests/write-guard.test.ts` covers an empty allowlist, deny-over-allow, `.brain` allow bypass, project blocks, immutable defaults, and `guard.outside_allow`. `tests/write-guard-operations.test.ts` checks normalized first-refusal order and the source-before-destination move order. |
| A project with no scope file behaves as before | `tests/write-guard-operations.test.ts:358-377`, `has no feature allow or deny restriction when scope.json is absent`, permits `src/new.ts` while retaining immutable `.env` and project `private/**` blocks. The focused command below runs this case. |
| Specification and state descendants remain writable under a non-empty allowlist | `tests/write-guard.test.ts` covers the `.brain` membership bypass; `tests/pre-tool-relay-parity.test.ts` runs the `specification path bypasses allow membership` and `state path bypasses allow membership` normalized cases through both hosts. |
| Invalid policy fails closed, with only bounded `.brain/` descendant repair | `tests/write-guard-operations.test.ts` covers corrupt guardrails, corrupt scope, malformed/drifted reviewer state, blocks before corrupt state, all-`.brain/` repair, exact `.brain` root exclusion, canonical alias rejection, and an explicit valid-state `.brain/**` deny. |
| Scope, guardrails, and host pre-tool contracts remain closed and compatible | `tests/pre-write-scope-contracts.test.ts` validates project-relative scope globs, the normalized mutation schema, additive `writeBlocks`, and generated type/registry registration. |
| Claude Code and Codex produce identical normalized runtime result identity | `tests/pre-tool-relay-parity.test.ts` executes every shared `PRE_TOOL_RELAY_CASES` input and requires equal complete `operationResult` values. `tests/claude-code-pre-tool-relay.test.ts`, `tests/codex-pre-tool-relay.test.ts`, and `tests/pre-tool-relay-hardening.test.ts` cover each adapter's extraction and malformed-input fail-closed boundary. |
| Packaged synchronous host hooks deny refused operations | `tests/pre-tool-relay-distribution.test.ts` verifies the native matchers, executable hook assets, the synchronous runtime deadline, and denial rendering from each packaged distribution. |
| Published documentation stays attached to executable contracts | `tests/contract-documentation.test.ts` requires the configuration, reviewer scope, host relay, and result-compatibility guides to publish the grammar, policy ordering, immutable defaults, repair boundary, supported tools, host-neutral result identity, time-of-check/time-of-use limit, and reason/exit compatibility. |

## Completed acceptance checklist

- [x] Structured mutations are canonicalized and refused before host mutation on
  an escape, symlink escape, or uninspectable target.
- [x] `scope record` translates only the reviewer summary grammar and refuses
  malformed or drifted state without replacing it.
- [x] Ordered glob matching, feature deny, `.brain` allow bypass, empty allow,
  immutable defaults, and additive project blocks have deterministic tests.
- [x] Invalid policy admits only all-`.brain/` descendant repair; exact `.brain`
  remains excluded.
- [x] Shared normalized cases conform across Claude Code and Codex, while
  unrelated Bash calls pass outside the structured-tool contract.
- [x] Contracts, fixtures, package hooks, public documentation, and stable
  reason/exit behavior have focused executable evidence.

## Verification commands

Focused implementation and contract verification:

```text
npm test -- --run tests/pre-write-scope-contracts.test.ts tests/write-guard.test.ts tests/write-guard-operations.test.ts tests/claude-code-pre-tool-relay.test.ts tests/codex-pre-tool-relay.test.ts tests/pre-tool-relay-parity.test.ts tests/pre-tool-relay-hardening.test.ts tests/pre-tool-relay-distribution.test.ts tests/contract-documentation.test.ts --reporter=verbose

Test Files  9 passed (9)
Tests       156 passed (156)
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

Consolidated full-suite evidence from the controller release gate:

```text
npm test

Test Files  162 passed (162)
Tests       4252 passed (4252)
Exit code   0
```

Controller release gate:

- [x] `npm run verify` — exit 0 after all task commits were integrated. It
  passed formatting, spelling, English, lint, typecheck, 4,252 tests, coverage
  (93.47% statements and 89.31% branches), mutation (3/3), gap calibration,
  performance, oracle, parity, result, contract, differential, build, package
  verification for both hosts, and benchmark gates.

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
- **Security:** canonical root and symlink inspection, immutable blocks, and
  bounded evidence references reduce unintended structured writes. The relay
  has no policy authority and deliberately excludes Bash and arbitrary MCP
  tools. It cannot eliminate the time-of-check/time-of-use gap after control
  returns to an external host.

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
npm test -- --run tests/pre-write-scope-contracts.test.ts tests/write-guard.test.ts tests/write-guard-operations.test.ts tests/claude-code-pre-tool-relay.test.ts tests/codex-pre-tool-relay.test.ts tests/pre-tool-relay-parity.test.ts tests/pre-tool-relay-hardening.test.ts tests/pre-tool-relay-distribution.test.ts tests/contract-documentation.test.ts --reporter=verbose
9 files passed; 156 tests passed; exit 0.
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
162 files passed; 4,252 tests passed; exit 0.
```

```text
npm run verify
All chained release gates passed; exit 0.
Coverage: 93.47% statements, 89.31% branches, 94.40% functions, 93.85% lines.
Mutation: 3/3 (100%).
Package verification: Codex and Claude Code passed.
```
````
