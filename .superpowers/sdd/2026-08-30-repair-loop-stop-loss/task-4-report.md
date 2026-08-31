# Task 4 Report: Explicit Repair Resolution and Specification Restart

Date: 2026-08-30

Base: `d0563dcede555a4f14b80a189703528658f16fe6`

## Outcome

Task 4 adds the explicit host-neutral `repair resolve` command and connects it
to sealed resolution artifacts, append-only events, replay, workflow reduction,
and one atomic managed transaction. A human identity and bounded written
observation are required. The runtime uses the classification already persisted
on the stop; it does not infer or reclassify the fault.

Code resolutions affect only the named acceptance criterion. They clear only
that criterion's attempt and stop, leave independent token limits unchanged,
and keep the run blocked until every active code stop is explicitly resolved.
The same run then returns to `code`.

A specification resolution never sends the historical run back to repair. It
records the resolution on that blocked run, writes a digest-bound restart
ticket, creates a new run at `spec`, freezes that run's own attempt and token
ceilings, and changes the active-run pointer in the same transaction. Every AC
identifier implicated by the source stop set is retired for the new plan. A
plan that reuses one is refused with the existing
`gate.ac_identifier_duplicate` policy, whose recovery text already forbids
reuse of a frozen identifier.

Plain `start`/`continue` resume paths do not resolve a stop or reset attempts.
Repeated resolution correlations are no-ops, including after a specification
restart changes the active-run pointer, because the source run remains
explicitly addressable with `--run`.

## Contract and compatibility ruling

The closed `state.event@1.2` schema was not changed. Its SHA-256 remains
`c91746a8b6ea23e23e76db4d070cc34ab70f3aec786c48b1046c89cfc1b612c6`,
identical to the required base. The closed manifest v1.5 was also not changed;
its SHA-256 remains
`7607416b9ea27fdf9b9eda65f399ba19c78bee0c740ea6905b8451a2c6381e76`.

Resolution and restart events use the additive `state.event@1.3` successor
(SHA-256
`4597757c6002b64fc79c09fd7ff1ab6c3f380e93dd1e7690c46615f84370c5a5`).
The new closed manifest v1.6 admits 48 schemas and preserves all 14 legacy
profiles. It adds event v1.3, `state.repair-resolution@1.0.0`, and
`state.repair-restart@1.0.0`. Existing producers continue to emit event v1.2;
only explicit resolution/restart operations emit v1.3.

No destructive event migration is required or permitted. The readable event
union and schema registry accept v1, v1.1, v1.2, and v1.3, and mixed-history
replay is the compatibility mechanism. Existing project-config migration
windows remain unchanged.

## TDD evidence

### Cycle 1: command route and human input

RED: `tests/repair-resolve-command.test.ts` failed 4/4 because the route and
required flags did not exist and malformed inputs could not resolve to the
command policy.

GREEN: the command, registry, exports, help surface, AC/run/human identifier
validation, and the bounded control-character-free note validation passed with
the adjacent command/help suites (24/24).

### Cycle 2: domain semantics and reducer/replay

RED: `tests/repair-resolution-reducer.test.ts` failed 4/4: there was no repair
resolution decision, plain resume recorded an event despite an active stop,
and specification restart/replay semantics were absent.

GREEN: selective code reset, multiple-stop blocking, same-run return to code,
immutable specification history, fresh spec start, frozen independent limits,
plain-resume refusal, and mixed replay passed with the workflow-v2 reducer and
replay suites (23/23).

### Cycle 3: artifacts and code-resolution composition

RED: `tests/repair-resolution-contracts.test.ts` failed 2/3 because resolution
and restart builders were missing. The first code-resolution E2E also exposed
that append preparation accepted only event v1.2 and that an idempotent result
must use a result reason with valid evidence policy.

GREEN: the artifact schemas/builders passed 3/3. The code E2E proved two
selective stops, invalid `--next-run` refusal for code, idempotent correlation,
and return of the same run to code only after both stops were resolved.

### Cycle 4: atomic multi-run append

RED: the new transaction test failed with `runtime.state_corrupt` at the
single-append guard.

GREEN: `applyPlan` now accepts multiple event appends only when every append
targets a distinct feature/run pair and has an exact reducer binding. It
prepares and freshness-checks every stream, fences every events/state pair,
and publishes one managed transaction. The event-store transaction suite
passed 27/27, including rejection of mismatched reducer bindings before I/O.

### Cycle 5: specification restart and AC retirement

RED: the specification E2E returned exit 2 because composition handled only a
code resolution. After atomic restart was added, the retired-AC test still
completed the new plan with exit 0.

GREEN: one transaction now writes both artifacts, appends the source and fresh
run events, and updates the active pointer. The old run stays blocked, the new
run starts at spec with zero attempts, retry creates no files or events, and a
plan reusing a retired identifier is refused with exit 3 and no mutation.

### Broad-suite regression cycle

The first broad run completed 201 files / 4,905 tests with 16 failures in 7
files. Fifteen were successor inventory expectations. One implementation
regression evaluated malformed ordinary write destinations inside append-only
collision logic, changing `guard.outside_allow` into
`runtime.state_corrupt`. Missing-single-reducer evidence was also remapped too
broadly. The collision check now exits immediately when there is no append,
and missing reducer failures retain exact events/state evidence.

