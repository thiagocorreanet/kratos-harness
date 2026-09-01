import { FEATURE_DOCUMENTS } from "../feature-documents/index.js";
import { PHASE_AGENT_PROMPTS } from "../phase-agents/index.js";
import {
  skeletonEffects,
  profileStack,
  unresolvedProjectProfile,
} from "../init/index.js";
import { extractManagedSection } from "../init/managed-section.js";
import type { PromptCategory } from "./model.js";

export interface ShippedPromptSurface {
  readonly id: string;
  readonly path: string;
  readonly category: PromptCategory;
  readonly host?: "claude-code" | "codex" | "antigravity" | "shared";
  readonly getRenderedText: () => string;
}

export interface CollectShippedPromptOptions {
  readonly distributionDir?: string;
  readonly repositoryRoot?: string;
  readonly fileReader?: (path: string) => string | undefined;
}

const CLAUDE_CODE_SKILL = `---
name: kratos
description: Run the deterministic Kratos objective-to-done workflow without changing runtime decisions.
---

# Kratos for Claude Code

Resolve this skill's own directory and invoke
\`node scripts/kratos.mjs <arguments>\`. The script is only a plugin-relative
bridge to the installed runtime. Never copy it into the project, require a
global \`kratos\` binary, or reproduce a gate decision in the prompt.

## Scope activation

Immediately after valid reviewer prose is available, invoke
\`node scripts/kratos.mjs scope record --root <absolute-project-root>\` from this
skill directory before any implementation begins. The runtime alone translates
reviewer prose, validates scope, and decides whether recording may proceed;
stop and relay any refusal unchanged.

## Initialization interview

Before \`kratos init\`, load \`scripts/project-profile-relay.mjs\` from this skill
directory. Ask every exported \`projectProfileQuestions\` entry in order. Record
each answer explicitly as \`resolved\`, \`not-applicable\` with a reason, or
\`unresolved\`; never infer an answer from stack detection or repository
contents. Commands are exact single-line strings run from the project root,
paths are project-relative lists, and implementation languages are programming
languages rather than the human-language policy.

Pass the keyed answers to \`relayProjectProfileAnswers\`, place its returned
value in \`host.init-answers@1.3.0\` as \`projectProfile\`, and pipe that complete
document to:

\`\`\`bash
node scripts/kratos.mjs init --host claude --root <absolute-project-root>
\`\`\`

The relay shapes values only. It does not validate readiness, parse generated
Markdown, or execute any configured command.

## Runtime workflow

1. Run \`node scripts/kratos.mjs handshake --json\` from this skill directory
   before the first stateful command.
2. Pass \`--root\` explicitly for every project operation.
3. Use \`objective\`, \`start\`, \`continue\`, \`approve\`, \`evidence record\`, and
   \`done\` in that order as the runtime state requires.
4. During the \`prd\` and \`spec\` phases, propose gaps as a
   \`host.gap-proposal@1.0.0\` document and hand it to \`gaps record <path>\`. A
   gap is one of four things: a rule that admits two readings which produce
   different code, a decision only the owner can make, a contradiction between
   two passages, or an external dependency nobody has confirmed. Propose
   nothing outside that set, and never decide whether a gap blocks: the
   runtime derives that.
5. Relay stable reason codes and recovery text exactly. Ask the user only when
   the runtime requests approval or returns a non-retryable decision.
6. Forward cancellation, timeout, hook, and error observations only after
   converting them to the published Kratos host-operation contract. Never pipe
   a raw Claude Code hook event directly into the runtime.

Treat model identity as observed metadata. If the host does not expose it, use
\`null\`; never infer a model name from conversational text.

## Phase-agent relay boundary

For phase work, the Claude Code host integration must load
\`scripts/phase-agent-relay.mjs\`. Its runtime transport invokes the packaged
runtime with \`--json handoff --root <absolute-project-root>\` and passes the
returned handoff to the relay. Its launcher binds the native Claude Code
phase-agent call to the returned \`model\` and \`effort\` exactly. The record
transport invokes \`agent record\` with the adapter message produced by the
relay, which keeps the returned \`assignmentDigest\` outside agent output.
Supply the relay with the host-observed \`sessionId\` and \`occurredAt\`. Before
the native launcher runs, the relay sends that lifecycle and the handoff's
\`assignmentDigest\` to \`hook --host claude-code\`. A nonzero start returns
\`runtime-refused\` with the runtime rendering and does not launch or record.

Declare exact model and effort selection unavailable when the native launcher
cannot bind either field. The relay then returns
\`exact-selection-unsupported\` before calling the launcher or \`agent record\`.
This is a host capability boundary, not a replacement workflow verdict; do not
choose another assignment. A missing host observation remains \`null\`.
`;

