# Workflow state machine

Kratos owns a single event-sourced run for the active feature. Hosts can ask
for operations; they cannot select a phase or write run state directly.

The ordered phases are `prd`, `spec`, `plan`, `code`, `review`, and
`acceptance`. `kratos start` creates the first event or resumes the exact active
run. `kratos continue` recomputes a proposal from the persisted revision and
records one accepted, rejected, resumed, or terminal transition.

Every request carries a correlation identifier. The event history stores that
operation identifier, so duplicate delivery is a no-op. A stale expected
revision, different feature, different run, missing evidence, or failed gate is
refused or recorded as a recoverable rejection without applying the proposed
phase change.

The public snapshot remains the compact `state.snapshot` contract. Replay state
also retains processed operation identifiers, which are an implementation
detail used for idempotency. The event stream and snapshot are written by one
managed transaction and remain protected by revision fingerprints and the run
lease boundary.

## Run lineage

A run records the PRD and design digests it observed when `run.started` was
sealed. That pair is the reducer seed, and every later command replays from the
pair the run committed rather than from whatever the working tree holds now.

The distinction matters because writing `00-prd.md` and `01-design.md` is the
work the `prd` and `spec` phases exist to do. A seed re-read from disk changes
the moment a phase succeeds, so replay stops reproducing the committed snapshot
and the append refuses as corrupt before it can write the correction — a
deadlock rather than a transient condition, and the happy path of the workflow
would be the thing that triggers it.

What the working tree holds now is observed separately and is what gates,
approvals, and artifact lineage bind to. A PRD that changes invalidates the
approvals bound to its old digest; it does not invalidate the run's history.

One consequence is deliberate: replay cannot re-derive `lineage` from the event
chain, so `audit` and `repair` compare every other snapshot field against replay
and take this one as recorded. Binding lineage to the chain instead would mean a
`state.event` contract change, which the frozen persisted contract does not
allow at version 1.0.0.

## Command flow

1. `kratos objective` records the active demand.
2. `kratos start` verifies the objective and Git preconditions.
3. `kratos continue` resumes or proposes phase completion.
4. Gates evaluate deterministic observed facts in stable precedence order.
5. Artifacts, evidence, lineage, and approvals bind the accepted transition.
6. `kratos done` completes only final acceptance.

No command bypasses the reducer by editing `state.json`.

## Acceptance repair stop-loss

`workflow-v2` freezes two resolved limits in its start event: the per-criterion
acceptance attempt ceiling and the optional objective token ceiling. An omitted
`acceptanceAttemptCeiling` resolves to `3` for that run. The objective's current
`objective.budget.tokens` value selects the ceiling only when an ordinary or
specification-restart run begins. Hooks, diagnostics, gap facts, and every other
current-run projection use the replayed `tokenCeiling`, even if objective state
is later added, removed, raised, or lowered. Measuring tokens is outside this
workflow decision and belongs to the existing usage pipeline.

Rejected acceptance criteria advance independently in task-document order. A
criterion below its ceiling yields the recorded `repair` decision and returns
the same run to `code`. A criterion reaching its ceiling yields
`run.stop_loss.repeated_rejection`, creates an immutable repair-stop artifact,
and blocks the run. Every simultaneous stop is retained in document order. The
agent output must provide exactly one `code` or `specification` classification
and bounded diagnosis for each newly stopping criterion; incomplete or
unexpected fault input is refused before an event is written.

The event contains ordered attempt facts, classification, and digest-bound
artifact references, not diagnoses. Replay reconstructs attempts and active
stops from the event stream, then validates the immutable artifact bytes. A
mixed `workflow-v1`/`workflow-v2` event stream is accepted only after an
explicit `state.event@1.4.0` `run.policy_upgraded` boundary freezes both chosen
limits. The legacy prefix contributes empty attempt and recovery state; replay
never infers limits from mutable configuration or objective state. A v2
continuation without the boundary fails closed. Accepted verdicts and duplicate
operations preserve attempts. Ordinary resume, phase completion, and phase
advance are refused whenever an active repair stop or specification restart is
present, independently of caller-supplied gate facts; forged equivalents fail
replay.

`repair resolve` is the only repair-loop release path. A persisted `code`
classification selectively clears its own criterion and leaves the run blocked
until all active code stops are resolved; the run then returns to `code`. A
`specification` stop cannot be resolved while any code stop remains, which
prevents a source run from stranding code recovery after the active-run pointer
moves. Once code stops are cleared, specification resolution writes a
digest-bound restart ticket on the source run and starts a separate run at
`spec`. The old run remains blocked, the new run needs a new specification
approval and its own frozen limits, and all affected source AC identifiers are
retired.

Observation revalidates the stop, resolution, and restart schemas and exact
digests; their source and target bindings; ordered retired identifiers; and the
successor stream, snapshot, and cross-links. Missing or changed artifacts and
missing or divergent successors make the source run corrupt. A duplicate
correlation is unchanged only when the original criterion, classification,
target run, human observation, and recovery bindings match exactly; a divergent
retry is a revision conflict.
