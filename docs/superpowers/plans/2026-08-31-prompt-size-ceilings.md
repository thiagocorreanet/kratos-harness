# Prompt Size Ceiling Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce deterministic prompt size ceilings in CI across all prompt categories (host skills, agent prompts, managed instruction blocks, and document templates), measuring rendered form and failing immediately on breaches or uncategorized prompts.

**Architecture:** A domain catalog defines the prompt categories, ceilings (in UTF-8 characters), rationales, and evaluation rules. A discovery module extracts rendered forms for static and generated prompts across host surfaces. A dedicated verification script (`scripts/check-prompt-ceilings.mjs`) and Vitest test suite (`tests/prompt-ceilings.test.ts`) enforce ceilings and inventory completeness in CI.

**Tech Stack:** Node.js (ESM), TypeScript, Vitest, `@kratos/runtime`, `@kratos/contracts`.

**Spec:** `docs/superpowers/specs/2026-08-31-prompt-size-ceilings-design.md`

## Global Constraints

- Measurement unit is UTF-8 Unicode characters (`string.length` on normalized text).
- Measurement must run on the rendered form (what the model actually receives).
- Neutrality across all host distributions (Claude Code, Codex, Antigravity).
- Deterministic error messages naming the file, measured character count, and limit.
- Zero tolerance for uncategorized prompt surfaces.
- Response to a breach is moving details into reference docs and linking, never silently raising the ceiling.

---

### Task 1: Prompt Ceilings Domain Catalog and Pure Evaluator

**Files:**
- Create: `packages/runtime/src/domain/prompt-ceilings/model.ts`
- Create: `packages/runtime/src/domain/prompt-ceilings/index.ts`
- Modify: `packages/runtime/src/index.ts`
- Test: `tests/prompt-ceilings-domain.test.ts`

**Interfaces:**
- Produces:
  ```typescript
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

  export interface PromptEvaluationResult {
    readonly path: string;
    readonly category: PromptCategory;
    readonly measuredChars: number;
    readonly ceilingChars: number;
    readonly passed: boolean;
    readonly error?: string;
  }

  export const PROMPT_CATEGORIES: readonly PromptCategoryDefinition[];
  export function getPromptCategory(category: PromptCategory): PromptCategoryDefinition;
  export function evaluatePromptCeiling(category: PromptCategory, measuredText: string, path: string): PromptEvaluationResult;
  ```

- [ ] **Step 1: Write the failing unit tests for domain catalog and evaluator**

Create `tests/prompt-ceilings-domain.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import {
  PROMPT_CATEGORIES,
  getPromptCategory,
  evaluatePromptCeiling,
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
    const res = evaluatePromptCeiling("orchestrator-prompt", "Short prompt", "test.md");
    expect(res.passed).toBe(true);
    expect(res.measuredChars).toBe(12);
    expect(res.error).toBeUndefined();
  });

  it("evaluates an oversized prompt as failed with formatted error naming file, size, and limit", () => {
    const longPrompt = "a".repeat(1001);
    const res = evaluatePromptCeiling("orchestrator-prompt", longPrompt, "agents/kratos-orchestrator.md");
    expect(res.passed).toBe(false);
    expect(res.measuredChars).toBe(1001);
    expect(res.ceilingChars).toBe(1000);
    expect(res.error).toBe(
      "Prompt size ceiling exceeded in agents/kratos-orchestrator.md: measured 1001 chars, limit is 1000 chars (category: orchestrator-prompt).",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt-ceilings-domain.test.ts`
Expected: FAIL with module `@kratos/runtime/domain/prompt-ceilings` not found.

- [ ] **Step 3: Implement domain model and exports**

