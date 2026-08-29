import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { KRATOS_VERSION } from "@kratos/contracts";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import type { Effect } from "@kratos/runtime/domain/effects";
import {
  MANAGED_SECTION_BEGIN,
  MANAGED_SECTION_END,
  destinationsOf,
  profileStack,
  type ResolvedAnswers,
  skeletonEffects,
  unresolvedProjectProfile,
} from "@kratos/runtime/domain/init";
import { beforeAll, describe, expect, expectTypeOf, it, vi } from "vitest";

const discoveryPath = join(
  fileURLToPath(new URL("../", import.meta.url)),
  "compatibility/inventory/go-v3-v0.6.5/discovery.json",
);

interface Discovery {
  readonly namespaces: {
    readonly generated_files: readonly { readonly name: string }[];
  };
}

/**
 * The frozen surface, read from the oracle rather than retyped.
 *
 * A path that drifts from the inventory fails here instead of shipping.
 */
let frozen: readonly string[];
let expectedSurface: readonly string[];

beforeAll(async () => {
  const discovery = JSON.parse(
    await readFile(discoveryPath, "utf8"),
  ) as Discovery;
  frozen = discovery.namespaces.generated_files
    .map(({ name }) => name)
    // A path carrying a feature or a run segment belongs to the command that
    // owns that lifecycle, not to initialization.
    .filter((name) => !name.includes("<"))
    .sort();
  expectedSurface = [".brain/.gitignore", ...frozen].sort();
});

const registry = createSchemaRegistry();
const nodeProject = profileStack({ rootEntries: ["package.json"] });

function answers(overrides: Partial<ResolvedAnswers> = {}): ResolvedAnswers {
  return {
    contractVersion: "1.3.0",
    hostContract: "1.3.0",
    hosts: ["claude", "codex"],
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
    snapshots: true,
    modelRoles: {
      claude: {
        planner: { model: "claude-planner", effort: "medium" },
        implementer: { model: "claude-implementer", effort: "medium" },
        judge: { model: "claude-judge", effort: "medium" },
      },
      codex: {
        planner: { model: "codex-planner", effort: "medium" },
        implementer: { model: "codex-implementer", effort: "high" },
        judge: { model: "codex-judge", effort: "medium" },
      },
    },
    projectProfile: unresolvedProjectProfile(),
    ...overrides,
  };
}

function contentAt(effects: readonly Effect[], path: string): string {
  const effect = effects.find(
    (candidate) => candidate.kind === "write_file" && candidate.path === path,
  );
  if (effect?.kind !== "write_file") {
    throw new Error(`nothing was generated at ${path}`);
  }
  return effect.content;
}

function underBrain(path: string): boolean {
  return path.startsWith(".brain/");
}

