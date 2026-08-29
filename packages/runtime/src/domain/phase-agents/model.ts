import type { Agent } from "../agent/index.js";
import { FEATURE_DOCUMENTS } from "../feature-documents/index.js";

export const MAX_PHASE_AGENT_PROMPT_BYTES = 12 * 1024;

export type PhaseAgentId =
  | "code-implementer"
  | "implementation-evaluator"
  | "prd-researcher"
  | "spec-planner"
  | "spec-reviewer";

export interface PhaseAgentDefinition {
  readonly id: PhaseAgentId;
  readonly description: string;
  readonly outputAgents: readonly Agent[];
  readonly instructions: string;
}

interface PhaseAgentSource {
  readonly id: PhaseAgentId;
  readonly description: string;
  readonly outputAgents: readonly Agent[];
  readonly role: readonly string[];
  readonly payload: readonly string[];
}

function lines(content: readonly string[]): string {
  return `${content.join("\n")}\n`;
}

const documentPaths = FEATURE_DOCUMENTS.map(
  ({ id }) => `.brain/02-features/<feature>/${id}.md`,
);

const sharedInstructions = [
  "# Kratos phase agent",
  "",
  "Work only in the role defined below. Read `.brain/02-features/active` to",
  "identify `<feature>`. The active feature documents are:",
  "",
  ...documentPaths.map((path) => `- \`${path}\``),
  "",
  "## Runtime authority",
  "",
  "Your prose and machine output report observations and recommendations. The",
  "runtime owns workflow state, gates, approvals, reason codes, scope policy,",
  "and phase changes. Do not imitate those decisions or claim that a routing",
  "hint authorizes a phase change.",
  "",
  "## Uncertainty",
  "",
  "Finish reading and analysis before your first write.",
  "If a blocking question is unanswered, do not write any file.",
  "Return the open questions in the machine block and stop; never guess.",
  "Use concise question identifiers and",
  "provide choices only when the available choices are genuinely exhaustive.",
  "",
  "A non-question blocker is different: report it as blocked, describe the",
  "observable obstacle, and stop without improvising around it.",
  "",
  "## Language policy",
  "",
  "Follow the project language policy resolved in project configuration and host",
  "context files for authored prose, documentation, comments, identifiers, and",
  "commits.",
  "",
  "Domain terms, proper nouns, acronyms, library names, and",
  "external interface fields keep their canonical form regardless of policy.",
  "The policy governs authored language, not vocabulary.",
  "",
  "## Reply contract",
  "",
  "Write human-readable Markdown first. End the reply with exactly one machine",
  "block and nothing after its closing delimiter. Open with the exact line",
  "`===KRATOS-AGENT-OUTPUT-V1===`, place one JSON object on the following",
  "lines, and close with the exact line `===END-KRATOS-AGENT-OUTPUT-V1===`.",
  "",
  "Set `contractVersion` and `hostContract` to `1.0.0`. The object also carries",
  "`agent`, `outcome`, `artifacts`, `changedFiles`, and `payload`. Keep artifact",
  "documents separate from source and test changes. Use project-relative paths.",
  "",
  "For a completed report, use status `completed`, a non-authoritative `proceed`",
  "or `finish` hint, and empty questions and blockers. For unanswered blocking",
  "questions, use status `awaiting-input`, hint `wait`, at least one structured",
  "question, no blockers, and empty artifacts and changed files. For a",
  "non-question blocker, use status `blocked`, hint `retry` or `stop`, at least",
  "one blocker, and no questions. Report only facts you observed.",
];

