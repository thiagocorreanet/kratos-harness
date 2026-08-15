# Concepts and architecture

## Deterministic core

Host integrations may collect context and render guidance, but they do not own
policy. Pure domain decisions receive explicit observations, return a result
and an effect plan, and never read the clock, Git, or filesystem directly.

## Project state

The project owns `.brain/`, including configuration, active feature state,
events, evidence references, approvals, migration receipts, and recovery
records. The installed plugin owns the executable runtime, schemas, templates,
and host adapters. Runtime code is never copied into a project.

## Trail

A normal trail progresses through PRD, specification, plan, code, review, and
acceptance. Every proposed, refused, or accepted transition is correlated and
replayable. Retries with the same correlation are idempotent.

## Gates and evidence

Gates have stable identifiers, precedence, reason codes, evidence references,
and recovery instructions. Approvals bind exact content digests; modifying the
objective, specification, policy, or bound artifact makes an old approval
stale. Evidence records a digest and classification, not an unreviewed copy of
sensitive content.

## Optional extensions

Risk profiles, dual judges, a team Control Tower, and signed attestations live
behind the experimental extension boundary. They can add evidence or rigor but
cannot weaken deterministic organization policy or mutate local state.
