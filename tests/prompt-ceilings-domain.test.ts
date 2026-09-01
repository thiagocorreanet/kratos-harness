import { describe, expect, it } from "vitest";
import {
  PROMPT_CATEGORIES,
  getPromptCategory,
  evaluatePromptCeiling,
  type PromptCategory,
} from "@kratos/runtime/domain/prompt-ceilings";

describe("prompt ceilings domain catalog", () => {
  it("defines all 5 prompt categories with non-empty rationales and ceilings", () => {
    expect(PROMPT_CATEGORIES.map((c) => c.category)).toEqual([
      "host-skill",
      "phase-agent-prompt",
      "orchestrator-prompt",
      "managed-instruction-block",
      "feature-document-template",
    ]);

    for (const cat of PROMPT_CATEGORIES) {
      expect(cat.ceilingChars).toBeGreaterThan(0);
      expect(cat.rationale.length).toBeGreaterThan(20);
    }
  });

  it("evaluates a prompt within ceiling as passing", () => {
    const res = evaluatePromptCeiling(
      "orchestrator-prompt",
      "Short prompt",
      "test.md",
    );
    expect(res.passed).toBe(true);
    expect(res.measuredChars).toBe(12);
    expect(res.error).toBeUndefined();
  });

  it("evaluates an oversized prompt as failed with formatted error naming file, size, and limit", () => {
    const longPrompt = "a".repeat(1001);
    const res = evaluatePromptCeiling(
      "orchestrator-prompt",
      longPrompt,
      "agents/kratos-orchestrator.md",
    );
    expect(res.passed).toBe(false);
    expect(res.measuredChars).toBe(1001);
    expect(res.ceilingChars).toBe(1000);
    expect(res.error).toBe(
      "Prompt size ceiling exceeded in agents/kratos-orchestrator.md: measured 1001 chars, limit is 1000 chars (category: orchestrator-prompt).",
    );
  });

  it("throws when requesting an unknown prompt category", () => {
    expect(() =>
      getPromptCategory("unknown-category" as unknown as PromptCategory),
    ).toThrow("Unknown prompt category: unknown-category");
  });
});
