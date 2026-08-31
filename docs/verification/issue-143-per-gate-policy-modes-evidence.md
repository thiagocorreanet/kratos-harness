# Issue #143 per-gate policy mode evidence

## Impact

- Compatibility: legacy policy defaults resolve identically after explicit
  migration; prior events remain readable and byte-preserved.
- State: project configuration advances to 1.4.0 and new events to 1.2.0; no
  historical event is rewritten. The host contract remains 1.3.0.
- Security: unreadable policy remains fail-closed, approval challenges bind the
  authorized gate's effective mode, and hosts gain no policy authority. The
  resolver and evaluator remain pure and receive no host, filesystem, Git,
  clock, process, or network capability.

## Acceptance evidence

| Criterion | Test evidence |
| --- | --- |
| Shadow records while enforce blocks in the same evaluation | `gate-policy-modes`, `workflow-state-machine` |
| Primary selected from the deciding outcome | `gate-policy-modes` mixed-primary case |
| Equal-outcome ordering is unchanged | `gate-policy-modes` stable-order case |
| Every recorded failure carries its mode | `event-gate-failures`, `workflow-state-machine` |
| Legacy global configuration preserves behavior | `config-migration`, canonical decision comparison |
| Evaluator remains pure | `architecture`, included in the full unit and coverage suites |

## Verification

- `npx vitest run tests/gate-policy-modes.test.ts tests/gates-approvals-evidence.test.ts tests/project-configuration.test.ts tests/config-migration.test.ts tests/contract-compatibility.test.ts tests/contract-schemas.test.ts tests/event-gate-failures.test.ts tests/event-sealing.test.ts tests/event-chain.test.ts tests/workflow-state-machine.test.ts tests/gate-facts.test.ts tests/gap-records.test.ts tests/acceptance.test.ts tests/observability.test.ts tests/host-adapter-contract.test.ts tests/contract-documentation.test.ts`
  — PASS: 16 files and 446 tests in 11.82 seconds.
- `npm run verify` — PASS with exit 0: 197 files and 4,877 unit tests passed in
  406.62 seconds; 197 files and 4,877 coverage tests passed in 1,051.48 seconds.
  Coverage reported 93.28% statements, 88.59% branches, 95.68% functions, and
  94.05% lines. The remaining formatting, spelling, English, lint, typecheck,
  mutation (4/4, 100%), gap calibration, performance, oracle, parity, result
  contract, contract generation, differential, build, package verification,
  and benchmark stages all passed.

Remote CI has not been claimed or observed.
