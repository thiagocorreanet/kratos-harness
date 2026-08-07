# ADR 0004: Host-Neutral Core and Thin Adapters

Status: Accepted

Date: 2026-08-06

## Context

Claude Code and OpenAI Codex expose different invocation, instruction,
capability, hook, and model-observation surfaces. Encoding those differences in
the state machine would create host-specific workflow semantics. Reducing the
core to the weakest host would also discard useful enforcement where a stronger
host surface exists.

Mestre Yoda must provide the same deterministic decisions on both hosts while
reporting capability differences honestly.

## Decision

The decision engine, reducers, contracts, state services, and result semantics
are host-neutral. Claude Code and Codex integrate through thin adapters that
translate invocation, capability discovery, observed identity, and response
rendering. Adapters never own transition policy and never mutate canonical state
directly.

Both adapters must pass one shared conformance suite. A future host is added by
implementing the same versioned adapter protocol rather than branching the core.

Host capabilities are normalized as explicit data. A missing preventive hook
does not remove the runtime's authoritative completion checks. When a host
cannot provide trustworthy observed identity or another optional signal, the
result and event record the limitation instead of substituting configured or
model-reported identity.

## Consequences

- Shared scenarios produce equivalent decisions and reason codes across hosts.
- Host-specific wiring remains small, reviewable, and replaceable.
- Capability gaps are visible and testable without weakening common policy.
- Shared conformance tests are necessary but insufficient; each adapter also
  needs real host contract and end-to-end tests.
- New host support requires protocol compatibility rather than core forks.
- Adapter and runtime versions must be bound by the plugin manifest.

## Alternatives rejected

- **Separate runtimes per host:** invites divergent policy and duplicated fixes.
- **Put host branching throughout the core:** obscures deterministic behavior
  and makes conformance difficult to prove.
- **Restrict all hosts to the weakest capability set:** sacrifices preventive
  controls without improving the authoritative runtime checks.
