Two owner decisions block the design. No specification file was written.

===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "spec",
  "outcome": {
    "status": "awaiting-input",
    "next": "wait",
    "questions": [
      {
        "questionId": "q-refund-window",
        "prompt": "Which refund window should the design implement?",
        "kind": "single-choice",
        "options": [
          { "optionId": "days-14", "label": "Fourteen days from delivery" },
          { "optionId": "days-30", "label": "Thirty days from delivery" }
        ]
      },
      {
        "questionId": "q-refund-owner",
        "prompt": "Who owns the refund ledger after this change?",
        "kind": "free-text",
        "options": []
      }
    ],
    "blockers": []
  },
  "artifacts": [],
  "changedFiles": [],
  "payload": {
    "requirementIds": ["req-refund-window"],
    "gapIds": ["gap-refund-window"],
    "approvalRequired": true
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===
