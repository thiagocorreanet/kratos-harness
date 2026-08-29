import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  evaluateMechanicalRule,
  runPromptEvaluationCase,
  type DeterministicReplayProvider,
  type PromptEvaluationCase,
} from "@kratos/runtime/domain/prompt-eval";

describe("prompt evaluation against baseline acceptance criteria", () => {
  it("AC1 & AC5: runs both sides without skipping and records consumption and duration for both", async () => {
    const testCase: PromptEvaluationCase = {
      id: "dual-run-test",
      description: "Dual run test",
      promptId: "code-implementer",
      input: { context: "Run step 1" },
      assertions: [
        {
          id: "a1",
          description: "Schema check",
          kind: "mechanical",
          mechanicalRule: { type: "schema_valid" },
        },
      ],
      trials: 2,
    };

    let withCount = 0;
    let withoutCount = 0;

    const provider: DeterministicReplayProvider = {
      invoke: async ({ systemPrompt }) => {
        if (systemPrompt !== "") {
          withCount++;
          return {
            rawReply: `===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "code",
  "outcome": { "status": "completed", "next": "proceed", "questions": [], "blockers": [] },
  "artifacts": [],
  "changedFiles": [],
  "payload": { "stepId": "s1", "testsAdded": 0, "testsPassed": true }
}
===END-KRATOS-AGENT-OUTPUT-V1===`,
            durationMs: 120,
            consumption: {
              inputTokens: 200,
              outputTokens: 50,
              totalTokens: 250,
            },
          };
        } else {
          withoutCount++;
          return {
            rawReply: "Regular assistant text",
            durationMs: 40,
            consumption: { inputTokens: 30, outputTokens: 20, totalTokens: 50 },
          };
        }
      },
    };

    const report = await runPromptEvaluationCase(testCase, provider);
    expect(withCount).toBe(2);
    expect(withoutCount).toBe(2);
    expect(report.withPrompt.averageDurationMs).toBe(120);
    expect(report.withoutPrompt.averageDurationMs).toBe(40);
    expect(report.withPrompt.averageConsumption.totalTokens).toBe(250);
    expect(report.withoutPrompt.averageConsumption.totalTokens).toBe(50);
  });

  it("AC2: reports identical resolutions as non-discriminating rather than a pass", async () => {
    const testCase: PromptEvaluationCase = {
      id: "non-disc-test",
      description: "Non-discriminating test",
      promptId: "prd-researcher",
      input: { context: "Context" },
      assertions: [
        {
          id: "always-fails",
          description: "Fails on both",
          kind: "mechanical",
          mechanicalRule: { type: "schema_valid" },
        },
      ],
      trials: 1,
    };

    const provider: DeterministicReplayProvider = {
      invoke: async () => ({
        rawReply: "Plain text with no block",
        durationMs: 50,
        consumption: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      }),
    };

    const report = await runPromptEvaluationCase(testCase, provider);
    expect(report.nonDiscriminatingCount).toBe(1);
    expect(report.assertions[0]?.discrimination).toBe(
      "non_discriminating_fail",
    );
    expect(report.assertions[0]?.isDiscriminating).toBe(false);
    expect(report.passingAuthorized).toBe(false);
  });

  it("AC3: mechanical assertion produces the exact same verdict for the same output", () => {
    const reply = `===KRATOS-AGENT-OUTPUT-V1===
{
  "contractVersion": "1.0.0",
  "hostContract": "1.0.0",
  "agent": "code",
  "outcome": { "status": "completed", "next": "proceed", "questions": [], "blockers": [] },
  "artifacts": [],
  "changedFiles": [],
  "payload": { "stepId": "s1", "testsAdded": 0, "testsPassed": true }
}
===END-KRATOS-AGENT-OUTPUT-V1===`;
    const rule = { type: "schema_valid" as const };

    const r1 = evaluateMechanicalRule(reply, rule);
    const r2 = evaluateMechanicalRule(reply, rule);
    expect(r1).toEqual(r2);
  });

  it("AC4: labels model-graded assertions and counts how many conclusions depend on one", async () => {
    const testCase: PromptEvaluationCase = {
      id: "hybrid-case",
      description: "Hybrid case",
      promptId: "prd-researcher",
      input: { context: "Context" },
      assertions: [
        {
          id: "mech-1",
          description: "Schema",
          kind: "mechanical",
          mechanicalRule: { type: "schema_valid" },
        },
        {
          id: "model-1",
          description: "Semantic quality",
          kind: "model_graded",
          modelGradedRubric: "Quality check",
        },
      ],
      trials: 1,
    };

    const provider: DeterministicReplayProvider = {
      invoke: async () => ({
        rawReply: "reply",
        durationMs: 50,
        consumption: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      }),
      gradeSemantic: async () => ({ passed: true }),
    };

    const report = await runPromptEvaluationCase(testCase, provider);
    expect(report.modelGradedCount).toBe(1);
    expect(
      report.assertions.find((a) => a.assertionId === "model-1")?.kind,
    ).toBe("model_graded");
  });

  it("AC6: verifies the evaluation runner is excluded from the default npm run verify command", async () => {
    const pkgJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkgJson.scripts.verify).not.toContain("eval:prompts");
    expect(pkgJson.scripts["eval:prompts"]).toBeDefined();
  });
});
