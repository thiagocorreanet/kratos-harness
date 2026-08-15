# Host operation messages

Issue [#113](https://github.com/thiagocorreanet/mestre-yoda/issues/113)
defines the lifecycle messages a host and runtime exchange around one
operation.

## Envelope

Every message fixes:

- `messageId`, for duplicate detection;
- `correlationId`, for one host conversation;
- `operationId`, for one runtime operation;
- `sequence`, starting at zero and increasing by one;
- `occurredAt`, supplied by the host boundary;
- `hostContract`, negotiated before schema validation.

Unknown fields are refused by the v1 schema. Unsupported host contract versions
use the existing host-version refusal before structural validation.

## Message families

| Kind | Required capability | Purpose |
| --- | --- | --- |
| `approval` | `interaction.approval` | Bind an explicit decision to one artifact digest and challenge |
| `hook` | `lifecycle.hook` | Report a digest-pinned before/after host hook |
| `timeout` | `lifecycle.timeout` | Report a deadline and the exact mutation state reached |
| `cancellation` | `lifecycle.cancellation` | Report who cancelled, why, and the mutation state |
| `error` | `lifecycle.error` | Report a reason, recovery, retry policy, and mutation state |

Missing capabilities are reported. They never authorize the runtime to skip a
gate or silently emulate host behaviour.

## Delivery ordering

The first message has sequence zero. A delivery is accepted only when its
sequence is exactly one greater than the accepted cursor. Repeating a seen
`messageId` returns the existing cursor without mutation. A gap, stale message,
changed correlation, or changed operation is rejected without mutation.

## Partial mutation rule

Mutation state is one of `none`, `prepared`, `publishing`, or `committed`.
`prepared` and `publishing` require a project-relative `transactionRef`.
`none` requires a null reference. This makes interruption evidence explicit
and gives the runtime one safe recovery target.
