# Configuration and `.brain` state

## Configuration layers

Kratos resolves explicit command flags first, then project configuration, then
documented defaults. It rejects contradictory ownership or unsupported
contract versions instead of guessing.

The project configuration records plugin and host contracts, language, policy
mode, enabled hosts, and managed state paths. Secrets, tokens, prompts, and
private keys are prohibited.

## Managed layout

| Path | Ownership | Purpose |
| --- | --- | --- |
| `.brain/config.json` | Kratos-managed | Versioned project configuration |
| `.brain/events.jsonl` | Append-only | Canonical event history |
| `.brain/02-features/` | Managed state | Objectives, runs, and materialized snapshots |
| `.brain/approvals/` | Managed state | Content-bound decisions |
| `.brain/evidence/` | Managed metadata | Digests, classification, and references |
| `.brain/02-features/<feature>/runs/<run>/gaps/` | Managed state | One record per detected gap and the answer it carries |
| `.brain/02-features/<feature>/runs/<run>/gates.json` | Derived state | The facts the gates read, derived from the records |
| `.brain/migrations/` | Managed recovery | Plans, receipts, backups, and rollback records |
| `.claude/` | Mixed/managed sections | Claude Code integration |
| `.codex/` and `AGENTS.md` | Mixed/managed sections | Codex integration |

Commit configuration, events, and non-sensitive evidence metadata when project
policy requires an auditable trail. Ignore local dashboards, transient locks,
and sensitive external evidence. Never add a broad ignore rule that hides the
entire `.brain` directory without an explicit governance decision.

Managed markers protect user-authored content. Reconciliation preserves bytes
outside marked sections and reports a conflict before changing an ambiguous
file.

## Feature scope and the pre-write guard

An active feature may persist `state.feature-scope@1.0.0` at
`.brain/02-features/<active-feature>/scope.json`. The closed JSON record has
`contractVersion` and `stateContract` set to `1.0.0`, plus ordered `allow` and
`deny` arrays of project-relative path globs. It is policy state, not a prompt:
the runtime makes the decision and a host only relays the result.

`kratos scope record` translates the active feature's `03-summa.md` reviewer
contract. The executable grammar is exactly the depth-two headings
`## File allowlist` and `## File denylist`, each appearing once. Within either
section, a declaration is one code-formatted bullet, for example
`- \`packages/runtime/src/**\``. Blank lines are accepted; fenced code and HTML
comments are ignored; an unformatted bullet, a malformed glob, a missing or
duplicated heading, or unfinished comment/fence makes the translation fail
closed. Nested headings do not end the active section. One parser and one
renderer own this grammar. The command creates the scope only when absent;
when a scope file already differs from the ordered reviewer declarations, or
the reviewer prose is malformed, it refuses without replacing that file.

### Glob dialect

Patterns are ordered, project-relative, slash-separated, and case-sensitive.
They support `*`, `?`, `**`, character classes, and a leading `!` that negates
a prior match in the same list. Matching starts as false and every matching
pattern replaces that result. Patterns cannot be absolute, drive-qualified,
backslash-bearing, traversing, empty, or control-character-bearing. A scope
contains at most 256 patterns per list; each pattern is at most 1,024
characters.

Before policy evaluation, the guard resolves every structured mutation target
against the canonical project root. It follows existing symlinks and resolves
the nearest existing ancestor for a new path. Both the lexical path and a
different in-project canonical identity must pass policy. A target outside the
root, a symlink escape, a dangling or otherwise uninspectable target is
refused before a mutation. The guard evaluates targets in normalized request
order (a move's source then destination) and refuses the whole request at its
first refusal.

### Policy order and repair boundary

For a canonical target, the guard applies this order:

1. Reject a path escape or an uninspectable target.
2. Apply immutable blocks and the project's `writeBlocks` extension from
   `.brain/guardrails.json`.
3. Load valid policy state and require `scope.json` and `03-summa.md` to agree
   when a scope file exists.
4. Apply feature `deny` rules.
5. Let `.brain/**` bypass feature allowlist membership, but not a valid explicit
   feature deny.
6. If `allow` is non-empty, require an allow match; an empty allowlist adds no
   allow restriction.

Immutable defaults block `.env` and `.env.*` files, except a basename whose
dot-separated suffix includes `example`, `sample`, or `template` (for example,
`.env.example`, `.env.local.sample`, and `.env.test.template`). They also block
every directory named `migrations` and its descendants, and any basename
`AGENTS.md` or `CLAUDE.md`. `writeBlocks` can add ordered project blocks but
cannot subtract immutable defaults. `.codex/**` and `.claude/**` are not
immutable blocks; feature scope or project `writeBlocks` may still restrict
them.

No scope file means feature allow/deny policy is absent for compatibility, but
immutable and project blocks still apply. Invalid or missing guardrails, an
invalid active feature marker, a corrupt scope, malformed reviewer prose, or
reviewer/scope drift otherwise fails closed. The limited repair exception is an
all-`.brain/**` request after immutable and project blocks have been evaluated;
it permits repair of invalid policy state. The exact `.brain` root is not
repairable: only descendants beginning `.brain/` qualify. Once policy is
valid, an explicit `.brain/**` deny remains effective.