Create `packages/runtime/src/domain/prompt-ceilings/model.ts`:
```typescript
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

export const PROMPT_CATEGORIES: readonly PromptCategoryDefinition[] = Object.freeze([
  {
    category: "host-skill",
    ceilingChars: 6000,
    description: "Host skill markdown definitions in distribution/*/skills/kratos/SKILL.md",
    rationale:
      "Skill instructions route lifecycle commands, interview relays, and phase handoffs without overwhelming host skill context.",
  },
  {
    category: "phase-agent-prompt",
    ceilingChars: 8000,
    description: "Phase agent role prompts rendered for native agent definitions",
    rationale:
      "Defines role boundaries, uncertainty fail-closed rules, language policy, document paths, and output machine blocks while protecting model attention.",
  },
  {
    category: "orchestrator-prompt",
    ceilingChars: 1000,
    description: "Orchestrator agent definitions in distribution/claude-code/agents/",
    rationale:
      "Pure relay agent connecting host events to runtime; carries no independent workflow logic or decisions.",
  },
  {
    category: "managed-instruction-block",
    ceilingChars: 6000,
    description: "Managed instruction block injected into project instruction files (CLAUDE.md, AGENTS.md)",
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

export function getPromptCategory(category: PromptCategory): PromptCategoryDefinition {
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
  readonly error?: string;
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
    : `Prompt size ceiling exceeded in ${path}: measured ${measuredChars} chars, limit is ${def.ceilingChars} chars (category: ${category}).`;

  return Object.freeze({
    path,
    category,
    measuredChars,
    ceilingChars: def.ceilingChars,
    passed,
    error,
  });
}
```

Create `packages/runtime/src/domain/prompt-ceilings/index.ts`:
```typescript
export {
  PROMPT_CATEGORIES,
  getPromptCategory,
  evaluatePromptCeiling,
  type PromptCategory,
  type PromptCategoryDefinition,
  type PromptEvaluationResult,
} from "./model.js";
```

Export in `packages/runtime/src/index.ts`:
```typescript
export * as promptCeilings from "./domain/prompt-ceilings/index.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prompt-ceilings-domain.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/prompt-ceilings tests/prompt-ceilings-domain.test.ts packages/runtime/src/index.ts
git commit -m "feat(runtime): introduce prompt ceilings domain catalog and evaluator"
```

---

### Task 2: Shipped Prompt Discovery and Rendered Surface Extraction

**Files:**
- Create: `packages/runtime/src/domain/prompt-ceilings/discovery.ts`
- Modify: `packages/runtime/src/domain/prompt-ceilings/index.ts`
- Test: `tests/prompt-ceilings-discovery.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface ShippedPromptSurface {
    readonly id: string;
    readonly path: string;
    readonly category: PromptCategory;
    readonly host?: "claude-code" | "codex" | "antigravity" | "shared";
    readonly getRenderedText: () => string;
  }

  export function collectShippedPromptSurfaces(options?: {
    readonly distributionDir?: string;
  }): readonly ShippedPromptSurface[];
  ```

- [ ] **Step 1: Write the failing discovery tests**

Create `tests/prompt-ceilings-discovery.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { collectShippedPromptSurfaces } from "@kratos/runtime/domain/prompt-ceilings";

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
    const managedBlocks = surfaces.filter((s) => s.category === "managed-instruction-block");
    expect(managedBlocks.length).toBeGreaterThanOrEqual(2);
    for (const block of managedBlocks) {
      expect(block.getRenderedText()).toContain("KRATOS:MANAGED:START");
      expect(block.getRenderedText()).toContain("KRATOS:MANAGED:END");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/prompt-ceilings-discovery.test.ts`
Expected: FAIL with `collectShippedPromptSurfaces` not defined.

- [ ] **Step 3: Implement discovery and rendered surface extractors**

