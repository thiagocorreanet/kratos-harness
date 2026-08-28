# Invalid Code Reply

This code reply reports an impossible negative test count.

===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "code",
  "outcome": { "status": "completed", "next": "proceed", "questions": [], "blockers": [] },
  "artifacts": [],
  "changedFiles": [{ "ref": "src/refunds/window.ts", "change": "modified" }],
  "payload": { "stepId": "step-window", "testsAdded": -1, "testsPassed": true }
}
===END-KRATOS-AGENT-OUTPUT-V1===
