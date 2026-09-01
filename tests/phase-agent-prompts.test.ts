import {
  MAX_PHASE_AGENT_PROMPT_BYTES,
  PHASE_AGENT_PROMPTS,
} from "@kratos/runtime/domain/phase-agents";
import { REASON_CATALOG } from "@kratos/contracts";
import type { Effect } from "@kratos/runtime/domain/effects";
import {
  profileStack,
  skeletonEffects,
  unresolvedProjectProfile,
} from "@kratos/runtime/domain/init";
import { describe, expect, it } from "vitest";

const documentPaths = [
  ".brain/02-features/<feature>/00-prd.md",
  ".brain/02-features/<feature>/01-design.md",
  ".brain/02-features/<feature>/02-tasks.md",
  ".brain/02-features/<feature>/03-summa.md",
] as const;

function prompt(id: (typeof PHASE_AGENT_PROMPTS)[number]["id"]): string {
  const definition = PHASE_AGENT_PROMPTS.find(
    (candidate) => candidate.id === id,
  );
  if (definition === undefined) throw new Error(`missing prompt ${id}`);
  return definition.instructions;
}

function contentAt(effects: readonly Effect[], path: string): string {
  const effect = effects.find(
    (candidate) => candidate.kind === "write_file" && candidate.path === path,
  );
  if (effect?.kind !== "write_file") throw new Error(`missing effect ${path}`);
  return effect.content;
}

function codexInstructions(content: string): string {
  const encoded = /^developer_instructions = (".*")$/mu.exec(content)?.[1];
  if (encoded === undefined) throw new Error("missing developer_instructions");
  return JSON.parse(encoded) as string;
}

describe("the canonical phase-agent prompts", () => {
  it("requires implementation agents to read and acknowledge curated memory", () => {
    for (const id of [
      "code-implementer",
      "implementation-evaluator",
    ] as const) {
      const instructions = prompt(id);
      expect(instructions).toContain("confirmed-lessons section");
      expect(instructions).toContain("exact `memory`");
      expect(instructions).toContain(
        "observation supplied by the runtime handoff",
      );
      expect(instructions).toContain("`memory: null`");
    }
  });

  it("maps the five installed roles onto every runtime output", () => {
    expect(
      PHASE_AGENT_PROMPTS.map(({ id, outputAgents }) => [id, outputAgents]),
    ).toEqual([
      ["code-implementer", ["code"]],
      ["implementation-evaluator", ["review", "acceptance"]],
      ["prd-researcher", ["prd"]],
      ["spec-planner", ["spec"]],
      ["spec-reviewer", ["plan"]],
    ]);
  });

  it("gives every role the same documents and fail-closed uncertainty rule", () => {
    for (const { instructions } of PHASE_AGENT_PROMPTS) {
      for (const path of documentPaths) expect(instructions).toContain(path);
      expect(instructions).toContain(
        "Finish reading and analysis before your first write.",
      );
      expect(instructions).toContain(
        "If a blocking question is unanswered, do not write any file.",
      );
      expect(instructions).toContain(
        "Return the open questions in the machine block and stop; never guess.",
      );
    }
  });

  it("contains language policy rules and normative exceptions in shared instructions", () => {
    for (const { instructions } of PHASE_AGENT_PROMPTS) {
      expect(instructions).toContain("## Language policy");
      expect(instructions).toContain(
        "Domain terms, proper nouns, acronyms, library names",
      );
      expect(instructions).toContain(
        "external interface fields keep their canonical form",
      );
    }
  });

  it("keeps each role inside its distinct responsibility", () => {
    expect(prompt("prd-researcher")).toContain(
      "Do not design the solution and do not write code.",
    );
    expect(prompt("spec-planner")).toContain(
      "Anchor acceptance criteria to the validated problem",
    );

    const reviewer = prompt("spec-reviewer");
    for (const requirement of [
      "error statuses, input validation, timeouts, and payload limits",
      "constraint violations, migration rollback, and pool exhaustion",
      "expiry, refresh, and lockout",
      "timeout, retry with backoff, and a fallback",
      "loading, error, empty, and offline states",
    ]) {
      expect(reviewer).toContain(requirement);
    }

    const implementer = prompt("code-implementer");
    expect(implementer).toContain("Implement exactly one planned step.");
    expect(implementer).toContain(
      "Never change an acceptance-criterion checkbox",
    );
    expect(implementer).toContain(
      "You cannot declare the step or feature complete.",
    );

    const evaluator = prompt("implementation-evaluator");
    expect(evaluator).toContain("Never write or modify code.");
    expect(evaluator).toContain("Low confidence is a failed judgment");
    expect(evaluator).toContain("A criterion without a mapped test fails.");
    expect(evaluator).toContain(
      "An unhandled applicable edge case prevents a passing verdict.",
    );
    expect(evaluator).toContain(
      "Cite a project-relative file and line or an exact test name for every judgment.",
    );
  });

  it("stays bounded and host neutral", () => {
    expect(MAX_PHASE_AGENT_PROMPT_BYTES).toBe(12 * 1024);
    const hostSpecificNames = [
      "Codex",
      "Claude Code",
      "apply_patch",
      "PreToolUse",
      "AskUserQuestion",
    ];
    for (const { instructions } of PHASE_AGENT_PROMPTS) {
      expect(Buffer.byteLength(instructions, "utf8")).toBeLessThanOrEqual(
        MAX_PHASE_AGENT_PROMPT_BYTES,
      );
      for (const name of hostSpecificNames) {
        expect(instructions).not.toContain(name);
      }
      expect(instructions).toContain("===KRATOS-AGENT-OUTPUT-V1===");
      expect(instructions).toContain("===END-KRATOS-AGENT-OUTPUT-V1===");
    }
  });

  it("contains no runtime policy identifier or unresolved placeholder", () => {
    for (const { instructions } of PHASE_AGENT_PROMPTS) {
      for (const { code } of REASON_CATALOG) {
        expect(instructions, code).not.toContain(code);
      }
      expect(instructions).not.toMatch(/\b(?:TBD|TODO)\b|__[A-Z_]+__/u);
      expect(instructions).not.toContain("{one JSON object");
    }
  });

  it("renders every Codex definition from the canonical body", () => {
    const effects = skeletonEffects(
      {
        contractVersion: "1.5.0",
        hostContract: "1.4.0",
        hosts: ["codex"],
        language: {
          conversation: "en",
          documentation: "en",
          comments: "en",
          identifiers: "en",
          commits: "en",
          preserveConventions: true,
          enforcement: "advisory",
        },
        policyMode: "standard",
        gateModes: {},
        snapshots: true,
        modelRoles: {
          codex: {
            planner: { model: "planner", effort: "medium" },
            implementer: { model: "implementer", effort: "medium" },
            judge: { model: "judge", effort: "medium" },
          },
        },
        projectProfile: unresolvedProjectProfile(),
      },
      profileStack({ rootEntries: ["package.json"] }),
    );

    for (const definition of PHASE_AGENT_PROMPTS) {
      const content = contentAt(effects, `.codex/agents/${definition.id}.toml`);
      expect(codexInstructions(content)).toBe(definition.instructions);
    }
  });
});