describe("the generated skeleton", () => {
  it("accepts resolved model-role objects but rejects raw assignments at its public boundary", () => {
    interface RawAssignments {
      readonly contractVersion: "1.2.0";
      readonly hostContract: "1.2.0";
      readonly hosts: readonly ["codex"];
      readonly language: {
        readonly conversation: "en";
        readonly documentation: "en";
        readonly comments: "en";
        readonly identifiers: "en";
        readonly commits: "en";
        readonly preserveConventions: true;
        readonly enforcement: "advisory";
      };
      readonly policyMode: "standard";
      readonly snapshots: true;
      readonly modelRoles: {
        readonly codex: {
          readonly planner: "planner";
          readonly implementer: "implementer";
          readonly judge: "judge";
        };
      };
    }

    expectTypeOf<RawAssignments["modelRoles"]>().not.toExtend<
      Parameters<typeof skeletonEffects>[0]["modelRoles"]
    >();
  });

  it("generates exactly the expected initialization surface", () => {
    expect(destinationsOf(skeletonEffects(answers(), nodeProject))).toEqual(
      expectedSurface,
    );
  });

  it("writes the state ignore rules byte for byte", () => {
    const generated = skeletonEffects(answers(), nodeProject);
    const gitignore = contentAt(generated, ".brain/.gitignore");

    expect(gitignore).toBe(
      [
        "# Volatile telemetry and run event streams are not tracked.",
        "03-memory/task_log.jsonl",
        "03-memory/.cache/",
        "02-features/*/runs/*/events.jsonl",
        "events.jsonl",
        "*.trace",
        "traces/",
      ].join("\n") + "\n",
    );
  });

  it("classifies every path written by initialization as deliberately committed or ignored", () => {
    const effects = skeletonEffects(answers(), nodeProject);
    const paths = destinationsOf(effects);

    const ignoredPaths = [
      ".brain/03-memory/task_log.jsonl",
      ".brain/03-memory/.cache/feature-create.json",
    ];

    const committedPaths = [
      ".brain/.gitignore",
      ".brain/00-business/README.md",
      ".brain/01-architecture/README.md",
      ".brain/01-architecture/adr/.gitkeep",
      ".brain/01-architecture/stack-profile.md",
      ".brain/02-features/README.md",
      ".brain/02-features/_template/00-prd.md",
      ".brain/02-features/_template/01-design.md",
      ".brain/02-features/_template/02-tasks.md",
      ".brain/02-features/_template/03-summa.md",
      ".brain/02-features/_template/state.json",
      ".brain/02-features/active",
      ".brain/03-memory/decisions.log",
      ".brain/03-memory/gotchas.md",
      ".brain/03-memory/task_metrics.md",
      ".brain/config.json",
      ".brain/guardrails.json",
      ".claude/settings.json",
      ".codex/agents/code-implementer.toml",
      ".codex/agents/implementation-evaluator.toml",
      ".codex/agents/prd-researcher.toml",
      ".codex/agents/spec-planner.toml",
      ".codex/agents/spec-reviewer.toml",
      ".codex/config.toml",
      "AGENTS.md",
      "CLAUDE.md",
    ];

    expect([...paths].sort()).toEqual(
      [...committedPaths, ...ignoredPaths].sort(),
    );
    for (const path of paths) {
      const isIgnored = ignoredPaths.includes(path);
      const isCommitted = committedPaths.includes(path);
      expect(isIgnored !== isCommitted).toBe(true);
    }
  });

  it("writes files and creates no directory of its own", () => {
    // The transaction normalizer synthesizes missing parents. A
    // create_directory effect here would be a second, divergent opinion about
    // which directories exist.
    const kinds = skeletonEffects(answers(), nodeProject).map(
      ({ kind }) => kind,
    );

    expect([...new Set(kinds)]).toEqual(["write_file"]);
  });

  it("produces byte-identical effects for identical inputs", () => {
    expect(skeletonEffects(answers(), nodeProject)).toEqual(
      skeletonEffects(answers(), nodeProject),
    );
  });

  it("does not let the host order reach a generated byte", () => {
    // Iteration order is the classic way a second run rewrites files that were
    // already right.
    expect(
      skeletonEffects(answers({ hosts: ["codex", "claude"] }), nodeProject),
    ).toEqual(
      skeletonEffects(answers({ hosts: ["claude", "codex"] }), nodeProject),
    );
  });

  it("reaches no clock, no random source, and no identifier generator", () => {
    const refuse = (name: string) => (): never => {
      throw new Error(`generation reached ${name}`);
    };
    // Sealing the constructor as well as `now` closes `new Date()`, which is
    // the reading of the clock a generator is most likely to make by accident.
    const sealedClock = refuse("the clock");
    vi.stubGlobal("Date", Object.assign(sealedClock, { now: sealedClock }));
    const random = vi
      .spyOn(Math, "random")
      .mockImplementation(refuse("Math.random"));
    const uuid = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockImplementation(refuse("crypto.randomUUID"));

    let generated: readonly Effect[];
    try {
      generated = skeletonEffects(answers(), nodeProject);
    } finally {
      vi.unstubAllGlobals();
      random.mockRestore();
      uuid.mockRestore();
    }

    expect(destinationsOf(generated)).toEqual(expectedSurface);
  });

  it("generates only the surface of the hosts the answers enabled", () => {
    const claudeOnly = destinationsOf(
      skeletonEffects(answers({ hosts: ["claude"] }), nodeProject),
    );
    const codexOnly = destinationsOf(
      skeletonEffects(answers({ hosts: ["codex"] }), nodeProject),
    );

    expect(claudeOnly).toEqual(
      expectedSurface.filter(
        (path) => !path.startsWith(".codex/") && path !== "AGENTS.md",
      ),
    );
    expect(codexOnly).toEqual(
      expectedSurface.filter(
        (path) => !path.startsWith(".claude/") && path !== "CLAUDE.md",
      ),
    );
    // State is not a host's property: the `.brain` skeleton is the same either
    // way.
    expect(claudeOnly.filter(underBrain)).toEqual(codexOnly.filter(underBrain));
  });

  it("writes a project configuration the runtime itself accepts", () => {
    const ptBrPolicy = {
      conversation: "pt-BR" as const,
      documentation: "pt-BR" as const,
      comments: "en" as const,
      identifiers: "en" as const,
      commits: "en" as const,
      preserveConventions: true,
      enforcement: "advisory" as const,
    };
    const generated = skeletonEffects(
      answers({ language: ptBrPolicy, policyMode: "strict", snapshots: false }),
      nodeProject,
    );
    const config: unknown = JSON.parse(
      contentAt(generated, ".brain/config.json"),
    );

    expect(config).toEqual({
      contractVersion: "1.3.0",
      stateContract: "1.3.0",
      pluginVersion: KRATOS_VERSION,
      hostContract: "1.3.0",
      language: ptBrPolicy,
      policyMode: "strict",
      managedState: {
        directory: ".brain",
        eventLog: "events.jsonl",
        snapshots: false,
      },
      modelRoles: {
        claude: {
          planner: { model: "claude-planner", effort: "medium" },
          implementer: { model: "claude-implementer", effort: "medium" },
          judge: { model: "claude-judge", effort: "medium" },
        },
        codex: {
          planner: { model: "codex-planner", effort: "medium" },
          implementer: { model: "codex-implementer", effort: "high" },
          judge: { model: "codex-judge", effort: "medium" },
        },
      },
      projectProfile: unresolvedProjectProfile(),
    });
    expect(
      registry.validate({
        id: "state.project-config",
        version: "1.3.0",
        value: config,
        structuralReasonCode: "guard.config_corrupt",
      }).kind,
    ).toBe("valid");
  });

  it("records the policy mode the answers chose in the guardrails", () => {
    const guardrails: unknown = JSON.parse(
      contentAt(
        skeletonEffects(answers({ policyMode: "strict" }), nodeProject),
        ".brain/guardrails.json",
      ),
    );

    expect(guardrails).toMatchObject({ policyMode: "strict" });
    expect(guardrails).toMatchObject({ stateContract: "1.0.0" });
  });

  it("records the detected stack and the evidence that decided it", () => {
    const profile = contentAt(
      skeletonEffects(
        answers(),
        profileStack({ rootEntries: ["go.mod", "package.json"] }),
      ),
      ".brain/01-architecture/stack-profile.md",
    );

    // A profile that names a stack without naming why is a profile nobody can
    // check.
    expect(profile).toContain("| go | `go.mod` |");
    expect(profile).toContain("| node | `package.json` |");
  });

  it("renders a recognized root byte for byte without inventing profile values", () => {
    const profile = contentAt(
      skeletonEffects(answers(), nodeProject),
      ".brain/01-architecture/stack-profile.md",
    );

    expect(profile).toBe(
      [
        "# Stack profile",
        "",
        "> Generated by `kratos init` from typed initialization answers and root-entry evidence.",
        "> Manual edits are not authoritative and will be overwritten. Change the typed initialization answers and rerun `kratos init`.",
        "",
        "## Detected stacks",
        "",
        "| Stack | Evidence |",
        "| --- | --- |",
        "| node | `package.json` |",
        "",
        "## Commands",
        "",
        "### Test",
        "",
        "`<UNRESOLVED: projectProfile.commands.test>`",
        "",
        "### Lint",
        "",
        "`<UNRESOLVED: projectProfile.commands.lint>`",
        "",
        "### Build",
        "",
        "`<UNRESOLVED: projectProfile.commands.build>`",
        "",
        "### Run",
        "",
        "`<UNRESOLVED: projectProfile.commands.run>`",
        "",
        "## Paths",
        "",
        "| Path group | Value |",
        "| --- | --- |",
        "| Source | `<UNRESOLVED: projectProfile.paths.source>` |",
        "| Tests | `<UNRESOLVED: projectProfile.paths.tests>` |",
        "| Configuration | `<UNRESOLVED: projectProfile.paths.configuration>` |",
        "",
        "## Conventions",
        "",
        "| Convention | Value |",
        "| --- | --- |",
        "| Directory layout | `<UNRESOLVED: projectProfile.conventions.directoryLayout>` |",
        "| Naming | `<UNRESOLVED: projectProfile.conventions.naming>` |",
        "| Implementation languages | `<UNRESOLVED: projectProfile.conventions.implementationLanguages>` |",
        "",
        "## Language policy",
        "",
        "| Artifact | Language |",
        "| --- | --- |",
        "| Conversation | `en` |",
        "| Documentation | `en` |",
        "| Comments | `en` |",
        "| Identifiers | `en` |",
        "| Commits | `en` |",
        "| Preserve conventions | `true` |",
        "| Enforcement | `advisory` |",
      ].join("\n") + "\n",
    );
  });

  it("renders an unrecognized root byte for byte", () => {
    const profile = contentAt(
      skeletonEffects(answers(), profileStack({ rootEntries: ["README.md"] })),
      ".brain/01-architecture/stack-profile.md",
    );

    expect(profile).toBe(
      [
        "# Stack profile",
        "",
        "> Generated by `kratos init` from typed initialization answers and root-entry evidence.",
        "> Manual edits are not authoritative and will be overwritten. Change the typed initialization answers and rerun `kratos init`.",
        "",
        "## Detected stacks",
        "",
        "No known stack matched this project root. Detection is offline and limited to root entry names.",
        "",
        "## Commands",
        "",
        "### Test",
        "",
        "`<UNRESOLVED: projectProfile.commands.test>`",
        "",
        "### Lint",
        "",
        "`<UNRESOLVED: projectProfile.commands.lint>`",
        "",
        "### Build",
        "",
        "`<UNRESOLVED: projectProfile.commands.build>`",
        "",
        "### Run",
        "",
        "`<UNRESOLVED: projectProfile.commands.run>`",
        "",
        "## Paths",
        "",
        "| Path group | Value |",
        "| --- | --- |",
        "| Source | `<UNRESOLVED: projectProfile.paths.source>` |",
        "| Tests | `<UNRESOLVED: projectProfile.paths.tests>` |",
        "| Configuration | `<UNRESOLVED: projectProfile.paths.configuration>` |",
        "",
        "## Conventions",
        "",
        "| Convention | Value |",
        "| --- | --- |",
        "| Directory layout | `<UNRESOLVED: projectProfile.conventions.directoryLayout>` |",
        "| Naming | `<UNRESOLVED: projectProfile.conventions.naming>` |",
        "| Implementation languages | `<UNRESOLVED: projectProfile.conventions.implementationLanguages>` |",
        "",
        "## Language policy",
        "",
        "| Artifact | Language |",
        "| --- | --- |",
        "| Conversation | `en` |",
        "| Documentation | `en` |",
        "| Comments | `en` |",
        "| Identifiers | `en` |",
        "| Commits | `en` |",
        "| Preserve conventions | `true` |",
        "| Enforcement | `advisory` |",
      ].join("\n") + "\n",
    );
  });

  it("renders a multi-stack root and every profile leaf byte for byte", () => {
    const profile = contentAt(
      skeletonEffects(
        answers({
          language: {
            conversation: "pt-BR",
            documentation: "pt-BR",
            comments: "en",
            identifiers: "en",
            commits: "en",
            preserveConventions: false,
            enforcement: "off",
          },
          projectProfile: {
            commands: {
              test: { status: "resolved", value: "npm test" },
              lint: {
                status: "resolved",
                value: "npm run lint | tee lint.log",
              },
              build: { status: "not-applicable", reason: "No build step." },
              run: { status: "resolved", value: "go run ./cmd/api" },
            },
            paths: {
              source: { status: "resolved", value: ["src", "cmd/api"] },
              tests: { status: "resolved", value: ["tests"] },
              configuration: {
                status: "not-applicable",
                reason: "Configuration is supplied by the host.",
              },
            },
            conventions: {
              directoryLayout: {
                status: "resolved",
                value: "Feature folders <own> their adapters.",
              },
              naming: {
                status: "resolved",
                value: "Use `camelCase` for TypeScript.",
              },
              implementationLanguages: {
                status: "resolved",
                value: ["TypeScript", "Go"],
              },
            },
          },
        }),
        profileStack({ rootEntries: ["go.mod", "package.json"] }),
      ),
      ".brain/01-architecture/stack-profile.md",
    );

    expect(profile).toBe(
      [
        "# Stack profile",
        "",
        "> Generated by `kratos init` from typed initialization answers and root-entry evidence.",
        "> Manual edits are not authoritative and will be overwritten. Change the typed initialization answers and rerun `kratos init`.",
        "",
        "## Detected stacks",
        "",
        "| Stack | Evidence |",
        "| --- | --- |",
        "| go | `go.mod` |",
        "| node | `package.json` |",
        "",
        "## Commands",
        "",
        "### Test",
        "",
        "```text",
        "npm test",
        "```",
        "",
        "### Lint",
        "",
        "```text",
        "npm run lint | tee lint.log",
        "```",
        "",
        "### Build",
        "",
        "Not applicable: No build step\\.",
        "",
        "### Run",
        "",
        "```text",
        "go run ./cmd/api",
        "```",
        "",
        "## Paths",
        "",
        "| Path group | Value |",
        "| --- | --- |",
        "| Source | src, cmd/api |",
        "| Tests | tests |",
        "| Configuration | Not applicable: Configuration is supplied by the host\\. |",
        "",
        "## Conventions",
        "",
        "| Convention | Value |",
        "| --- | --- |",
        "| Directory layout | Feature folders &lt;own&gt; their adapters\\. |",
        "| Naming | Use \\`camelCase\\` for TypeScript\\. |",
        "| Implementation languages | TypeScript, Go |",
        "",
        "## Language policy",
        "",
        "| Artifact | Language |",
        "| --- | --- |",
        "| Conversation | `pt-BR` |",
        "| Documentation | `pt-BR` |",
        "| Comments | `en` |",
        "| Identifiers | `en` |",
        "| Commits | `en` |",
        "| Preserve conventions | `false` |",
        "| Enforcement | `off` |",
      ].join("\n") + "\n",
    );
  });

  it("keeps command bytes copyable while escaping Markdown prose and control-bearing labels", () => {
    const command = "run && pipe | read < input > output & keep";
    const backticks = "printf '```'";
    const profile = contentAt(
      skeletonEffects(
        answers({
          projectProfile: {
            commands: {
              test: { status: "resolved", value: command },
              lint: { status: "resolved", value: backticks },
              build: {
                status: "not-applicable",
                reason: "![x](https://example.test/x) *not* _built_",
              },
              run: { status: "unresolved" },
            },
            paths: {
              source: { status: "unresolved" },
              tests: { status: "unresolved" },
              configuration: { status: "unresolved" },
            },
            conventions: {
              directoryLayout: { status: "unresolved" },
              naming: { status: "unresolved" },
              implementationLanguages: {
                status: "resolved",
                value: ["Type\nScript", "Go\tlang", "C\u0000lang"],
              },
            },
          },
        }),
        nodeProject,
      ),
      ".brain/01-architecture/stack-profile.md",
    );

    expect(profile).toContain(`### Test\n\n\`\`\`text\n${command}\n\`\`\``);
    expect(profile).toContain(
      `### Lint\n\n\`\`\`\`text\n${backticks}\n\`\`\`\``,
    );
    expect(profile).not.toContain("&amp;&amp;");
    expect(profile).not.toContain("&#124;");
    expect(profile).toContain(
      "Not applicable: \\!\\[x\\]\\(https://example\\.test/x\\) \\*not\\* \\_built\\_",
    );
    expect(profile).toContain("Type\\\\nScript, Go\\\\tlang, C\\\\u0000lang");
  });

  it("says plainly when no known stack matched", () => {
    const profile = contentAt(
      skeletonEffects(answers(), profileStack({ rootEntries: ["README.md"] })),
      ".brain/01-architecture/stack-profile.md",
    );

    expect(profile).toContain("No known stack matched");
  });

  it("wraps the host instructions in the managed markers", () => {
    const generated = skeletonEffects(answers(), nodeProject);

    for (const path of ["AGENTS.md", "CLAUDE.md"]) {
      const content = contentAt(generated, path);

      // Task 4 replaces what sits between these markers and nothing else, so
      // an instruction file that does not carry them cannot be updated safely.
      expect(content.startsWith(`${MANAGED_SECTION_BEGIN}\n`)).toBe(true);
      expect(content.endsWith(`${MANAGED_SECTION_END}\n`)).toBe(true);
    }
  });

  it("carries the conversation language into the host instructions", () => {
    const generated = skeletonEffects(
      answers({
        language: {
          conversation: "pt-BR",
          documentation: "pt-BR",
          comments: "en",
          identifiers: "en",
          commits: "en",
          preserveConventions: true,
          enforcement: "advisory",
        },
      }),
      nodeProject,
    );

    // The managed content stays in English; the language answer says which
    // language the host converses in.
    expect(contentAt(generated, "CLAUDE.md")).toContain("Conversation: pt-BR");
    expect(contentAt(generated, "AGENTS.md")).toContain("Conversation: pt-BR");
  });

  it("renders the language policy section into .codex/config.toml", () => {
    const generated = skeletonEffects(
      answers({
        language: {
          conversation: "pt-BR",
          documentation: "pt-BR",
          comments: "en",
          identifiers: "en",
          commits: "en",
          preserveConventions: true,
          enforcement: "advisory",
        },
      }),
      nodeProject,
    );
    const toml = contentAt(generated, ".codex/config.toml");
    expect(toml).toContain("[language]");
    expect(toml).toContain('conversation = "pt-BR"');
    expect(toml).toContain('documentation = "pt-BR"');
    expect(toml).toContain('comments = "en"');
    expect(toml).toContain('identifiers = "en"');
    expect(toml).toContain('commits = "en"');
    expect(toml).toContain("preserve_conventions = true");
    expect(toml).toContain('enforcement = "advisory"');
  });

  it("names only the destinations of a plan, not its narration", () => {
    // A plan carries emitted output as well as writes, and an emitted line is
    // not a file anybody has to be told was touched.
    expect(
      destinationsOf([
        { kind: "emit", channel: "human", text: "Initializing." },
        { kind: "write_file", path: ".brain/config.json", content: "{}\n" },
      ]),
    ).toEqual([".brain/config.json"]);
  });

  it("gives every generated file a body a reader can act on", () => {
    const generated = skeletonEffects(answers(), nodeProject);
    const empty = generated
      .filter(
        (effect) => effect.kind === "write_file" && effect.content.length === 0,
      )
      .map((effect) => (effect.kind === "write_file" ? effect.path : ""));

    // The append-only records and the directory keeper start empty on purpose;
    // everything else says what it is for.
    expect(empty).toEqual([
      ".brain/01-architecture/adr/.gitkeep",
      ".brain/02-features/active",
      ".brain/03-memory/decisions.log",
      ".brain/03-memory/task_log.jsonl",
    ]);
  });
});
