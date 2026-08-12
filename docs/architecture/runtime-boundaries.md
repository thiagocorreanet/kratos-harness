# Runtime Boundaries, Ports, and Composition

The architecture specification assigns the decision engine one authority and
forbids it from performing filesystem, Git, network, or host effects. This
document describes how that is enforced rather than merely intended.

The core cannot reach the filesystem, the clock, randomness, the process, Git,
or a host — not by convention, but because the dependency direction that would
allow it fails CI.

## Layers

| Layer | Location | May import |
| --- | --- | --- |
| `domain` | `packages/runtime/src/domain/` | `domain`, `ports`, `@mestre-yoda/contracts` |
| `ports` | `packages/runtime/src/ports/` | `domain` |
| `infra` | `packages/runtime/src/infra/` | `ports`, `domain`, `node:*` |
| `composition` | `packages/runtime/src/composition/` | everything above |

`domain` and `ports` must not import a Node builtin at all. A contributor
adding `import { readFile } from "node:fs/promises"` to a policy module fails CI
rather than review.

Neither layer may import Ajv, a schema JSON path, or `infra/schema`. Validation
types belong to `domain/schema`; the engine and embedded documents remain an
infrastructure implementation detail. Architecture fixtures exercise all three
forbidden routes from both `domain` and `ports` while retaining valid
ports-to-domain imports.

A builtin is recognized by resolving against Node's own builtin list, not by the
`node:` prefix. `import { readFileSync } from "fs"` is legal Node and resolves
fine, so a prefix check would let four dropped characters walk through the rule.
`require()` is matched too: it has no place in this ESM package, which is
exactly why it must not be an unwatched way out. A relative specifier is
resolved against the importing module, so a layer cannot reach a builtin
indirectly by importing an entry module.

**Only an entry point may import composition.** That is what keeps the
composition root a root instead of a service locator any module can reach into.

`@mestre-yoda/contracts` must not import a runtime layer, so the published
contracts stay consumable without dragging the runtime along.

### Why a test rather than a linter plugin

A dependency-graph linter would add a plugin, a config format, and a second
place where layering is described. The rule is instead a test that reads every
package source, extracts static, type-only, side-effect, and dynamic import
specifiers, resolves each to a layer, and reports the file, the specifier, and
the rule broken.

It runs inside `npm test`, so CI gates it with no new dependency and one source
of truth. The rule table lives in the test as data, so adding a layer is a
one-line change.

Static and side-effect imports are matched anchored to the start of a line,
which is where a real declaration must appear. That is what keeps a specifier
quoted inside an expression from being mistaken for a dependency, and the
extractor is tested against exactly that case. The repository-wide sweep asserts
it actually saw `domain` and `ports` files, so an empty glob cannot report a
clean repository.

## Ports

Effects arrive only through these interfaces. They are interfaces only: a port
carrying an implementation would drag its runtime dependencies into every module
that imports it, which is what the layering exists to prevent.

| Port | Responsibility | Determinism concern it removes |
| --- | --- | --- |
| `Clock` | current instant | wall-clock time |
| `Ids` | identifier generation | randomness |
| `FileSystem` | read, write, list, remove, stat | ambient disk state |
| `Git` | atomic repository observation | subprocess behavior |
| `Locks` | acquire and release a fenced lease | concurrency timing |
| `Environment` | environment variables and working directory | ambient process state |
| `Output` | structured and human output | stream side effects |
| `Workspace` | canonical paths, read-only project markers, and Git worktree topology | ambient discovery state |

`Workspace` is deliberately separate from `RuntimePorts`. Project discovery
uses it before a project root exists; only after discovery succeeds does
`createRuntimeAt` construct mutation-capable ports at that root. See the
[project discovery contract](project-discovery.md) for precedence and safety.
Its production configuration adapter crosses the
[schema registry contract](schema-registry.md) before a configuration value can
enter the domain.

`Git` returns one atomic observation of a repository: HEAD, worktree kind,
in-progress operation, and the complete change set, assembled behind a single
call so the parts cannot tear between reads. See the
[Git service contract](git-service.md) for the failure variants, the evidence
boundary, and the read-only guarantee.

`Locks` ships a deliberately thin implementation. `RUN-07` owns lease expiry,
renewal, and recovery of an abandoned lease. This issue fixes its shape so that
issue implements against a settled interface instead of inventing one. It still
runs the shared contract suite against both implementations — narrowing an
exception to the assertions that issue owns, rather than excusing the whole
port.

### One contract suite per port

A port with two implementations has two chances to disagree. The suite that
proves the Node implementation is the same suite run against the fake, so a fake
that quietly diverges fails immediately instead of letting in-memory tests pass
while the real runtime misbehaves.

Where a difference is genuine it is a named exception on a specific
**assertion**, never on a whole port. Excusing an entire port is how two
implementations end up disagreeing on a field's units or the sign of a timestamp
while a document claims they agree.