Create `packages/runtime/src/domain/prompt-ceilings/discovery.ts`:
```typescript
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { FEATURE_DOCUMENTS } from "../feature-documents/index.js";
import { PHASE_AGENT_PROMPTS } from "../phase-agents/index.js";
import {
  skeletonEffects,
  profileStack,
  unresolvedProjectProfile,
} from "../init/index.js";
import {
  MANAGED_SECTION_BEGIN,
  MANAGED_SECTION_END,
  extractManagedSection,
} from "../init/managed-section.js";
import type { PromptCategory } from "./model.js";

export interface ShippedPromptSurface {
  readonly id: string;
  readonly path: string;
  readonly category: PromptCategory;
  readonly host?: "claude-code" | "codex" | "antigravity" | "shared";
  readonly getRenderedText: () => string;
}

export function collectShippedPromptSurfaces(options?: {
  readonly distributionDir?: string;
  readonly repositoryRoot?: string;
}): readonly ShippedPromptSurface[] {
  const root = options?.repositoryRoot ?? process.cwd();
  const distDir = options?.distributionDir ?? join(root, "distribution");
  const surfaces: ShippedPromptSurface[] = [];

  // 1. Host Skills
  const hostSkillPaths = [
    { host: "claude-code" as const, rel: "claude-code/skills/kratos/SKILL.md" },
    { host: "codex" as const, rel: "codex/skills/kratos/SKILL.md" },
    { host: "antigravity" as const, rel: "antigravity/skills/kratos/SKILL.md" },
  ];
  for (const { host, rel } of hostSkillPaths) {
    const fullPath = join(distDir, rel);
    if (existsSync(fullPath)) {
      surfaces.push({
        id: `skill:${host}`,
        path: `distribution/${rel}`,
        category: "host-skill",
        host,
        getRenderedText: () => readFileSync(fullPath, "utf8"),
      });
    }
  }

  // 2. Orchestrator Agents
  const orchestratorRel = "claude-code/agents/kratos-orchestrator.md";
  const orchestratorFull = join(distDir, orchestratorRel);
  if (existsSync(orchestratorFull)) {
    surfaces.push({
      id: "agent:orchestrator:claude-code",
      path: `distribution/${orchestratorRel}`,
      category: "orchestrator-prompt",
      host: "claude-code",
      getRenderedText: () => readFileSync(orchestratorFull, "utf8"),
    });
  }

  // 3. Phase Agents (canonical instructions)
  for (const agent of PHASE_AGENT_PROMPTS) {
    surfaces.push({
      id: `phase-agent:${agent.id}:codex`,
      path: `.codex/agents/${agent.id}.toml (rendered)`,
      category: "phase-agent-prompt",
      host: "codex",
      getRenderedText: () => agent.instructions,
    });
    surfaces.push({
      id: `phase-agent:${agent.id}:claude-code`,
      path: `.claude/agents/${agent.id}.md (rendered)`,
      category: "phase-agent-prompt",
      host: "claude-code",
      getRenderedText: () => agent.instructions,
    });
  }

  // 4. Feature Document Templates
  for (const doc of FEATURE_DOCUMENTS) {
    surfaces.push({
      id: `template:${doc.id}`,
      path: `.brain/02-features/<feature>/${doc.id}.md (template)`,
      category: "feature-document-template",
      host: "shared",
      getRenderedText: () => doc.template,
    });
  }

  // 5. Managed Instruction Blocks across host profiles
  const sampleAnswers = {
    contractVersion: "1.3.0" as const,
    hostContract: "1.3.0" as const,
    hosts: ["claude-code", "codex", "antigravity"] as const,
    language: {
      conversation: "en" as const,
      documentation: "en" as const,
      comments: "en" as const,
      identifiers: "en" as const,
      commits: "en" as const,
      preserveConventions: true,
      enforcement: "advisory" as const,
    },
    policyMode: "standard" as const,
    snapshots: true,
    modelRoles: {
      codex: {
        planner: { model: "planner", effort: "medium" as const },
        implementer: { model: "implementer", effort: "medium" as const },
        judge: { model: "judge", effort: "medium" as const },
      },
    },
    projectProfile: unresolvedProjectProfile(),
  };

  const sampleProfile = profileStack({ rootEntries: ["package.json"] });
  const effects = skeletonEffects(sampleAnswers, sampleProfile);

  const claudeEffect = effects.find(
    (e) => e.kind === "write_file" && e.path === "CLAUDE.md",
  );
  if (claudeEffect && claudeEffect.kind === "write_file") {
    const block = extractManagedSection(claudeEffect.content) ?? claudeEffect.content;
    surfaces.push({
      id: "managed-section:claude-code",
      path: "CLAUDE.md (managed section)",
      category: "managed-instruction-block",
      host: "claude-code",
      getRenderedText: () => block,
    });
  }

  const codexEffect = effects.find(
    (e) => e.kind === "write_file" && e.path === "AGENTS.md",
  );
  if (codexEffect && codexEffect.kind === "write_file") {
    const block = extractManagedSection(codexEffect.content) ?? codexEffect.content;
    surfaces.push({
      id: "managed-section:codex",
      path: "AGENTS.md (managed section)",
      category: "managed-instruction-block",
      host: "codex",
      getRenderedText: () => block,
    });
  }

  return Object.freeze(surfaces);
}
```