The second broad run completed 200/201 files and 4,923/4,924 tests; its only
failure was the exact v1 fixture inventory omitting the two new artifact
fixtures. After registering those fixtures, the final broad run passed all 201
files and all 4,924 tests.

## Files

- Command/domain: `packages/runtime/src/domain/cli/repair-resolve.ts`, command
  registry/exports/spec, workflow decisions/model/reducer, repair-loop artifact
  builders/model, and acceptance-criteria plan policy.
- Composition/transaction: CLI reducer routing, workflow observation and
  artifact preparation, event preparation, multi-run apply planning, and
  transaction precondition freezing.
- Event contracts: event model/redaction/sealing/semantics and the new
  `schemas/state/event.v1.3.schema.json`.
- Artifact contracts: `schemas/state/repair-resolution.v1.schema.json` and
  `schemas/state/repair-restart.v1.schema.json`.
- Compatibility: contract catalog/types/registry, closed manifest v1.6,
  contract-versioning references, fixtures, and exact schema inventories.
- Tests: command/help, resolution artifacts, reducer/replay, code and spec E2E,
  transaction atomicity/security, schema catalog/fixtures, and compatibility
  inventories.

## Verification

- Focused Task 4 plus broad-regression set: 19 files, 538 tests passed.
- `npx --yes npm@11.16.0 test`: 201 files, 4,924 tests passed in 298.93s.
- `npx --yes npm@11.16.0 run format:check`: passed.
- `npx --yes npm@11.16.0 run lint`: passed with zero warnings.
- `npx --yes npm@11.16.0 run typecheck`: passed.
- `npx --yes npm@11.16.0 run contracts:check`: passed; 48 schemas, 14 legacy
  profiles, generated types current.
- `npx --yes npm@11.16.0 run result:check`: passed; 76 reasons and exits
  0-5 verified.
- `npx --yes npm@11.16.0 run parity:check`: inventory passed; the published Go
  v3 behavioral baseline remains 0/400 and was not changed by this task.
- `git diff --check`: passed.

## Security, replay, and idempotency audit

- Human identity and note are explicit, locally validated, bounded, and
  persisted in a digest-bound resolution artifact. Control bytes, malformed
  identifiers, unsafe references, and inconsistent restart relationships are
  rejected.
- Classification authority remains the sealed repair stop. The command cannot
  select a different classification.
- Multi-run reducer authority is exact per feature/run, rejects proxies,
  accessors, exotic arrays/objects, duplicate destinations, missing bindings,
  and mismatched bindings before mutation.
- Both event streams and their snapshots are revision-fenced immediately
  before one atomic publication. The active pointer and artifact writes share
  the same transaction, so a partial specification restart is not published.
- Duplicate correlations produce no second artifact, ticket, event, counter
  reset, or active-pointer change.
- Mixed event versions replay to the same state as direct reduction. A token
  ceiling is never removed by rejection-stop resolution, and the new run
  freezes its own current objective/configuration limits.
- Source specification history remains blocked and addressable but cannot be
  resumed after restart. Retired criterion IDs cross the ticket/event boundary
  and are enforced when the new plan is frozen.

## Deviations and concerns

- The existing `gate.ac_identifier_duplicate` reason is reused for a retired
  identifier because its published recovery already says not to reuse a frozen
  identifier. No reason-catalog successor was necessary.
- Event history compatibility is additive replay rather than a rewrite
  migration. This is deliberate: rewriting signed/hash-chained predecessor
  events would violate the closed-version ruling.
- The parity command reports the repository's existing 0/400 behavioral
  baseline after successfully verifying the inventory. Task 4 does not claim
  Go-v3 behavioral parity.
- Public end-user documentation and issue-wide evidence remain Task 5 scope;
  this report records the Task 4 implementation and gates only.

## Correction round 1: cumulative AC retirement

Review found that a specification restart originally derived
`retiredCriterionIds` from the mutable `activeRepairStops` list. Resolving a
code stop first removed it from that list, so resolving the remaining
specification stop could omit the earlier tripped AC from the restart ticket and
event.

RED evidence:

- The mixed-stop E2E resolved the code AC first and the specification AC
  second. The fresh `startedFromSpec.retiredCriterionIds` contained only the
  remaining specification AC.
- The replay test resolved a code stop and showed that the resulting state had
  no immutable source-stop history after the active stop was cleared.

GREEN implementation:

- `WorkflowState.repairStopHistory` is internal reducer state derived solely
  from `run.stop_loss.repeated_rejection` events. It records every first-seen
  tripped stop in event order and is never removed or rewritten by resolution.
- Specification restart composition derives retired IDs from that cumulative
  replayed history rather than from the mutable active-stop projection.
- No event, artifact, or manifest schema changed. Old histories deterministically
  reconstruct the new internal projection from their existing stop events.
- The E2E now proves `code resolution -> specification resolution -> fresh spec
  run` retires both IDs. Its new task document reuses only the earlier
  code-resolved ID and is refused with exit 3 and no mutation.
- Replay proves the historical stop remains present after its active stop and
  attempt have been selectively cleared.

Correction verification:

- Focused mixed-stop E2E and replay RED commands each failed on the missing
  historical code-stop ID/history, then passed after the reducer change.
- Affected workflow, reducer, replay, state-machine, corruption, and narration
  set: 6 files, 54 tests passed.
- Full `npx --yes npm@11.16.0 test`: 201 files, 4,924 tests passed in 408.56s.
- Format, lint, typecheck, contracts, result, parity, and diff checks passed.
