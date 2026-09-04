# Derived Answers Recorded Without Confirmation Design

Date: 2026-09-04
Status: APPROVED
Issue: #214; supersedes `AC-8` of `ADP-08` (#190)
Dependencies: `ADP-08` (#190), `ADP-09` (#206), `ADP-10` (#209), `ADP-13` (#208)
Approval source: the project lead's direct instruction during a `kratos init` run

## Problem and outcome

The initialization interview asked the operator to confirm every answer the
runtime had already derived. On a repository where derivation resolved eight of
the ten profile leaves, the host still put ten questions to the operator, eight
of them restating a value and its evidence and waiting for a nod. The derivation
work under `ADP-08` through `ADP-13` exists so that the operator answers less,
not so that the operator ratifies more.

This design removes the confirmation step. The host records a `derived` leaf as
the runtime derived it, with its value and its evidence string, and asks the
operator only about the leaves the runtime reported as `unresolved`. The four
leaf states and their meaning are unchanged: `resolved` still means a human
stated the value, `derived` still means the runtime read it from evidence, and
the two remain distinct in configuration, in the rendered stack profile, and in
diagnostics.

## What changes

1. **Host skills** (`distribution/*/skills/kratos/SKILL.md`): the interview
   section instructs the host to record derived answers without asking and to
   ask, in order, only the `projectProfileQuestions` entries the payload reports
   as `unresolved`. The two guards stay: the host never presents a candidate the
   payload does not carry and never adds a description the payload does not
   carry.

2. **Permission provenance** (`domain/init/permissions.ts`): a derived command
   earns its `Bash(<command>)` allowance from the evidence the runtime recorded.
   The new `derived_profile` origin carries that evidence string, and
   `assertPermissionProvenance` accepts such an entry only when a `derived` slot
   carries both the same command and the same evidence. The `explicit_profile`
   origin is unchanged and still requires a `resolved` slot.

3. **Runtime prose** (`domain/init/derive.ts`, `domain/init/stack.ts`): the
   comments that described every derived value as "offered for confirmation"
   now describe it as recorded with its evidence.

4. **Package manager** (`domain/init/derive.ts`): a command derived from
   `package.json#scripts` names the package manager the repository attests to
   instead of `npm` unconditionally. The `packageManager` field outranks any
   lockfile; one lockfile at the root (`package-lock.json`,
   `npm-shrinkwrap.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`,
   `bun.lockb`) decides; no lockfile leaves npm as the default nothing
   contradicts; lockfiles of two different managers derive nothing from the
   manifest, so the command slots reach the interview as `unresolved`. The
   evidence names what decided (`package.json#scripts.test via pnpm-lock.yaml`).
   Bun goes through `bun run <script>` for every slot, because `bun test` is
   Bun's own runner and not the declared script.

5. **Source below tests** (`domain/init/derive.ts`): a directory that carries a
   source candidate name but sits below a test directory (`tests/unit/lib`) is
   no longer offered as a source root. It mirrors the source tree rather than
   being one, and naming it as a second root also stopped the directory layout
   from being derived for the real one.

Nothing else moves. The relay, the `host.init-answers@1.6.0` contract, the
`state.project-config@1.5.0` contract, the stack profile rendering, and
`kratos doctor` are untouched.

## Superseded acceptance criterion

`AC-8` of `ADP-08` read: "Gates requiring operator consent fail closed on
unconfirmed `derived` values with diagnostic reason." Its only implementation
was the permission gate, which ignored `derived` command slots and so withheld
the allowance from every command the runtime derived. With confirmation gone,
that gate would never fire again for a derived command and would silently
withhold allowances from every project whose commands are not on the canonical
stack table (`pnpm test`, `make test`, `pytest` declared in `pyproject.toml`).

The criterion is replaced by:

- `AC-8'`: a permission derived from a `derived` command slot carries the
  `derived_profile` origin and the exact evidence string the profile recorded,
  and provenance validation rejects an entry whose command or evidence the
  profile does not carry.

The rationale is that manifest evidence is verifiable provenance. A command read
from `package.json#scripts.test` is traceable to a file the operator committed;
a command the operator types into an interview is not more trustworthy than
that, only more expensive to obtain.

That rationale holds only while the derived command is the one the project
runs. Before this change the manifest derivation emitted `npm test` for every
`package.json`, and the confirmation step was where a pnpm or yarn project had
that corrected. Removing the step without fixing the derivation would have
granted an allowance to a command nobody runs, which is why items 4 and 5 are
part of this change rather than follow-ups.

## Consequences

- A repository that carries lockfiles of two managers, which usually means one
  of them is stale, reaches the interview with every command slot unresolved.
  The remedy is in the repository, not in the runtime: remove the lockfile the
  project does not use, or state the manager in `package.json#packageManager`.
- An operator who wants a derived value changed has no interview step in which
  to change it. The `profile` command exposes only `derive`. A correction path
  (`profile set`, or re-running `init` with an explicit answer) is out of scope
  here and should be filed as its own issue.
- The generated `.claude/settings.json` gains an allowance for every derived
  command. On a Node project whose scripts use the canonical `npm` forms this is
  a no-op, because the `stack` origin already granted them; on a project using
  `pnpm`, `make`, or `just` it is the difference between the allowance existing
  or not.
- The historical records of `ADP-08` (`2026-09-02-project-profile-derivation-design.md`,
  its plan, and `issue-190-project-profile-derivation-evidence.md`) describe
  the confirmation step as delivered. They are left as written; this document
  is the record of why that step was removed.

## Alternatives rejected

- **Record derived commands as `resolved` so the old gate grants them:** makes
  `resolved` mean two things and discards the evidence string the schema
  requires a derived leaf to carry.
- **Keep the confirmation only for command slots:** keeps most of the friction
  for the leaves most likely to be derived correctly, since commands come from
  declarative manifests rather than heuristics.
- **Grant no allowance for derived commands:** leaves the permission gate as
  dead code and regresses every non-canonical toolchain relative to the
  interview it replaces.