const CODEX_SKILL = `---
name: kratos
description: Run the deterministic Kratos objective-to-done workflow through its embedded runtime.
---

# Kratos for Codex

Resolve this skill's own directory and invoke
\`node scripts/kratos.mjs <arguments>\`. The script is only a plugin-relative
bridge to the installed runtime. Do not copy it into the project, depend on a
global binary, or implement workflow policy in this skill.

## Scope activation

Immediately after valid reviewer prose is available, invoke
\`node scripts/kratos.mjs scope record --root <absolute-project-root>\` from this
skill directory before any implementation begins. The runtime alone translates
reviewer prose, validates scope, and decides whether recording may proceed;
stop and relay any refusal unchanged.

## Initialization interview

Before \`kratos init\`, load \`scripts/project-profile-relay.mjs\` from this skill
directory. Ask every exported \`projectProfileQuestions\` entry in order. Record
each answer explicitly as \`resolved\`, \`not-applicable\` with a reason, or
\`unresolved\`; never infer an answer from stack detection or repository
contents. Commands are exact single-line strings run from the project root,
paths are project-relative lists, and implementation languages are programming
languages rather than the human-language policy.

Pass the keyed answers to \`relayProjectProfileAnswers\`, place its returned
value in \`host.init-answers@1.3.0\` as \`projectProfile\`, and pipe that complete
document to:

\`\`\`bash
node scripts/kratos.mjs init --host codex --root <absolute-project-root>
\`\`\`

The relay shapes values only. It does not validate readiness, parse generated
Markdown, or execute any configured command.

## Runtime workflow

Run a JSON handshake first, pass an explicit project \`--root\`, and relay the
runtime's result, reason code, evidence, and recovery unchanged. The normal
trail is \`objective\`, \`start\`, \`continue\`, content-bound \`approve\`,
\`evidence record\`, and \`done\`. During the \`prd\` and \`spec\` phases, propose
gaps as a \`host.gap-proposal@1.0.0\` document and hand it to
\`gaps record <path>\`. A gap is one of four things: a rule that admits two
readings which produce different code, a decision only the owner can make, a
contradiction between two passages, or an external dependency nobody has
confirmed. Propose nothing outside that set, and never decide whether a gap
blocks the run; the runtime derives that from what it recorded. Lifecycle cancellation, timeout, hook, and error
facts are sent to \`hook --host codex\` through the shared host contract.

Unknown model identity stays \`null\`. A user-provided model label is not an
observed host identity.

## Phase-agent relay boundary

For phase work, the Codex host integration must load
\`scripts/phase-agent-relay.mjs\`. Its runtime transport invokes the packaged
runtime with \`--json handoff --root <absolute-project-root>\` and passes the
returned handoff to the relay. Its launcher binds the native Codex phase-agent
call to the returned \`model\` and \`effort\` exactly. The record transport invokes
\`agent record\` with the adapter message produced by the relay, which keeps the
returned \`assignmentDigest\` outside agent output.
Supply the relay with the host-observed \`sessionId\` and \`occurredAt\`. Before
the native launcher runs, the relay sends that lifecycle and the handoff's
\`assignmentDigest\` to \`hook --host codex\`. A nonzero start returns
\`runtime-refused\` with the runtime rendering and does not launch or record.

Declare exact model and effort selection unavailable when the native launcher
cannot bind either field. The relay then returns
\`exact-selection-unsupported\` before calling the launcher or \`agent record\`.
This is a host capability boundary, not a replacement workflow verdict; do not
choose another assignment. A missing host observation remains \`null\`.
`;

