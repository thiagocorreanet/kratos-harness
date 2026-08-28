# Valid PRD Reply

The requirements are grounded in the observed refund-window problem. The PRD contains no design or implementation decisions.

===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "prd",
  "outcome": {
    "status": "completed",
    "next": "proceed",
    "questions": [],
    "blockers": []
  },
  "artifacts": [".brain/02-features/refunds/00-prd.md"],
  "changedFiles": [],
  "payload": {
    "objective": "Refund an order within the published window.",
    "requirementIds": ["req-refund-window", "req-refund-audit"],
    "gapIds": []
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===
