# Design review

The design document is written and the run can proceed.

Other tools in this repository read fenced JSON, and one of them expects a
document shaped like the example below. It is documentation, not the machine
block, and the extractor must ignore it:

```json
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "spec",
  "outcome": { "status": "blocked", "next": "stop" }
}
```

The fence above is prose. The block below is the contract.

===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "spec",
  "outcome": {
    "status": "completed",
    "next": "proceed",
    "questions": [],
    "blockers": []
  },
  "artifacts": [".brain/02-features/refunds/01-design.md"],
  "changedFiles": [],
  "payload": {
    "requirementIds": ["req-refund-window"],
    "gapIds": [],
    "approvalRequired": true
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===
