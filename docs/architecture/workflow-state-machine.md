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
