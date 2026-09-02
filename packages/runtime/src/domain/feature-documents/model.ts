export type FeatureDocumentId =
  "00-prd" | "01-design" | "02-tasks" | "03-summa";

interface SectionDefinition {
  readonly name: string;
  readonly depth: 2 | 3;
  readonly comment?: string;
  readonly placeholder?: string;
  readonly scaffold?: readonly string[];
  readonly subsections?: readonly SectionDefinition[];
}

interface DocumentSource {
  readonly id: FeatureDocumentId;
  readonly title: string;
  readonly subtitle?: string | readonly string[];
  readonly sections: readonly SectionDefinition[];
}

export interface FeatureDocumentDefinition {
  readonly id: FeatureDocumentId;
  readonly title: string;
  readonly requiredSections: readonly string[];
  readonly template: string;
}

export type PrdDocumentObservation =
  | { readonly kind: "missing" }
  | { readonly kind: "untouched" }
  | { readonly kind: "incomplete"; readonly missingSection: string }
  | { readonly kind: "complete" };

const SOURCES = [
  {
    id: "00-prd",
    title: "PRD: <feature name>",
    subtitle:
      "Written by prd-researcher (prd phase) — the WHAT and WHY. No code, no architecture.",
    sections: [
      {
        name: "Problem Discovery",
        depth: 2,
        comment:
          'Start from the problem, not the solution. Fill when the demand is vague, recurring,\n     or stated as a ready solution; otherwise mark the technique "not applied" + why.',
        subsections: [
          {
            name: "Initial demand",
            depth: 3,
            placeholder: "<the original request, verbatim>",
          },
          {
            name: "Classification",
            depth: 3,
            placeholder:
              "<problem | proposed solution | bug | improvement | refactor | external obligation>",
          },
          {
            name: "Technique applied",
            depth: 3,
            placeholder: "<5 Whys applied | 5 Whys not applied>",
          },
          {
            name: "Decision reason",
            depth: 3,
            placeholder: "<why the technique was or wasn't applied>",
          },
          {
            name: "5 Whys investigation",
            depth: 3,
            comment:
              "adaptive: stop when the root cause surfaces; don't force five. Omit if not applied.",
            scaffold: [
              "1. Why is this necessary? — ...",
              "2. Why does it happen today? — ...",
              "3. Why doesn't the current process/system solve it? — ...",
              "4. Why does it impact user/operation/business? — ...",
              "5. Why solve it now? — ...",
            ],
          },
          {
            name: "Probable root cause",
            depth: 3,
            placeholder:
              "<a process/system/rule/flow/communication/architecture/context cause — never person-blame>",
          },
          {
            name: "Validated problem",
            depth: 3,
            placeholder:
              "<the real problem, distinct from the proposed solution>",
          },
          {
            name: "Solution hypothesis",
            depth: 3,
            placeholder: "<a hypothesis, explicitly not yet a committed plan>",
          },
          {
            name: "Success metric",
            depth: 3,
            placeholder: "<how success is measured, tied to the root cause>",
          },
          {
            name: "Risks & premises",
            depth: 3,
            placeholder: "<incl. the risk of assuming the wrong root cause>",
          },
        ],
      },
      {
        name: "Action Framing — 5W2H",
        depth: 2,
        comment:
          "Only after the problem is clear. Skip for small/trivial/well-structured actions;\n     record the skip reason. Never use 5W2H to justify the initial solution on its own.",
        subsections: [
          {
            name: "Technique applied",
            depth: 3,
            placeholder: "<5W2H applied | 5W2H not applied>",
          },
          {
            name: "Decision reason",
            depth: 3,
            placeholder: "<why the technique was or wasn't applied>",
          },
          {
            name: "What — what will be done or investigated",
            depth: 3,
            scaffold: [
              "### Why — why it should be done",
              "### Who — users, areas, systems or owners involved",
              "### Where — module, flow, screen, process or integration affected",
              "### When — priority, urgency, window or milestone",
              "### How — initial approach / strategy",
              "### How Much — effort, complexity, impact or uncertainty (no financial estimate required)",
            ],
          },
          {
            name: "Machine-readable discovery record",
            depth: 3,
            comment:
              "Replace the object below with a state.requirement-discovery@1.0.0 record. The runtime validates the record; this phase never blocks a run.",
            scaffold: [
              "",
              "<!-- KRATOS-REQUIREMENT-DISCOVERY-V1",
              "{}",
              "KRATOS-END-REQUIREMENT-DISCOVERY-V1 -->",
            ],
          },
        ],
      },
      {
        name: "Problem",
        depth: 2,
        placeholder:
          "<2-3 paragraphs: what's broken, who feels the pain, why now — grounded in the validated problem above>",
      },
      {
        name: "Users",
        depth: 2,
        placeholder: "<personas — role, need, context>",
      },
      {
        name: "Goals",
        depth: 2,
        scaffold: ["- <measurable outcome 1>"],
      },
      {
        name: "Non-goals",
        depth: 2,
        scaffold: ["- <explicitly out of scope>"],
      },
      {
        name: "Scope",
        depth: 2,
        scaffold: [
          "**In-scope:**",
          "- <feature/capability>",
          "",
          "**Out-of-scope:**",
          "- <what we're NOT doing>",
        ],
      },
      {
        name: "Success metrics",
        depth: 2,
        placeholder: "<quantitative/behavioral evidence of success>",
      },
      {
        name: "Open questions",
        depth: 2,
        placeholder: "<decisions not yet made — track them, don't paper over>",
      },
    ],
  },
  {
    id: "01-design",
    title: "Design: <feature name>",
    subtitle:
      "Written by spec-planner (spec phase) — the HOW. Diagrams and contracts, no code.",
    sections: [
      {
        name: "Architecture overview",
        depth: 2,
        placeholder: "<ASCII or mermaid diagram + 1-2 paragraphs>",
      },
      {
        name: "Data model",
        depth: 2,
        placeholder:
          "<entities, fields, relationships, migrations, RLS implications>",
      },
      {
        name: "API surface",
        depth: 2,
        placeholder: "<endpoints, request/response shapes, auth requirements>",
      },
      {
        name: "Integration points",
        depth: 2,
        placeholder: "<existing code/services this touches>",
      },
      {
        name: "Trade-offs considered",
        depth: 2,
        scaffold: [
          "| Option | Pros | Cons | Chosen? |",
          "|--------|------|------|---------|",
          "| ... | ... | ... | ... |",
        ],
      },
      {
        name: "Risks",
        depth: 2,
        placeholder: "<things that could go wrong + mitigation>",
      },
    ],
  },
  {
    id: "02-tasks",
    title: "Tasks: <feature name>",
    subtitle: [
      "Status: [ ] todo · [x] done — flipped by the orchestrator after evaluation, never by hand mid-sprint.",
      "AC IDs (AC-<sprint>.<task>.<n>, E<n> for edge cases) are the audit contract — never renumber after approval.",
    ],
    sections: [
      {
        name: "Sprint 1: <name>",
        depth: 2,
      },
      {
        name: "Task 1.1: <imperative title>",
        depth: 3,
        scaffold: [
          "",
          "**Files affected:** <list or glob>",
          "",
          "**Description:** <1-2 sentences>",
          "",
          "**Steps:**",
          "1. ...",
          "",
          "**Acceptance criteria:**",
          "- [ ] AC-1.1.1: <verifiable criterion>",
          "",
          "**Edge cases:**",
          "- [ ] AC-1.1.E1: <what if X fails?> → <expected behavior>",
          "",
          "**Out of scope:**",
          "- <explicit don'ts>",
        ],
      },
    ],
  },
  {
    id: "03-summa",
    title: "Summa: <feature name>",
    subtitle:
      "Written by spec-reviewer (plan phase) — the Judge's contract. Compressed reference the evaluator enforces.",
    sections: [
      {
        name: "In one sentence",
        depth: 2,
        placeholder: "<what this feature does>",
      },
      {
        name: "Hard requirements (the Judge enforces these)",
        depth: 2,
        scaffold: ['- <e.g., "RLS policies must restrict by tenant_id">'],
      },
      {
        name: "Files that should change",
        depth: 2,
        placeholder: "<allowlist — Judge flags edits outside this list>",
      },
      {
        name: "Files that must NOT change",
        depth: 2,
        placeholder: "<denylist — Judge rejects changes touching these>",
        scaffold: [
          "",
          "> Exception: checkbox status flips (`[ ]` → `[x]`) in 02-tasks.md are exempt.",
          "> Any other edit to spec content after approval is an automatic FAIL.",
        ],
      },
      {
        name: "Done means",
        depth: 2,
        placeholder: "<crisp definition — what the Judge checks for PASS>",
      },
    ],
  },
] as const satisfies readonly DocumentSource[];

