import {
  isAcceptanceCriterionId,
  type ReadableAgentOutput,
} from "@kratos/contracts";

/**
 * The agreements a schema cannot state.
 *
 * Every one of these is a contradiction between two fields the schema
 * validates independently. They are refusals rather than warnings because a
 * runtime that routes on a self-contradicting block routes on whichever field
 * it happened to read first.
 */
export type AgentOutputRefusal =
  | "artifact-also-changed"
  | "duplicate-changed-file"
  | "duplicate-option-id"
  | "duplicate-question-id"
  | "duplicate-step-id"
  | "duplicate-criterion-id"
  | "invalid-criterion-id"
  | "unknown-step-dependency"
  | "verdict-contradicts-criteria"
  | "verdict-contradicts-findings";

/** One sentence per refusal, so every surface reports the same cause. */
export function describeAgentOutputRefusal(reason: AgentOutputRefusal): string {
  switch (reason) {
    case "artifact-also-changed":
      return "A path is listed both as a written artifact and as a changed file.";
    case "duplicate-changed-file":
      return "A changed file is listed more than once.";
    case "duplicate-option-id":
      return "A question offers the same option identifier twice.";
    case "duplicate-question-id":
      return "A blocking question identifier is used more than once.";
    case "duplicate-step-id":
      return "A plan step identifier is used more than once.";
    case "duplicate-criterion-id":
      return "An acceptance criterion identifier is reported more than once.";
    case "invalid-criterion-id":
      return "An acceptance criterion identifier does not match the canonical grammar.";
    case "unknown-step-dependency":
      return "A plan step depends on a step the plan does not contain.";
    case "verdict-contradicts-criteria":
      return "The acceptance verdict accepts a run whose criteria did not all pass.";
    case "verdict-contradicts-findings":
      return "The review verdict passes a change that still carries a high finding.";
  }
}

/**
 * Why this block contradicts itself, or null when it does not.
 *
 * Runs after schema validation and before any domain decision, so a caller can
 * assume both the shape and the internal agreement of what it reads.
 */
export function checkAgentOutput(
  output: ReadableAgentOutput,
): AgentOutputRefusal | null {
  const changed: string[] = [];
  for (const file of output.changedFiles) changed.push(file.ref);
  if (new Set(changed).size !== changed.length) {
    return "duplicate-changed-file";
  }
  // Artifacts are the specification documents the agent wrote; changed files
  // are the source and tests it touched. A path claimed as both erases exactly
  // the distinction the scope check reads.
  const artifacts = new Set(output.artifacts);
  for (const ref of changed) {
    if (artifacts.has(ref)) return "artifact-also-changed";
  }

  const questions = output.outcome.questions;
  const questionIds = new Set<string>();
  for (const question of questions) {
    if (questionIds.has(question.questionId)) return "duplicate-question-id";
    questionIds.add(question.questionId);
    const optionIds = new Set<string>();
    for (const option of question.options) {
      if (optionIds.has(option.optionId)) return "duplicate-option-id";
      optionIds.add(option.optionId);
    }
  }

  return checkPayload(output);
}

function checkPayload(output: ReadableAgentOutput): AgentOutputRefusal | null {
  if (output.agent === "plan") {
    const steps = output.payload.steps;
    const ids: string[] = [];
    for (const step of steps) ids.push(step.stepId);
    if (new Set(ids).size !== ids.length) return "duplicate-step-id";
    const known = new Set(ids);
    for (const step of steps) {
      for (const dependency of step.dependsOn) {
        if (!known.has(dependency)) return "unknown-step-dependency";
      }
    }
    return null;
  }
  if (
    output.agent === "review" &&
    output.payload.verdict === "pass" &&
    output.payload.findings.some(
      (finding: { readonly severity: string }) => finding.severity === "high",
    )
  ) {
    return "verdict-contradicts-findings";
  }
  if (
    output.agent === "acceptance" &&
    output.payload.criteria.some(
      (criterion: { readonly criterionId: string }) =>
        !isAcceptanceCriterionId(criterion.criterionId),
    )
  ) {
    return "invalid-criterion-id";
  }
  if (
    output.agent === "acceptance" &&
    new Set(
      output.payload.criteria.map(
        (criterion: { readonly criterionId: string }) => criterion.criterionId,
      ),
    ).size !== output.payload.criteria.length
  ) {
    return "duplicate-criterion-id";
  }
  if (
    output.agent === "acceptance" &&
    output.payload.verdict === "accepted" &&
    output.payload.criteria.some(
      (criterion: { readonly outcome: string }) =>
        criterion.outcome !== "passed",
    )
  ) {
    return "verdict-contradicts-criteria";
  }
  return null;
}
