Changes requested: `tests/refund-window.test.ts` does not cover the final eligible day, and `src/refunds/window.ts:41` excludes it.

===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "review",
  "outcome": {
    "status": "completed",
    "next": "proceed",
    "questions": [],
    "blockers": []
  },
  "artifacts": [],
  "changedFiles": [],
  "payload": {
    "verdict": "changes-requested",
    "findings": [
      {
        "findingId": "finding-window-boundary",
        "severity": "high",
        "summary": "The window comparison excludes the final day.",
        "ref": "src/refunds/window.ts:41"
      }
    ]
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===
