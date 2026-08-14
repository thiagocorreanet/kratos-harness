# Initialization Command Design

Task 5 of the plan for issue
[#25](https://github.com/thiagocorreanet/mestre-yoda/issues/25) (`SDD-01`).
Extends the design in
[`2026-08-13-project-initialization-design.md`](./2026-08-13-project-initialization-design.md)
with the three decisions its plan assumed rather than made. Depends on
[#101](https://github.com/thiagocorreanet/mestre-yoda/issues/101) (`RUN-05a`)
for the destinations outside `.brain/`.

## Problem

The plan's Task 5 says the command consumes discovery, the answers contract,
the profiler, the skeleton, the managed-section planner, `previewPlan`, and
`applyPlan`. Three things stand between that list and a command:

- The frozen input contract is `stdin.init-answers`, and no port reads standard
  input.
- `dispatch` calls a pure, synchronous handler. `init` has to observe the
  project -- discovery, the two instruction files, the entries at the root --
  before it can decide anything.
- Nothing yet turns a committed plan into the report the issue requires: every
  destination named as created, updated, or preserved.

None of these is a change of contract. `command-routing.md` already
distinguishes commands that declare a project or host prerequisite from the
read-only registry that declares none, and says the current registry declares
none. This is the case that documentation anticipated.

## Standard input as a port

A new `StandardInput` port with one method: `read(): Promise<string | null>`.
`null` means nothing was piped, which is different from an empty document --
an empty document is a validation failure with a reason, and no document at all
is the ordinary case of a caller using `--answers`.

Supplying both `--answers` and piped input is a usage failure rather than a
precedence rule. Deciding silently which one wins is how somebody initializes a
project from the answers they did not mean.

The Node adapter reads standard input only when it is not a TTY. The fake takes
the text as data, which is what keeps every initialization test free of a
terminal.

## Observation before decision

`CommandSpec` gains a declared prerequisite, and `Invocation` gains the
observation the composition root collected to satisfy it:

```ts
export type CommandObservation =
  | { readonly kind: "none" }
  | {
      readonly kind: "initialization";
      readonly resolution: ProjectResolution;
      readonly answers: unknown;
      readonly rootEntries: readonly string[];
      readonly instructions: ReadonlyMap<string, ManagedFileObservation>;
    };
```

A closed union rather than `unknown`, so a handler reads its observation
without a cast. The handler stays pure and synchronous: it receives facts and
returns a result and an effect plan, exactly as `help` and `version` do. The
composition root remains the only code that reads a filesystem or applies an
effect.

The mismatch branch -- a handler handed an observation of the wrong kind --
is reachable by constructing an invocation directly, so it is tested rather
than ignored for coverage. A registry that grows a second observing command
without a test for that branch is the thing this shape is meant to make
visible.

## The seven frozen flags

The inventory freezes the names under hash-only provenance and establishes
nothing about behavior. These semantics are this runtime's contract, chosen to
satisfy the issue, and the parity claim stays limited accordingly.

| Flag | Meaning |
| --- | --- |
| `--answers <path>` | Read the answers document from a file instead of standard input |
| `--root <path>` | Initialize exactly this directory; no ancestor search |
| `--detect-root` | Resolve the root by discovery, and refuse if discovery finds none |
| `--worktree-local` | In a linked Git worktree, do not fall back to the principal checkout |
| `--host <id>` | Narrow the generated surface to one host; repeatable |
| `--merge` | Authorize appending the managed section to an unmarked instruction file |
| `--force` | Authorize replacing an unmarked instruction file outright |

Without `--root` and without `--detect-root`, initialization targets the
current directory. A command that creates state should not walk up the tree and
initialize somebody's home directory because a `.brain/` happened to be there;
detection is opt-in for exactly that reason. `--root` with `--detect-root` is a
usage failure, since one names a directory and the other asks for a search.

`--host` narrows what the answers enabled; it cannot enable a host the answers
left out. Answers are the configuration, and a flag that quietly extended them
would make the same document produce different projects.

## Result mapping

The result names every destination and what happened to it:

| Outcome | Meaning |
| --- | --- |
| `created` | The destination did not exist and now does |
| `updated` | The destination existed and its bytes changed |
| `preserved` | The destination existed and was left exactly as it was |

`preserved` covers both an already-correct generated file and the content
outside a managed section. A person needs to know which of their files the tool
touched more than they need a count, and "preserved" is the word that answers
the question they are actually asking.

The classification comes from the same normalized plan that commits: a
destination absent from the plan's operations was preserved, and one present
was created or updated according to its recorded precondition. Deriving it from
the plan rather than from a second observation is what keeps the report from
disagreeing with what was written.

## Testing strategy

**Idempotency.** The second `init` previews as `noop`. The first passing proves
nothing.

**Reporting.** Every frozen destination appears in the result exactly once,
with the outcome the plan implies.

**Flags.** All seven, plus the usage failures: both input sources, both root
modes, and a `--host` the answers did not enable.

**Observation.** A handler handed the wrong observation kind fails as an
internal failure rather than proceeding on absent facts.

**Interruption.** Faults injected across the init transaction leave the project
untouched or complete, reusing the campaign shape `RUN-05`, `RUN-07`, and
`RUN-05a` already use.
