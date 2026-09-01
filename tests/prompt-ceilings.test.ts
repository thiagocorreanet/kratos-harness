import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROMPT_CATEGORIES,
  collectShippedPromptSurfaces,
  evaluatePromptCeiling,
} from "@kratos/runtime/domain/prompt-ceilings";

function findFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("prompt size ceiling enforcement", () => {
  it("measures every currently shipped prompt and confirms zero breaches", () => {
    const fileReader = (path: string) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    };
    const surfaces = collectShippedPromptSurfaces({ fileReader });
    expect(surfaces.length).toBeGreaterThan(0);

    const results = surfaces.map((surface) => {
      const rendered = surface.getRenderedText();
      return evaluatePromptCeiling(surface.category, rendered, surface.path);
    });

    for (const result of results) {
      expect(
        result.passed,
        `Expected ${result.path} to pass ceiling (${result.measuredChars}/${result.ceilingChars} chars)`,
      ).toBe(true);
      expect(result.error).toBeUndefined();
    }
  });

  it("fails when a fixture prompt exceeds its category ceiling and formats the error", () => {
    const longContent = "X".repeat(6001);
    const result = evaluatePromptCeiling("host-skill", longContent, "fixtures/oversized-skill.md");
    expect(result.passed).toBe(false);
    expect(result.measuredChars).toBe(6001);
    expect(result.ceilingChars).toBe(6000);
    expect(result.error).toBe(
      "Prompt size ceiling exceeded in fixtures/oversized-skill.md: measured 6001 chars, limit is 6000 chars (category: host-skill).",
    );
  });

  it("ensures every shipped markdown/prompt file in distribution/ is cataloged under a category", () => {
    const distDir = join(process.cwd(), "distribution");
    const allDistFiles = findFilesRecursive(distDir);
    const promptFiles = allDistFiles.filter(
      (f) => f.endsWith(".md") && !f.includes("node_modules"),
    );

    const surfaces = collectShippedPromptSurfaces();
    const inventoriedRelPaths = new Set(
      surfaces.map((s) => s.path),
    );

    for (const file of promptFiles) {
      const rel = relative(process.cwd(), file);
      expect(
        inventoriedRelPaths.has(rel),
        `Uncategorized prompt file detected: ${rel}. All shipped prompts must be declared under a valid category.`,
      ).toBe(true);
    }
  });

  it("applies identical rules and ceilings across host distributions (Claude Code, Codex, Antigravity)", () => {
    const surfaces = collectShippedPromptSurfaces();
    const skills = surfaces.filter((s) => s.category === "host-skill");
    expect(skills.length).toBe(3);

    for (const skill of skills) {
      expect(skill.category).toBe("host-skill");
      const res = evaluatePromptCeiling(skill.category, skill.getRenderedText(), skill.path);
      expect(res.ceilingChars).toBe(6000);
      expect(res.passed).toBe(true);
    }
  });
});
