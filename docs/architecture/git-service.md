# Git Service and Repository-State Classification

Issue [#23](https://github.com/thiagocorreanet/kratos-harness/issues/23)
(`RUN-08`) replaces the placeholder `Git` port with one atomic observation of a
repository. It does not add a public command, and it defines no workflow
policy: the staged bundle still exposes only `help`, `version`, and
`handshake`.

## The observation model

The port has exactly one method:

```ts
observe(): Promise<GitObservation>;
```

One call returns HEAD, worktree kind, in-progress operation, and the complete
change set together, as one immutable snapshot.

The alternative — `state()`, `head()`, and `changedPaths()` as separate calls,
which is what `RUN-01` left in the tree — cannot answer the question the
consuming gates ask. `complete.observation_changed` compares an observation
taken at declaration time against one taken at completion. Three independent
reads can tear: HEAD is read, the user checks out a branch, the change set is
read, and the result is a snapshot describing a repository that never existed.

`observe()` is not one atomic read end to end. `composeGit` runs `rev-parse`,
then `status`, then a directory listing — three separate reads, with the
repository free to change between any of them. What is actually atomic, and
what matters most, is narrower: HEAD and the complete change set both come out
of the single `git status --porcelain=v2 --branch` invocation, so exactly the
pair `complete.observation_changed` compares — "what changed" against "what
HEAD it changed relative to" — cannot tear against each other. Worktree
topology (from `rev-parse`) and the in-progress operation (from the directory
listing) are composed around that one atomic read, so tearing between them and
the status read is representable: abort a rebase between the status read and
the marker read, and the observation can report unmerged entries with
`operation: "none"`, a state that never existed as such on disk. What removes
the class of bug a caller could otherwise construct by accident is not
field-by-field atomicity but whole-observation comparison:
`complete.observation_changed` treats the entire snapshot as the unit of
comparison, so a caller can only ever compare two complete observations
against each other, never assemble one from parts read at different times.

The change set keeps its distinctions rather than collapsing them into one
`dirty` flag. Each `GitChange` carries its tracking state (`tracked`,
`untracked`, `ignored`), its index and worktree change kinds separately, its
conflict sides, its rename origin, and its entry type (`file`, `directory`,
`symlink`, `submodule`). `complete.undeclared_change` needs paths outside a
declared scope, and `complete.ignored_removed` needs what was ignored at
baseline; neither can be recovered from a boolean once the facts have been
merged.

An unborn HEAD carries a branch name and no commit; a detached HEAD carries a
commit and no branch. The union makes the two unrepresentable together, which
removes the class of bug where a caller reads a commit that does not exist.

## Failure variants

`observe()` never rejects. Every failure is a variant of the same frozen union:

| Condition | Variant |
| --- | --- |
| spawn fails with `ENOENT` | `git_absent` |
| `rev-parse` exits 128 | `not_a_repository` |
| `rev-parse` reports `is-inside-work-tree` as `false` | `not_a_repository` |
| process killed by timeout | `timeout` |
| unexpected exit code | `command_failed` |
| output unparsable, marker unreadable, or `maxBuffer` exceeded | `unreadable` |

A rejected promise carries no stable classification and forces every caller to
invent one. A frozen union makes the exhaustiveness check the compiler's job
instead.

`git_absent` and `not_a_repository` stay distinct because the parity inventory
requires it: `REASON-NO-GIT` records that Git command and read failures "use
their distinct error classification and must not masquerade as `no_git`".
Collapsing the two would break that line now, before the policy that consumes
it exists. Git missing from the system is a host problem the user must fix;
a directory that is not a repository is a normal, expected state that a
workflow may legitimately run in.

A bare repository and the inside of a `.git` directory both exit 0 while
reporting `is-inside-work-tree` as `false`. There is no worktree to classify in
either case, so both are `not_a_repository` rather than a successful
observation with an empty change set. A repository too large to buffer is not a
command that failed, so `maxBuffer` overflow classifies as `unreadable`.

`unreadable` is also what a defect in `composeGit`'s own parsing surfaces as.
`parseRevParse`, `parseStatusPorcelainV2`, `classifyWorktree`, and
`classifyOperation` are pure and return `null` on malformed input rather than
throwing, but `composeGit` wraps the whole read in a `try`/`catch`, so a bug
that throws instead — in those calls or anywhere else in the sequence — is
caught by the same handler that defends against a misbehaving `GitRunner`, and
reported the same way. Anyone debugging a mysterious `unreadable` should
consider a parser defect, not only a Git or filesystem problem.

No reason code is introduced. Mapping a variant to a `Result` is a policy
decision owned by the issues that define completion and guard semantics, and
the frozen catalog remains at revision 1.3.

## Command sequence

Every observation runs the same two commands in the same order, each with the
same fixed prefix:

```text
git --no-optional-locks --no-pager -c core.quotepath=false \
  -c status.renames=copies \
  rev-parse --path-format=absolute --is-inside-work-tree \
  --git-dir --git-common-dir

git --no-optional-locks --no-pager -c core.quotepath=false \
  -c status.renames=copies \
  status --porcelain=v2 -z --branch -uall --ignored=matching
```

`rev-parse` runs first because it decides whether the second command is worth
running: it establishes that a worktree exists and produces the git directory
paths that classify the worktree as principal or linked.

The in-progress operation is then read from marker entries in the git
directory. That is a directory listing, not a command, so it produces no
evidence record. A git directory that cannot be listed fails the whole
observation as `unreadable` rather than silently reporting `operation: "none"`
— a rebase reported as no operation is worse than no answer.

Markers are matched by precedence, not alphabetically:

| Marker | Operation |
| --- | --- |
| `rebase-merge` | `rebase` |
| `rebase-apply` | `rebase` |
| `CHERRY_PICK_HEAD` | `cherry_pick` |
| `REVERT_HEAD` | `revert` |
| `MERGE_HEAD` | `merge` |

The order matters because the markers are not mutually exclusive. An
interactive rebase that stops on a conflict leaves `MERGE_HEAD` present as
well; the rebase is the operation the user is in, and the merge is one step
inside it, so `rebase` wins.

`core.quotepath=false` stops Git from escaping non-ASCII bytes in path output,
so the parser receives real bytes and decodes them once, explicitly, rather
than reversing Git's own quoting.

## Pinning rename and copy detection

The environment table below neutralizes system and global Git config, but
`.git/config` — repository-local config — is still read by an ordinary
invocation. A repository with `status.renames=false` would turn every rename
into a plain add plus a delete, silently: no failure, no evidence, just a
`renamedFrom: null` where a caller expected a pair. `renamedFrom` is
load-bearing precisely because a file moved out of a declared scope is a case
the scope gate must see, and the rename pair is the only way to see it.

`-c status.renames=copies` in the fixed argv prefix pins this. `-c` on the
command line always outranks repository config, so a hostile or merely
differently-configured repository cannot suppress the signal the way it could
suppress an environment variable by never being asked to inherit one. `copies`
rather than plain `true` is a deliberate choice: it enables copy detection as
well as rename detection, which is what the `copied` scenario in the test
corpus depends on. Before this pin, that scenario opted into copy detection
with its own local `git config status.renames copies` — now redundant, since
the pin already forces it, and removed from the scenario for that reason.

## Environment

The adapter passes an explicit environment rather than inheriting the user's.
Ambient configuration is exactly what makes a subprocess non-deterministic.

| Variable | Value | Reason |
| --- | --- | --- |
| `PATH` | inherited | Git must still be found on the host. A test-facing override simulates Git missing without mutating the process environment. |
| `GIT_CONFIG_NOSYSTEM` | `1` | Ignores `/etc/gitconfig`, so a machine-wide setting cannot change the change set. |
| `GIT_CONFIG_GLOBAL` | a path that cannot exist | Neutralizes the user's `~/.gitconfig`. A personal `status.showUntrackedFiles=no` would otherwise silently shrink the change set a gate evaluates. |
| `GIT_OPTIONAL_LOCKS` | `0` | Second half of the read-only guarantee, alongside `--no-optional-locks`. |
| `GIT_TERMINAL_PROMPT` | `0` | A credential prompt would block the process until the timeout instead of failing. |
| `LC_ALL` | `C` | Removes locale from message text and ordering. |

Arguments are always passed as an array through `execFile`, never through a
shell, so no path or branch name can be interpreted as syntax. Execution is
bounded by a 10-second timeout with `SIGKILL` and a 16 MiB buffer.

## Why `--ignored=matching`

Ignored entries are aggregated: a wholly ignored directory is reported as one
entry with `entry: "directory"`, not one entry per file inside it. Enumerating
`node_modules` on every observation is a cost the snapshot does not need to
pay, and set comparison over aggregated entries is enough to detect a removed
ignored path.

Aggregation requires `--ignored=matching`, not `--ignored=traditional`. This is
counterintuitive and was verified empirically rather than read off the flag
name: `traditional` aggregates only while untracked listing is `normal`, and
combined with `--untracked-files=all` it degrades to one entry per ignored
file. Measured on a repository with a 500-file `node_modules`, a loose `.env`,
and an ignored `src/debug.log`:

| Flags | Ignored entries |
| --- | --- |
| `-uall --ignored=traditional` | 502 |
| `-uall --ignored=matching` | 3 (`.env`, `node_modules/`, `src/debug.log`) |

`matching` is the combination that keeps ignored entries aggregated while
untracked files stay individually listed, which is what both halves of the
model need. A loose ignored file, and an ignored file inside a non-ignored
directory, are both still reported individually — aggregation collapses only a
directory that is ignored in its entirety.

## The evidence boundary

Each invocation contributes one record:

```ts
export interface GitCommandRecord {
  readonly argv: readonly string[];
  readonly exitCode: number | null;
  readonly stdoutSha256: string;
  readonly stdoutBytes: number;
  readonly stderrSha256: string;
  readonly stderrBytes: number;
  readonly outcome: "ok" | "failed" | "timeout" | "not_spawned";
}
```

Output bytes are recorded as a digest and a length, never as content. Status
output names every changed path in the repository and stderr can quote file
content; persisting either would make the evidence trail a copy of the user's
work.

Duration and timestamps are absent by construction rather than by redaction.
Either would make two observations of an unchanged repository unequal, and
equality across repeated observation is the determinism property the port is
tested for. `argv` is safe to record because the command sequence carries no
observed data — a guard test asserts that no argument in the recorded evidence
comes from anything the repository itself reported, so a future argument
derived from an observed path fails the build. That guard checks the evidence,
not the runner's actual argv: the fixed prefix (`--no-optional-locks
--no-pager -c core.quotepath=false -c status.renames=copies`) is applied
inside `nodeGitRunner` and is never recorded or checked, so a path added there
would be invisible to it. The claim the guard proves is narrower than "every
argument is pinned" — it is that no *observed* path is ever fed back into an
argv, which is the property that actually matters: the prefix is fixed source,
not repository-derived data.

Evidence survives failure. A variant that returns early still carries the
records accumulated before the failure, so an observation that found no
repository can still show what was run.

## Read-only guarantee

`git status` refreshes the index as a side effect and takes the index lock to
do it. That makes a plain read both a mutation of the user's repository and a
possible failure against a concurrent reader. Both `--no-optional-locks` and
`GIT_OPTIONAL_LOCKS=0` are set to suppress it, belt and braces, because the
two mechanisms have differed across Git versions.

The guarantee is tested, not asserted. `tests/node-git-runner.test.ts` digests
`.git/index` before and after an observation and fails if the digest changes.
The test is built to actually exercise the guard: right after a commit the
index's cached stat information is already current, so a status run has nothing
to refresh and would pass whether or not the guard were present. The test
therefore first makes the cached stat information stale, so removing
`--no-optional-locks` makes it fail. No mutating subcommand exists anywhere in
the adapter, and the observation never writes to the repository under any
variant.

## Path decoding and byte ordering

Git reports paths as bytes. A filename is not required to be valid UTF-8 on
Linux or macOS, so decoding can genuinely fail.

Decoding is strict. An undecodable path becomes
`{ kind: "undecodable", sha256, bytes }` rather than a string containing
U+FFFD. Silent replacement would let two distinct files normalize to the same
path, and a scope gate would then compare against a name that does not exist on
disk.

Changes are ordered by UTF-8 byte sequence. The rest of the runtime orders with
`localeCompare(…, "en-US")`, but there the data are generated identifiers.
These are arbitrary names read off a disk, and locale ordering is not stable
across ICU versions — which is exactly what platform consistency forbids. An
undecodable path has no name to order by, so it sorts after every named path
and against its peers by digest; any total order works, and this one needs no
second source of truth.

## Platform consistency and its boundary

CI runs `ubuntu-latest` only. "Normalized change sets are platform-consistent
for the supported scenario corpus" is therefore delivered as a property of the
normalization itself — byte ordering, `/` separators, explicit decoding, no
locale dependence — proven on Linux by the real-repository scenario corpus and
by property tests.

The real operating-system matrix belongs to
[#51](https://github.com/thiagocorreanet/kratos-harness/issues/51) (`QAL-03`),
"Build the real-Git and cross-platform integration matrix". This is recorded as
an explicit scope decision: the acceptance criterion is not reported as proven
by a matrix that does not exist.
