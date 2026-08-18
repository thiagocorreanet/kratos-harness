export type FeatureDocumentId =
  "00-prd" | "01-design" | "02-tasks" | "03-summa";

interface SectionDefinition {
  readonly name: string;
  readonly depth: 2 | 4;
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
          "Record discovery here. SDD-11 defines when and how this method runs.",
      },
      {
        name: "Action framing (5W2H)",
        depth: 2,
        guidance:
          "Frame the action here after the problem is clear. SDD-11 defines the method.",
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
          "### 1. Work unit",
          "",
          "<!-- State one concrete change. Add more numbered work units without renumbering approved items. -->",
        ],
      },
      {
        name: "Files",
        depth: 4,
        guidance: "List every file this work unit may create or modify.",
      },
      {
        name: "Acceptance criteria",
        depth: 4,
        scaffold: [
          "- [ ] State an observable outcome. SDD-13 defines criterion identifiers.",
        ],
      },
      {
        name: "Edge cases",
        depth: 4,
        guidance: "List boundary and failure cases this work unit must handle.",
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
