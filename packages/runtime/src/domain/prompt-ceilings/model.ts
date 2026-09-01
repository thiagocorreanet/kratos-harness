export type PromptCategory =
  | "host-skill"
  | "phase-agent-prompt"
  | "orchestrator-prompt"
  | "managed-instruction-block"
  | "feature-document-template";

export interface PromptCategoryDefinition {
  readonly category: PromptCategory;
  readonly ceilingChars: number;
  readonly description: string;
  readonly rationale: string;
}

export const PROMPT_CATEGORIES: readonly PromptCategoryDefinition[] =
  Object.freeze([
    {
      category: "host-skill",
      ceilingChars: 6000,
      description:
        "Host skill markdown definitions in distribution/*/skills/kratos/SKILL.md",
      rationale:
        "Skill instructions route lifecycle commands, interview relays, and phase handoffs without overwhelming host skill context.",
    },
    {
      category: "phase-agent-prompt",
      ceilingChars: 8000,
      description:
        "Phase agent role prompts rendered for native agent definitions",
      rationale:
        "Defines role boundaries, uncertainty fail-closed rules, language policy, document paths, and output machine blocks while protecting model attention.",
    },
    {
      category: "orchestrator-prompt",
      ceilingChars: 1000,
      description:
        "Orchestrator agent definitions in distribution/claude-code/agents/",
      rationale:
        "Pure relay agent connecting host events to runtime; carries no independent workflow logic or decisions.",
    },
    {
      category: "managed-instruction-block",
      ceilingChars: 6000,
      description:
        "Managed instruction block injected into project instruction files (CLAUDE.md, AGENTS.md)",
      rationale:
        "Contains host-specific tool permissions and stack-detected rules without bloating project root instruction files.",
    },
    {
      category: "feature-document-template",
      ceilingChars: 3500,
      description: "Feature document templates in .brain/02-features/",
      rationale:
        "Structured scaffolding and section guidance; keeps templates focused on structure rather than embedding expansive documentation.",
    },
  ]);

const CATEGORY_MAP = new Map<PromptCategory, PromptCategoryDefinition>(
  PROMPT_CATEGORIES.map((def) => [def.category, def]),
);

export function getPromptCategory(
  category: PromptCategory,
): PromptCategoryDefinition {
  const def = CATEGORY_MAP.get(category);
  if (!def) {
    throw new Error(`Unknown prompt category: ${category}`);
  }
  return def;
}

export interface PromptEvaluationResult {
  readonly path: string;
  readonly category: PromptCategory;
  readonly measuredChars: number;
  readonly ceilingChars: number;
  readonly passed: boolean;
  readonly error?: string | undefined;
}

export function evaluatePromptCeiling(
  category: PromptCategory,
  measuredText: string,
  path: string,
): PromptEvaluationResult {
  const def = getPromptCategory(category);
  const measuredChars = measuredText.length;
  const passed = measuredChars <= def.ceilingChars;
  const error = passed
    ? undefined
    : `Prompt size ceiling exceeded in ${path}: measured ${String(measuredChars)} chars, limit is ${String(def.ceilingChars)} chars (category: ${category}).`;

  return Object.freeze({
    path,
    category,
    measuredChars,
    ceilingChars: def.ceilingChars,
    passed,
    ...(error !== undefined ? { error } : {}),
  });
}
