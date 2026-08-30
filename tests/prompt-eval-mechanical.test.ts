import { describe, expect, it } from "vitest";
import { evaluateMechanicalRule } from "@kratos/runtime/domain/prompt-eval";

describe("mechanical assertion evaluator", () => {
  const validCodeReply = `Here is the explanation.
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
  "changedFiles": [{ "ref": "packages/runtime/src/domain/sample.ts", "change": "modified" }],
  "payload": {
    "stepId": "02-tasks:step-1",
    "testsAdded": 1,
    "testsPassed": true
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===`;

  const validReviewReply = `Review report.
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
  "artifacts": [".brain/02-features/f1/03-summa.md"],
  "changedFiles": [],
  "payload": {
    "verdict": "pass",
    "findings": []
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===`;

  const validAcceptanceReply = `Acceptance report.
===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "acceptance",
  "outcome": {
    "status": "completed",
    "next": "finish",
    "questions": [],
    "blockers": []
  },
  "artifacts": [],
  "changedFiles": [],
  "payload": {
    "verdict": "accepted",
    "criteria": [
      {
        "criterionId": "AC-1.1.1",
        "outcome": "passed",
        "evidenceRef": ".brain/02-features/f1/runs/run-01/evidence/tests.json"
      }
    ]
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===`;

  const awaitingInputReply = `Questions.
===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "prd",
  "outcome": {
    "status": "awaiting-input",
    "next": "wait",
    "questions": [
      {
        "questionId": "Q-01",
        "prompt": "Which format?",
        "kind": "single-choice",
        "options": [{ "optionId": "A", "label": "JSON" }, { "optionId": "B", "label": "YAML" }]
      }
    ],
    "blockers": []
  },
  "artifacts": [],
  "changedFiles": [],
  "payload": {
    "objective": "Design doc",
    "requirementIds": ["R-1"],
    "gapIds": []
  }
}
===END-KRATOS-AGENT-OUTPUT-V1===`;

  it("evaluates schema_valid and coherence_valid", () => {
    expect(
      evaluateMechanicalRule(validCodeReply, { type: "schema_valid" }),
    ).toEqual({ passed: true });
    expect(
      evaluateMechanicalRule(validCodeReply, { type: "coherence_valid" }),
    ).toEqual({ passed: true });
    expect(
      evaluateMechanicalRule("No block here", { type: "schema_valid" }).passed,
    ).toBe(false);
    expect(
      evaluateMechanicalRule(
        '===KRATOS-AGENT-OUTPUT-V1===\n{"invalid": 123}\n===END-KRATOS-AGENT-OUTPUT-V1===',
        { type: "schema_valid" },
      ).passed,
    ).toBe(false);
  });

  it("evaluates agent, status, and routing hint matches", () => {
    expect(
      evaluateMechanicalRule(validCodeReply, {
        type: "agent_equals",
        expected: "code",
      }),
    ).toEqual({
      passed: true,
    });
    expect(
      evaluateMechanicalRule(validCodeReply, {
        type: "agent_equals",
        expected: "spec",
      }).passed,
    ).toBe(false);
    expect(
      evaluateMechanicalRule(validCodeReply, {
        type: "status_equals",
        expected: "completed",
      }),
    ).toEqual({
      passed: true,
    });
    expect(
      evaluateMechanicalRule(validCodeReply, {
        type: "routing_hint_equals",
        expected: "proceed",
      }),
    ).toEqual({
      passed: true,
    });
  });

  it("evaluates scope bounds, artifacts, and changedFiles", () => {
    expect(
      evaluateMechanicalRule(validCodeReply, {
        type: "scope_bounded",
        allowedPrefixes: ["packages/runtime/"],
      }),
    ).toEqual({ passed: true });
    expect(
      evaluateMechanicalRule(validCodeReply, {
        type: "scope_bounded",
        allowedPrefixes: ["packages/adapters/"],
      }).passed,
    ).toBe(false);
    expect(
      evaluateMechanicalRule(validCodeReply, { type: "artifacts_empty" }),
    ).toEqual({ passed: true });
    expect(
      evaluateMechanicalRule(validCodeReply, { type: "changed_files_empty" })
        .passed,
    ).toBe(false);
    expect(
      evaluateMechanicalRule(validCodeReply, { type: "no_blockers" }),
    ).toEqual({ passed: true });
  });

  it("evaluates artifacts_contains and question/blocker rules", () => {
    expect(
      evaluateMechanicalRule(validReviewReply, {
        type: "artifacts_contains",
        path: ".brain/02-features/f1/03-summa.md",
      }),
    ).toEqual({ passed: true });
    expect(
      evaluateMechanicalRule(validReviewReply, {
        type: "artifacts_contains",
        path: ".brain/02-features/f1/00-prd.md",
      }).passed,
    ).toBe(false);

    expect(
      evaluateMechanicalRule(awaitingInputReply, {
        type: "has_blocking_question",
      }),
    ).toEqual({ passed: true });
    expect(
      evaluateMechanicalRule(validCodeReply, { type: "has_blocking_question" })
        .passed,
    ).toBe(false);
  });

  it("evaluates verdict_equals for review and acceptance payloads", () => {
    expect(
      evaluateMechanicalRule(validReviewReply, {
        type: "verdict_equals",
        expected: "pass",
      }),
    ).toEqual({
      passed: true,
    });
    expect(
      evaluateMechanicalRule(validReviewReply, {
        type: "verdict_equals",
        expected: "fail",
      }).passed,
    ).toBe(false);
    expect(
      evaluateMechanicalRule(validAcceptanceReply, {
        type: "verdict_equals",
        expected: "accepted",
      }),
    ).toEqual({
      passed: true,
    });
    expect(
      evaluateMechanicalRule(validAcceptanceReply, {
        type: "verdict_equals",
        expected: "rejected",
      }).passed,
    ).toBe(false);
  });
});
