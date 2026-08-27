import { isAcceptanceCriterionId } from "@kratos/contracts";

import type {
  AcceptanceCriterionDeclaration,
  AcceptanceCriterionKind,
  AcceptanceCriterionOutcome,
  TaskDocumentObservation,
} from "./model.js";

const MAX_CRITERIA = 126;
const workUnitHeading = /^### Work unit (\d+):\s+\S.*$/u;
const taskHeading = /^#### Task (\d+)\.(\d+):\s+\S.*$/u;
const checkboxDeclaration = /^- \[( |x)\] (\S+): (\S.*)$/u;
const criterionParts = /^AC-(\d+)\.(\d+)\.(E?)(\d+)$/u;

/** Parse already-observed task-document bytes without crossing an I/O boundary. */
export function inspectTaskDocument(
  content: string | null,
): TaskDocumentObservation {
  if (content === null) return { kind: "missing" };

  const declarations: AcceptanceCriterionDeclaration[] = [];
  const identifiers = new Set<string>();
  let fence: "`" | "~" | null = null;
  let workUnit: string | null = null;
  let task: string | null = null;
  let section: AcceptanceCriterionKind | null = null;

  const lines = content.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (marker !== undefined) {
      const kind = marker[0] as "`" | "~";
      if (fence === null) fence = kind;
      else if (fence === kind) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const work = workUnitHeading.exec(line);
    if (work !== null) {
      workUnit = work[1] ?? null;
      task = null;
      section = null;
      continue;
    }

    const taskMatch = taskHeading.exec(line);
    if (taskMatch !== null) {
      if (workUnit === null || taskMatch[1] !== workUnit) {
        return { kind: "malformed", line: lineNumber };
      }
      task = taskMatch[2] ?? null;
      section = null;
      continue;
    }

    if (line === "##### Acceptance criteria") {
      section = "main";
      continue;
    }
    if (line === "##### Edge cases") {
      section = "edge";
      continue;
    }
    if (/^#{1,5}\s/u.test(line)) {
      section = null;
      if (/^#{1,3}\s/u.test(line)) {
        task = null;
        if (/^#{1,2}\s/u.test(line)) workUnit = null;
      }
      continue;
    }
    if (section === null) {
      if (/^- \[(?: |x)\] AC-/u.test(line)) {
        return { kind: "malformed", line: lineNumber };
      }
      continue;
    }
    if (!line.startsWith("- [")) continue;

    const declaration = checkboxDeclaration.exec(line);
    if (declaration === null || workUnit === null || task === null) {
      return { kind: "malformed", line: lineNumber };
    }
    const [, checkbox, criterionId, text] = declaration;
    if (
      !isAcceptanceCriterionId(criterionId) ||
      checkbox === undefined ||
      text === undefined
    ) {
      return { kind: "malformed", line: lineNumber };
    }
    const parts = criterionParts.exec(criterionId);
    if (
      parts?.[1] !== workUnit ||
      parts[2] !== task ||
      (section === "edge") !== (parts[3] === "E")
    ) {
      return { kind: "malformed", line: lineNumber };
    }
    if (identifiers.has(criterionId)) {
      return { kind: "duplicate", criterionId };
    }
    if (declarations.length === MAX_CRITERIA) {
      return { kind: "malformed", line: lineNumber };
    }
    identifiers.add(criterionId);
    declarations.push({
      criterionId,
      workUnit,
      task,
      criterionKind: section,
      checked: checkbox === "x",
      ordinal: declarations.length,
      line: lineNumber,
      text,
      normalizedDeclaration: `- [ ] ${criterionId}: ${text}`,
    });
  }

  return declarations.length === 0
    ? { kind: "malformed", line: 0 }
    : { kind: "valid", declarations: Object.freeze(declarations) };
}

/** Replace only criterion checkbox bytes, preserving all other document bytes. */
export function renderCriterionCheckboxes(
  content: string,
  outcomes: ReadonlyMap<string, AcceptanceCriterionOutcome>,
): string {
  const observed = inspectTaskDocument(content);
  if (observed.kind !== "valid") {
    throw new Error("Task document is not valid acceptance input");
  }
  const known = new Set(
    observed.declarations.map(({ criterionId }) => criterionId),
  );
  for (const criterionId of outcomes.keys()) {
    if (!known.has(criterionId)) {
      throw new Error("Acceptance outcome names an unknown criterion");
    }
  }
  return content.replace(
    /^(- \[)( |x)(\] (AC-\d+\.\d+\.E?\d+): [^\r\n]+)(\r?)$/gmu,
    (
      line,
      open: string,
      _current: string,
      tail: string,
      id: string,
      cr: string,
    ) => {
      const outcome = outcomes.get(id);
      if (outcome === undefined) return line;
      return `${open}${outcome === "passed" ? "x" : " "}${tail}${cr}`;
    },
  );
}