function comment(text: string): string {
  return `<!-- ${text} -->`;
}

function renderSection(section: SectionDefinition): string[] {
  const lines: string[] = [];
  lines.push("", `${"#".repeat(section.depth)} ${section.name}`);
  if (section.comment !== undefined) {
    lines.push(comment(section.comment));
  }
  if (section.placeholder !== undefined) {
    lines.push(section.placeholder);
  }
  if (section.scaffold !== undefined) {
    lines.push(...section.scaffold);
  }
  if (section.subsections !== undefined) {
    for (const sub of section.subsections) {
      lines.push(...renderSection(sub));
    }
  }
  return lines;
}

function render(source: DocumentSource): string {
  const lines = [`# ${source.title}`];
  if (source.subtitle !== undefined) {
    lines.push("");
    const subtitleLines =
      typeof source.subtitle === "string" ? [source.subtitle] : source.subtitle;
    for (const sub of subtitleLines) {
      lines.push(`> ${sub}`);
    }
  }
  for (const section of source.sections) {
    lines.push(...renderSection(section));
  }
  return `${lines.join("\n")}\n`;
}

function define(source: DocumentSource): FeatureDocumentDefinition {
  return Object.freeze({
    id: source.id,
    title: source.title,
    requiredSections: Object.freeze(source.sections.map(({ name }) => name)),
    template: render(source),
  });
}

export const PRD_DOCUMENT = define(SOURCES[0]);

export const FEATURE_DOCUMENTS: readonly FeatureDocumentDefinition[] =
  Object.freeze([
    PRD_DOCUMENT,
    ...SOURCES.slice(1).map((source) => define(source)),
  ]);

const prd = PRD_DOCUMENT;

/** Classify already-observed PRD bytes without reaching any I/O boundary. */
export function inspectPrdDocument(
  content: string | null,
): PrdDocumentObservation {
  if (content === null) return { kind: "missing" };
  if (content === prd.template) return { kind: "untouched" };

  const headings = markdownHeadings(content);
  for (const section of prd.requiredSections) {
    if (!headings.has(section)) {
      return { kind: "incomplete", missingSection: section };
    }
  }
  return { kind: "complete" };
}

function markdownHeadings(content: string): ReadonlySet<string> {
  const headings = new Set<string>();
  let fence: "`" | "~" | null = null;
  for (const line of content.split(/\r?\n/u)) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker !== undefined) {
      const kind = marker[0] as "`" | "~";
      if (fence === null) fence = kind;
      else if (fence === kind) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^#{2,6}\s+(.+?)\s*#*\s*$/u.exec(line)?.[1];
    if (heading !== undefined) headings.add(heading);
  }
  return headings;
}
