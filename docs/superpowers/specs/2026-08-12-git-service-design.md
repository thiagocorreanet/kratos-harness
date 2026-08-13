# Git Service and Repository-State Classification Design

Issue [#23](https://github.com/thiagocorreanet/mestre-yoda/issues/23)
(`RUN-08`). Epic
[#15](https://github.com/thiagocorreanet/mestre-yoda/issues/15). Depends on
[#16](https://github.com/thiagocorreanet/mestre-yoda/issues/16) (`RUN-01`) and
[#18](https://github.com/thiagocorreanet/mestre-yoda/issues/18) (`RUN-03`).

## Problem

`RUN-01` fixed the shape of the `Git` port and deliberately left its semantics
unimplemented. What ships today is three thin methods — `state()`, `head()`,
and `changedPaths()` — whose comments name this issue as their owner. No domain
module consumes them; only the shared port contract suite does.

That placeholder cannot support the gates that later workflow issues will
build. `complete.undeclared_change` needs to know which paths are outside a
declared scope; `complete.ignored_removed` needs to know what was ignored at
baseline; `complete.observation_changed` needs an observation that cannot tear
between two reads; and `REASON-NO-GIT` requires that an absent repository stay
distinguishable from a Git command that failed. A single `dirty` flag and a
flat list of path strings answers none of those.

Two further problems are already present in the tree. Git invocation is
duplicated: `infra/node/index.ts` and `infra/node/workspace.ts` each carry
their own `execFile` wrapper with slightly different environments and error
handling. And neither wrapper disables Git's optional locks, so an observation
can update the index as a side effect — a read that mutates the user's
repository.

## Goals

- Replace the placeholder `Git` port with one atomic observation that returns a
  normalized, immutable snapshot of repository, HEAD, worktree, in-progress
  operation, and change set.
- Distinguish tracked, untracked, ignored, staged, unstaged, renamed,
  type-changed, conflicted, symlink, and submodule entries as separate facts
  rather than one collapsed enum.
- Map every Git failure to a frozen discriminated variant that never rejects and
  never masquerades as a different condition.
- Execute Git through one Node adapter with an explicit environment, bounded
  timeouts, array-only argument passing, and no shell.
- Guarantee the observation is read-only against the user's repository.
- Capture deterministic command evidence that carries no output bytes, no file
  content, no duration, and no timestamp.
- Keep every parsing and classification decision inside the layers covered by
  the 100% coverage gate.

## Non-goals

- Workflow policy. No gate, objective transition, approval rule, or completion
  decision is defined here. Issues `SDD-02` through `SDD-09` own those, and they
  own the mapping from an observation variant to a reason code.
- New reason codes. The frozen catalog is not extended by this issue.
- A public command. The observation stays internal, as
  `docs/architecture/runtime-boundaries.md` requires of foundation issues.
- Mutation. No commit, stage, checkout, fetch, or any other write operation.
- Submodule recursion. A submodule is reported as one aggregate entry; observing
  it as a repository is a second observation this one does not own.
- A cross-platform CI matrix. See "Platform consistency" below.
- Replacing `Workspace.locateWorktree`. Project discovery keeps its own worktree
  topology; this issue does not duplicate it.

## Alternatives

### A. Pure parser in the domain, thin Node adapter (selected)

`infra/node/git.ts` executes one argv and returns raw bytes, exit code, and
whether the process was killed. `composition/git.ts` sequences the invocations
and assembles the snapshot. `domain/git/*` owns every parser and every
classification rule.

`vitest.config.ts` requires 100% branches, functions, lines, and statements
across `domain/**` and `composition/**`, and excludes `infra/node/**`. A
`--porcelain=v2 -z` parser is the branch-densest code in this issue: unusual
filenames, rename scores, three-stage unmerged entries, submodule state fields.
Placing it in `infra/node` would put the riskiest code exactly where the gate
does not look. A pure parser is also exercisable from exact byte vectors with no
Git installed, while real repositories remain the source of those vectors.

### B. Parsing inside the Node adapter

The adapter returns the finished model and the domain declares types only. Less
indirection, but every edge case becomes an integration test requiring a real
repository in a specific state, and the parser sits outside the coverage gate.

### C. Split tokenizing and classification

The adapter tokenizes the NUL-delimited stream and the domain classifies it.
This splits one responsibility across two layers, keeps part of the parser
outside the gate, and introduces an intermediate boundary with no precedent
elsewhere in the runtime.

## Port surface

```ts
export interface Git {
  observe(): Promise<GitObservation>;
}
```

The three placeholder methods are removed rather than preserved as derived
conveniences. Nothing in the runtime consumes them, and keeping them would leave
two public ways to ask the same question — one of which reintroduces the tearing
that a single observation exists to prevent.

Reading status and HEAD at different moments is a real race: the repository can
change between the two calls, which is precisely the condition
`complete.observation_changed` exists to detect. One call, one snapshot.

## Observation model

```ts
export type GitObservation =
  | { readonly kind: "observed"; readonly repository: GitRepository;
      readonly evidence: readonly GitCommandRecord[] }
  | { readonly kind: "git_absent"; readonly evidence: readonly GitCommandRecord[] }
  | { readonly kind: "not_a_repository"; readonly evidence: readonly GitCommandRecord[] }
  | { readonly kind: "timeout"; readonly evidence: readonly GitCommandRecord[] }
  | { readonly kind: "command_failed"; readonly evidence: readonly GitCommandRecord[] }
  | { readonly kind: "unreadable"; readonly evidence: readonly GitCommandRecord[] };
```

`observe()` never rejects. A rejected promise carries no stable classification
and forces every caller to invent one; a frozen union makes the exhaustiveness
check the compiler's job.

No reason code is introduced. `runtime-boundaries.md` states that these
foundation issues define no workflow policy, and the mapping from a variant to a
`Result` is a policy decision belonging to the issues that own completion and
guard semantics. The catalog remains at revision 1.3.

`git_absent` and `not_a_repository` stay separate because the parity inventory
requires it: `REASON-NO-GIT` records that Git command and read failures "use
their distinct error classification and must not masquerade as `no_git`".
Collapsing them would break that line before the consuming policy exists.

```ts
export interface GitRepository {
  readonly head: GitHead;
  readonly worktree: "principal" | "linked";
  readonly operation: "none" | "merge" | "rebase" | "cherry_pick" | "revert";
  readonly changes: readonly GitChange[];
}

export type GitHead =
  | { readonly kind: "unborn"; readonly branch: string }
  | { readonly kind: "branch"; readonly branch: string;
      readonly commit: string; readonly upstream: GitUpstream | null }
  | { readonly kind: "detached"; readonly commit: string };

export interface GitUpstream {
  readonly ref: string;
  readonly ahead: number;
  readonly behind: number;
}
```

An unborn HEAD carries its branch name and no commit; a detached HEAD carries
its commit and no branch. Making those unrepresentable together removes the
class of bug where a caller reads a commit that does not exist.

```ts
export interface GitChange {
  readonly path: GitPath;
  readonly tracking: "tracked" | "untracked" | "ignored";
  readonly index: GitChangeKind;
  readonly worktree: GitChangeKind;
  readonly conflict: GitConflict | null;
  readonly renamedFrom: GitPath | null;
  readonly entry: "file" | "directory" | "symlink" | "submodule";
}

export type GitChangeKind =
  | "none" | "added" | "modified" | "deleted"
  | "renamed" | "copied" | "type_changed";

export interface GitConflict {
  readonly ours: boolean;
  readonly theirs: boolean;
  readonly base: boolean;
}
```

`index` and `worktree` carry a Git change kind only when `tracking` is
`"tracked"`. An untracked or ignored path has no index state and no worktree
delta to describe, so both fields are `"none"` and `tracking` alone reports its
presence. Encoding an untracked file as `worktree: "added"` would make it
indistinguishable from a staged addition, which is a distinction the completion
gate needs.

`index` and `worktree` are separate fields because staged and unstaged are
independent states of one path, and that distinction is what the issue says the
gates depend on. `renamedFrom` preserves the origin-destination pair rather than
flattening a rename into a delete plus an add: a file moved out of a declared
scope is a case the scope gate must see, and the pair is the only way to see it.

### Paths

```ts
export type GitPath =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "undecodable"; readonly sha256: string; readonly bytes: number };
```

With `-z` the Git output is raw bytes, and a filename on Linux is not required
to be valid UTF-8. Decoding everything as `utf8` replaces invalid bytes with
U+FFFD without reporting it, so two distinct files can normalize to one path and
a scope gate compares against a name that does not exist. The `undecodable`
variant refuses to invent a name while keeping the entry identifiable by digest.

Decoding uses `TextDecoder` with `fatal: true`. `TextDecoder` is a JavaScript
global, not a Node builtin, so it does not violate the layering rule enforced by
`tests/architecture.test.ts`.

Digesting an undecodable path requires hashing raw bytes, and `Digests` exposes
only `sha256(text: string)`. The port gains one additive method:

```ts
export interface Digests {
  sha256(text: string): string;
  sha256Bytes(bytes: Uint8Array): string;
}
```

Hex-encoding the bytes and hashing that string instead would produce a digest of
the encoding rather than of the path, which is not what the field claims to be.
Computing the digest in the Node adapter would move the decodable/undecodable
decision outside the coverage gate. Only `infra/digests.ts` implements this
port — the fake reuses the same construction — so the change lands in one place
and no existing caller is affected.

Paths are sorted by UTF-8 byte sequence. The rest of the runtime uses
`localeCompare(…, "en-US")`, but there the data are generated identifiers; here
they are arbitrary names read off a disk, and locale ordering is not stable
across ICU versions. Byte ordering is what makes "platform-consistent"
defensible.

Ignored entries are aggregated: a wholly ignored directory is one entry with
`entry: "directory"`, not one entry per file inside it. Enumerating
`node_modules` file by file on every observation is a cost the snapshot does not
need to pay, and set comparison over aggregated entries is sufficient for
detecting a removed ignored path.

Aggregation requires `--ignored=matching`, not `--ignored=traditional`. This is
counterintuitive and was verified empirically rather than read off the flag
name. `traditional` aggregates only while untracked listing is `normal`;
combined with `--untracked-files=all` it degrades to one entry per ignored file.
On a repository with a 500-file `node_modules`, a loose `.env`, and an ignored
`src/debug.log`:

| Flags | Ignored entries |
| --- | --- |
| `-uall --ignored=traditional` | 502 |
| `-uall --ignored=matching` | 3 (`.env`, `node_modules/`, `src/debug.log`) |

`matching` is the combination that keeps ignored entries aggregated while
untracked files stay individually listed, which is what both halves of the model
need. A loose ignored file and an ignored file inside a non-ignored directory
are both still reported individually — aggregation collapses only a directory
that is ignored in its entirety.

## Command evidence

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

No output bytes, no file content, no duration, no timestamp. Duration and
timestamps would make two observations of an unchanged repository unequal, which
would defeat the determinism property the observation is tested for.

Recording `argv` is safe because the command sequence is fixed and contains no
user data — a property asserted by test, not assumed by convention.

This issue persists nothing. The evidence travels inside the returned
observation, and the caller decides whether to turn it into an `EvidenceRef` and
commit it through the event store. Writing from `observe()` would turn a read
into a state mutation and drag the transaction and lease boundaries into a
query.

## Invocation

Two Git commands per observation, not one per fact, followed by a set of
filesystem marker reads.

Both commands share one fixed prefix:

```text
git --no-optional-locks --no-pager -c core.quotepath=false <subcommand> …
```

1. `rev-parse --path-format=absolute --is-inside-work-tree --git-dir
   --git-common-dir` — existence and worktree topology in one call. A linked
   worktree is exactly `git-dir !== git-common-dir`.
2. `status --porcelain=v2 -z --branch --untracked-files=all
   --ignored=matching` — branch, HEAD commit, detached state, upstream
   divergence, the full change set, and unmerged entries. One read is what makes
   the snapshot atomic. See "Paths" for why `matching` is the flag that
   aggregates ignored directories here.

The in-progress operation is then read from the git directory
(`MERGE_HEAD`, `rebase-merge/`, `rebase-apply/`, `CHERRY_PICK_HEAD`,
`REVERT_HEAD`), because porcelain v2 reports that entries are unmerged but not
which operation produced them. These are filesystem reads, not commands, so they
produce no `GitCommandRecord`; a marker that cannot be read classifies the whole
observation as `unreadable` rather than silently reporting `operation: "none"`.

Worktree topology comes from (1) rather than a second `git worktree list`, which
`Workspace.locateWorktree` already runs during project discovery. One source of
truth per question.

### Environment

Constructed in full, never inherited beyond `PATH`:

| Variable | Value | Reason |
| --- | --- | --- |
| `PATH` | inherited | locating the `git` executable |
| `GIT_CONFIG_NOSYSTEM` | `1` | system config must not alter observation |
| `GIT_CONFIG_GLOBAL` | nonexistent path | `~/.gitconfig` must not alter observation |
| `GIT_OPTIONAL_LOCKS` | `0` | the observation must not write the index |
| `GIT_TERMINAL_PROMPT` | `0` | never block waiting for credentials |
| `LC_ALL` | `C` | stable, unlocalized Git messages |

`GIT_OPTIONAL_LOCKS=0`, together with `--no-optional-locks` in the argv, is what
makes `observe()` genuinely read-only. Without it `git status` refreshes the
index as a side effect and takes the index lock, so an observation both mutates
the user's repository and can fail against a concurrent reader.

`GIT_CONFIG_GLOBAL` matters for correctness, not only hygiene: a personal
`status.showUntrackedFiles=no` would silently change the change set a gate
evaluates.

Arguments are always passed as an array with no shell. No observed path is ever
fed back into an argv — the sequence carries no pathspec, so a filename
beginning with `-` can never be read as a flag. That is a property of the fixed
sequence and is asserted by test.

### Limits and failure classification

Per-command `timeout` of 10 seconds, configurable when constructing the adapter,
with `killSignal: "SIGKILL"`, an explicit `maxBuffer`, and `windowsHide: true`.

| Condition | Variant |
| --- | --- |
| spawn fails with `ENOENT` | `git_absent` |
| `rev-parse` exits 128 | `not_a_repository` |
| `rev-parse` reports `is-inside-work-tree` as `false` | `not_a_repository` |
| process killed by timeout | `timeout` |
| unexpected exit code | `command_failed` |
| output unparsable, marker unreadable, or `maxBuffer` exceeded | `unreadable` |

A bare repository and the inside of a `.git` directory both exit 0 while
reporting `is-inside-work-tree` as `false`. There is no worktree to classify in
either case, so both are `not_a_repository` rather than a successful observation
with an empty change set.

A repository too large to buffer is not a command that failed, so `maxBuffer`
overflow classifies as `unreadable`.

## Module layout

| Module | Responsibility |
| --- | --- |
| `domain/git/model.ts` | frozen observation, change, path, and evidence types |
| `domain/git/status.ts` | `--porcelain=v2 -z` parser |
| `domain/git/refs.ts` | `rev-parse` output and marker classification |
| `domain/git/paths.ts` | byte decoding, normalization, ordering |
| `domain/git/evidence.ts` | `GitCommandRecord` construction |
| `composition/git.ts` | invocation sequence and snapshot assembly |
| `infra/node/git.ts` | process execution and git-directory marker reads |
| `infra/fake/git.ts` | scripted runner and fixed-observation stub |

Sequencing lives in `composition/git.ts`, which the coverage gate includes,
rather than in `infra/node`, which it excludes. The Node adapter is reduced to a
surface with no decision branches: run an argv, return
`{ spawned, exitCode, stdout, stderr, timedOut }`.

This mirrors `composition/events.ts` and `composition/transactions.ts`, which
already occupy that role between `domain/` and `infra/node/`.

## Consolidating Git invocation

`infra/node/workspace.ts` and `infra/node/index.ts` each carry an `execFile`
wrapper for Git. Both are replaced by `infra/node/git.ts`, and `workspace.ts`
consumes it.

The acceptance criterion "policy code never shells out directly" is otherwise
unprovable, so the consolidation is paired with an architecture test:
`node:child_process` may be imported by `infra/node/git.ts` and by nothing else
in the package. That turns the criterion into a CI failure rather than a review
convention. It also removes the current divergence between the two wrappers,
one of which omits the optional-locks protection entirely.

No other change is made to `workspace.ts`.

## Platform consistency

CI runs `ubuntu-latest` only (`.github/workflows/ci.yml:24`).

"Normalized change sets are platform-consistent for the supported scenario
corpus" is therefore delivered as a property of the normalization — byte
ordering, `/` separators, explicit decoding, no locale dependence — proven on
Linux by the scenario corpus and by property tests. The real operating-system
matrix belongs to
[#51](https://github.com/thiagocorreanet/mestre-yoda/issues/51) (`QAL-03`),
whose title is "Build the real-Git and cross-platform integration matrix".

This is recorded as an explicit scope decision. The acceptance criterion is not
reported as proven by a matrix that does not exist.

## Tests and evidence

### Scenario corpus

A builder creates a real temporary Git repository per classified state:

| Group | Scenarios |
| --- | --- |
| Absence | Git missing from `PATH`; directory that is not a repository |
| HEAD | unborn; branch with upstream; branch without upstream; detached |
| Worktree | principal; linked |
| Change set | clean; staged; unstaged; staged and unstaged; deleted; untracked; ignored file; ignored directory; renamed; copied; type-changed; symlink; submodule |
| Conflict | merge; rebase; cherry-pick; revert |
| Names | space; newline; Unicode; leading dash; undecodable bytes |

Every scenario asserts the expected normalized observation and the equality of
two consecutive observations of the same repository. Determinism is a tested
property, not an assumption.

### Byte vectors

Each scenario exports the exact bytes Git produced, and those bytes become the
input to the pure parser tests. This is what makes the selected approach pay:
the parser is exhaustively exercised under the coverage gate with no process
involved, and the vectors are not authored by hand — they are what Git actually
emitted. A vector that drifts fails the integration test that generated it.

### Property tests

Over `domain/git/paths.ts`: byte ordering is total and stable; decoding never
yields U+FFFD from bytes that decode cleanly; an undecodable path never collides
with a textual one.

### Guard tests

- `node:child_process` is imported only by `infra/node/git.ts`, checked with the
  same import extractor `tests/architecture.test.ts` already uses.
- No argv element is derived from observed data, asserted against the recorded
  evidence.
- The observation leaves the repository byte-identical, including the index
  file, verified before and after.

### Capability reporting

Symlink and submodule scenarios depend on platform support. Where support is
absent the test reports the missing capability rather than disappearing from the
run. A scenario that vanishes from a green report is indistinguishable from a
scenario that passed.

### Port contract suite

`describeGitContract` is rewritten for `observe()` and runs against both the
fake and the Node implementation, per the one-suite-per-port rule in
`runtime-boundaries.md`. The `RUN-08` exception recorded there is removed,
because this issue is what it was waiting for.

## Verification

```bash
npx vitest run tests/git-observation.test.ts tests/git-status-parser.test.ts \
  tests/git-paths-properties.test.ts tests/node-git.test.ts \
  tests/ports-contract.test.ts tests/architecture.test.ts
npm run verify
```

The narrow tests run first, the full suite before review.

## Documentation

`docs/architecture/git-service.md` will document the observation model, the
command sequence, the environment contract and why each variable is set, the
failure classification table, the evidence boundary, the read-only guarantee,
and the platform-consistency scope decision. The `Git` row in the ports table of
`runtime-boundaries.md` is updated and its `RUN-08` placeholder note removed.

Parity remains `0 / 400 (0.00%)`. This is internal structure and adds no
differential, integration, or E2E evidence to any inventory row.

The implementation PR must link issue #23, explain the atomic-observation choice
and the removal of the three placeholder methods, state that no reason code is
added and why, list the exact verification commands, and record the
cross-platform scope boundary against `QAL-03`.
