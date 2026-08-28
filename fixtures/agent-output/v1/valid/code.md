# Valid Code Reply

Implemented only step-window. The three mapped tests pass; completion remains for the evaluator to judge.

===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "code",
  "outcome": {
    "status": "completed",
    "next": "proceed",
    "questions": [],
    "blockers": []
  },
  "artifacts": [],
  "changedFiles": [
    { "ref": "src/refunds/window.ts", "change": "modified" },
    { "ref": "tests/refund-window.test.ts", "change": "added" }
  ],
  "payload": {
    "stepId": "step-window",
    "testsAdded": 3,
    "testsPassed": true
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===
