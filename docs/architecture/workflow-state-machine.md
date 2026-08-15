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

## Command flow

1. `kratos objective` records the active demand.
2. `kratos start` verifies the objective and Git preconditions.
3. `kratos continue` resumes or proposes phase completion.
4. Gates evaluate deterministic observed facts in stable precedence order.
5. Artifacts, evidence, lineage, and approvals bind the accepted transition.
6. `kratos done` completes only final acceptance.

No command bypasses the reducer by editing `state.json`.
