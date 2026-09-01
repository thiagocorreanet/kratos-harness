import { describe, expect, it } from "vitest";
import { collectShippedPromptSurfaces } from "@kratos/runtime/domain/prompt-ceilings";
import {
  MANAGED_SECTION_BEGIN,
  MANAGED_SECTION_END,
} from "@kratos/runtime/domain/init";

describe("shipped prompt discovery", () => {
  it("discovers all shipped prompt surfaces across skills, agents, templates, and managed blocks", () => {
    const surfaces = collectShippedPromptSurfaces();
    expect(surfaces.length).toBeGreaterThanOrEqual(12);

    const categories = new Set(surfaces.map((s) => s.category));
    expect(categories.has("host-skill")).toBe(true);
    expect(categories.has("phase-agent-prompt")).toBe(true);
    expect(categories.has("orchestrator-prompt")).toBe(true);
    expect(categories.has("managed-instruction-block")).toBe(true);
    expect(categories.has("feature-document-template")).toBe(true);

    for (const surface of surfaces) {
      const text = surface.getRenderedText();
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("renders phase agents for codex to developer_instructions format", () => {
    const surfaces = collectShippedPromptSurfaces();
    const codexAgents = surfaces.filter(
      (s) => s.category === "phase-agent-prompt" && s.host === "codex",
    );
    expect(codexAgents.length).toBe(5);
    for (const agent of codexAgents) {
      expect(agent.getRenderedText()).toContain("===KRATOS-AGENT-OUTPUT-V1===");
    }
  });

  it("extracts managed instruction block rendered across hosts", () => {
    const surfaces = collectShippedPromptSurfaces();
    const managedBlocks = surfaces.filter(
      (s) => s.category === "managed-instruction-block",
    );
    expect(managedBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of managedBlocks) {
      expect(block.getRenderedText()).toContain(MANAGED_SECTION_BEGIN);
      expect(block.getRenderedText()).toContain(MANAGED_SECTION_END);
    }
  });
});