Update `packages/runtime/src/domain/prompt-ceilings/index.ts`:
```typescript
export {
  PROMPT_CATEGORIES,
  getPromptCategory,
  evaluatePromptCeiling,
  type PromptCategory,
  type PromptCategoryDefinition,
  type PromptEvaluationResult,
} from "./model.js";

export {
  collectShippedPromptSurfaces,
  type ShippedPromptSurface,
} from "./discovery.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/prompt-ceilings-discovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/domain/prompt-ceilings/discovery.ts packages/runtime/src/domain/prompt-ceilings/index.ts tests/prompt-ceilings-discovery.test.ts
git commit -m "feat(runtime): add prompt surface discovery and rendered extraction"
```

---

### Task 3: Comprehensive Vitest Test Suite for Prompt Ceilings

**Files:**
- Create: `tests/prompt-ceilings.test.ts`

**Interfaces:**
- Consumes: `collectShippedPromptSurfaces`, `evaluatePromptCeiling`, `PROMPT_CATEGORIES` from `@kratos/runtime/domain/prompt-ceilings`.

- [ ] **Step 1: Write the full test suite**

Create `tests/prompt-ceilings.test.ts`:
```typescript
import { readdirSync, statSync } from "node:fs";
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
    const surfaces = collectShippedPromptSurfaces();
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run tests/prompt-ceilings.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/prompt-ceilings.test.ts
git commit -m "test: add prompt ceiling and inventory completeness test suite"
```

---

### Task 4: CI Verification Script and Verification Target Integration

**Files:**
- Create: `scripts/check-prompt-ceilings.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: CLI script exiting with code 0 on passing ceilings or code 1 on breach / uncategorized prompt, printing formatted evaluation tables and failure diagnostics.
- Adds script: `"prompts:ceilings:check": "node scripts/check-prompt-ceilings.mjs"`
- Adds to `"verify"` in `package.json`.

- [ ] **Step 1: Write `scripts/check-prompt-ceilings.mjs`**

Create `scripts/check-prompt-ceilings.mjs`:
```javascript
import { collectShippedPromptSurfaces, evaluatePromptCeiling } from "@kratos/runtime/domain/prompt-ceilings";

console.log("=== Checking Prompt Size Ceilings ===");

const surfaces = collectShippedPromptSurfaces();
let hasFailures = false;

console.log(`\nDiscovered ${surfaces.length} shipped prompt surfaces across all categories.\n`);
console.log(
  `${"Category".padEnd(28)} | ${"Measured".padStart(8)} / ${"Limit".padEnd(8)} | ${"Status".padEnd(8)} | Target`,
);
console.log("-".repeat(85));

