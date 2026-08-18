# Gates, approvals, and evidence

Gate evaluators are pure functions. They receive a closed context and perform
no filesystem, clock, Git, process, or network I/O. Failures are aggregated in
stable priority order. `shadow` records findings while passing, `warn` reports
findings without blocking, and `enforce` blocks.

## Gap facts

`gates.json` under the run directory carries the facts the gates read:
`openGaps`, `stopLoss.tripped`, `stopLoss.exhausted`, `partitionRequired`, and
`partitionApproved`. It is published as `state.gates@1.0.0`. A missing file
means nothing has been recorded yet and yields the declared defaults: no open
gaps, no tripped budget, no partition to approve. A file that cannot be read as
its contract, or whose count disagrees with the identifiers it lists, fails
closed as unreadable context rather than reading as zero open gaps.

Only the runtime writes it. `kratos gaps record` receives a proposal validated
against `host.gap-proposal@1.0.0`, writes one `state.gap@1.0.0` record per new
gap, appends one event, and derives `gates.json` from the resulting record set.
`kratos gaps resolve` and `kratos gaps waive` answer a recorded gap and derive
the facts again. `kratos gates record` records the host-observed stop-loss and
partition facts. The model proposes, the command receives, and the gate
decides.

A gap is one of four things and nothing else: a rule that admits two readings
which produce different code, a decision only the owner can make, a
contradiction between two passages of the documents, or an external dependency
nobody has confirmed. The schema closes that set, so a fifth kind is refused at
validation with the contract, pointer, and keyword that rejected it. Every gap
carries a description, a recommendation, the reasoning behind it, and a weight
of high, medium, or low; the weight says where the argument is worth having.

Detection is confined to the `prd` and `spec` phases and stops at
specification approval. After approval the derived count is zero by
construction and the records stay on disk, so a gap raised late is visible in
history without stopping a run whose remaining questions are technical.

An owner answers a gap as accepted, adjusted, or rejected, and records
separately whether a document actually changed as a result. An owner may also
proceed over a gap nobody answered; the waiver is recorded, the gap stops
blocking, and it stays on record as unanswered.

The rollout axis is the existing `GateMode`. Under `enforce` an open gap blocks
with `gate.gaps_abertos`. Under `warn` and `shadow` the same gap is recorded,
reported by `kratos handoff` and `kratos doctor`, and the run continues. The
project configuration selects `enforce` with `policyMode: "strict"` and `warn`
otherwise; `shadow` is available to the evaluator for staged rollout.

An approval binds the run, gate, PRD digest, specification digest, policy
version, approver, decision, observation, challenge, decision time, and expiry.
The challenge is the SHA-256 digest of canonical binding data. A changed
artifact, expired approval, repeated approval identifier, or altered challenge
cannot authorize the current operation.

Evidence metadata binds a project-relative reference to its content digest,
classification, and redaction policy. Restricted evidence cannot be declared
unredacted. Handoff manifests sort their evidence and hash the complete
manifest, so input order cannot change the package.

`kratos handoff` is a read-only operational view. It renders the active feature
and objective digest, run state, current phase, gate outcome, blockers, and next
host action without copying user-authored objective text into a public stream.

Final acceptance requires complete steps, no gate failures, a valid
`final-acceptance` approval, verified evidence, and artifact lineage bound to
the same run and policy.
