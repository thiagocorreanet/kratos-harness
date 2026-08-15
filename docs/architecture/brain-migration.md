# Legacy Brain Migration Planning

Issues [#41](https://github.com/thiagocorreanet/mestre-yoda/issues/41) and
[#42](https://github.com/thiagocorreanet/mestre-yoda/issues/42) provide both
the deterministic plan and its transactional command surface. `migrate brain`
previews by default and applies only after `--yes` authorizes the exact plan
digest. `migrate rollback <migration-id>` removes only the files the completed
migration recorded as newly created and retains its receipt.

## The layout it recognizes

One. Discovery already reports a legacy sibling Brain as a directory
`<project-name>-brain/.brain` beside the project, and refuses to read it as
current state. `docs/architecture/project-discovery.md` states that rule; this
document says what happens next.

The frozen inventory records that `kratos migrate brain` exists, along with its
`--root` and `--yes` flags and its confirmation contract. It does not record
what the legacy layout contained, so the planner describes the layout this
runtime recognizes rather than claiming parity with one it cannot see.

## The decision

The plan is a pure function of the observation and a digest function. Nothing
is read inside it, so the same layout always produces the same plan, and the
plan can be rendered, compared, and re-derived without touching a disk.

Each legacy entry produces exactly one action:

| Entry | Action | Why |
| --- | --- | --- |
| Absent from the project | `copy` | `absent_in_project` |
| Present with the same digest | `skip` | `identical_in_project` |
| Present with a different digest | `conflict` | `differs_in_project` |
| Not a regular file | `unsupported` | `not_a_regular_file` |

A directory produces no action of its own. It is created by the file it holds,
and planning it separately would describe a byte nobody moves.

Actions are ordered by source path, so two runs render identically, and the
plan carries a digest over that ordered list.

## What blocks a migration

**A conflict blocks it.** The project's own state wins by default: overwriting
it silently is how a migration destroys the work it was meant to preserve. The
plan names both digests so a person can decide.

**An unsupported entry blocks it.** Carrying across something no
transformation is declared for would move a byte the plan cannot explain.

**Two candidate layouts block it.** Two siblings are not a preference to
resolve — they mean the runtime cannot know which project the state belongs to.
The plan names the candidates and stops.

## What the plan promises

A ready plan reports the bytes its copies would write, so free space can be
checked before anything moves, and declares itself reversible: every action
either writes a file that was absent or writes nothing, so undoing the
migration is removing exactly what it created.

Planning writes nothing. An authorized apply copies the planned files in one
managed transaction and persists authorization, rollback, and completed
receipt documents under `.brain/migrations/<migration-id>`.

## What this claims

The command, form, root flag, confirmation, receipt, and rollback surfaces are
implemented. Compatibility rows stay migration-only until real Go v3 fixtures
can prove the private baseline conversion byte for byte.
