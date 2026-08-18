import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FEATURE_DOCUMENTS,
  PRD_DOCUMENT,
  inspectPrdDocument,
} from "@kratos/runtime/domain/feature-documents";
import { evaluateGates } from "@kratos/runtime/domain/gates";
import { profileStack, skeletonEffects } from "@kratos/runtime/domain/init";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const expectedTemplates = {
  "00-prd": `# Requirements

<!-- Explain the problem and the reasoning behind it. Keep architecture and implementation decisions in 01-design.md. -->

## Problem

<!-- State the observed problem and why it matters. -->

## Affected users

<!-- Name the users or systems affected and describe the impact on each. -->

## Goals

<!-- List the outcomes this feature must achieve. -->

## Non-goals

<!-- List adjacent outcomes this feature deliberately will not pursue. -->

## Scope boundary

<!-- State what is inside and outside the change boundary. -->

## Success metrics

<!-- Define observable measures that show whether the problem was solved. -->

## Open questions

<!-- Record unresolved decisions. Write "None" when every decision is closed. -->

## Problem discovery (5 Whys)

<!-- Quote the original request, classify it, and record whether 5 Whys ran and why. Ask why until the cause surfaces: do not force exactly five questions or stop at five while the cause remains hidden. -->

### Original request (quoted as received)

<!-- Preserve the requester's words without silently reframing them. -->

### Classification

<!-- Choose one: stated problem, proposed solution, defect, improvement, refactor, or external obligation. -->

### Application decision and investigation

<!-- Record applied or skipped and the reason. Skip for a well-specified simple operation, small visual change, clear legal obligation, trivial defect with a known cause, or a demand already explicit about problem, impact, metric, and scope. A skip still needs a reason. -->

<!-- A person is not a root cause. Ask: What allowed the omission to happen? What would have caught it? Rewrite blame as a process, system, rule, flow, communication, architecture, or operating-context cause. -->

### Discovery outcome

<!-- State the probable root cause, validated problem, solution hypothesis, success metric, and risk that the assumed cause is wrong. Keep the validated problem and solution hypothesis separate and commit to neither. -->

## Action framing (5W2H)

<!-- Only after the problem is clear, record whether 5W2H ran and why. Skip it for small, trivial, or already well-structured work; a skip still needs a reason. -->

### What, Why, Who, Where, When, How, and How Much

<!-- When applied, answer all seven fields. How Much means effort, complexity, operational impact, or uncertainty; never require a financial estimate or invent a number. -->

<!-- 5W2H cannot ratify the requester's original solution. If its only support is that the solution fits these fields, investigate the problem further. State the action plan separately from the validated problem and solution hypothesis, and commit to none. -->

### Machine-readable discovery record

<!-- Replace the object below with a state.requirement-discovery@1.0.0 record. The runtime validates the record; this phase never blocks a run. -->

<!-- KRATOS-REQUIREMENT-DISCOVERY-V1
{}
KRATOS-END-REQUIREMENT-DISCOVERY-V1 -->
`,
  "01-design": `# Design

<!-- Describe the approach and its contracts. Keep executable code out of this document. -->

## Architecture summary

<!-- Explain the components, responsibilities, and control flow. -->

## Data model

<!-- Define data shapes, ownership, lifecycle, and invariants. -->

## Interface surface

<!-- Define public and internal interfaces, inputs, outputs, and errors. -->

## Integration points

<!-- Name every external boundary and how failures cross it. -->

## Trade-offs

| Decision | Benefit | Cost | Rejected alternative |
| --- | --- | --- | --- |

## Risks

<!-- List technical, compatibility, operational, and security risks with mitigations. -->
`,
  "02-tasks": `# Tasks

<!-- Order work by dependency. Each work unit must be independently reviewable. -->

## Ordered work

### 1. Work unit

<!-- State one concrete change. Add more numbered work units without renumbering approved items. -->

#### Files

<!-- List every file this work unit may create or modify. -->

#### Acceptance criteria

- [ ] State an observable outcome. SDD-13 defines criterion identifiers.

#### Edge cases

<!-- List boundary and failure cases this work unit must handle. -->

## Out of scope

<!-- List work that implementers must not perform as part of this feature. -->
`,
  "03-summa": `# Summary

<!-- This is the reviewer contract. Summarize constraints; do not introduce new scope. -->

## One-sentence statement

<!-- State the approved change in one sentence. -->

## Hard requirements

<!-- List the conditions an implementation may not trade away. -->

## File allowlist

<!-- List paths the implementation may change. -->

## File denylist

<!-- List paths the implementation must not change. -->

## Definition of done

<!-- List the evidence required for acceptance. -->

<!-- After approval, changing specification content fails review. The only exemption is flipping an acceptance checkbox in 02-tasks.md. -->
`,
} as const;

