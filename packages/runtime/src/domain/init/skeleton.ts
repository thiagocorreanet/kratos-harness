import {
  KRATOS_VERSION,
  type CuratedMemoryV1,
  type ProjectConfigV1_3,
} from "@kratos/contracts";

import type { Effect } from "../effects.js";
import { FEATURE_DOCUMENTS } from "../feature-documents/index.js";
import {
  PHASE_AGENT_PROMPTS,
  type PhaseAgentDefinition,
} from "../phase-agents/index.js";

import {
  MANAGED_SECTION_BEGIN,
  MANAGED_SECTION_END,
} from "./managed-section.js";
import type { StackProfile } from "./stack.js";
import type { ResolvedAnswers } from "./answers.js";
import { renderStackProfile } from "./stack-profile.js";

type Answers = ResolvedAnswers;
type Host = Answers["hosts"][number];

interface HostSurface {
  /** The root paths this host owns, for the guardrails record. */
  readonly roots: readonly string[];
  readonly files: (answers: Answers) => readonly FileEntry[];
}

type FileEntry = readonly [path: string, content: string];

/**
 * Every file initialization writes, as a plan rather than as work performed.
 *
 * Pure by construction: the destinations and the bytes are a function of the
 * answers, the detected stack, and the contract version alone. No clock, no
 * generated identifier, and no locale-dependent sort reaches the output, which
 * is what lets a second run decide there is nothing to do instead of rewriting
 * files that were already right.
 */
export function skeletonEffects(
  answers: Answers,
  profile: StackProfile,
): readonly Effect[] {
  const hosts = new Set<Host>(answers.hosts);
  const files: FileEntry[] = [...stateFiles(answers, profile)];
  for (const [host, surface] of HOST_SURFACES) {
    if (hosts.has(host)) files.push(...surface.files(answers));
  }

  return Object.freeze(
    files
      .sort(([left], [right]) => compare(left, right))
      .map(([path, content]) =>
        Object.freeze({ kind: "write_file", path, content } as const),
      ),
  );
}

/** The destinations a plan touches, in plan order. */
export function destinationsOf(effects: readonly Effect[]): readonly string[] {
  return effects.flatMap((effect) => ("path" in effect ? [effect.path] : []));
}

/**
 * Order by code unit rather than by locale.
 *
 * `localeCompare` sorts differently under different locales, and a plan whose
 * order depends on the machine that built it is a plan that cannot be compared
 * against the one built yesterday. Every value sorted here is a destination,
 * and destinations are unique, so there is no equal case to decide.
 */
function compare(left: string, right: string): number {
  return left < right ? -1 : 1;
}

