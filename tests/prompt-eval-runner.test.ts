import { describe, expect, it } from "vitest";
import {
  runPromptEvaluationCase,
  type DeterministicReplayProvider,
  type PromptEvaluationCase,
} from "@kratos/runtime/domain/prompt-eval";

describe("prompt evaluation dual-run runner", () => {
  const sampleCase: PromptEvaluationCase = {
    id: "sample-code-eval",
    description: "Evaluates code implementer output",
    promptId: "code-implementer",
    input: {
      context: "Implement step 1",
    },
    assertions: [
      {
        id: "assert-schema",
        description: "Valid machine block",
        kind: "mechanical",
        mechanicalRule: { type: "schema_valid" },
      },
      {
        id: "assert-code-agent",
        description: "Agent is code",
        kind: "mechanical",
        mechanicalRule: { type: "agent_equals", expected: "code" },
      },
    ],
    trials: 2,
  };

  it("executes both sides with mock provider without skipping on failure", async () => {
    const validCodeReply = `===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "code",
  "outcome": { "status": "completed", "next": "proceed", "questions": [], "blockers": [] },
  "artifacts": [],
  "changedFiles": [{ "ref": "src/index.ts", "change": "modified" }],
  "payload": { "stepId": "02-tasks:step-1", "testsAdded": 1, "testsPassed": true }
}
===END-KRATOS-AGENT-OUTPUT-V1===`;

    const emptyBaselineReply = "I am a helpful assistant without instructions.";

    const mockProvider: DeterministicReplayProvider = {
      invoke: ({ systemPrompt }) => {
        const isWithPrompt = systemPrompt !== "";
        return Promise.resolve({
          rawReply: isWithPrompt ? validCodeReply : emptyBaselineReply,
          durationMs: isWithPrompt ? 200 : 50,
          consumption: {
            inputTokens: isWithPrompt ? 500 : 50,
            outputTokens: 100,
            totalTokens: isWithPrompt ? 600 : 150,
          },
        });
      },
    };

    const report = await runPromptEvaluationCase(sampleCase, mockProvider);
    expect(report.withPrompt.trials.length).toBe(2);
    expect(report.withoutPrompt.trials.length).toBe(2);
    expect(report.withPrompt.overallPassRate).toBe(1.0);
    expect(report.withoutPrompt.overallPassRate).toBe(0.0);
    expect(report.passingAuthorized).toBe(true);
  });

  it("supports previousPrompt comparison", async () => {
    const validCodeReply = `===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "code",
  "outcome": { "status": "completed", "next": "proceed", "questions": [], "blockers": [] },
  "artifacts": [],
  "changedFiles": [{ "ref": "src/index.ts", "change": "modified" }],
  "payload": { "stepId": "02-tasks:step-1", "testsAdded": 1, "testsPassed": true }
}
===END-KRATOS-AGENT-OUTPUT-V1===`;

    const mockProvider: DeterministicReplayProvider = {
      invoke: ({ systemPrompt }) =>
        Promise.resolve({
          rawReply: systemPrompt !== "" ? validCodeReply : "baseline",
          durationMs: 100,
          consumption: {
            inputTokens: 100,
            outputTokens: 50,
            totalTokens: 150,
          },
        }),
    };

    const report = await runPromptEvaluationCase(sampleCase, mockProvider, {
      previousPrompt: "previous version instructions",
    });
    expect(report.previousPrompt).toBeDefined();
    expect(report.previousPrompt?.trials.length).toBe(2);
  });
});
