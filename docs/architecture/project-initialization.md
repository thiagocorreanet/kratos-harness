# Project Initialization

`init` is the first command that writes what a user asked for, and it writes
into a directory they already live in. Everything below exists because of that
second sentence.

It establishes the managed `.brain`, `.claude`, and `.codex` surfaces in one
transaction. Run it twice and nothing changes. Run it on a project that already
has content and nothing of theirs is lost. Interrupt it and the project is
either untouched or complete.

## The generated surface

The `go-v3-v0.6.5` inventory freezes the legacy generated file list. The
twenty-eight paths that carry no `<feature>` or `<run>` segment are
initialization's (the twenty-seven legacy oracle paths plus
`.brain/.gitignore`); the rest belong to the commands that own those
lifecycles.

```text
.brain/.gitignore
.brain/00-business/README.md
.brain/01-architecture/README.md
.brain/01-architecture/adr/.gitkeep
.brain/01-architecture/stack-profile.md
.brain/02-features/README.md
.brain/02-features/_template/{00-prd,01-design,02-tasks,03-summa}.md
.brain/02-features/_template/state.json
.brain/02-features/active
.brain/03-memory/.cache/feature-create.json
.brain/03-memory/{decisions.log,gotchas.md,task_log.jsonl,task_metrics.md}
.brain/config.json
.brain/guardrails.json
.claude/settings.json
.codex/agents/{code-implementer,implementation-evaluator,prd-researcher,spec-planner,spec-reviewer}.toml
.codex/config.toml
AGENTS.md
CLAUDE.md
```

That list is the allowlist.

## State ignore rules (`.brain/.gitignore`)

The state directory carries its own `.gitignore` so that append-only logs
(`03-memory/task_log.jsonl`, `02-features/*/runs/*/events.jsonl`,
`events.jsonl`), transient caches (`03-memory/.cache/`), and tool traces
(`*.trace`, `traces/`) stay untracked in Git without polluting the project root
`.gitignore`.

Curated memory, decisions (`decisions.log`), gotchas (`gotchas.md`), distilled
task metrics (`task_metrics.md`), project configuration (`config.json`),
guardrails (`guardrails.json`), and all feature specifications and execution
states remain under version control.

### Adopting state ignore rules in existing repositories

Repositories initialized before this change can adopt the rules by running
`kratos init` and removing any previously committed volatile files from the
Git index without deleting local files:

```bash
git rm -r --cached .brain/03-memory/task_log.jsonl .brain/03-memory/.cache/
git commit -m "chore: adopt state ignore rules"
```

## Shared phase-agent prompts

`PHASE_AGENT_PROMPTS` is the one behavioral source for the researcher,
planner, reviewer, implementer, and evaluator. Codex initialization renders
the canonical body into `developer_instructions` in each project-local TOML
definition. Claude Code package staging renders the same body below native
agent front matter. A conformance test decodes the installed formats and
requires exact body equality; the host wrappers cannot acquire separate
behavior.

The five installed roles cover the six runtime outputs without changing the
workflow order: researcher emits `prd`, planner emits `spec`, reviewer emits
`plan`, implementer emits `code`, and evaluator emits `review` or `acceptance`
according to the runtime-selected phase. Every body names the four canonical
feature documents from `FEATURE_DOCUMENTS`, stops before writing when a
blocking question is unanswered, and appends the published machine block.

Prompts report observations and non-authoritative routing hints. They do not
carry stable reason-code strings, gate decisions, or transition policy. The
runtime remains the only component that decides workflow state and translates
the reviewer's `03-summa.md` declarations into `scope.json`.

Where content would have to be invented, it is not. The Claude settings grant
nothing, because deciding what a host may do is `ADP-02`. The guardrails record
what this runtime enforces today and leave the ported workflow gates to
`SDD-04`. The feature template carries the contract header without the
lifecycle fields `SDD-02` owns.

## Feature document contracts

The four Markdown templates are embedded in the runtime. Keeping them beside
their document definitions preserves `skeletonEffects` as a pure function by
inspection: initialization never reads package assets, and a packaged runtime
cannot drift from its source templates. `FEATURE_DOCUMENTS` is the single
source for each filename, title, required section name, guidance, and rendered
bytes.

| Document | Required sections |
| --- | --- |
| `00-prd.md` | Problem; Affected users; Goals; Non-goals; Scope boundary; Success metrics; Open questions; Problem discovery (5 Whys); Action framing (5W2H) |
| `01-design.md` | Architecture summary; Data model; Interface surface; Integration points; Trade-offs; Risks |
| `02-tasks.md` | Ordered work; Files; Acceptance criteria; Edge cases; Out of scope |
| `03-summa.md` | One-sentence statement; Hard requirements; File allowlist; File denylist; Definition of done |

Guidance travels with each feature copy inside Markdown comments. It remains
available to an author without becoming rendered specification content. The
task template notes that criterion identifiers belong to `SDD-13`; the PRD
template only scaffolds the two discovery sections whose method belongs to
`SDD-11`.

