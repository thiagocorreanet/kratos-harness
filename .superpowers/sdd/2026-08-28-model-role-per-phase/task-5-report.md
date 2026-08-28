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
