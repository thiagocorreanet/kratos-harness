# Task 5 report: bind lessons to implementation phases

## RED / GREEN

- RED: `npm test -- tests/memory-phase-binding.test.ts` initially failed because
  neither `host.phase-handoff@1.2.0` nor `host.agent-output@1.2.0` was selected
  by the embedded registry.
- GREEN: the same focused suite now passes four tests covering v1.2 selection,
  non-target null enforcement, empty and populated bindings, migration refusal,
  and projection drift.
- GREEN: `npm test -- tests/agent-output-recording.test.ts tests/model-role-workflow.test.ts`
  passed 55 tests after v1.2 record-envelope and acknowledgement wiring.
- GREEN: contract/schema, prompt, relay distribution, build, and package checks
  were re-run after generated type and formatter updates.

## Implementation

- Added immutable, closed `host.phase-handoff@1.2.0` and
  `host.agent-output@1.2.0` schemas. Both require `memory`; code/review require
  the exact Gotchas reference plus a SHA-256 and up to 24 unique confirmed
  lesson digests, while every other phase requires null.
- The runtime classifies legacy state, validates the ledger semantically and
  byte-validates the projection before producing code/review handoffs. It binds
  sorted confirmed lesson IDs and the exact projection digest.
- `agent record` compares a code/review acknowledgement with both its resolved
  assignment memory and a second current observation. Missing, mismatched, or
  stale context returns `memory.phase_context_stale` before recording.
- Implementer/evaluator prompts now explicitly read confirmed lessons and return
  the handoff acknowledgement. Both packaged relays continue to transport the
  runtime-owned handoff unchanged.
- Updated generated contract declarations, registry catalog/manifest capacity,
  JSON contract selection, and the stale runtime-distribution reason catalog
  expectation from 1.8.0 to 1.9.0.

## Self-review / risks

- Predecessor schemas were not changed; v1.2 is selected explicitly.
- Empty curated memory binds the stock deterministic projection with an empty
  lesson list. Legacy custom content and projection drift remain fail-closed.
- The acknowledgement is intentionally runtime-checked; prompts only instruct
  reading and returning it.
- Existing controller-ledger artifacts were not modified.