The summary is the reviewer contract. After specification approval, changing
its specification content is a failure. Flipping an acceptance checkbox in
`02-tasks.md` is the sole exemption and does not count as a specification edit.

### Reviewer scope translation

The summary's `## File allowlist` and `## File denylist` sections also provide
the exact source for the active feature's executable write scope. `kratos scope
record` accepts only code-formatted glob bullets (`- \`path/**\``) under those
two depth-two headings. It ignores comments and fenced examples, preserves
declaration order, and uses one parser and one renderer so the stored
`scope.json` and reviewer prose have one grammar. A missing heading, malformed
bullet, invalid glob, or unterminated comment/fence is malformed reviewer prose.

The command writes `.brain/02-features/<active-feature>/scope.json` only if it
does not already exist. If an existing scope file that already differs from the
ordered declarations is found, the command refuses rather than overwriting the
reviewer/state disagreement. The pre-write guard likewise refuses feature
mutations when a present scope cannot be parsed or does not agree with the
reviewer contract; a missing scope preserves projects that have not adopted
feature scope yet.

The shipped reviewer-to-code skills invoke `scope record` immediately after
valid reviewer prose and before implementation. They do not parse scope or
decide policy. The runtime carries a missing-file or exact-content observation
into the managed mutation boundary, so concurrent creation or change is a
revision conflict rather than an overwrite or a stale unchanged result.

The PRD's discovery sections implement the
[requirement discovery contract](requirement-discovery.md). Their guidance
classifies every demand, makes 5 Whys adaptive, keeps 5W2H after discovery, and
scaffolds the one schema-validated machine record shared by every host.

## Idempotency is a consequence

`normalizeManagedMutationPlan` collapses a plan the project already satisfies
into a no-op. A second `init` therefore decides there is nothing to do --
provided the generated bytes are identical.

That proviso is the actual work. Generation is a pure function of the answers,
the detected stack, and the contract version. No clock, no generated
identifier, and no locale-dependent sort reaches the output; the effect order
is by code unit, and the host order in the answers does not reach a byte. Three
assertions defend it, including one that runs generation with `Date`,
`Math.random`, and `crypto.randomUUID` sealed to throw.

The test that matters is not "init twice succeeds" but "the second init
reports no change". The first passes even when every file is rewritten with
identical-looking content.

## Managed sections

`CLAUDE.md` and `AGENTS.md` are the two destinations a person may already own.
Initialization writes its content between explicit markers:

```text
<!-- BEGIN KRATOS MANAGED SECTION -->
...generated instructions...
<!-- END KRATOS MANAGED SECTION -->
```

| The file | Behavior |
| --- | --- |
| Does not exist | Written with the managed section as its whole content |
| Contains the markers | The section between them is replaced; everything outside is preserved byte for byte, trailing whitespace and line endings included |
| Exists without markers | Refused with `guard.outside_allow`, unless `--merge` or `--force` authorizes it |
| Markers malformed | Refused with `runtime.state_corrupt` |

Appending to a document whose structure it does not understand is how a tool
silently corrupts something somebody wrote, so `--merge` and `--force` are the
caller's explicit statements and neither is inferred from the absence of the
other. A file that already carries the markers keeps its own content even under
`--force`: there is a safe place for the section, so discarding the rest would
be a loss nobody asked for.

A section that appears twice, an end marker before its beginning, or a lone
marker is refused rather than repaired. Repairing means guessing which marker
was meant, and `--force` authorizes replacing a file rather than interpreting
state no protocol can read; that repair is `OBS-02`.

## Answers

The runtime interviews nobody. It accepts one answers document, validated
through the schema registry, from standard input or from the path given to
`--answers`. Supplying both is a usage failure rather than a precedence rule
nobody can remember.

Absent input and an empty document are different answers. Zero bytes on
standard input is a caller who used a flag instead, or redirected from an empty
source; a document that is present but blank fails validation with a reason.

Keeping the interview in the host adapter is what makes initialization testable
without a terminal and identical under Claude Code, Codex, and a CI job.

Current `host.init-answers@1.3.0` accepts `modelRoles`, keyed by enabled
configuration host. Every supplied host map is closed to `planner`,
`implementer`, and `judge`. Each assignment is either a bare model name or
`{ "model": NAME, "effort": EFFORT }`; a bare name normalizes exactly to the
object form with `effort: "medium"`.

It also accepts a partial `projectProfile` whose `commands`, `paths`, and
`conventions` leaves are independently `resolved`, `not-applicable` with a
reason, or `unresolved`. Reinitialization preserves omitted current leaves;
explicit `unresolved` clears one. Detection never invents a command, path, or
convention from a stack marker.

```json
{
  "contractVersion": "1.3.0",
  "hostContract": "1.3.0",
  "hosts": ["codex"],
  "modelRoles": {
    "codex": {
      "planner": "gpt-5.6-terra",
      "implementer": { "model": "gpt-5.6-sol", "effort": "high" },
      "judge": { "model": "gpt-5.6-terra", "effort": "medium" }
    }
  },
  "projectProfile": {
    "commands": {
      "test": { "status": "resolved", "value": "npm test" },
      "build": {
        "status": "not-applicable",
        "reason": "The project runs directly from source."
      }
    },
    "paths": {
      "source": { "status": "resolved", "value": ["packages"] }
    },
    "conventions": {
      "implementationLanguages": {
        "status": "resolved",
        "value": ["TypeScript"]
      }
    }
  }
}
```

