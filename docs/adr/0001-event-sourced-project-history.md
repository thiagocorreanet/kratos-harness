# ADR 0001: Event-Sourced Project History

Status: Accepted

Date: 2026-08-06

## Context

Mestre Yoda must explain why a workflow advanced, stopped, or invalidated prior
approval. A mutable state file can describe the present but cannot prove how the
runtime reached it. Model-authored summaries are also insufficient because the
runtime, rather than the model, owns transition authority.

The project needs deterministic replay, content lineage, crash recovery, and
evidence that can be inspected without trusting conversational memory. It also
needs fast startup and human-readable status views.

## Decision

Each run owns an append-only, hash-linked event stream as its authoritative
history. A validated `state.json` snapshot accelerates startup but is derived
from the event cursor and hash. Markdown checkboxes, status pages, dashboards,
and summaries are regenerable views.

Every committed decision event records normalized inputs, contract and policy
versions, prior and resulting state identities, stable reason code, effect
summary, artifact digests, and observed host/model identity when available.
Events reference sensitive evidence by digest. The hash chain detects mutation;
it does not authenticate an author.

State changes and their events commit through one recoverable transaction. A
snapshot that does not match its event cursor and hash is rejected and may be
rebuilt only through an explicit audit or repair operation.

## Consequences

- Decisions can be replayed and audited independently of generated prose.
- Content-bound approvals and descendant invalidation have durable lineage.
- Snapshots remain fast without becoming a competing source of truth.
- Transaction, canonicalization, retention, and migration rules become public
  compatibility concerns and require dedicated tests.
- Corruption cannot be repaired silently; recovery must preserve the rejected
  evidence and report what changed.
- The hash chain provides integrity evidence only. Signed identity and remote
  attestations remain a separate post-1.0 decision.

## Alternatives rejected

- **Mutable state only:** fast, but unable to explain or replay history.
- **Git history as the event store:** excludes uncommitted runtime operations and
  makes workflow correctness depend on user commit behavior.
- **A remote event service:** conflicts with local-first, offline operation and
  introduces privacy, availability, and tenancy requirements before beta.

