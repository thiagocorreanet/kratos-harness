# Managed Transaction Surface Design

Issue [#101](https://github.com/thiagocorreanet/mestre-yoda/issues/101)
(`RUN-05a`). Epic
[#15](https://github.com/thiagocorreanet/mestre-yoda/issues/15). Extends
[#20](https://github.com/thiagocorreanet/mestre-yoda/issues/20) (`RUN-05`) and
unblocks [#25](https://github.com/thiagocorreanet/mestre-yoda/issues/25)
(`SDD-01`).

## Problem

The managed transaction accepts destinations below `.brain/` and nothing else.
That was the entire managed surface when `RUN-05` landed, and the rule is
written three times: `assertManagedPath` in the domain normalizer,
`isManagedDestination` in the composition transaction manager, and
`normalizeManagedPath` in the Node adapter. Three spellings of one rule is two
opportunities for them to disagree.

`SDD-01` is the first command that writes what a user asked for, and four of
its frozen destinations are outside that surface: `.claude/`, `.codex/`,
`CLAUDE.md`, and `AGENTS.md`. Its design commits one `EffectPlan` through
`applyPlan`, which is what makes an interrupted initialization leave the
project untouched or complete. Writing the host files outside the transaction
would surrender that guarantee for more than half the files the command
creates.

## Goals

- State the managed-surface rule once and have all three layers consume it.
- Accept the initialization destinations without loosening any existing
  refusal.
- Give a destination at the project root a parent the protocol can inspect and
  synchronize.

## Non-goals

- The `init` command, its flags, and its answers contract, which are `SDD-01`.
- Any destination outside the frozen `init` inventory. A widened surface is not
  an open one.
- Changing what a transaction guarantees. The commit, recovery, and failure
  contracts are untouched; only the set of destinations they accept moves.

## One rule, three consumers

The rule moves to `domain/transactions/surface.ts` as a total predicate over a
project-relative path. The domain normalizer keeps throwing
`guard.outside_allow`, the composition manager keeps its boolean question, and
the Node adapter keeps refusing before it touches a syscall -- but all three
ask the same function.

`infra` may import `domain`, so the adapter consumes the rule directly rather
than restating it. That is what makes "the three layers agree" a property of
the code instead of a claim a test has to re-establish for every path anybody
thinks to try.

## The widened surface

| Destination | Accepted | Why |
| --- | --- | --- |
| `.brain/**` | yes | Managed state, as before |
| `.brain/transactions/**` | no | The manager owns the namespace exclusively |
| `.claude/**`, `.codex/**` | yes | Host surfaces the frozen `init` inventory generates |
| `CLAUDE.md`, `AGENTS.md` | yes | The two instruction files, by exact name |
| Any other root file | no | `state.json` at the root is still outside |
| A managed root itself | no | `.brain`, `.claude`, and `.codex` are not destinations |

Root files are accepted by exact spelling rather than by pattern. A pattern
over the project root -- any `*.md`, say -- would accept a file this runtime
has no business writing, and the inventory names exactly two.

Case aliasing keeps its existing treatment: the reserved namespace is matched
case-insensitively, and the collision key stays lowercase, so a plan cannot
target `CLAUDE.md` and `claude.md` in one transaction.

## The project root as a parent

`parentOf` returns `"."` for a path with no separator. That branch was
unreachable, and carried a coverage ignore saying so. It becomes reachable the
moment `CLAUDE.md` is a legal destination.

The durable port already documents `.` as the project-root sentinel, but only
`syncDirectory` accepts it. `inspect` learns the same sentinel, resolving it
through the adapter's existing anchored-root validation, so publishing a root
file can assert its parent is a directory the way every other operation does.

No new port method appears. The sentinel is one value on two existing methods,
which keeps a project root from becoming a second kind of path that every
future operation has to reason about.

## What stays refused

Every refusal `RUN-05` established survives unchanged: absolute,
drive-qualified, backslash-bearing, control-character, traversing, empty,
trailing-separator, reserved, overlapping, contradictory, and case-colliding
paths. The Node adapter keeps anchoring to the canonical root, keeps
revalidating every existing component without following symlinks, and keeps
refusing symlinks and special entries at a destination.

The failure mapping does not move. A destination outside the surface is still
`guard.outside_allow`, and the reason catalog gains nothing.

## Testing strategy

**One rule.** A property test asserts the three layers accept and refuse the
same paths, over the accept table, the refuse table, and generated
near-misses -- because the point of the change is that they cannot disagree.

**Widened accept table.** `.claude/settings.json`, `.codex/agents/x.toml`,
`CLAUDE.md`, and `AGENTS.md` normalize into operations; `.claude` alone,
`state.json`, and `readme.md` do not.

**Root parent.** A plan writing `CLAUDE.md` inspects and synchronizes `.`, and
the Node adapter resolves that sentinel through the same validated root it
anchors everything else to.

**Interruption.** A fault campaign over a plan spanning `.brain/`, a host
directory, and the project root, reusing the campaign shape `RUN-05` and
`RUN-07` already use. This is the assertion that the widened surface did not
weaken the guarantee it was widened to preserve.
