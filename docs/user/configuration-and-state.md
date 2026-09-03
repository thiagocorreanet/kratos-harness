# Configuration and `.brain` state

## Configuration layers

Kratos resolves explicit command flags first, then project configuration, then
documented defaults. It rejects contradictory ownership or unsupported
contract versions instead of guessing.

The current `state.project-config@1.5.0` records plugin and host contracts,
granular language policy, inherited policy mode, per-gate overrides,
host-specific model roles, managed state paths, and the typed project profile.
Secrets, tokens, prompts, and private keys are prohibited. Historical
configuration `1.0.0`, `1.1.0`, `1.2.0`, or `1.3.0` is readable only for
explicit migration and returns
`profile.config_migration_required` before an ordinary operation can treat it
as current state. Configuration `1.4.0` is cleanly upgraded to `1.5.0`
via `migrate config` or `init`.

## Gate policy modes

`policyMode` remains required and supplies the mode inherited by every gate
without an override:

| `policyMode` | Inherited gate mode |
| --- | --- |
| `standard` | `warn` |
| `strict` | `enforce` |

`gateModes` is also required. It is a closed partial map: keys may only be
published gate IDs and values may only be `shadow`, `warn`, or `enforce`. An
empty object preserves the inherited behavior for every gate.

```json
{
  "policyMode": "strict",
  "gateModes": {
    "gaps-closed": "shadow"
  }
}
```

In this example, `gaps-closed` records an open-gap finding but allows the
operation to continue; every other gate inherits `enforce` and can block.
`warn` findings also remain recorded while allowing continuation. If several
gates fail, the runtime selects outcome severity in the order block, warn,
pass, then preserves the established priority and gate-ID ordering within an
outcome. `primary` is the first ordered failure from the outcome that decided
the result.

Roll out one gate deliberately as `shadow -> measure -> warn -> enforce`.
`shadow` keeps the failure, its reason, and its effective mode visible without
changing the decision; measure those findings before moving to `warn`, then
use `enforce` only when blocking is intended. Reinitialization preserves an
omitted `gateModes` map from the current project configuration. Supplying a map
replaces that partial map, including with `{}` when the inherited defaults
should be restored.

The runtime resolves the complete mode table before pure gate evaluation.
Unreadable policy fails closed with an all-`enforce` table and unreadable
context. Prompts, agent responses, command hosts, Claude Code, and Codex do not
decide or override modes; they only convey configuration input or render the
runtime-owned result.

## Project profile

`projectProfile` contains exact project-root commands (`test`, `lint`, `build`,
and `run`), project-relative source/test/configuration paths, directory and
naming conventions, and implementation-language labels. Every leaf is a
closed `resolved`, `derived` (carrying provenance `evidence`), `not-applicable`,
or `unresolved` record. The programming languages in this profile do not
replace the separate human-language policy.

`.brain/01-architecture/stack-profile.md` is generated deterministically from
that typed state plus offline scan evidence: a language census counted from
source file extensions and toolchain markers matched by manifest name, reported
as two separate facts. Derived commands and paths visibly annotate their
provenance (e.g. `(derived from package.json#scripts.test)`). The scan reads
names, never file contents, is bounded in depth and entry count, and never enters
a dependency, build output, or `.brain` directory. A project that matches
neither layer is reported with the extensions and root entries the scan observed
rather than with silence. Manual Markdown edits are never authoritative. Doctor
compares renderer bytes and passes when all leaves are resolved, derived, or
not-applicable; unresolved leaves warn with actionable key names. Neither
initialization nor doctor executes configured commands. Gates requiring operator
consent fail closed on unconfirmed derived values.

## Model roles and fixed phase mapping

`modelRoles` is keyed by `claude` and `codex`. Each enabled host has exactly
`planner`, `implementer`, and `judge`; the non-empty host key set is the enabled
host set. There is no separate enabled-host field and no configurable phase
mapping that could disagree with runtime policy.

| Phase | Required role |
| --- | --- |
| `prd`, `spec`, `plan` | `planner` |
| `code` | `implementer` |
| `review`, `acceptance` | `judge` |

A role assignment may be a bare host model name or a closed object containing
`model` and `effort`. A bare value always normalizes to the object form with
`effort: "medium"`:

```json
{
  "modelRoles": {
    "codex": {
      "planner": "gpt-5.6-terra",
      "implementer": { "model": "gpt-5.6-sol", "effort": "high" },
      "judge": { "model": "gpt-5.6-terra", "effort": "medium" }
    }
  }
}
```

The runtime resolves configured names through the active host's versioned
catalog and persists canonical model identities. Every phase resolution checks
the complete host map and compares the canonical implementer and judge with
exact equality. If they are equal, `model.independence_violation` blocks the
operation. This strict refusal is the owner-approved replacement for the
contradictory one-time-warning proposal; no warning receipt exists.

There is no fallback across roles, aliases, models, or effort levels. A missing
host, missing role, unknown or ambiguous alias, absent canonical identity, or
unsupported effort produces its stable `model.*` refusal and no state change.
Prompts and agent output cannot select a role or override this configuration.

