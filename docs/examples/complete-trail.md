# Complete trail example

This example is illustrative until the package is built; paths and identifiers
must match the selected project.

```sh
kratos init --host codex --root .
kratos objective "Add invoice approval with an auditable decision"
kratos start --run-id invoice-approval --host codex --correlation-id start-1
kratos status --json
```

If `continue` returns `gate.aprovacao_spec`, inspect the generated PRD and
specification digests. Record the decision for that exact content:

```sh
kratos approve spec --approver human:owner --observation "Reviewed exact PRD and specification digests"
kratos continue --complete --artifact ./spec.md --expected-revision 1
```

After implementation, record the test evidence and advance:

```sh
kratos evidence record tests-1 ./test-results.json --kind test --classification internal --redaction none
kratos continue --complete --artifact ./change-summary.md --evidence tests-1 --expected-revision 2
kratos audit
```

If evidence changes after recording, completion returns an evidence mismatch.
Review the new bytes, record a new evidence item, and retry with the current
revision. Do not edit the event log or reuse the stale approval.

Final completion requires the active run's acceptance approval, required
evidence, and exact artifact references:

```sh
kratos done --artifact ./final-summary.md --evidence tests-1 --expected-revision 5
kratos evidence bundle --output .brain/exports/invoice-approval.json
kratos dashboard --output .brain/exports/invoice-approval.html
```
