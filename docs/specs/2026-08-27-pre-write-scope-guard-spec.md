# Objective Spec: Pre-Write Feature Scope Guard

Date: 2026-08-27
Status: APPROVED
Approval source: GitHub issue #133 and the user's approved brainstorming design

## 1. Problem and outcome

Kratos can audit out-of-scope changes after they reach disk, but it cannot stop
them. The reviewer already declares an allowlist and denylist in `03-summa.md`,
yet that prose has no executable contract. The desired outcome is a host-neutral
runtime decision that refuses an out-of-scope structured file mutation before
Claude Code or Codex invokes the filesystem tool.

## 2. Published contracts

- `state.feature-scope@1.0.0` persists ordered `allow` and `deny` path-glob
  arrays at `.brain/02-features/<active-feature>/scope.json`.
- The existing `.brain/guardrails.json` receives a versioned schema. Its
  existing fields remain valid and an optional project write-block extension
  augments immutable runtime defaults.
- `host.pre-tool-use@1.0.0` describes a normalized structured mutation request
  independently of either host's hook payload.
- `host.operation-result@1.0.0` remains the published response envelope. A
  refusal is blocked, exit code 3, carries one stable reason code, and claims no
  state change.

The scope file is derived by `kratos scope record` from the reviewer's
code-formatted glob bullets in `03-summa.md`. The command fails closed if the
prose is malformed or differs from an existing scope file. There is one parser
and one renderer so prose and state cannot drift.

## 3. Glob and path semantics

Patterns are ordered, project-relative, slash-separated, and case-sensitive.
They support `*`, `?`, `**`, character classes, and a leading `!` that negates a
prior match within the same list. Matching starts from no match, then each
matching pattern replaces the current result.

Targets are canonicalized against the canonical project root before policy is
evaluated. Existing symlinks and the nearest existing ancestor of a new path
are resolved. A target outside the project, a symlink escape, or a target that
cannot be inspected is refused before mutation.

Every target of a structured mutation is checked, including both sides of a
move. Multi-target requests are atomic: the first refusal in normalized target
order refuses the whole request.

## 4. Decision order

1. Reject malformed, uninspectable, or project-escaping targets.
2. Apply project guardrails and immutable global blocks.
3. Require the scope file and reviewer prose to agree when both exist.
4. Apply feature deny rules.
5. Exempt `.brain/**` from allowlist membership so specifications,
   configuration, and Kratos state remain repairable.
6. When the allowlist is non-empty, require a match; an empty list imposes no
   allow restriction.

Deny always wins over allow. Immutable defaults block real environment files
(`.env` and `.env.*`, except example, sample, and template variants), every
`migrations` directory and descendant, and host instruction files named
`AGENTS.md` or `CLAUDE.md`. Projects may extend but not subtract from these
defaults. `.codex/**` and `.claude/**` are not globally blocked.

If policy state itself is invalid, an all-`.brain/**` mutation may repair it;
otherwise policy errors fail closed. Once policy is valid, an explicit feature
deny still applies to `.brain/**`.

## 5. Host boundary

Claude Code and Codex distributions install thin synchronous `PreToolUse`
hooks. They normalize only structured file mutation tools (`Write`, `Edit`,
legacy `MultiEdit`, and Codex `apply_patch`) and invoke the same runtime guard.
The runtime extracts all paths, reads policy, decides, and returns the published
operation result. The hook merely converts an allowed result into host
continuation or a blocked result into the host's deny response. Shell commands
and arbitrary MCP tools remain outside this contract because their targets
cannot be deterministically inspected at this boundary.

## 6. Compatibility and failure policy

- A project with no feature scope file has no feature allow/deny restriction,
  while project/global write blocks still apply.
- Existing valid guardrails files remain valid without the optional extension.
- Claude Code and Codex share schemas, extraction semantics, canonicalization,
  policy, and reason codes; only payload rendering differs.
- Existing after-the-fact audit behavior is unchanged.
- Lock scope is unrelated and unchanged.

Stable refusal reasons include `guard.write_block`, `guard.scope_deny`,
`guard.outside_allow`, `guard.scope_corrupt`, `guard.guardrails_corrupt`,
`guard.path_escape`, and `guard.target_uninspectable`. Evidence is bounded,
project-relative when possible, and never echoes arbitrary tool content.

## 7. Acceptance and verification

- Table tests cover nested globs, ordered negations, outside-root paths,
  symlinks, empty allowlists, and deny-over-allow precedence.
- Reviewer fixtures prove prose/scope agreement and deliberate drift failure.
- A specification or state path remains writable under an active allowlist.
- A denied path and a source path outside a non-empty allowlist are refused
  with stable reasons before any mutation.
- The same normalized cases pass both Claude Code and Codex adapter conformance
  suites.
- Contract generation/checks, focused tests, and `npm run verify` pass.