Initialization can obtain concrete host defaults from the enabled adapters,
but it discloses every default and persists the resolved assignment. The
current defaults are `sonnet@medium` / `opus@medium` / `sonnet@medium` for
Claude planner/implementer/judge and `gpt-5.6-terra@medium` /
`gpt-5.6-sol@high` / `gpt-5.6-terra@medium` for Codex. These are adapter facts,
not shared runtime constants and not dynamic inheritance.

## Managed layout

| Path | Ownership | Purpose |
| --- | --- | --- |
| `.brain/config.json` | Kratos-managed | Versioned project configuration |
| `.brain/events.jsonl` | Append-only | Canonical event history |
| `.brain/02-features/` | Managed state | Objectives, runs, and materialized snapshots |
| `.brain/approvals/` | Managed state | Content-bound decisions |
| `.brain/evidence/` | Managed metadata | Digests, classification, and references |
| `.brain/03-memory/task_log.jsonl` | Ignored local state | Raw keyed phase token/duration measurements |
| `.brain/03-memory/task_metrics.md` | Tracked managed report | Deliberately refreshed phase distributions and bounded provenance |
| `.brain/02-features/<feature>/runs/<run>/gaps/` | Managed state | One record per detected gap and the answer it carries |
| `.brain/02-features/<feature>/runs/<run>/gates.json` | Derived state | The facts the gates read, derived from the records |
| `.brain/03-memory/candidates/*.json` | Machine-local diagnostic inbox | Sanitized failure candidates; ignored by Git |
| `.brain/03-memory/curated-memory.json` | Committed managed ledger | Versioned authority for confirmed and archived lessons |
| `.brain/03-memory/gotchas.md` | Committed deterministic projection | Exact Markdown rendering of the ledger |
| `.brain/migrations/` | Managed recovery | Plans, receipts, backups, and rollback records |
| `.claude/` | Mixed/managed sections | Claude Code integration |
| `.codex/` and `AGENTS.md` | Mixed/managed sections | Codex integration |

Commit configuration, events, and non-sensitive evidence metadata when project
policy requires an auditable trail. Ignore local dashboards, transient locks,
and sensitive external evidence. Never add a broad ignore rule that hides the
entire `.brain` directory without an explicit governance decision.

Initialization places `03-memory/task_log.jsonl` in `.brain/.gitignore`. The
file is a canonical keyed set despite its JSONL form: one line is identified by
`(runId, phase)`, and managed transactions atomically replace validated bytes.
Each record includes the sorted, unique session identifiers that contributed
tokens to that phase, bounded to 256 identifiers. A pre-ownership `1.0.0`
record without that field remains readable and gains its launcher as the sole
contributor on the next raw-log rewrite. Records may also carry at most 256
contributor checkpoints: a session identifier, cumulative gross-token count,
and observation time used for chronological allocation. A compatible `1.0.0`
record without checkpoints remains readable and gains an empty checkpoint list
on its next raw-log rewrite without changing its distribution. The file is raw
machine-local operational state and is not a history stream. The tracked
`task_metrics.md` is the reviewable projection; only `metrics refresh` may
replace it. Refresh records a raw-log digest, generation time, bounded
feature/run sources, counts, and distributions, but no prompts or transcripts.

The additive `state.phase-measurement@1.0.0` records are created lazily. Existing
projects need no state rewrite or migration, and the initialized empty raw log
is valid. Published predecessor state remains readable unchanged.

Both measurement destinations are create-once initialization state. A later
`kratos init` preserves their bytes exactly, including non-canonical line endings
or trailing spaces, instead of restoring the empty-log or initial-report seed.
First creation carries a missing-file precondition. Concurrent creation of
either path therefore returns `runtime.revision_conflict`, preserves the
concurrent bytes, and prevents partial initialization writes.

Curated memory has a deliberately split Git boundary: candidate JSON is
machine-local and ignored, while `curated-memory.json` and `gotchas.md` are
committed project knowledge. The ledger is authoritative; `gotchas.md` is a
deterministic projection whose SHA-256 must match the ledger. A missing or
changed projection is `memory.projection_drift`, not permission to overwrite
either artifact. Fresh initialization creates the empty ledger and its exact
two-section projection.

Candidate diagnostics are sanitized and limited to 2 KiB before persistence.
Repeated matching diagnostics increment the v1.1 candidate count and widen its
first/last observation interval using an execution-time file precondition.
Confirmed v1.1 lessons record technology, failure kind, a project-local
dependency, count, and observation interval. Curation reads dependency metadata
only; it does not read dependency contents, run project commands, call a model,
or access the network.
Capture performs no model call, network/socket operation, or project command.
It uses no automatic promotion path. Windows and POSIX diagnostics share the
same conservative volatile matcher without folding drive, path, or case.
Managed publication carries candidate fingerprints as execution-time read
guards alongside ledger and projection preconditions. Candidate cleanup starts
only after authority commits and uses a separate fingerprinted managed delete,
so a replacement candidate is retained rather than unconditionally unlinked.
An interruption leaves the old pair or a recoverable transaction; it never
makes candidate deletion authority out of an uncommitted change.

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
Creation is create-only, and an agreeing existing file is accepted only if its
exact bytes still match the observed content at the managed transaction
boundary. A file that appears or changes during the operation produces a
revision conflict and is never overwritten.

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