for (const surface of surfaces) {
  const rendered = surface.getRenderedText();
  const evaluation = evaluatePromptCeiling(
    surface.category,
    rendered,
    surface.path,
  );

  const status = evaluation.passed ? "PASS" : "FAIL";
  const measured = `${evaluation.measuredChars}`.padStart(8);
  const limit = `${evaluation.ceilingChars}`.padEnd(8);
  const cat = surface.category.padEnd(28);

  console.log(`${cat} | ${measured} / ${limit} | ${status.padEnd(8)} | ${surface.path}`);

  if (!evaluation.passed) {
    hasFailures = true;
    console.error(`  ERROR: ${evaluation.error}`);
  }
}

console.log("-".repeat(85));

if (hasFailures) {
  console.error("\nFAIL: One or more prompt size ceilings were exceeded.");
  console.error("Policy: Factor detailed guidance into reference documents and link to them instead of raising the ceiling.\n");
  process.exit(1);
} else {
  console.log("\nSUCCESS: All prompt size ceilings passed.\n");
}
```

- [ ] **Step 2: Update `package.json` to include `"prompts:ceilings:check"` in `"verify"`**

Modify `package.json`:
Add script:
```json
"prompts:ceilings:check": "node scripts/check-prompt-ceilings.mjs",
```
Update `"verify"` script to include `npm run prompts:ceilings:check`.

- [ ] **Step 3: Run the check script and verify command**

Run: `node scripts/check-prompt-ceilings.mjs`
Expected: Exits with code 0 and logs PASS for all discovered surfaces.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-prompt-ceilings.mjs package.json
git commit -m "feat(ci): add check-prompt-ceilings script to build verification"
```

---

### Task 5: Architecture Documentation, Policy and Baseline Evidence

**Files:**
- Create: `docs/architecture/prompt-size-ceilings.md`
- Create: `docs/verification/qal-10-prompt-ceilings-evidence.md`
- Modify: `docs/contributing/workflow.md`

**Interfaces:**
- Documents the categories, ceilings, rationales, measurement rules, and remediation policy.
- Records exact baseline character measurements for every shipped prompt surface.

- [ ] **Step 1: Create `docs/architecture/prompt-size-ceilings.md`**

Create documentation outlining:
- The problem of prompt bloat and instruction degradation.
- Category definitions and limits.
- Rendered form measurement policy.
- Breach remediation rules (linking to reference material rather than expanding prompts).

- [ ] **Step 2: Create `docs/verification/qal-10-prompt-ceilings-evidence.md`**

Record current measurements for all prompts:
- Claude Code skill (`distribution/claude-code/skills/kratos/SKILL.md`)
- Codex skill (`distribution/codex/skills/kratos/SKILL.md`)
- Antigravity skill (`distribution/antigravity/skills/kratos/SKILL.md`)
- Orchestrator (`distribution/claude-code/agents/kratos-orchestrator.md`)
- 5 Phase agent prompts
- Document templates (`00-prd.md`, `01-design.md`, `02-tasks.md`, `03-summa.md`)
- Rendered managed instruction block

- [ ] **Step 3: Update `docs/contributing/workflow.md`**

Add prompt ceiling review rules to the pull request and development workflow documentation.

- [ ] **Step 4: Run full verification suite**

Run: `npm run verify`
Expected: All checks pass cleanly.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture/prompt-size-ceilings.md docs/verification/qal-10-prompt-ceilings-evidence.md docs/contributing/workflow.md
git commit -m "docs: document prompt size ceiling policy and record baseline measurements"
```

---

## Self-Review

- **Spec coverage:** Every requirement from `docs/superpowers/specs/2026-08-31-prompt-size-ceilings-design.md` (measurement unit, category ceilings and rationale, discovery, rendered form measurement, CI failure formatting, uncategorized prompt prevention, and baseline evidence) is implemented in Tasks 1-5.
- **Placeholder scan:** No TBD, TODO, or vague steps. Full code blocks and commands are provided.
- **Type consistency:** Types (`PromptCategory`, `PromptCategoryDefinition`, `PromptEvaluationResult`, `ShippedPromptSurface`) and function signatures are uniform across tasks.