`Git` runs the same shared suite, mechanically unmodified, against both
implementations — but two of its five properties are vacuous on the stub.
`stubGit` is a fixed pass-through with a default `changes: []`, so "returns
changes sorted by path bytes" cannot meaningfully fail there (there is no sort
step to regress), and "observes the same repository equally twice" cannot
either (a constant return can never diverge from itself). Only the Node
implementation exercises those two against a live sort and a live process. The
remaining three — a kind from the closed set, resolving rather than
rejecting, and evidence carrying no output bytes — are proven on both sides.
`Locks` runs the same suite against both as well; only the semantics `RUN-07`
owns are left for that issue to assert.

### Path safety

Both filesystem implementations refuse the same set of unsafe paths and report
an escape with the same message, so a caller can match on one string. Refused:
absolute, drive-qualified, backslash-bearing, control-character, empty, and
traversing paths.

Traversal is **refused, not clamped**. A path that tried to escape never
silently resolves to somewhere inside the project.

A space is legal in a real project path and is not refused. Rejecting it would
be a restriction the runtime would have to walk back the first time it read a
user's repository.

The Node implementation additionally resolves the real path and requires it
below the project root before any mutation. Lexical normalization is not enough
on its own: a symlink can point outside the project while the path reaching it
looks perfectly safe.

Both the parent **and the final component** are resolved. Checking only the
parent misses the case where the last segment is itself a symlink — the parent
is then perfectly legitimate and the whole redirect lives in that one segment.
A symlink that stays inside the root is still followed normally; the refusal is
about escaping, not about symlinks.

An escaping path throws from `stat` rather than returning `null`, because a
refusal is not an absence and flattening the two would let a rejected path read
as a missing file.

## Composition

```ts
createRuntime(overrides?: Partial<RuntimePorts>): RuntimePorts
```

Overrides come from an explicit caller argument and nothing else. There is no
environment check and no test-mode branch, so production code has no path to a
fake. A key that is absent keeps the real implementation; a key that is present
replaces exactly that port and not its neighbours.

A fully deterministic runtime is therefore one call:

```ts
createRuntime({
  clock: fixedClock("2026-08-07T00:00:00.000Z"),
  ids: sequentialIds(),
  fileSystem: memoryFileSystem(),
  output: recordingOutput(),
});
```

A **partial** override is not a deterministic runtime. `createRuntime({ clock })`
keeps the real filesystem rooted at `process.cwd()`, so applying a plan through
it would write into the working tree. Override every port whose effects a test
must not perform.

Schema validation follows the same dependency direction. Closed identifiers,
typed results, and canonical JSON live in `domain/schema`; embedded schema
documents and Ajv live in `infra/schema`; and `composition/schema` constructs
one real registry and adapts project configuration. Module evaluation compiles
that embedded catalog once at startup; project discovery reuses the same
instance through its cached configuration adapter. A malformed catalog is a
package integrity failure, not a user-state diagnostic. Tests retain explicit
registry and validator injection, and no domain module locates composition as a
service. The registry has no port and no capability for filesystem or network
schema discovery.

## Effect plans

The domain does not call ports. It returns an ordered `EffectPlan` describing
what should happen, and the caller applies it.

That separation keeps the decision previewable without creating a second
decision path. The normalized managed plan is currently internal to execution;
public dry-run wiring is outside these foundation issues. A future dry-run
surface must render that same normalized plan instead of deriving a parallel
plan that can drift from the applied one.

`applyPlan` snapshots the effect plan before its first asynchronous boundary.
It normalizes managed create, write, and delete effects into one exact ordered
plan, then commits them through the
[atomic transaction boundary](atomic-transactions.md). Structured and human
emits remain outside that transaction and run in declared order only after a
commit. `append_event` is a structured internal effect: its owning
[event-store integrity boundary](event-store.md) derives the run-scoped stream
and snapshot paths, verifies their persisted binding, prepares one exact-prefix
append and replayed snapshot, and submits both writes through the same managed
transaction. It does not add a public command.

Normal execution follows the fixed prepare-and-publish sequence and does not use
`decideRecovery` as its control loop. That pure policy is limited to explicit
recovery and failure classification after an execution attempt rejects. A
rejected promise is not proof that its effect did not happen: those paths use
fresh destination fingerprints. Explicit recovery may abort before
`publishing`; once `publishing` is durable, it only rolls forward to `committed`
or blocks on unexpected evidence.

## Scope

These foundation issues deliver runtime, schema, internal durable mutation, and
internal event-store boundaries; they define no workflow policy, objective
transition, or new command. The objective lifecycle, guardrails, locks, and
host adapters fill their own semantics through later issues. Read-only project
discovery and typed transaction inspection remain internal and do not change
the shipped command surface.

Parity remains `0 / 400 (0.00%)`. This is internal structure and adds no
differential, integration, or E2E evidence to any row.
