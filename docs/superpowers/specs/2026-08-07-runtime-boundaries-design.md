# Runtime Boundaries, Ports, and Composition Design

Issue [#16](https://github.com/thiagocorreanet/kratos-harness/issues/16) (`RUN-01`).
Epic [#15](https://github.com/thiagocorreanet/kratos-harness/issues/15).
Depends on [#3](https://github.com/thiagocorreanet/kratos-harness/issues/3) (`FND-02`),
[#11](https://github.com/thiagocorreanet/kratos-harness/issues/11) (`CMP-03`),
[#12](https://github.com/thiagocorreanet/kratos-harness/issues/12) (`CMP-04`), and
[#14](https://github.com/thiagocorreanet/kratos-harness/issues/14) (`CMP-06`).

## Problem

The architecture specification already assigns each runtime component one
authority and forbids the decision engine from performing filesystem, Git,
network, or host effects. Nothing enforces that today. The runtime package is a
CLI, a handshake, and a version constant; there is no place where a policy
decision could live that is structurally prevented from reading a clock or
opening a file.

Every issue after this one — the objective lifecycle, the guardrails, the event
store, the migration planner — writes decision logic. If the boundary is not
enforced before that logic exists, it will be retrofitted against code that
already leaks, which is the expensive order to do it in.

## Goal

A deterministic core that *cannot* reach the filesystem, the clock, randomness,
the process, Git, or a host, because the dependency direction that would let it
is rejected in CI. Effects arrive only through injected ports, and one
composition root wires the real implementations for the bundle and deterministic
fakes for tests.

## Non-goals

- The objective lifecycle, guardrails, or any transition policy (`SDD-*`).
- The real event store, lock leases, or transactions (`RUN-05` … `RUN-07`).
- Project discovery and `.brain` resolution (`RUN-03`).
- Command routing and rendering (`RUN-02`).
- Claude Code and Codex adapters (`ADP-*`).

This issue delivers the boundary those issues fill in. Each port ships with a
minimal real implementation and a deterministic fake, both proven by one shared
contract suite — enough to prove the boundary holds, not enough to pre-empt the
issues that own the behavior.

## Decisions

### D1: Four layers, one direction

| Layer | Location | May import |
| --- | --- | --- |
| `domain` | `packages/runtime/src/domain/` | `domain`, `ports` (types only), `@mestre-yoda/contracts` |
| `ports` | `packages/runtime/src/ports/` | `domain` types only |
| `infra` | `packages/runtime/src/infra/` | `ports`, `domain`, `node:*` |
| `composition` | `packages/runtime/src/composition/` | everything above |

`domain` and `ports` must not import `node:*` at all. Not "should not" — the
architecture test rejects it, so a future contributor adding `import { readFile }
from "node:fs/promises"` to a policy module fails CI rather than review.

Nothing imports `composition` except the process entry point and tests. That is
what keeps the composition root a root rather than a service locator that any
module can reach into.

### D2: Ports are interfaces, never classes

Each port is a TypeScript interface in its own file, with a `Fake` and a `Node`
implementation living in `infra`. Interfaces carry no implementation, so `ports`
stays importable from `domain` without dragging anything runtime-bound along.

The seven ports the issue names:

| Port | Responsibility | Determinism concern it removes |
| --- | --- | --- |
| `Clock` | current instant | wall-clock time |
| `Ids` | identifier generation | randomness |
| `FileSystem` | read, write, list, atomic replace | ambient disk state |
| `Git` | repository classification and scope | subprocess behavior |
| `Locks` | acquire and release a fenced lease | concurrency timing |
| `Environment` | environment variables and cwd | ambient process state |
| `Output` | write structured and human output | stream side effects |

`Locks` and `Git` are the two whose real implementations are deliberately thin
here: `RUN-07` and `RUN-08` own their semantics. This issue fixes their *shape*
so those issues implement against a settled interface instead of inventing one.

### D3: One contract suite per port, run against every implementation

A port with two implementations has two chances to disagree. The suite that
proves `NodeFileSystem` behaves correctly is the same suite run against
`FakeFileSystem`, so a fake that quietly diverges fails immediately rather than
letting in-memory tests pass while the real runtime misbehaves.

Each port exports `describePortContract(name, factory)` from a shared test
module, invoked once per implementation. Where a behavior genuinely cannot be
shared — a real filesystem has a disk, a fake does not — the difference is an
explicit, named exception rather than a silently skipped case.

### D4: The composition root takes overrides, not flags

```ts
createRuntime(overrides?: Partial<RuntimePorts>): RuntimePorts
```

Tests pass fakes; the bundle passes nothing. There is no `NODE_ENV` check, no
`isTest` branch, and no way for production code to select a fake — the only path
to a fake is an explicit argument from a caller that already has one.

A fixed-clock, fixed-id runtime is therefore one call:

```ts
createRuntime({ clock: fixedClock("2026-08-07T00:00:00.000Z"), ids: sequentialIds() })
```

which is exactly what the acceptance criterion "core transition tests run
entirely in memory with fixed clock/ID providers" asks for.

### D5: The architecture rule is a test, not a linter plugin

The repository's established pattern is checked scripts plus Vitest, with no
dependency added unless it earns its place. A dependency-graph linter would add
a plugin, a config format, and a second place where layering is described.

Instead one test reads every `.ts` file under `packages/`, extracts static and
dynamic import specifiers, resolves each to a layer, and asserts the direction.
It runs inside `npm test`, so it gates CI with no new dependency and no second
source of truth.

The rule table lives in the test as data, so adding a layer is a one-line change
and the failure message can name both the file and the rule it broke.

### D6: Effects are described in the domain, performed in infra

The domain does not call ports directly. It returns an ordered **effect plan**
— a data structure describing what should happen — and the caller applies it.
This is the architecture specification's effect planner boundary, and it is what
makes dry-run possible without a parallel code path: a dry run is the same
decision with the plan rendered instead of applied.

This issue defines the plan shape and proves a plan can be produced purely and
applied through ports. It defines no policy that produces one.

## Components

| Unit | Responsibility |
| --- | --- |
| `domain/effects.ts` | Effect plan shape and constructors |
| `domain/decision.ts` | Decision envelope binding a result to an effect plan |
| `ports/*.ts` | One interface per port |
| `infra/node/*.ts` | Node-backed implementations |
| `infra/fake/*.ts` | Deterministic in-memory implementations |
| `composition/runtime.ts` | `createRuntime` and `RuntimePorts` |
| `tests/support/port-contracts.ts` | Shared per-port contract suites |
| `tests/architecture.test.ts` | Dependency-direction enforcement |

## Error handling

Ports report failure through the universal result contract rather than throwing
ad-hoc errors, so a port failure and a policy refusal render identically to a
caller. Where a port genuinely cannot continue — a filesystem that cannot be
read at all — it throws, and the composition root's caller converts it to
`runtime.internal_failure`, which the catalog already defines as sanitized.

No new reason code is introduced. This issue adds no behavior that needs one.

## Testing

| Level | Proves |
| --- | --- |
| Architecture | `domain` and `ports` import no `node:*`; no layer imports downward |
| Port contract | Every implementation of a port agrees with the same suite |
| Composition | Overrides replace exactly the named ports and nothing else |
| Determinism | Two runs with a fixed clock and ids produce byte-identical output |

The architecture test must itself be proven non-vacuous: it asserts that a
deliberately forbidden import is detected, using a fixture file outside
`packages/`, so a broken matcher fails loudly instead of passing everything.

## Compatibility impact

None to shipped behavior. The bundle's public surface — `--help`, `--version`,
`handshake`, `--expect` — is unchanged, and package verification still enforces
the same three-file plugin inventory.

Parity remains `0 / 400 (0.00%)`. This is internal structure; it adds no
differential, integration, or E2E evidence to any row.

## Open decisions recorded rather than deferred

**Where ports live.** Inside `packages/runtime` rather than a new package. A
separate package would need its own `package.json`, export map, and coverage
entry while the only consumer is the runtime. `ADP-01` may extract them when a
second consumer genuinely exists; doing it now would be speculative.

**Coverage.** New `domain`, `ports`, and `composition` modules join the 100%
coverage gate, because they are small, pure, and fully reachable. `infra/node`
implementations that wrap the filesystem are exercised by their contract suites
but not added to the gate, since forcing 100% on real I/O error paths invites
unreachable defensive branches written only to satisfy a threshold.
