import { describe, expect, it } from "vitest";
import {
  generateHostStackRules,
  renderStackRuleContent,
  profileStack,
  STACK_IDS,
  type StackProfile,
} from "@kratos/runtime/domain/init";

describe("stack-scoped project rules generation", () => {
  it("generates zero rules for an unrecognized stack profile", () => {
    const profile: StackProfile = profileStack({ rootEntries: [] });
    const claudeRules = generateHostStackRules("claude", profile);
    const codexRules = generateHostStackRules("codex", profile);

    expect(claudeRules).toEqual([]);
    expect(codexRules).toEqual([]);
  });

  it("generates node rules for detected node stack under host rules directory", () => {
    const profile = profileStack({ rootEntries: ["package.json"] });
    const claudeRules = generateHostStackRules("claude", profile);
    const codexRules = generateHostStackRules("codex", profile);

    expect(claudeRules).toHaveLength(1);
    const firstClaude = claudeRules[0];
    expect(firstClaude).toBeDefined();
    if (firstClaude !== undefined) {
      expect(firstClaude[0]).toBe(".claude/rules/node.md");
      expect(firstClaude[1]).toContain("# Node.js and TypeScript Conventions");
    }

    expect(codexRules).toHaveLength(1);
    const firstCodex = codexRules[0];
    expect(firstCodex).toBeDefined();
    if (firstCodex !== undefined) {
      expect(firstCodex[0]).toBe(".codex/rules/node.md");
      expect(firstCodex[1]).toContain("# Node.js and TypeScript Conventions");
    }
  });

  it("generates separate rules files for polyglot repositories with multiple detected stacks", () => {
    const profile = profileStack({
      rootEntries: ["package.json", "Cargo.toml"],
    });
    const claudeRules = generateHostStackRules("claude", profile);

    expect(claudeRules.map(([path]) => path).sort()).toEqual([
      ".claude/rules/node.md",
      ".claude/rules/rust.md",
    ]);
  });

  it("keeps each stack rule file bounded, concise, and under 35 lines", () => {
    // Every identifier the marker tables can name, so a toolchain that was
    // added to detection without rules to go with it fails here.
    for (const stack of STACK_IDS) {
      const content = renderStackRuleContent(stack);
      const lines = content.split("\n");
      expect(lines.length).toBeLessThanOrEqual(35);
      expect(content.length).toBeLessThan(2000);
      expect(content.startsWith("# ")).toBe(true);
    }
  });
});
