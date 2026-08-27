export type FeatureDocumentId =
  "00-prd" | "01-design" | "02-tasks" | "03-summa";

interface SectionDefinition {
  readonly name: string;
  readonly depth: 2 | 5;
  readonly guidance?: string;
  readonly scaffold?: readonly string[];
}

interface DocumentSource {
  readonly id: FeatureDocumentId;
  readonly title: string;
  readonly guidance: string;
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
    title: "Requirements",
    guidance:
      "Explain the problem and the reasoning behind it. Keep architecture and implementation decisions in 01-design.md.",
    sections: [
      {
        name: "Problem",
        depth: 2,
        guidance: "State the observed problem and why it matters.",
      },
      {
        name: "Affected users",
        depth: 2,
        guidance:
          "Name the users or systems affected and describe the impact on each.",
      },
      {
        name: "Goals",
        depth: 2,
        guidance: "List the outcomes this feature must achieve.",
      },
      {
        name: "Non-goals",
        depth: 2,
        guidance:
          "List adjacent outcomes this feature deliberately will not pursue.",
      },
      {
        name: "Scope boundary",
        depth: 2,
        guidance: "State what is inside and outside the change boundary.",
      },
      {
        name: "Success metrics",
        depth: 2,
        guidance:
          "Define observable measures that show whether the problem was solved.",
      },
      {
        name: "Open questions",
        depth: 2,
        guidance:
          'Record unresolved decisions. Write "None" when every decision is closed.',
      },
      {
        name: "Problem discovery (5 Whys)",
        depth: 2,
        guidance:
          "Quote the original request, classify it, and record whether 5 Whys ran and why. Ask why until the cause surfaces: do not force exactly five questions or stop at five while the cause remains hidden.",
        scaffold: [
          "### Original request (quoted as received)",
          "",
          "<!-- Preserve the requester's words without silently reframing them. -->",
          "",
          "### Classification",
          "",
          "<!-- Choose one: stated problem, proposed solution, defect, improvement, refactor, or external obligation. -->",
          "",
          "### Application decision and investigation",
          "",
          "<!-- Record applied or skipped and the reason. Skip for a well-specified simple operation, small visual change, clear legal obligation, trivial defect with a known cause, or a demand already explicit about problem, impact, metric, and scope. A skip still needs a reason. -->",
          "",
          "<!-- A person is not a root cause. Ask: What allowed the omission to happen? What would have caught it? Rewrite blame as a process, system, rule, flow, communication, architecture, or operating-context cause. -->",
          "",
          "### Discovery outcome",
          "",
          "<!-- State the probable root cause, validated problem, solution hypothesis, success metric, and risk that the assumed cause is wrong. Keep the validated problem and solution hypothesis separate and commit to neither. -->",
        ],
      },
      {
        name: "Action framing (5W2H)",
        depth: 2,
        guidance:
          "Only after the problem is clear, record whether 5W2H ran and why. Skip it for small, trivial, or already well-structured work; a skip still needs a reason.",
        scaffold: [
          "### What, Why, Who, Where, When, How, and How Much",
          "",
          "<!-- When applied, answer all seven fields. How Much means effort, complexity, operational impact, or uncertainty; never require a financial estimate or invent a number. -->",
          "",
          "<!-- 5W2H cannot ratify the requester's original solution. If its only support is that the solution fits these fields, investigate the problem further. State the action plan separately from the validated problem and solution hypothesis, and commit to none. -->",
          "",
          "### Machine-readable discovery record",
          "",
          "<!-- Replace the object below with a state.requirement-discovery@1.0.0 record. The runtime validates the record; this phase never blocks a run. -->",
          "",
          "<!-- KRATOS-REQUIREMENT-DISCOVERY-V1",
          "{}",
          "KRATOS-END-REQUIREMENT-DISCOVERY-V1 -->",
        ],
      },
    ],
  },
  {
    id: "01-design",
    title: "Design",
    guidance:
      "Describe the approach and its contracts. Keep executable code out of this document.",
    sections: [
      {
        name: "Architecture summary",
        depth: 2,
        guidance: "Explain the components, responsibilities, and control flow.",
      },
      {
        name: "Data model",
        depth: 2,
        guidance: "Define data shapes, ownership, lifecycle, and invariants.",
      },
      {
        name: "Interface surface",
        depth: 2,
        guidance:
          "Define public and internal interfaces, inputs, outputs, and errors.",
      },
      {
        name: "Integration points",
        depth: 2,
        guidance: "Name every external boundary and how failures cross it.",
      },
      {
        name: "Trade-offs",
        depth: 2,
        scaffold: [
          "| Decision | Benefit | Cost | Rejected alternative |",
          "| --- | --- | --- | --- |",
        ],
      },
      {
        name: "Risks",
        depth: 2,
        guidance:
          "List technical, compatibility, operational, and security risks with mitigations.",
      },
    ],
  },
  {
    id: "02-tasks",
    title: "Tasks",
    guidance:
      "Order work by dependency. Each work unit must be independently reviewable.",
    sections: [
      {
        name: "Ordered work",
        depth: 2,
        scaffold: [
          "### Work unit 1: Work unit",
          "",
          "<!-- State one concrete change. Add more numbered work units without renumbering approved items. -->",
          "",
          "#### Task 1.1: Task",
          "",
          "<!-- State one task inside this work unit. Preserve approved task coordinates. -->",
        ],
      },
      {
        name: "Files",
        depth: 5,
        guidance: "List every file this work unit may create or modify.",
      },
      {
        name: "Acceptance criteria",
        depth: 5,
        scaffold: [
          "<!-- Declare main-path outcomes as: - [ ] AC-<work-unit>.<task>.<criterion>: Observable outcome. -->",
        ],
      },
      {
        name: "Edge cases",
        depth: 5,
        scaffold: [
          "<!-- Declare boundary and failure outcomes as: - [ ] AC-<work-unit>.<task>.E<criterion>: Observable outcome. -->",
        ],
      },
      {
        name: "Out of scope",
        depth: 2,
        guidance:
          "List work that implementers must not perform as part of this feature.",
      },
    ],
  },
  {
    id: "03-summa",
    title: "Summary",
    guidance:
      "This is the reviewer contract. Summarize constraints; do not introduce new scope.",
    sections: [
      {
        name: "One-sentence statement",
        depth: 2,
        guidance: "State the approved change in one sentence.",
      },
      {
        name: "Hard requirements",
        depth: 2,
        guidance: "List the conditions an implementation may not trade away.",
      },
      {
        name: "File allowlist",
        depth: 2,
        guidance: "List paths the implementation may change.",
      },
      {
        name: "File denylist",
        depth: 2,
        guidance: "List paths the implementation must not change.",
      },
      {
        name: "Definition of done",
        depth: 2,
        guidance: "List the evidence required for acceptance.",
        scaffold: [
          "<!-- After approval, changing specification content fails review. The only exemption is flipping an acceptance checkbox in 02-tasks.md. -->",
        ],
      },
    ],
  },
] as const satisfies readonly DocumentSource[];

function comment(text: string): string {
  return `<!-- ${text} -->`;
}

function render(source: DocumentSource): string {
  const lines = [`# ${source.title}`, "", comment(source.guidance)];
  for (const section of source.sections) {
    lines.push("", `${"#".repeat(section.depth)} ${section.name}`, "");
    if (section.guidance !== undefined) lines.push(comment(section.guidance));
    if (section.scaffold !== undefined) {
      if (section.guidance !== undefined) lines.push("");
      lines.push(...section.scaffold);
    }
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