const ANTIGRAVITY_SKILL = `---
name: kratos
description: Run the deterministic Kratos objective-to-done workflow through its embedded runtime.
---

# Kratos for Antigravity

Resolve this skill's own directory and invoke
\`node scripts/kratos.mjs <arguments>\`. The script is only a plugin-relative
bridge to the installed runtime. Do not copy it into the project, depend on a
global binary, or implement workflow policy in this skill.

## Scope activation

Immediately after valid reviewer prose is available, invoke
\`node scripts/kratos.mjs scope record --root <absolute-project-root>\` from this
skill directory before any implementation begins. The runtime alone translates
reviewer prose, validates scope, and decides whether recording may proceed;
stop and relay any refusal unchanged.

## Initialization interview

Before \`kratos init\`, load \`scripts/project-profile-relay.mjs\` from this skill
directory. Ask every exported \`projectProfileQuestions\` entry in order. Record
each answer explicitly as \`resolved\`, \`not-applicable\` with a reason, or
\`unresolved\`; never infer an answer from stack detection or repository
contents. Commands are exact single-line strings run from the project root,
paths are project-relative lists, and implementation languages are programming
languages rather than the human-language policy.

Pass the keyed answers to \`relayProjectProfileAnswers\`, place its returned
value in \`host.init-answers@1.3.0\` as \`projectProfile\`, and pipe that complete
document to:

\`\`\`bash
node scripts/kratos.mjs init --host antigravity --root <absolute-project-root>
\`\`\`

The relay shapes values only. It does not validate readiness, parse generated
Markdown, or execute any configured command.

## Runtime workflow

1. Run \`node scripts/kratos.mjs handshake --json\` from this skill directory
   before the first stateful command.
2. Pass \`--root\` explicitly for every project operation.
3. Use \`objective\`, \`start\`, \`continue\`, \`approve\`, \`evidence record\`, and
   \`done\` in that order as the runtime state requires.
4. During the \`prd\` and \`spec\` phases, propose gaps as a
   \`host.gap-proposal@1.0.0\` document and hand it to \`gaps record <path>\`. A
   gap is one of four things: a rule that admits two readings which produce
   different code, a decision only the owner can make, a contradiction between
   two passages, or an external dependency nobody has confirmed. Propose
   nothing outside that set, and never decide whether a gap blocks: the
   runtime derives that.
5. Relay stable reason codes and recovery text exactly. Ask the user only when
   the runtime requests approval or returns a non-retryable decision.
6. Forward cancellation, timeout, hook, and error observations only after
   converting them to the published Kratos host-operation contract. Never pipe
   a raw Antigravity hook event directly into the runtime.

Treat model identity as observed metadata. If the host does not expose it, use
\`null\`; never infer a model name from conversational text.

## Phase-agent relay boundary

For phase work, the Antigravity host integration must load
\`scripts/phase-agent-relay.mjs\`. Its runtime transport invokes the packaged
runtime with \`--json handoff --root <absolute-project-root>\` and passes the
returned handoff to the relay. Its launcher binds the native Antigravity
phase-agent call to the returned \`model\` and \`effort\` exactly. The record
transport invokes \`agent record\` with the adapter message produced by the
relay, which keeps the returned \`assignmentDigest\` outside agent output.

Declare exact model and effort selection unavailable when the native launcher
cannot bind either field. The relay then returns
\`exact-selection-unsupported\` before calling the launcher or \`agent record\`.
This is a host capability boundary, not a replacement workflow verdict; do not
choose another assignment. A missing host observation remains \`null\`.
`;

const CLAUDE_CODE_ORCHESTRATOR = `---
name: kratos-orchestrator
description: Relays Claude Code lifecycle facts to the embedded Kratos runtime.
---

# Kratos orchestrator

Use the \`kratos\` skill. The runtime owns workflow state, gates, reason codes,
approvals, and mutations. This agent may collect host facts and render runtime
results, but it must not advance a phase or reinterpret a refusal on its own.
`;

export function collectShippedPromptSurfaces(
  options?: CollectShippedPromptOptions,
): readonly ShippedPromptSurface[] {
  const surfaces: ShippedPromptSurface[] = [];

  // 1. Host Skills
  const hostSkillPaths = [
    {
      host: "claude-code" as const,
      rel: "claude-code/skills/kratos/SKILL.md",
      content: CLAUDE_CODE_SKILL,
    },
    {
      host: "codex" as const,
      rel: "codex/skills/kratos/SKILL.md",
      content: CODEX_SKILL,
    },
    {
      host: "antigravity" as const,
      rel: "antigravity/skills/kratos/SKILL.md",
      content: ANTIGRAVITY_SKILL,
    },
  ];
  for (const { host, rel, content } of hostSkillPaths) {
    const fullPath = `distribution/${rel}`;
    surfaces.push({
      id: `skill:${host}`,
      path: fullPath,
      category: "host-skill",
      host,
      getRenderedText: () => options?.fileReader?.(fullPath) ?? content,
    });
  }

  // 2. Orchestrator Agents
  const orchestratorRel = "claude-code/agents/kratos-orchestrator.md";
  const orchestratorPath = `distribution/${orchestratorRel}`;
  surfaces.push({
    id: "agent:orchestrator:claude-code",
    path: orchestratorPath,
    category: "orchestrator-prompt",
    host: "claude-code",
    getRenderedText: () =>
      options?.fileReader?.(orchestratorPath) ?? CLAUDE_CODE_ORCHESTRATOR,
  });

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
    contractVersion: "1.4.0" as const,
    hostContract: "1.4.0" as const,
    hosts: ["claude", "codex", "antigravity"] as const,
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
    const block =
      extractManagedSection(claudeEffect.content) ?? claudeEffect.content;
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
    const block =
      extractManagedSection(codexEffect.content) ?? codexEffect.content;
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