describe("feature document contracts", () => {
  it("publishes one canonical required-section set and exact template bytes", () => {
    expect(
      Object.fromEntries(
        FEATURE_DOCUMENTS.map(({ id, requiredSections, template }) => [
          id,
          { requiredSections, template },
        ]),
      ),
    ).toEqual({
      "00-prd": {
        requiredSections: [
          "Problem",
          "Affected users",
          "Goals",
          "Non-goals",
          "Scope boundary",
          "Success metrics",
          "Open questions",
          "Problem discovery (5 Whys)",
          "Action framing (5W2H)",
        ],
        template: expectedTemplates["00-prd"],
      },
      "01-design": {
        requiredSections: [
          "Architecture summary",
          "Data model",
          "Interface surface",
          "Integration points",
          "Trade-offs",
          "Risks",
        ],
        template: expectedTemplates["01-design"],
      },
      "02-tasks": {
        requiredSections: [
          "Ordered work",
          "Files",
          "Acceptance criteria",
          "Edge cases",
          "Out of scope",
        ],
        template: expectedTemplates["02-tasks"],
      },
      "03-summa": {
        requiredSections: [
          "One-sentence statement",
          "Hard requirements",
          "File allowlist",
          "File denylist",
          "Definition of done",
        ],
        template: expectedTemplates["03-summa"],
      },
    });
  });

  it("generates every feature template byte for byte from the canonical contract", () => {
    const effects = skeletonEffects(
      {
        contractVersion: "1.0.0",
        hostContract: "1.0.0",
        hosts: ["codex"],
        language: "en",
        policyMode: "standard",
        snapshots: true,
      },
      profileStack({ rootEntries: ["package.json"] }),
    );

    for (const [id, expected] of Object.entries(expectedTemplates)) {
      expect(
        effects.find(
          (effect) =>
            effect.kind === "write_file" &&
            effect.path === `.brain/02-features/_template/${id}.md`,
        ),
      ).toMatchObject({ content: expected });
      expect(expected).not.toMatch(/\b(?:Claude|Codex)\b/u);
    }
  });

  it("recognizes missing, untouched, incomplete, and complete PRDs", () => {
    const complete = `# Requirements

${PRD_DOCUMENT.requiredSections
  .map((section) => `## ${section}\n\nCompleted ${section}.`)
  .join("\n\n")}
`;

    expect(inspectPrdDocument(null)).toEqual({ kind: "missing" });
    expect(inspectPrdDocument(expectedTemplates["00-prd"])).toEqual({
      kind: "untouched",
    });
    expect(
      inspectPrdDocument(complete.replace("## Success metrics", "## Measures")),
    ).toEqual({ kind: "incomplete", missingSection: "Success metrics" });
    expect(inspectPrdDocument(complete)).toEqual({ kind: "complete" });
  });

  it("does not treat headings inside fenced examples as document sections", () => {
    const fenced = `# Requirements

\`\`\`markdown
## Problem
\`\`\`
`;

    expect(inspectPrdDocument(fenced)).toEqual({
      kind: "incomplete",
      missingSection: "Problem",
    });
  });

  it("ships a completed example of every document", async () => {
    for (const document of FEATURE_DOCUMENTS) {
      const content = await readFile(
        join(
          repositoryRoot,
          "fixtures/feature-documents/complete",
          `${document.id}.md`,
        ),
        "utf8",
      );

      expect(content).not.toBe(document.template);
      for (const section of document.requiredSections) {
        expect(content).toMatch(
          new RegExp(`^#{2,6} ${section.replace(/[()]/gu, "\\$&")}$`, "mu"),
        );
      }
    }
  });
});

describe("the PRD presence gate", () => {
  const base = {
    mode: "enforce" as const,
    phase: "prd" as const,
    contextReadable: true,
    stopLoss: { tripped: false, exhausted: false },
    prdDigest: "a".repeat(64),
    specDigest: null,
    approvals: [],
    openGaps: 0,
    partitionRequired: false,
    partitionApproved: false,
    finalAcceptance: false,
  };

  it.each([
    {
      name: "missing",
      prdDocument: { kind: "missing" as const },
      reasonCode: "gate.prd_ausente",
      detail: null,
    },
    {
      name: "untouched",
      prdDocument: { kind: "untouched" as const },
      reasonCode: "gate.prd_untouched",
      detail: null,
    },
    {
      name: "incomplete",
      prdDocument: {
        kind: "incomplete" as const,
        missingSection: "Success metrics",
      },
      reasonCode: "gate.prd_section_missing",
      detail: "Missing required section: Success metrics",
    },
    {
      name: "complete",
      prdDocument: { kind: "complete" as const },
      reasonCode: null,
      detail: null,
    },
  ])("classifies a $name PRD", ({ prdDocument, reasonCode, detail }) => {
    const decision = evaluateGates({
      ...base,
      prdDigest: prdDocument.kind === "missing" ? null : base.prdDigest,
      prdDocument,
    });

    expect(decision.primary?.reasonCode ?? null).toBe(reasonCode);
    expect(decision.primary?.detail ?? null).toBe(detail);
  });
});
