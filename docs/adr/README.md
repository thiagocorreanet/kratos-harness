# Architecture Decision Records

Architecture Decision Records preserve the context, selected choice,
consequences, and rejected alternatives for structural Mestre Yoda decisions.
The canonical architecture specification defines the whole system; these records
explain why its foundational boundaries exist.

## Accepted decisions

- [ADR 0001: Event-Sourced Project History](0001-event-sourced-project-history.md)
  makes the append-only event stream authoritative and snapshots derived.
- [ADR 0002: Embedded Self-Contained ESM Runtime](0002-embedded-esm-runtime.md)
  binds TypeScript development to a single plugin-owned JavaScript artifact.
- [ADR 0003: Project-Local Brain State](0003-project-local-brain-state.md)
  places project memory in `.brain/` and defines the legacy migration boundary.
- [ADR 0004: Host-Neutral Core and Thin Adapters](0004-host-adapter-boundary.md)
  keeps Claude Code and Codex integration outside deterministic workflow policy.

## Lifecycle

Accepted ADRs are immutable historical records. A changed structural decision
adds a new ADR that supersedes the old one, and both records link to each other.
Implementation pull requests that change a structural boundary cite the
governing ADR and explain compatibility, state, migration, and security impact.

