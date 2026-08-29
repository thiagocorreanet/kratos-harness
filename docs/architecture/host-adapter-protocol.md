# The Host Adapter Protocol

Issue [#35](https://github.com/thiagocorreanet/kratos-harness/issues/35)
(`ADP-01`) gives Claude Code and Codex one way to reach the runtime.
[ADR-0004](../adr/0004-host-adapter-boundary.md) already decided the shape: an
adapter translates and relays, it never owns transition policy, and every host
passes one shared conformance suite. This document states the half of that
protocol the runtime carries today.

## What an adapter is

```ts
interface HostAdapter {
  readonly name: string;
  describe(): HostDescriptor;
  translate(invocation: HostInvocation): AdapterMessageV1_1;
  relay(response: AdapterMessageV1_1): HostRendering;
}
```

Three methods, and deliberately no fourth. There is no method here that could
advance a phase, resolve a gate, or write state, and the conformance suite
asserts the exact method set rather than the absence of names somebody thought
to forbid. A method nobody anticipated is how an adapter grows a decision.

The same boundary is enforced statically: `packages/adapters` may import the
contracts package and nothing else. It cannot reach the runtime's domain,
ports, infrastructure, or composition, so it cannot call a decision even by
accident.

## Describing a host

An adapter states its identity, configuration host, contract revision,
capabilities, model catalog, and who is running:

| Field | Meaning |
| --- | --- |
| `host` | The identity carried on every message this adapter sends |
| `configurationHost` | The `claude` or `codex` configuration key |
| `hostContract` | The host contract revision this adapter speaks |
| `capabilities` | Every capability the host offers, as declared |
| `modelRouting` | Host-native defaults, aliases, canonical identities, and supported efforts |
| `observedIdentity.adapterVersion` | The adapter build |
| `observedIdentity.model` | The model the host reported, or `null` |
| `observedIdentity.effort` | The effort the host reported, or `null` |

`model: null` or `effort: null` means the host did not report that execution
fact. It never means the adapter selected a replacement or that the runtime may
copy configured values into observation. ADR-0004 requires the limitation to be
recorded rather than filled in, because a substituted identity is
indistinguishable from an observed one once it reaches an event.

## Model routing facts and runtime policy

The adapter owns host facts, not the routing decision. Its closed catalog gives
the runtime concrete defaults, aliases, canonical model identities, and
supported effort names. The runtime owns the fixed phase-to-role map, resolves
all three configured roles, compares canonical implementer and judge identities,
and refuses missing, ambiguous, unsupported, or non-independent routing. An
adapter cannot remap a phase, choose a fallback role, downgrade effort, or turn
`model.independence_violation` into a warning.

The current bundled defaults are versioned with each adapter:

| Host | Planner | Implementer | Judge |
| --- | --- | --- | --- |
| Claude Code (`claude`) | `sonnet@medium` | `opus@medium` | `sonnet@medium` |
| Codex (`codex`) | `gpt-5.6-terra@medium` | `gpt-5.6-sol@high` | `gpt-5.6-terra@medium` |

Initialization persists the canonical resolved objects, so an existing project
does not silently inherit different defaults from a later adapter version.
Concrete names remain adapter data; shared workflow policy is host neutral.

## Packaged phase-agent relay

Each packaged host ships `skills/kratos/scripts/phase-agent-relay.mjs`. The
host-specific module pins only the host identity and delegates to the shared
adapter protocol. For one phase it:

1. obtains the validated handoff through the runtime transport;
2. refuses to start phase work unless the native launcher declares exact model
   and effort selection;
3. passes the runtime-selected phase, role, model, and effort unchanged to that
   launcher; and
4. translates the launch result into an `sdd.agent.record:<correlation>`
   request carrying the original `assignmentDigest` in `phaseExecution`.

The launcher returns nullable host-observed identity separately from the
selected assignment. The relay never fills a missing observation from the
handoff. Runtime handoff refusals are returned unchanged, and an unavailable
exact selector is a host capability refusal before work, not permission to
choose a fallback.

The repository cannot invoke proprietary Codex or Claude Code phase-agent APIs
in a portable test process. The packaged-host conformance suite therefore
imports both built relay modules and supplies controlled runtime and launcher
ports. It executes the complete handoff-to-launch-to-record binding and proves
that an unsupported selector calls neither launch nor record. This verifies the
shipped integration contract; it is not a claim that a proprietary host API
ran end to end in the test environment.

## Contract negotiation

Each adapter-message revision pins `hostContract` to a constant. A host speaking a
different revision would therefore fail schema validation as a bad property,
which names a field instead of naming the contract. So the runtime reads the
declared revision structurally, before anything validates the message, and
judges it first:

| Declared revision | Reason | Exit |
| --- | --- | --- |
| Accepted by the manifest | none; the message proceeds | |
| Absent, non-string, or malformed | `contract.host_version_invalid` | 2 |
| Well-formed and not accepted | `contract.host_version_unsupported` | 2 |

The declared value never reaches the result. An adapter that sent something
hostile would otherwise have it echoed back to whoever reads the failure.

This is the same ordering the answers document already uses, for the same
reason.

Routing-capable operations require `host.adapter-message@1.1.0`. The registered
`1.0.0` revision remains accepted only for the legacy payloads it defines; it
cannot carry a phase handoff, model catalog, or execution observation.

## Capabilities

Capabilities are explicit data, normalized before anyone compares them: sorted,
deduplicated, and stripped of entries that are not capability identifiers. Two
hosts that offer the same things produce the same list, and an adapter cannot
change a decision by reordering its own.

An entry the runtime does not recognize is dropped rather than refused. Failing
an operation over a field it does not need would make every future host
capability a breaking change; dropping it keeps a later reader from treating an
unusable value as offered.

A capability an operation requires and the host did not offer is reported, not
worked around. ADR-0004 is explicit that a host missing a preventive hook does
not remove the runtime's own checks, so the missing list explains a refusal and
never authorizes skipping one.

## Payloads travel by reference

A request payload is `{ ref, sha256 }` — a project-relative path and a digest.
A host never inlines content. The runtime reads the bytes it verifies rather
than the bytes it was told about, and the reference pattern refuses absolute
paths, drive-qualified paths, backslashes, parent segments, URI schemes, and
control characters.

For phase output, a request additionally carries `phaseExecution` with the
handoff's `assignmentDigest` and the host-observed nullable `model` and
`effort`. The runtime binds that envelope to the operation, correlation, path,
and inspected content digest before reading agent content. Response,
model-catalog, and phase-execution message variants forbid this top-level field;
their generated TypeScript variants preserve the same closed shape as the
schema.

The host returns the assignment digest selected by `kratos handoff`; it does
not calculate a new assignment. Before append, the runtime re-resolves current
configuration, run revision, phase, host, role, model, and effort. Drift returns
`model.assignment_stale`; a known observed mismatch returns
`model.execution_mismatch`. When the host reports neither value, observed model
and effort remain `null` in the event.

## Relaying a decision

The response payload is a universal result. An adapter publishes it; it does
not recompute the exit code, restate the reason, or convert a refusal into a
success. The conformance suite drives every exit class through `relay` and
checks the verdict survives.

## The conformance suite

`describeHostAdapterContract(label, factory)` follows the same shape as the
port contracts already in this repository: one suite, run against every
implementation, so a host that quietly diverges fails there rather than in
production. The fake, Claude Code, and Codex adapters pass the same suite.
Host-specific catalog data changes the facts supplied to the shared runtime,
not its decision path or stable reason codes.

## Operation lifecycle messages

The versioned `host.operation-message` contract carries approval, hook,
timeout, cancellation, and error messages. Every message has one correlation,
one operation, a monotonic sequence, and a stable delivery identifier.
Duplicate delivery is idempotent; gaps, stale delivery, changed correlation,
and changed operation are refused without advancing the cursor.

Timeout, cancellation, and error messages always report mutation state. A
message interrupted in `prepared` or `publishing` must name the transaction
that requires recovery, so a host cannot turn a partial mutation into an
unreported cancellation. See [host operation messages](host-operation-messages.md).

The frozen inventory also carries `CLI-HOOK`, `FLAG-HOOK-HOST`, and
`IO-STDIN-HOOK-PAYLOAD`. The wire payload and delivery policy now exist; the
public hook command is delivered with the host command integration rather than
by making an adapter decide.

The wire identity is `claude-code`; initialization keeps `claude` as the local
surface selector. Legacy `init --host both` is represented by enabling both
hosts in the answers document rather than adding a third host identity.

No parity row moves. The inventory establishes that a host protocol exists, not
what the legacy runtime put on the wire, and a parity claim needs a differential
capture to compare against.
