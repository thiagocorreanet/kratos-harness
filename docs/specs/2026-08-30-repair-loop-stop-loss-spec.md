# Objective Spec: Repair Loop Stop-Loss

Date: 2026-08-30
Status: APPROVED
Design: `docs/superpowers/specs/2026-08-30-repair-loop-stop-loss-design.md`
Issue: #141 (`SDD-16`)

## 1. Problem and desired outcome

Kratos has a token-budget stop-loss but no limit on repeated acceptance
rejections. A run must stop after a declared number of failures of the same
acceptance criterion and explain whether code or specification is defective.

## 2. In scope and non-goals

In scope are a per-criterion attempt ceiling with default 3, event-sourced
attempt replay, judge classification and diagnosis, explicit human resolution,
specification restart through a fresh approval run, a declarable run-frozen
token ceiling, stable reason codes, host parity, migration, documentation, and
evidence.

Review finding attempts, token measurement, automatic fault classification,
and host-owned routing policy are non-goals.

## 3. Acceptance criteria

- [ ] A failed `AC-*` below its ceiling advances its counter and returns the
  run to `code`.
- [ ] A failed `AC-*` at its ceiling blocks the run and records its identifier,
  classification, and diagnosis.
- [ ] Every simultaneously tripping criterion is represented in document
  order.
- [ ] Plain resume, accepted outcomes, and repeated commands do not reset
  attempts.
- [ ] Code resolution resets only the selected criterion and specification
  resolution starts a new run at `spec` with new approval authority.
- [ ] Event replay reconstructs identical attempts and active stops, including
  mixed `workflow-v1/v2` history.
- [ ] Missing project configuration resolves to ceiling 3 rather than
  unbounded behavior.
- [ ] The objective token ceiling is frozen per run and produces a stop reason
  distinguishable from repeated rejection.
- [ ] Claude Code and Codex relay equivalent inputs and results.
- [ ] Public behavior, migration, compatibility, state, and security impact are
  documented with no placeholder text.

## 4. Test matrix and verification commands

- Contracts and migration: schema acceptance/rejection, predecessor byte
  freezing, generated types, reason-catalog additivity, `1.3.0 -> 1.4.0`.
- Domain: attempts 1/2/3, custom ceiling, simultaneous trips, missing faults,
  selective reset, spec restart, pass/resume invariants, token independence.
- Integration: atomic verdict/event persistence, replay, corruption,
  idempotency, handoff, both host adapters.
- Verification: focused Vitest suites, `npm run contracts:check`,
  `npm run result:check`, and `npm run verify` under npm 11.16.0.

## 5. Compatibility and risk

Old schema bytes and event records remain immutable. Existing project
configuration moves through explicit migration. The safety impact is positive:
bounded repair loops and explicit release replace silent retry. Diagnoses are
bounded typed local state and are referenced by digest from event metadata.
