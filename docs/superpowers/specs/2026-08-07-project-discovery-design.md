# Project Discovery and `.brain` Configuration Resolution Design

Issue [#18](https://github.com/thiagocorreanet/kratos-harness/issues/18) (`RUN-03`).
Epic [#15](https://github.com/thiagocorreanet/kratos-harness/issues/15).
Depends on [#16](https://github.com/thiagocorreanet/kratos-harness/issues/16) (`RUN-01`)
and [#12](https://github.com/thiagocorreanet/kratos-harness/issues/12) (`CMP-04`).

## Problem

The runtime has a project-rooted filesystem port but no way to decide what the
project root is. `createRuntime` roots every effect at
`overrides.environment?.workingDirectory() ?? process.cwd()`, which is a
placeholder: it assumes the caller already invoked the command from the exact
directory the state belongs to. A command run from `src/api/handlers` would
create a second `.brain` tree three levels below the real one, and nothing in
the runtime would notice.

The frozen inventory shows how wrong that assumption is. Twenty seven rows carry
a `--root` flag, each specified as a "nonempty directory path in spaced or `=`
form, default current directory" that "runs against the Brain/project rooted
there without changing process cwd". Two more rows, `FLAG-INIT-WORKTREE-LOCAL`
and `FLAG-DOCTOR-WORKTREE-LOCAL`, show that a linked Git worktree resolves to a
different Brain than the principal worktree unless the caller says otherwise.
`REASON-BRAIN-MIGRATION-PENDING` shows that a project can be found and still be
unusable because its state is in the legacy sibling layout.

Every issue after this one reads or writes `.brain`. If root resolution is
retrofitted later, each of them will already carry its own idea of where the
project is, and the guarantee that state never escapes into the wrong repository
will be a review habit rather than a structural property.

The layering makes this harder than it first looks. The `FileSystem` port
refuses absolute paths and refuses traversal, which is correct for managed
project paths and useless for discovery: discovery must look *above* a directory
it does not yet own. There is no port today that can answer a question about a
path outside the project, which is exactly the question this issue exists to
answer.

## Goal

One resolver that turns an invocation (a working directory, an optional
`--root`, an optional worktree mode) into a single classified answer: which
absolute directory is the project root, whether it holds a usable `.brain`,
which configuration values apply, and where each of those values came from.

The decision is pure. The observation that feeds it is collected through a port.
Discovery reads and never writes, so a run that fails to find a project cannot
have changed anything on the way to failing.

## Non-goals

- Command routing, flag parsing, the result envelope, and rendering. Those are
  [#17](https://github.com/thiagocorreanet/kratos-harness/issues/17) (`RUN-02`).
  This issue defines what `--root` and `--worktree-local` *mean*; the parser
  that accepts them and the renderer that reports the failure belong there.
- Registering any command. `init`, `doctor`, `status`, and `migrate` are owned
  by their own issues. This issue registers none of them, so it publishes no
  new command surface.
- Executing the legacy Brain migration. Discovery classifies the legacy layout
  and refuses; `migrate brain` (`FORM-MIGRATE-BRAIN`) performs it after explicit
  confirmation, and ADR 0003 requires that discovery alone never move or rewrite
  either location.
- Schema validation machinery. `RUN-04` owns the registry. This issue names the
  point in the sequence where project configuration is validated, defines the
  narrow `ConfigurationValidator` seam that registry will satisfy, and tests it
  with an injected deterministic validator. No second schema interpreter is
  introduced while `RUN-04` is still unmerged.
- Atomicity, locks, and crash recovery (`RUN-05` through `RUN-07`). Discovery
  performs no mutation, so it needs none of them.
- Repository classification. `RUN-08` owns clean, dirty, detached, and unborn.
  Discovery asks Git *where* a worktree is, never *what state* it is in.
- Concrete default values for project configuration. See D9 and the open
  decisions: the frozen evidence fixes the shape of `.brain/config.json`, not
  the values `init` writes into it.
- Classifying unsupported filesystems. No inventory row names an outcome for a
  filesystem that lacks symlinks, is case insensitive, or cannot canonicalize a
  path. Refusing a path that cannot be canonicalized is in scope; declaring a
  filesystem unsupported would be inventing a public contract, so it is not.

## Decisions

### D1: Discovery is a pure resolver over a collected observation

The domain exports one function:

```ts
resolveProject(
  request: DiscoveryRequest,
  observation: WorkspaceObservation,
  validateConfiguration: ConfigurationValidator,
): ProjectResolution
```

`DiscoveryRequest` carries the working directory, the optional `--root` value,
and the worktree mode. `WorkspaceObservation` is an inert record of what the
filesystem and Git reported. `ConfigurationValidator` is a pure function over
parsed unknown data; `RUN-04` will supply the schema-registry implementation.
`ProjectResolution` is a discriminated union. No port is called inside the
function, so the whole of root selection, precedence, and refusal is testable
with literal values and no temporary directory.

This mirrors `RUN-01`'s effect-plan split: the domain describes, the edge
performs. Discovery is the read-side twin of that rule, so the runtime has one
shape for "decide purely, touch the world at the boundary" rather than two.

Rejected: a `ProjectLocator` service that holds ports and walks the filesystem
itself. It would put the precedence rules in `infra`, where the layering test
cannot protect them and where every test of a tie-break needs a real directory
tree. The interesting behavior here is the ordering, and ordering is exactly
what a pure function makes cheap to prove.

### D2: A new `Workspace` port collects what `FileSystem` cannot

```ts
interface DirectoryProbe {
  readonly path: string;            // absolute, canonical
  readonly brain: "absent" | "directory" | "other" | "escaping";
  readonly git: "absent" | "present";
  readonly legacyBrain: boolean;    // sibling <name>-brain/.brain present
  readonly configuration:
    | { readonly kind: "absent" | "other" }
    | { readonly kind: "file"; readonly text: string };
}

interface WorktreeLocation {
  readonly kind: "principal" | "linked";
  readonly topLevel: string;        // this worktree
  readonly principal: string;       // the principal worktree
}

interface Workspace {
  canonicalize(path: string, base: string): Promise<string | null>;
  inspect(path: string): Promise<DirectoryProbe>;
  ancestors(start: string): Promise<readonly DirectoryProbe[]>;
  locateWorktree(start: string): Promise<WorktreeLocation | null>;
}
```

`ancestors` returns the chain from `start` up to the filesystem root, nearest
first. It reads `.brain/config.json` only when `.brain` is a real directory and
records the raw bytes without interpreting them. Path arithmetic stays in
`infra`, where `node:path` lives and where drive letters, UNC prefixes, and
separator differences are already solved. Which entry of the chain wins and
how the raw document is classified stay in `domain`, because those are policy.

Rejected: reusing `FileSystem`. It is constructed with a root and refuses
absolute and traversing paths, which is precisely the behavior discovery would
have to defeat. Widening it would weaken the one port whose narrowness protects
every managed write in the runtime.

Rejected: extending `Git` with `locateWorktree`. `nodeGit(root)` is bound to a
root at construction, so using it before the root is known inverts the
dependency. `RUN-08` also owns that port's semantics, and location is a
different question from classification: a detached, dirty, or unborn repository
sits in exactly the same place.

Rejected: writing a path module inside `domain` so the walk could be pure all
the way down. It would reimplement `node:path` badly across three platforms to
avoid one port, and `domain` may not import a Node builtin, so it could not
share the tested implementation.

### D3: Composition is two phase

```text
argv -> request -> observeWorkspace(bootstrapPorts) -> resolveProject
                                                            |
                                       root + configuration |
                                                            v
                                     createRuntime({ rooted at the root })
```

The bootstrap phase composes only `Workspace`, `Environment`, and `Clock`. It
cannot write, because it holds no `FileSystem` and no `Locks`. Only after the
root is resolved does `createRuntime` compose a filesystem rooted at it.

This is what makes "fail before mutation" structural rather than a review note:
during discovery there is no port present that could mutate anything.

Rejected: composing the full runtime at the working directory and re-rooting
after discovery. A runtime that briefly points at the wrong directory is a
runtime that can write to the wrong directory if any code between the two steps
touches it. Not creating it is cheaper than remembering not to use it.

### D4: `--root` pins the root and disables the ancestor walk

When `--root` is supplied, the resolved root is that directory after
canonicalization, and no ancestor is examined. The value may be relative; it is
resolved against the process working directory, which is never changed, exactly
as every `FLAG-*-ROOT` row specifies.

Rejected: treating `--root` as the starting point of the upward walk. A
`--root` naming a subdirectory of a project would then silently retarget its
parent. The rows say the command runs against the project "rooted there", and a
flag whose value is a suggestion is worse than no flag: it makes an operator's
explicit instruction unpredictable.

### D5: Without `--root`, the nearest ancestor holding `.brain` wins

The chain is walked nearest first. The first entry whose `.brain` is a directory
is the project root. If no entry has one, the Git top level from D6 is the root
if there is one, and otherwise the resolution is `not-found` at the working
directory.

The marker name is fixed, not configured. `project-config.v1.schema.json` pins
`managedState.directory` to the constant `.brain` and `managedState.eventLog` to
`events.jsonl`. That closes the bootstrap circle: discovery never has to read
configuration in order to learn where configuration is.

`.brain` outranks the Git top level because ADR 0003 makes state project-owned
and project-local, and because a repository can legitimately contain several
projects while a `.brain` names exactly one.

Rejected: requiring `.brain/config.json` rather than the `.brain` directory as
the marker. A project whose configuration file was deleted would then resolve as
no project at all, and the catalog already distinguishes those two situations:
`guard.config_missing` says configuration is absent, which is only expressible
if the project was found first.

Rejected: stopping the walk at the Git top level. `no_git` exists in the frozen
catalog precisely because a project without a repository is legitimate, and a
`.brain` above a nested repository is a real layout, not a mistake.

### D6: A linked worktree resolves to the principal worktree by default

`FLAG-INIT-WORKTREE-LOCAL` and `FLAG-DOCTOR-WORKTREE-LOCAL` are both boolean and
both default to false, and both describe that default as the principal worktree:
`init` "anchors new Brain memory beside the linked worktree instead of the
principal worktree" only when set, and `doctor` "inspects the linked worktree's
own Brain rather than resolving to the principal worktree memory" only when set.
So the resolver takes a worktree mode with the value `principal` by default, and
only a command that declares the flag may pass `local`.

The two rules compose without conflict. The flag chooses where new state is
anchored and which Brain `doctor` inspects. Every other command simply runs D5,
so a linked worktree that was initialized locally is found by the ordinary
nearest-marker rule, and one that was not falls through to the principal
worktree.

Rejected: making every command carry `--worktree-local`. Only two rows name it,
and adding it to the other twenty five root-bearing commands would publish a
flag the frozen evidence does not show, on commands whose usage text `RUN-02`
generates from the registry.

Rejected: inferring the mode from the presence of a linked `.brain`. That would
make `doctor --worktree-local` a no-op whenever the inference already agreed and
would silently disagree with `init`, whose flag has to be explicit because it
decides where a directory is created rather than which of two existing ones to
read.

### D7: The legacy sibling Brain fails with `brain_migration_pending`

When the resolved root has no `.brain` but a sibling `<name>-brain/.brain`
exists, the resolution is `migration-pending`. Its reason is the frozen
`brain_migration_pending`: status `failure`, exit 1, `stateChanged: false`,
retryable, with the catalog recovery text "Run `yoda migrate brain` from the
project root, verify the sibling Brain repository, and retry."

Discovery reads the sibling to know it exists and does nothing else with it. It
does not open its files, classify its contract version, or plan a migration.
ADR 0003 and the architecture specification both require migration to be a
user-invoked transaction and never a side effect of discovery.

Note the asymmetry this preserves: an in-project `.brain` wins outright. A
project that has already migrated is never dragged back to the sibling because
the old directory was left in place, which is what step 8 of the migration
sequence requires.

Rejected: treating the sibling as a readable state location so ordinary commands
keep working. The catalog gives this condition a failure status and exit 1, so
"keep working" would contradict the one piece of frozen evidence that describes
the situation.

Rejected: `contract.state_version_unsupported`. It is the right shape for a
persisted state contract outside the supported window, but the legacy layout is
detected by *location*, before any state file is read or any version string is
seen, and the catalog already has a reason that names the location problem and
points at the exact command that fixes it.

### D8: Discovery classifies, the command declares its requirement

`ProjectResolution` is one of:

| Variant | Meaning |
| --- | --- |
| `initialized` | Root found, `.brain` present, configuration resolved |
| `root-only` | Root found, no `.brain`, no legacy sibling |
| `migration-pending` | Root found, no `.brain`, legacy sibling present |
| `marker-unusable` | `.brain` exists but is not a usable directory |
| `configuration-unusable` | Root and `.brain` found, but configuration classification or validation failed |
| `not-found` | No root could be resolved |
| `refused` | The supplied `--root` cannot be used |

The resolver does not decide whether a variant is a failure. `init` needs
`root-only` and would fail on `initialized` without `--merge` or `--force`;
`status` needs `initialized`; `doctor` accepts several and reports on them.
Each command declares its requirement in the `RUN-02` registry, which is the one
field this issue adds to `CommandSpec`, and the shared pipeline maps an
unsatisfied requirement to the reason in the error-handling table.

Rejected: a resolver that throws when there is no project. It would force every
command that legitimately runs without one, starting with `init`, to catch and
reinterpret an exception, and it would put the policy in the wrong place: only
the command knows whether an uninitialized directory is a problem or the point.

### D9: Configuration precedence is defaults, then project file, then flags

Three layers, lowest to highest:

| Layer | Source | Scope |
| --- | --- | --- |
| `default` | Runtime built-in values | Every setting |
| `project` | `.brain/config.json` | Every setting the file declares |
| `flag` | Explicit command flags | Only the settings a flag names |

There is no environment-variable layer. The architecture specification lists
environment variables among untrusted inputs, no inventory row names an
environment variable that configures the runtime, and a fourth layer would be a
public contract invented rather than observed. A caller that needs to override a
setting passes a flag, which is visible in the invocation and therefore in the
provenance record.

The concrete default values are not decided here. The schema constrains
`language` to `en` or `pt-BR` and `policyMode` to `standard` or `strict` but
declares no default for either, and the frozen `SCHEMA-CONFIG-SCHEMA-JSON` row
only asserts that validation outcomes are preserved. Choosing a value would be
choosing observable behavior with no evidence, so the default layer ships as a
mechanism with the values owned by `CLI-INIT`.

Rejected: last-writer-wins across a merged object. The provenance requirement in
the issue asks where every resolved setting came from, and a merge that produces
only the final object cannot answer it after the fact.

### D10: Every resolved setting carries its provenance, project-relative

```ts
interface Resolved<T> {
  readonly value: T;
  readonly source: "default" | "project" | "flag";
  readonly ref: string | null;   // ".brain/config.json" or "--root"
}
```

`ref` is a project-relative path or a flag name. It is never an absolute path,
because the result contract's output-safety rules reject absolute Unix, Windows,
and UNC paths in public output, and provenance is meant to be rendered.

The resolved root is the one absolute path in the resolution, and it is
therefore marked as unsafe to render: a command that reports success names the
project by its relative marker, not by the operator's home directory layout.
`CLI-INIT` reports "the initialized root on stdout", so a future issue that
needs to print it must decide the safe form deliberately rather than inherit an
absolute string by accident.

Rejected: provenance as a separate parallel map keyed by setting name. It can
drift from the values it describes, and nothing would fail when it does. Binding
the two in one type makes a value without provenance a type error.

### D11: Configuration failures are ordered absence, contract, then schema

1. `.brain/config.json` absent: `guard.config_missing`, exit 2.
2. Present but unparsable as JSON: `guard.config_corrupt`, exit 2.
3. `stateContract` missing, non-string, or untrimmed:
   `contract.state_version_invalid`, exit 4.
4. `stateContract` well formed but outside the supported window:
   `contract.state_version_unsupported`, exit 4.
5. Parsed and in window but failing the schema: `guard.config_corrupt`, exit 2.

Steps 3 and 4 precede step 5 because the contract versioning guide states that
classification happens before payload validation or mutation, and that a future
value never selects the nearest known schema. Validating an unknown contract
against the current schema would report a field-level error for a document that
this runtime is not entitled to interpret at all.

Step 5 calls the injected `ConfigurationValidator`; this issue does not inspect
schema keywords or assert a `ProjectConfigV1` type. Its tests use a deterministic
validator double and require that the double is never called for steps 1 through
4. `RUN-04` later supplies the real registry function without changing the
resolver or its error ordering.

Rejected: validating first and classifying second, which reads more naturally
because a malformed document is malformed either way. It produces the wrong
public answer for a *newer* project: a field the next contract adds would be
reported as an unknown property rather than as a state contract this runtime
cannot read.

### D12: No new reason code

Every outcome above already has a name in catalog revision 1.3.

| Outcome | Reason | Exit |
| --- | --- | --- |
| No project found | `guard.config_missing` | 2 |
| `--root` is not a usable directory | `trail.uso` | 2 |
| `.brain` exists but is unusable | `guard.project_marker_corrupt` | 2 |
| Legacy sibling layout | `brain_migration_pending` | 1 |
| Configuration absent or corrupt | `guard.config_missing`, `guard.config_corrupt` | 2 |
| State contract invalid or unsupported | `contract.state_version_*` | 4 |
| Unexpected throw at the edge | `runtime.internal_failure` | 2 |

Two of these bindings deserve the argument rather than the assertion.

`guard.config_missing` for "no project anywhere up the chain" reuses a name
whose frozen description is "Guard evaluation cannot find required project
configuration". The `guard.` prefix is a frozen name, not a jurisdiction: the
condition is the absence of required project configuration, which is exactly
what happened. A new `discovery.project_missing` would mean a catalog revision
for an outcome the catalog can already name, and revisions 1.1 through 1.3 show
that additions are reserved for genuinely new families.

`guard.project_marker_corrupt` for a `.brain` that is a regular file, or a
symlink resolving outside the root, is the closest frozen name and its recovery
text, "Repair the project marker against its managed contract before rerunning
the guard", is the correct instruction. The alternative,
`runtime.internal_failure`, is defined as sanitized with forbidden evidence,
which would hide a condition the operator can fix in one command.

Both bindings are TypeScript-runtime decisions, not proven parity. The frozen
provenance for `internal/guard/codes.go` is hash-only, so which file Go v3
considered the project marker, and which code it emitted when run outside a
project, are not observable from the inventory. They are recorded as open
decisions and claim no row.

## Components

| Unit | Responsibility |
| --- | --- |
| `domain/project/request.ts` | `DiscoveryRequest` and worktree mode |
| `domain/project/observation.ts` | `WorkspaceObservation` and probe types |
| `domain/project/resolve.ts` | `resolveProject`, root selection, precedence |
| `domain/project/config.ts` | Layered configuration and `Resolved<T>` |
| `domain/project/validation.ts` | Pure validator seam consumed by discovery and implemented by `RUN-04` |
| `domain/project/reasons.ts` | Resolution variant to reason-code mapping |
| `ports/index.ts` | Pre-root `Workspace` interface, separate from `RuntimePorts` |
| `infra/node/workspace.ts` | Ancestor walk, canonicalization, worktree query |
| `infra/fake/index.ts` | In-memory tree honouring the same contract |
| `composition/discovery.ts` | `observeWorkspace` and the two-phase wiring |

`domain/project/**` imports no Node builtin and calls no port, so the
architecture test already in place covers it without a new rule.

## Error handling

| Condition | Detected in | Reason | Exit |
| --- | --- | --- | --- |
| `--root` empty or malformed | `RUN-02` parser | `trail.uso` | 2 |
| `--root` absent, unreadable, or not a directory | `resolveProject` | `trail.uso` | 2 |
| `--root` cannot be canonicalized | `observeWorkspace` | `trail.uso` | 2 |
| No `.brain` and no Git top level | `resolveProject` | `guard.config_missing` | 2 |
| `.git` exists but topology is invalid or ambiguous | `resolveProject` | `guard.project_marker_corrupt` | 2 |
| `.brain` is a file or escapes the root | `resolveProject` | `guard.project_marker_corrupt` | 2 |
| Legacy sibling Brain present | `resolveProject` | `brain_migration_pending` | 1 |
| `.brain/config.json` absent | `resolveProject` | `guard.config_missing` | 2 |
| Configuration unparsable or schema invalid | `resolveProject` | `guard.config_corrupt` | 2 |
| `stateContract` malformed | `resolveProject` | `contract.state_version_invalid` | 4 |
| `stateContract` out of window | `resolveProject` | `contract.state_version_unsupported` | 4 |
| Filesystem error during observation | `observeWorkspace` | `runtime.internal_failure` | 2 |

Every one of these is `stateChanged: false`, which is not a claim the resolver
has to make carefully: the bootstrap composition holds no writing port, so no
discovery failure has anything to declare.

No message echoes the supplied `--root` value or any absolute path. That is the
same rule `RUN-02` applies to arguments, for the same reason: a misdirected root
is exactly the input most likely to contain a home directory or a client name.

An escaping symlink is refused, never clamped. `RUN-01` established that rule
for managed paths, and relaxing it for the root would let a `.brain` symlink
redirect the whole project silently.

## Testing

| Level | Proves |
| --- | --- |
| Resolver unit | Each variant, from literal observations, with no filesystem |
| Precedence table | Every layer combination resolves to one value and one source |
| Failure ordering | Contract classification precedes schema validation |
| Port contract | The Node and fake `Workspace` agree on one shared suite |
| Property | Canonicalization is idempotent and never yields a path above the root |
| Property | Traversal, control characters, and empty segments are refused |
| Integration | Ordinary repository, nested directory, worktree, detached HEAD |
| Integration | Spaces, Unicode, symlink inside root, symlink escaping root |
| Integration | Non-repository directory, and repository with no `.brain` |
| Non-mutation | A full discovery run touches no writing port and creates no file |
| Determinism | The same tree and request resolve identically across runs |

The detached-HEAD case asserts something specific: the resolved root is
*identical* to the attached case. Discovery must not depend on HEAD, and a test
that merely runs in detached HEAD without asserting equality would pass even if
it did.

The non-mutation test is the one that must be proven non-vacuous, in the way
`RUN-01` required of the architecture test and `RUN-02` of the help snapshot. It
runs against a recording filesystem that fails the test if any write, remove, or
directory creation is observed, and a fixture that deliberately writes has to
make it fail.

Property tests generate path segments including `..`, `.`, empty strings, NUL
and other control characters, backslashes, drive-qualified prefixes, and
combining Unicode, and assert that no generated input resolves to a root outside
the canonical start.

Coverage for `domain/project/**` and `composition/discovery.ts` is 100%, which
the existing gate already requires of `domain/**` and `composition/**`.
`infra/node/workspace.ts` is proven by the shared port contract suite and stays
outside the gate, on the same reasoning `RUN-01` recorded: forcing 100% on real
I/O error paths invites defensive branches written for a threshold.

## Compatibility impact

Parity remains `0 / 400 (0.00%)`. No row moves.

The rows this work touches and deliberately does not claim:

| Row | Why it does not move |
| --- | --- |
| `FLAG-*-ROOT` (27 rows) | Each belongs to its command; no command is registered here |
| `FLAG-INIT-WORKTREE-LOCAL` | Requires `init`, which this issue does not implement |
| `FLAG-DOCTOR-WORKTREE-LOCAL` | Requires `doctor`, likewise |
| `PKG-INTERNAL-BRAIN` | Layout ownership extends far past discovery |
| `PKG-INTERNAL-CONFIG` | Configuration writing and generation are not here |
| `PKG-INTERNAL-DETECT` | Stack detection is a separate concern; see below |
| `REASON-BRAIN-MIGRATION-PENDING` | Emitted here, but the row needs the four evidence kinds and `migrate brain` |
| `FILE-BRAIN-CONFIG-JSON` | Discovery reads it; generation is `CLI-INIT` |

A row counts only when unit, differential, integration, and end-to-end evidence
all pass. This issue produces unit, property, and integration evidence for
internal structure and no differential or end-to-end evidence against the frozen
oracle, so claiming any of the rows above would overstate the work.

`PKG-INTERNAL-DETECT` deserves a note because `FLAG-INIT-DETECT-ROOT` is easy to
confuse with discovery. The row is explicit that it "selects only stack
detection, not where Brain memory is stored". It is a different root, resolved
for a different purpose, and it is not part of this design.

No shipped behavior changes. The bundle's public surface is unchanged, because
no command consumes the resolver yet.

## Open decisions recorded rather than deferred

**The frozen ancestor walk is not observable.** Every `--root` row documents the
default as "current directory" and `CLI-GLOBAL-REQUIRE-CONTRACT` lists
"commands executed from a subdirectory" as an edge case, which together prove
that Go v3 resolves *something* from a nested directory, but not what. The
legacy references are hash-only provenance, so the stop condition, the order of
marker and repository checks, and the behavior at a filesystem boundary are all
undetermined. D5 is therefore the TypeScript runtime's rule, documented as such,
and no parity is claimed for it. An authorized oracle observation of `yoda
status` from a nested directory, from a directory whose parent has a `.brain`,
and from inside a nested repository would settle it.

**Which file Go v3 treated as the project marker.** The reason code
`guard.project_marker_corrupt` comes from `internal/guard/codes.go` with
hash-only provenance. Binding it to `.brain` is the reading that fits its
recovery text, and it is recorded as a binding rather than a fact. The same
oracle run against a project whose `.brain` is a regular file would confirm or
replace it.

**The reason for running outside any project.** `guard.config_missing` is the
closest frozen name, but no row states which code Go v3 emitted when no project
existed at all. If an oracle observation shows a different code, this is a
one-line change in `domain/project/reasons.ts` and no other module.

**Tie-break when the principal and a linked worktree both hold `.brain`.** D5
resolves to the nearest, which for a command run inside the linked worktree is
the linked one. The frozen evidence covers only where new state is *anchored*
and which Brain `doctor` *inspects*, not which one an ordinary command in a
linked worktree reads when both exist. The nearest-marker rule is the
consistent extension of D5 rather than an observed behavior, and it is recorded
here so a future oracle observation can correct it in one place.

**Default configuration values.** Deliberately unset, per D9. The default layer
exists and is exercised by tests using fixture values; the shipped values arrive
with `CLI-INIT`, which is the row that owns what a new project contains.

**Unsupported filesystems.** The issue lists them among the conditions to defend
against. What this design provides is a refusal for any path that cannot be
canonicalized and a resolution that never depends on symlink support. It does
not classify a filesystem, because no reason code names that outcome and adding
one would require a catalog revision justified by no evidence. If a real
platform failure appears in integration testing, it arrives as a filesystem
error and renders as `runtime.internal_failure` until an authorized observation
justifies better.

**Where `Workspace` lives.** In `packages/runtime/src/ports/` alongside the
other seven, not in a new package. The reasoning `RUN-01` recorded still holds:
the only consumer is the runtime, and `ADP-01` may extract the set when a second
consumer genuinely exists.
