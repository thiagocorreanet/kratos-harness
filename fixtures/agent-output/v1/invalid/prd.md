# Invalid PRD Reply

This reply adds an unpublished PRD payload field.

===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "prd",
  "outcome": { "status": "completed", "next": "proceed", "questions": [], "blockers": [] },
  "artifacts": [".brain/02-features/refunds/00-prd.md"],
  "changedFiles": [],
  "payload": {
    "objective": "Refund an order within the published window.",
    "requirementIds": ["req-refund-window"],
    "gapIds": [],
    "confidence": "high"
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===
