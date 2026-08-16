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
  translate(invocation: HostInvocation): AdapterMessageV1;
  relay(response: AdapterMessageV1): HostRendering;
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

An adapter states its identity, its contract revision, its capabilities, and
who is running:

| Field | Meaning |
| --- | --- |
| `host` | The identity carried on every message this adapter sends |
| `hostContract` | The host contract revision this adapter speaks |
| `capabilities` | Every capability the host offers, as declared |
| `observedIdentity.adapterVersion` | The adapter build |
| `observedIdentity.model` | The model the host reported, or `null` |

`model: null` means the host was handed no model identity. It never means the
adapter chose one. ADR-0004 requires the limitation to be recorded rather than
filled in, because a substituted identity is indistinguishable from an observed
one once it reaches an event.

## Contract negotiation

`adapter-message.v1` pins `hostContract` to a constant. A host speaking a
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

## Relaying a decision

The response payload is a universal result. An adapter publishes it; it does
not recompute the exit code, restate the reason, or convert a refusal into a
success. The conformance suite drives every exit class through `relay` and
checks the verdict survives.

## The conformance suite

`describeHostAdapterContract(label, factory)` follows the same shape as the
port contracts already in this repository: one suite, run against every
implementation, so a host that quietly diverges fails there rather than in
production. A minimal fake adapter passes it today, which is what lets the
suite exist before either real host does.

`ADP-02` and `ADP-03` add Claude Code and Codex by passing this suite, not by
branching the core.

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