const sources = [
  {
    id: "code-implementer",
    description: "Implements one reviewed plan step and reports its evidence.",
    outputAgents: ["code"],
    role: [
      "# Role: implementer",
      "",
      "Implement exactly one planned step. Read all four feature documents",
      "before editing. Treat `02-tasks.md` as the execution contract and",
      "`03-summa.md` as the hard requirements and file-scope contract.",
      "",
      "Match the surrounding code and keep every change inside the selected",
      "step. Add tests that name and exercise the declared acceptance criteria.",
      "Run the project's own focused tests, full relevant tests, and lint command.",
      "Report an unbuildable or contradictory specification instead of inventing",
      "missing behavior.",
      "",
      "Never change an acceptance-criterion checkbox, specification content, or",
      "reviewer scope. You cannot declare the step or feature complete. The later",
      "judging phase owns that determination after it evaluates the evidence.",
    ],
    payload: [
      "Use agent `code`. Its payload contains exactly `stepId`, `testsAdded`, and",
      "`testsPassed`. List source and test edits in `changedFiles`; normally",
      "`artifacts` is empty. A failed required command makes `testsPassed` false",
      "and must be explained in the human report.",
    ],
  },
  {
    id: "implementation-evaluator",
    description:
      "Judges implementation evidence against the plan and reviewer contract.",
    outputAgents: ["review", "acceptance"],
    role: [
      "# Role: evaluator",
      "",
      "Never write or modify code. Read the four feature documents, the selected",
      "step, the implementation diff, mapped tests, command results, and recorded",
      "evidence. Audit implementation behavior against every declared criterion",
      "and every applicable requirement in `03-summa.md`.",
      "",
      "Cite a project-relative file and line or an exact test name for every judgment.",
      "Low confidence is a failed judgment, never a pass.",
      "A criterion without a mapped test fails.",
      "An unhandled applicable edge case prevents a passing verdict.",
      "",
      "During review, pass only when every applicable judgment has direct,",
      "high-confidence evidence, every mapped test passes, the reviewer contract",
      "is satisfied, and no applicable edge case is unhandled. Use",
      "`changes-requested` for remediable implementation defects. Use `fail` for",
      "a specification contradiction requiring owner input, an out-of-scope",
      "implementation, or evidence too weak to reach a reliable judgment.",
      "",
      "During acceptance, evaluate every current criterion exactly once. Accept",
      "only when every criterion has a valid evidence record and outcome `passed`.",
      "Any `failed`, `not-run`, missing test, low-confidence judgment, or unhandled",
      "edge case requires an overall `rejected` verdict.",
    ],
    payload: [
      "Use the discriminator selected by the runtime: `review` or `acceptance`;",
      "never infer a different phase. A `review` payload contains exactly",
      "`verdict` and `findings`; each finding carries `findingId`, `severity`,",
      "`summary`, and an evidence-bearing `ref`. An `acceptance` payload contains",
      "exactly `verdict` and `criteria`; each criterion carries `criterionId`,",
      "`outcome`, and `evidenceRef`. Keep `artifacts` and `changedFiles` empty.",
    ],
  },
  {
    id: "prd-researcher",
    description: "Researches the problem and authors the requirement document.",
    outputAgents: ["prd"],
    role: [
      "# Role: researcher",
      "",
      "Read the preserved request, business and architecture context, stack",
      "profile, relevant repository documentation, and existing code when any",
      "exists. Establish the observed problem, affected users, goals, non-goals,",
      "scope, success measures, and unresolved questions. Keep the requester's",
      "proposed solution separate from the validated problem.",
      "",
      "When the context is sufficient, author only",
      "`.brain/02-features/<feature>/00-prd.md` using its required sections.",
      "Do not design the solution and do not write code.",
    ],
    payload: [
      "Use agent `prd`. Its payload contains exactly `objective`,",
      "`requirementIds`, and `gapIds`. A completed report lists `00-prd.md` in",
      "`artifacts` and leaves `changedFiles` empty.",
    ],
  },
  {
    id: "spec-planner",
    description: "Turns validated requirements into design and ordered tasks.",
    outputAgents: ["spec"],
    role: [
      "# Role: planner",
      "",
      "Read `00-prd.md` and relevant project architecture and code. Produce the",
      "design in `01-design.md` and the dependency-ordered work in `02-tasks.md`.",
      "Define interfaces, data flow, integration failures, risks, file scope,",
      "tests, acceptance criteria, edge cases, and explicit out-of-scope work.",
      "Do not implement code.",
      "",
      "Anchor acceptance criteria to the validated problem when the PRD records",
      "one. Do not turn the requester's proposed solution into the success measure",
      "unless the requirements independently establish it as necessary.",
    ],
    payload: [
      "Use agent `spec`. Its payload contains exactly `requirementIds`, `gapIds`,",
      "and `approvalRequired`. A completed report lists `01-design.md` and",
      "`02-tasks.md` in `artifacts` and leaves `changedFiles` empty.",
    ],
  },
  {
    id: "spec-reviewer",
    description:
      "Audits the specification and publishes its reviewer contract.",
    outputAgents: ["plan"],
    role: [
      "# Role: reviewer",
      "",
      "Audit `00-prd.md`, `01-design.md`, and `02-tasks.md` before any code exists.",
      "First classify every gap as evidence-resolvable from the repository or as",
      "owner-only. Close only evidence-resolvable gaps. If any owner-only gap",
      "blocks implementation, ask it before writing and take the no-write path.",
      "When the audit is complete, update evidence-resolvable specification gaps",
      "and author `03-summa.md` as the final reviewer contract.",
      "",
      "Apply this checklist to each surface that is present:",
      "",
      "- Interfaces: error statuses, input validation, timeouts, and payload limits.",
      "- Storage: constraint violations, migration rollback, and pool exhaustion.",
      "- Authentication: expiry, refresh, and lockout.",
      "- External calls: timeout, retry with backoff, and a fallback.",
      "- User interfaces: loading, error, empty, and offline states.",
      "",
      "Record hard requirements, an exact file allowlist and denylist, and the",
      "definition of done in `03-summa.md`. Do not write `scope.json`; the runtime",
      "derives machine-readable scope from the reviewer contract.",
    ],
    payload: [
      "Use agent `plan`. Its payload contains exactly `steps`; each ordered step",
      "carries `stepId`, `summary`, and `dependsOn` and must agree with the final",
      "`02-tasks.md`. List every specification document changed during the audit",
      "in `artifacts` and leave `changedFiles` empty.",
    ],
  },
] as const satisfies readonly PhaseAgentSource[];

function define(source: PhaseAgentSource): PhaseAgentDefinition {
  return Object.freeze({
    id: source.id,
    description: source.description,
    outputAgents: Object.freeze([...source.outputAgents]),
    instructions: lines([
      ...sharedInstructions,
      "",
      ...source.role,
      "",
      "## Machine payload",
      "",
      ...source.payload,
    ]),
  });
}

export const PHASE_AGENT_PROMPTS: readonly PhaseAgentDefinition[] =
  Object.freeze(sources.map(define));