function lines(...content: readonly string[]): string {
  return `${content.join("\n")}\n`;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The `.brain` skeleton, which is the same whichever hosts are enabled.
 *
 * State is the project's, not a host's: a project initialized for Claude Code
 * and later opened in Codex must not need different state.
 */
function stateFiles(
  answers: Answers,
  profile: StackProfile,
): readonly FileEntry[] {
  return [
    [".brain/.gitignore", brainGitignore()],
    [".brain/00-business/README.md", businessReadme()],
    [".brain/01-architecture/README.md", architectureReadme()],
    // An empty keeper is how the directory survives a checkout while it holds
    // no decision yet.
    [".brain/01-architecture/adr/.gitkeep", ""],
    [
      ".brain/01-architecture/stack-profile.md",
      renderStackProfile(profile, answers.projectProfile, answers.language),
    ],
    [".brain/02-features/README.md", featuresReadme()],
    ...FEATURE_DOCUMENTS.map(
      ({ id, template }) =>
        [`.brain/02-features/_template/${id}.md`, template] as const,
    ),
    [".brain/02-features/_template/state.json", templateState()],
    // The name of the active feature, written by the command that selects one.
    [".brain/02-features/active", ""],
    [".brain/03-memory/.cache/feature-create.json", json({})],
    // Append-only records start empty: a seeded entry would be a decision
    // nobody made and a metric nobody measured.
    [".brain/03-memory/curated-memory.json", curatedMemory()],
    [".brain/03-memory/decisions.log", ""],
    [".brain/03-memory/gotchas.md", gotchasDocument()],
    [".brain/03-memory/task_log.jsonl", ""],
    [".brain/03-memory/task_metrics.md", taskMetricsDocument()],
    [".brain/config.json", configuration(answers)],
    [".brain/guardrails.json", guardrails(answers)],
  ];
}

const HOST_SURFACES: readonly (readonly [Host, HostSurface])[] = [
  [
    "claude",
    {
      roots: [".claude", "CLAUDE.md"],
      files: (answers) => [
        [".claude/settings.json", claudeSettings()],
        [
          "CLAUDE.md",
          instructions(
            answers,
            "CLAUDE.md",
            "Host settings live in `.claude/settings.json`.",
          ),
        ],
      ],
    },
  ],
  [
    "codex",
    {
      roots: [".codex", "AGENTS.md"],
      files: (answers) => [
        ...PHASE_AGENT_PROMPTS.map(
          (definition) =>
            [
              `.codex/agents/${definition.id}.toml`,
              agentDefinition(definition),
            ] as const,
        ),
        [".codex/config.toml", codexConfiguration(answers)],
        [
          "AGENTS.md",
          instructions(
            answers,
            "AGENTS.md",
            "Agent definitions live in `.codex/agents` and host settings in " +
              "`.codex/config.toml`.",
          ),
        ],
      ],
    },
  ],
  [
    "antigravity",
    {
      roots: [".gemini", "GEMINI.md"],
      files: (answers) => [
        [".gemini/settings.json", geminiSettings()],
        [
          "GEMINI.md",
          instructions(
            answers,
            "GEMINI.md",
            "Host settings live in `.gemini/settings.json`.",
          ),
        ],
      ],
    },
  ],
];

function configuration(answers: Answers): string {
  const config: ProjectConfigV1_3 = {
    contractVersion: "1.3.0",
    stateContract: "1.3.0",
    pluginVersion: KRATOS_VERSION,
    hostContract: "1.3.0",
    language: answers.language,
    policyMode: answers.policyMode,
    managedState: {
      directory: ".brain",
      eventLog: "events.jsonl",
      snapshots: answers.snapshots,
    },
    modelRoles: answers.modelRoles,
    projectProfile: structuredClone(
      answers.projectProfile,
    ) as ProjectConfigV1_3["projectProfile"],
  };
  return json(config);
}

/**
 * The managed paths and workflow policy mode, recorded where a person can
 * inspect the same inputs the deterministic gate evaluator consumes.
 */
function guardrails(answers: Answers): string {
  const hosts = new Set<Host>(answers.hosts);
  const roots = [".brain"];
  for (const [host, surface] of HOST_SURFACES) {
    if (hosts.has(host)) roots.push(...surface.roots);
  }
  return json({
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    policyMode: answers.policyMode,
    snapshots: answers.snapshots,
    managedPaths: roots.sort(compare),
  });
}

function brainGitignore(): string {
  return lines(
    "# Volatile telemetry and run event streams are not tracked.",
    "03-memory/task_log.jsonl",
    "03-memory/.cache/",
    "03-memory/candidates/",
    "02-features/*/runs/*/events.jsonl",
    "events.jsonl",
    "*.trace",
    "traces/",
  );
}

function businessReadme(): string {
  return lines(
    "# Business context",
    "",
    "Why this project exists, who it is for, and what it refuses to do. Write",
    "the constraints a reader could not recover from the code, and leave the",
    "rest to the code.",
  );
}

function architectureReadme(): string {
  return lines(
    "# Architecture",
    "",
    "How this project is put together. One decision per file under `adr`,",
    "recorded when it is made rather than reconstructed later.",
    "",
    "`stack-profile.md` is generated from the project root and is overwritten",
    "on the next initialization.",
  );
}

function featuresReadme(): string {
  return lines(
    "# Features",
    "",
    "One directory per feature, created from `_template`. `active` names the",
    "feature currently being worked on, and is empty when none is.",
  );
}

/**
 * The contract header every piece of state carries.
 *
 * The lifecycle fields belong to the command that owns the feature lifecycle,
 * `SDD-02`. A template that guessed them would freeze a shape nothing reads.
 */
function templateState(): string {
  return json({ contractVersion: "1.0.0", stateContract: "1.0.0" });
}

function gotchasDocument(): string {
  return lines(
    "# Gotchas",
    "",
    "## Confirmed lessons",
    "",
    "No confirmed lessons.",
    "",
    "## Archived lessons",
    "",
    "No archived lessons.",
  );
}

function curatedMemory(): string {
  const ledger: CuratedMemoryV1 = {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    revision: 0,
    projectionDigest:
      "09b049b364f55134c3b4942b653a7b677f7775fb67de8321064e6237da852e83",
    updatedAt: "1970-01-01T00:00:00Z",
    confirmed: [],
    archive: [],
  };
  return json(ledger);
}

function taskMetricsDocument(): string {
  return lines(
    "# Task metrics",
    "",
    "Measurements taken from real runs. A number without the run it came from",
    "is a claim, not a measurement.",
  );
}

/**
 * Claude Code settings, granting nothing.
 *
 * Initialization establishes the file; deciding what a host may do is the
 * adapter's work in `ADP-02`, and an allowance invented here would be a
 * permission nobody granted.
 */
function claudeSettings(): string {
  return json({ permissions: { allow: [], deny: [] } });
}

function geminiSettings(): string {
  return json({ permissions: { allow: [], deny: [] } });
}

function codexConfiguration(answers: Answers): string {
  return lines(
    `# Managed by Kratos ${KRATOS_VERSION}.`,
    "",
    'contract_version = "1.3.0"',
    'host_contract = "1.3.0"',
    `policy_mode = "${answers.policyMode}"`,
    "",
    "[language]",
    `conversation = "${answers.language.conversation}"`,
    `documentation = "${answers.language.documentation}"`,
    `comments = "${answers.language.comments}"`,
    `identifiers = "${answers.language.identifiers}"`,
    `commits = "${answers.language.commits}"`,
    `preserve_conventions = ${String(answers.language.preserveConventions)}`,
    `enforcement = "${answers.language.enforcement}"`,
    "",
    "[state]",
    'directory = ".brain"',
    'event_log = "events.jsonl"',
    `snapshots = ${String(answers.snapshots)}`,
  );
}

function agentDefinition(definition: PhaseAgentDefinition): string {
  return lines(
    `# Managed by Kratos ${KRATOS_VERSION}.`,
    "",
    `name = ${JSON.stringify(definition.id)}`,
    `description = ${JSON.stringify(definition.description)}`,
    'state = ".brain"',
    `developer_instructions = ${JSON.stringify(definition.instructions)}`,
  );
}

/**
 * The instructions a host reads, wrapped in the managed markers.
 *
 * The managed content stays in English whatever the answers say. `language` is
 * the language the host converses in, not a second copy of this document to
 * keep in step with the first.
 */
function instructions(answers: Answers, file: string, note: string): string {
  return lines(
    MANAGED_SECTION_BEGIN,
    "# Kratos",
    "",
    `Kratos ${KRATOS_VERSION} manages this section of ${file}. Anything`,
    "outside the markers belongs to this project and is preserved exactly as",
    "it was written.",
    "",
    "## This project",
    "",
    "- Language policy:",
    `  - Conversation: ${answers.language.conversation}`,
    `  - Documentation: ${answers.language.documentation}`,
    `  - Code comments: ${answers.language.comments}`,
    `  - Code identifiers: ${answers.language.identifiers}`,
    `  - Suggested commits: ${answers.language.commits}`,
    `  - Preserve conventions: ${answers.language.preserveConventions ? "enabled" : "disabled"}`,
    `  - Enforcement: ${answers.language.enforcement}`,
    `- Policy mode: ${answers.policyMode}`,
    `- Snapshots: ${answers.snapshots ? "enabled" : "disabled"}`,
    "- Managed state: `.brain`, described by `.brain/config.json`",
    "",
    "## Working here",
    "",
    "- Feature work lives under `.brain/02-features`, started from the files",
    "  in `_template`.",
    "- Decisions belong in `.brain/03-memory/decisions.log` and the traps you",
    "  hit belong in `.brain/03-memory/gotchas.md`.",
    "- Architecture records live in `.brain/01-architecture`, one decision per",
    "  file under `adr`.",
    `- ${note}`,
    "",
    MANAGED_SECTION_END,
  );
}
