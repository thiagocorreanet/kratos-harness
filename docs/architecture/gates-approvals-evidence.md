# Gates, approvals, and evidence

Gate evaluators are pure functions. They receive a closed context and perform
no filesystem, clock, Git, process, or network I/O. Failures are aggregated in
stable priority order. `shadow` records findings while passing, `warn` reports
findings without blocking, and `enforce` blocks.

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
