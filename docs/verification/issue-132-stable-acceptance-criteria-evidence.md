# Issue #132 stable acceptance criterion evidence

Date: 2026-08-27

## Scope

This evidence closes
[issue #132](https://github.com/thiagocorreanet/kratos-harness/issues/132).
It gives each task-document acceptance criterion a canonical identifier,
freezes declarations when planning completes, records evidence-bound verdicts,
and exposes partial acceptance without changing `EventV1`.

## Acceptance evidence

| Identifier | Acceptance criterion | Evidence |
| --- | --- | --- |
| `AC-1.1.1` | Grammar and regular expression have one definition | `schemas/contracts/acceptance-criterion-id.v1.schema.json` owns the exact expression and length; `tests/acceptance-criterion-contracts.test.ts` proves matcher, schemas, generated declarations, and consumers use it. |
| `AC-1.1.2` | Duplicate identifiers are rejected by name | `tests/acceptance-criteria-parser.test.ts` asserts the closed `duplicate` observation includes `AC-01.2.3`; plan completion accepts no snapshot or transition from that observation. |
| `AC-1.1.3` | Malformed identifiers are rejected | Parser cases cover missing `E`, doubled `E`, a negative component, coordinate mismatch, absent ID, and excess length; `tests/workflow-run-lineage.test.ts` proves malformed planning exits with no snapshot or phase advance. |
| `AC-1.1.4` | A criterion without evidence cannot pass | `tests/acceptance-criteria-policy.test.ts` asserts `gate.ac_evidence_missing`; digest-invalid evidence has the distinct `gate.ac_evidence_invalid` policy. |
| `AC-1.1.5` | Post-freeze renumbering is refused | The snapshot policy tests renumber, removal, reorder, and declaration edit as `gate.ac_declaration_changed`. |
| `AC-1.1.6` | Post-freeze append is allowed and recorded | `tests/workflow-run-lineage.test.ts` appends `AC-1.1.E2` only in acceptance, asserts a successor snapshot with `previousSnapshotRef`, and finds its immutable verdict path in the event. |
| `AC-1.1.7` | The acceptance gate reports partial state | `tests/gates-approvals-evidence.test.ts` asserts ordered passed and failed states plus `gate.ac_incomplete`; `tests/acceptance.test.ts` requires every state to be passed, checked, and evidence-valid before done. |
| `AC-1.1.8` | Implementing phases cannot flip checkboxes | `tests/workflow-run-lineage.test.ts` changes `AC-1.1.1` during code, receives `gate.ac_checkbox_forbidden`, and proves no code-agent record is written. |

## Required test evidence

| Requirement | Evidence |
| --- | --- |
| Parser property coverage | Deterministic generated non-contiguous IDs, leading zeroes, 256-entry bound, fenced decoys, malformed forms, duplicates, CRLF preservation, and rendering idempotency in `tests/acceptance-criteria-parser.test.ts`. |
| Freeze and append | Pure prefix-policy cases in `tests/acceptance-criteria-policy.test.ts`; atomic plan snapshot and acceptance successor snapshot in `tests/workflow-run-lineage.test.ts`. |
| Checkbox authority | Pure expected-state comparison plus an integrated code-phase refusal with no agent-output artifact. |
| Replay identity | The integrated acceptance test reopens the settled run through `status` and compares the final event's AC-bearing `artifactRefs` byte-for-byte. |

## Verification commands

Focused verification:

```text
npm test -- --run tests/schema-registry-fixtures.test.ts tests/workflow-run-lineage.test.ts tests/acceptance-criterion-contracts.test.ts tests/acceptance-criteria-parser.test.ts tests/acceptance-criteria-policy.test.ts tests/gates-approvals-evidence.test.ts tests/acceptance.test.ts tests/agent-output-contract.test.ts tests/contract-reason-catalog.test.ts

Test Files  9 passed (9)
Tests       237 passed (237)
Exit code   0
```

Complete repository gate:

```text
npm run verify

Test Files  153 passed (153)
Tests       4069 passed (4069)
Statements  93.94%
Branches    89.76%
Functions   94.27%
Lines       94.22%
Mutation    3 / 3 (100.00%)
Package     passed for Codex and Claude Code
Exit code   0
```

The same gate passed formatting, spelling, English-only enforcement, lint,
type checking, gap calibration, performance budgets, oracle verification,
parity inventory validation, result and contract checks, differential
self-tests, build, package verification, and benchmarks.

## Impact

- **Compatibility:** The state and host identities remain `1.0.0`, and
  `EventV1` is byte-unchanged. Two additive persisted schemas and reason
  catalog `1.5.0` are published. Acceptance payload criterion IDs now use the
  canonical AC schema instead of the generic identifier definition.
- **State:** New runs freeze one immutable snapshot at accepted plan
  completion. Acceptance writes one immutable verdict per criterion and may
  append a successor snapshot. Legacy runs bootstrap only when current task
  bytes match the event-linked plan lineage digest exactly.
- **Security:** No host or model gains authority. The runtime validates IDs,
  history, evidence metadata and digests before mutation; code and review
  cannot mark acceptance checkboxes; all writes remain in the existing atomic
  transaction plan.
