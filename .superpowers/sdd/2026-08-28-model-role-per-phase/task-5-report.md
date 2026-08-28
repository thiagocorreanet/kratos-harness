# Task 5 Report: Resolve and digest-bind read-only handoffs

## Status

Completed. `handoff` now resolves the current phase's configured model role,
binds it to the exact configuration bytes and workflow revision, and remains
read-only for both success and refusal paths.

## Delivered

- Configuration `1.0.0` now yields `model.config_migration_required`; only
  current `1.1.0` configuration is executable for role-aware handoffs.
- Workflow observation maps `KRATOS_HOST` launchers (`claude-code`/`codex`) to
  canonical configuration hosts, reads the current catalog, resolves aliases,
  validates effort and implementer/judge independence, and emits bounded,
  stable refusal subjects.
- `PhaseHandoffV1_1` carries the pre-existing feature/run/phase/gate
  orientation plus canonical assignment and an SHA-256 assignment digest over
  configuration bytes, run id, revision, host, and all assignment fields.
- `--json` emits schema-validated `host.phase-handoff@1.1.0`; human output is
  rendered from that same validated payload. Adapter-message remains an
  always-JSON relay.
- Partial role maps remain schema-readable so the runtime can report the
  required missing role rather than hiding it as generic config corruption.

## TDD evidence

The first configuration migration test failed because v1 config was still
accepted. The new handoff suite then failed because the command still emitted
legacy orientation prose and did not resolve config/catalog facts. Both were
made green with the minimum composition and contract work.

Verification passed:

```text
npm test -- tests/model-role-workflow.test.ts tests/cli-composition.test.ts tests/project-configuration.test.ts tests/result-contract-rendering.test.ts
Test Files 4 passed
Tests 90 passed

npm run contracts:check
contract families v1.0.0: verified (33 schemas; 14 legacy profiles; generated types current)

npm run lint -- --quiet
exit 0

npm run typecheck
exit 0
```

## Self-review

- No fallback model, effort, host, or prompt policy was introduced.
- Handoff success and every covered refusal assert unchanged durable snapshots.
- Assignment identity uses canonical catalog resolution; configured aliases are
  never used as security identity.

## Fix round 1/5

### RED

Added controlled integration reproductions for a configuration replacement
between inspection and read, deletion during catalog resolution, missing
planner roles in code/review/acceptance, a bad judge dependency while the PRD
phase selects planner, absent and unsupported launcher identities, and a
phase/revision change while resolving a handoff. The first RED run failed all
eight new assertions: late phases accepted a missing planner, dependency diagnostics
named planner, launcher diagnostics were non-actionable, the digest used stale
inspection metadata, and deletion/phase-revision drift still published a
handoff.

### GREEN

- Handoff now hashes the exact configuration text it parses and resolves, then
  re-reads it before publishing; deletion returns `guard.config_missing` and
  changed bytes return `model.assignment_stale`.
- The resolver validates planner, implementer, and judge in the stable
  `MODEL_ROLES` order for every handoff and returns the exact `{ host, role }`
  refusal subject.
- Missing and unsupported launchers use bounded diagnostics that name only the
  accepted identities (`claude-code`, `codex`).
- The run is replayed immediately before payload publication; phase or revision
  drift returns `model.assignment_stale`. All handoff paths remain read-only.

Verification passed:

```text
npm test -- tests/model-role-workflow.test.ts tests/cli-composition.test.ts tests/project-configuration.test.ts tests/result-contract-rendering.test.ts tests/model-role-resolution.test.ts tests/workflow-state-machine.test.ts tests/event-store-transaction.test.ts
Test Files 7 passed
Tests 154 passed

npm run contracts:check
contract families v1.0.0: verified (33 schemas; 14 legacy profiles; generated types current)

npm run lint -- --quiet
exit 0

npm run typecheck
exit 0
```
