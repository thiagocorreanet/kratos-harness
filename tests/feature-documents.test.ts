import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FEATURE_DOCUMENTS,
  PRD_DOCUMENT,
  inspectPrdDocument,
} from "@kratos/runtime/domain/feature-documents";
import { evaluateGates, resolveGateModes } from "@kratos/runtime/domain/gates";
import {
  DEFAULT_LANGUAGE_POLICY,
  profileStack,
  skeletonEffects,
  unresolvedProjectProfile,
} from "@kratos/runtime/domain/init";
import { extractRequirementDiscovery } from "@kratos/runtime/domain/requirement-discovery";
import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

const expectedTemplates = {
  "00-prd": `# PRD: <feature name>

> Written by prd-researcher (prd phase) — the WHAT and WHY. No code, no architecture.

## Problem Discovery
<!-- Start from the problem, not the solution. Fill when the demand is vague, recurring,
     or stated as a ready solution; otherwise mark the technique "not applied" + why. -->

### Initial demand
<the original request, verbatim>

### Classification
<problem | proposed solution | bug | improvement | refactor | external obligation>

### Technique applied
<5 Whys applied | 5 Whys not applied>

### Decision reason
<why the technique was or wasn't applied>

### 5 Whys investigation
<!-- adaptive: stop when the root cause surfaces; don't force five. Omit if not applied. -->
1. Why is this necessary? — ...
2. Why does it happen today? — ...
3. Why doesn't the current process/system solve it? — ...
4. Why does it impact user/operation/business? — ...
5. Why solve it now? — ...

### Probable root cause
<a process/system/rule/flow/communication/architecture/context cause — never person-blame>

### Validated problem
<the real problem, distinct from the proposed solution>

### Solution hypothesis
<a hypothesis, explicitly not yet a committed plan>

### Success metric
<how success is measured, tied to the root cause>

### Risks & premises
<incl. the risk of assuming the wrong root cause>

## Action Framing — 5W2H
<!-- Only after the problem is clear. Skip for small/trivial/well-structured actions;
     record the skip reason. Never use 5W2H to justify the initial solution on its own. -->

### Technique applied
<5W2H applied | 5W2H not applied>

### Decision reason
<why the technique was or wasn't applied>

### What — what will be done or investigated
### Why — why it should be done
### Who — users, areas, systems or owners involved
### Where — module, flow, screen, process or integration affected
### When — priority, urgency, window or milestone
### How — initial approach / strategy
### How Much — effort, complexity, impact or uncertainty (no financial estimate required)

### Machine-readable discovery record
<!-- Replace the object below with a state.requirement-discovery@1.0.0 record. The runtime validates the record; this phase never blocks a run. -->

<!-- KRATOS-REQUIREMENT-DISCOVERY-V1
{}
KRATOS-END-REQUIREMENT-DISCOVERY-V1 -->

## Problem
<2-3 paragraphs: what's broken, who feels the pain, why now — grounded in the validated problem above>

## Users
<personas — role, need, context>

## Goals
- <measurable outcome 1>

## Non-goals
- <explicitly out of scope>

## Scope
**In-scope:**
- <feature/capability>

**Out-of-scope:**
- <what we're NOT doing>

## Success metrics
<quantitative/behavioral evidence of success>

## Open questions
<decisions not yet made — track them, don't paper over>
`,
  "01-design": `# Design: <feature name>

> Written by spec-planner (spec phase) — the HOW. Diagrams and contracts, no code.

## Architecture overview
<ASCII or mermaid diagram + 1-2 paragraphs>

## Data model
<entities, fields, relationships, migrations, RLS implications>

## API surface
<endpoints, request/response shapes, auth requirements>

## Integration points
<existing code/services this touches>

## Trade-offs considered
| Option | Pros | Cons | Chosen? |
|--------|------|------|---------|
| ... | ... | ... | ... |

## Risks
<things that could go wrong + mitigation>
`,
  "02-tasks": `# Tasks: <feature name>

> Status: [ ] todo · [x] done — flipped by the orchestrator after evaluation, never by hand mid-sprint.
> AC IDs (AC-<sprint>.<task>.<n>, E<n> for edge cases) are the audit contract — never renumber after approval.

## Sprint 1: <name>

### Task 1.1: <imperative title>

**Files affected:** <list or glob>

**Description:** <1-2 sentences>

**Steps:**
1. ...

**Acceptance criteria:**
- [ ] AC-1.1.1: <verifiable criterion>

**Edge cases:**
- [ ] AC-1.1.E1: <what if X fails?> → <expected behavior>

**Out of scope:**
- <explicit don'ts>
`,
  "03-summa": `# Summa: <feature name>

> Written by spec-reviewer (plan phase) — the Judge's contract. Compressed reference the evaluator enforces.

## In one sentence
<what this feature does>

## Hard requirements (the Judge enforces these)
- <e.g., "RLS policies must restrict by tenant_id">

## Files that should change
<allowlist — Judge flags edits outside this list>

## Files that must NOT change
<denylist — Judge rejects changes touching these>

> Exception: checkbox status flips (\`[ ]\` → \`[x]\`) in 02-tasks.md are exempt.
> Any other edit to spec content after approval is an automatic FAIL.

## Done means
<crisp definition — what the Judge checks for PASS>
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
          "Problem Discovery",
          "Action Framing — 5W2H",
          "Problem",
          "Users",
          "Goals",
          "Non-goals",
          "Scope",
          "Success metrics",
          "Open questions",
        ],
        template: expectedTemplates["00-prd"],
      },
      "01-design": {
        requiredSections: [
          "Architecture overview",
          "Data model",
          "API surface",
          "Integration points",
          "Trade-offs considered",
          "Risks",
        ],
        template: expectedTemplates["01-design"],
      },
      "02-tasks": {
        requiredSections: ["Sprint 1: <name>", "Task 1.1: <imperative title>"],
        template: expectedTemplates["02-tasks"],
      },
      "03-summa": {
        requiredSections: [
          "In one sentence",
          "Hard requirements (the Judge enforces these)",
          "Files that should change",
          "Files that must NOT change",
          "Done means",
        ],
        template: expectedTemplates["03-summa"],
      },
    });
  });

  it("generates every feature template byte for byte from the canonical contract", () => {
    const effects = skeletonEffects(
      {
        contractVersion: "1.5.0",
        hostContract: "1.4.0",
        hosts: ["codex"],
        language: DEFAULT_LANGUAGE_POLICY,
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

  it("carries extractable requirement-discovery block in PRD template", () => {
    expect(extractRequirementDiscovery(PRD_DOCUMENT.template)).toEqual({
      kind: "found",
      value: {},
    });
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
## Problem Discovery
\`\`\`
`;

    expect(inspectPrdDocument(fenced)).toEqual({
      kind: "incomplete",
      missingSection: "Problem Discovery",
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
    gateModes: resolveGateModes("strict", {}),
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