When a host map is omitted, composition asks that enabled host's adapter for
its versioned defaults. The runtime resolves aliases to canonical identities,
validates every effort, and compares the canonical implementer and judge before
planning any effect. Equal identities return `model.independence_violation`;
missing or invalid facts fail without cross-role, model, alias, or effort
fallback. The earlier one-time-warning proposal was removed by owner decision:
initialization never writes warning state for a non-independent configuration.

Success discloses each defaulted answer and persists complete canonical object
assignments in `.brain/config.json`. Later commands therefore use project state,
not whatever defaults a newer adapter happens to ship. Prompt text does not
choose roles or enforce independence; prompts only report phase output to the
runtime-owned policy boundary.

The runtime renders `.brain/01-architecture/stack-profile.md` from the typed
profile, offline root-entry stack evidence, and configured language policy.
The document is a deterministic projection, not an answer source. `kratos doctor`
compares its exact bytes with a fresh rendering and reports each
unresolved typed key. Missing or drifted bytes warn; an unreadable or non-file
destination and invalid authoritative configuration fail. A `not-applicable`
leaf counts as complete. Neither `init` nor `doctor` executes configured
commands.

With no pipe and no `--answers`, `init` waits on standard input the way any
filter does. In a terminal it does not: reading a TTY would hang the process
waiting on a person who was never asked for anything.

## Flags

| Flag | Meaning |
| --- | --- |
| `--answers <path>` | Read the answers document from a file instead of standard input |
| `--root <path>` | Initialize exactly this directory, searching no ancestor |
| `--detect-root` | Search ancestors for the root, and refuse if none is found |
| `--worktree-local` | In a linked Git worktree, do not fall back to the principal checkout |
| `--host <id>` | Generate only this host's surface, out of those the answers enabled |
| `--merge` | Append the managed section to an unmarked instruction file |
| `--force` | Replace an unmarked instruction file outright |

Without `--root` and without `--detect-root`, initialization targets the
current directory. A command that creates state should not walk up the tree and
initialize a directory somebody forgot they had state in, so detection is
something you ask for. Naming a root and asking for a search at once is a usage
failure, since one names a directory and the other looks for one.

`--host` narrows what the answers enabled and never extends it. Answers are the
configuration, and a flag that quietly added a host would make one document
produce two different projects.

## Result

The result names every destination and what happened to it:

| Outcome | Meaning |
| --- | --- |
| `created` | The destination did not exist and now does |
| `updated` | The destination existed and its bytes changed |
| `preserved` | The destination existed and was left exactly as it was |

The classification comes from comparing the generated bytes against what was
observed, before anything is written. The decision claims a state change
whenever it hands over a non-empty plan, and the transaction reports what
actually moved -- a plan the project already satisfies commits as a no-op and
the published result says so.

| Situation | Reason |
| --- | --- |
| The project was initialized, or already matched the answers | `trail.ok` |
| A managed destination exists without markers and no flag authorizes it | `guard.outside_allow` |
| The answers document fails validation | its contract reason |
| An enabled host has no model catalog | `model.resolution_unavailable` |
| A role is missing or its effort is unsupported | the matching `model.*` refusal |
| Implementer and judge resolve to one canonical model | `model.independence_violation` |
| A managed section is malformed | `runtime.state_corrupt` |
| An incomplete transaction blocks the commit | `runtime.recovery_required` |
| A destination moved between the decision and the commit | `runtime.revision_conflict` |

## How the command is wired

`init` is the first command that cannot decide from argv alone. It declares a
prerequisite, and the composition root collects the observation before
dispatch: the resolved root, the validated answers, the entries at the project
root, and every destination as it was found. The handler stays pure and
synchronous, exactly like `help` and `version`.

Observing every destination rather than only the two files a person may own is
what lets one mechanism report each as created, updated, or preserved instead
of two that can disagree about the same file.

A command may also declare that its plan bootstraps the managed state root.
Absent means `existing`, which every other command needs; only the command
whose purpose is creating that state says otherwise.

## What parity this claims

`CLI-INIT`, the seven `FLAG-INIT-*` rows, and `IO-STDIN-INIT-ANSWERS` move to
`in_progress` with unit evidence. None moves to `parity`.

The inventory freezes the flag *names* under hash-only provenance. It does not
establish what `--merge` merged, what `--force` forced, or what the legacy
answers document contained. The semantics above are this runtime's contract,
chosen to satisfy the issue, not recovered from the oracle. A parity claim
needs differential, integration, and end-to-end evidence against a captured
predecessor, which is `CMP-05` work.

Parity therefore remains `0 / 400 (0.00%)`. Claiming a behavioral row on the
strength of a name would make the parity number describe something other than
parity.
