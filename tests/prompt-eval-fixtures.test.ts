import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  runPromptEvaluationCase,
  type PromptEvaluationCase,
  type DeterministicReplayProvider,
} from "@kratos/runtime/domain/prompt-eval";

describe("prompt evaluation fixtures", () => {
  it("verifies non-discriminating fixture identifies non-discriminating assertions", async () => {
    const fileContent = await readFile(
      "quality/evaluations/prompts/cases/non-discriminating-sample.v1.json",
      "utf8",
    );
    const evalCase = JSON.parse(fileContent) as PromptEvaluationCase;

    const replayProvider: DeterministicReplayProvider = {
      invoke: async () => ({
        rawReply: `===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "prd",
  "outcome": { "status": "completed", "next": "proceed", "questions": [], "blockers": [] },
  "artifacts": [".brain/02-features/feat/00-prd.md"],
  "changedFiles": [],
  "payload": { "objective": "test", "requirementIds": ["R-1"], "gapIds": [] }
}
===END-KRATOS-AGENT-OUTPUT-V1===`,
        durationMs: 100,
        consumption: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      }),
    };

    const report = await runPromptEvaluationCase(evalCase, replayProvider);
    expect(report.nonDiscriminatingCount).toBeGreaterThan(0);
    expect(report.passingAuthorized).toBe(false);
  });

  it("verifies code-implementer fixture runs with replay provider", async () => {
    const fileContent = await readFile(
      "quality/evaluations/prompts/cases/code-implementer.v1.json",
      "utf8",
    );
    const evalCase = JSON.parse(fileContent) as PromptEvaluationCase;

    const validCodeReply = `===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "code",
  "outcome": { "status": "completed", "next": "proceed", "questions": [], "blockers": [] },
  "artifacts": [],
  "changedFiles": [{ "ref": "packages/runtime/src/domain/model.ts", "change": "modified" }],
  "payload": { "stepId": "02-tasks:step-1", "testsAdded": 1, "testsPassed": true }
}
===END-KRATOS-AGENT-OUTPUT-V1===`;

    const replayProvider: DeterministicReplayProvider = {
      invoke: async ({ systemPrompt }) => ({
        rawReply: systemPrompt ? validCodeReply : "Baseline without prompt",
        durationMs: systemPrompt ? 200 : 50,
        consumption: { inputTokens: 400, outputTokens: 50, totalTokens: 450 },
      }),
    };

    const report = await runPromptEvaluationCase(evalCase, replayProvider);
    expect(report.withPrompt.overallPassRate).toBe(1.0);
    expect(report.withoutPrompt.overallPassRate).toBe(0.0);
    expect(report.passingAuthorized).toBe(true);
  });
});
