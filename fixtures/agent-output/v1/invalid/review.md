# Invalid Review Reply

This review finding carries no evidence reference.

===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "review",
  "outcome": { "status": "completed", "next": "proceed", "questions": [], "blockers": [] },
  "artifacts": [],
  "changedFiles": [],
  "payload": {
    "verdict": "changes-requested",
    "findings": [
      {
        "findingId": "finding-window-boundary",
        "severity": "high",
        "summary": "The window comparison excludes the final day."
      }
    ]
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===
