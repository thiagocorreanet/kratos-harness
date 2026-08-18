import type { AgentOutputV1 } from "@kratos/contracts";

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
  output: AgentOutputV1,
): AgentOutputRefusal | null {
  const changed = output.changedFiles.map(({ ref }) => ref);
  if (new Set(changed).size !== changed.length) {
    return "duplicate-changed-file";
  }
  // Artifacts are the specification documents the agent wrote; changed files
  // are the source and tests it touched. A path claimed as both erases exactly
  // the distinction the scope check reads.
  const artifacts = new Set(output.artifacts);
  if (changed.some((ref) => artifacts.has(ref))) {
    return "artifact-also-changed";
  }

  const questions = output.outcome.questions;
  if (
    new Set(questions.map(({ questionId }) => questionId)).size !==
    questions.length
  ) {
    return "duplicate-question-id";
  }
  for (const question of questions) {
    const options = question.options.map(({ optionId }) => optionId);
    if (new Set(options).size !== options.length) {
      return "duplicate-option-id";
    }
  }

  return checkPayload(output);
}

function checkPayload(output: AgentOutputV1): AgentOutputRefusal | null {
  if (output.agent === "plan") {
    const steps = output.payload.steps;
    const ids = steps.map(({ stepId }) => stepId);
    if (new Set(ids).size !== ids.length) return "duplicate-step-id";
    const known = new Set(ids);
    if (steps.some(({ dependsOn }) => dependsOn.some((id) => !known.has(id)))) {
      return "unknown-step-dependency";
    }
    return null;
  }
  if (
    output.agent === "review" &&
    output.payload.verdict === "pass" &&
    output.payload.findings.some(({ severity }) => severity === "high")
  ) {
    return "verdict-contradicts-findings";
  }
  if (
    output.agent === "acceptance" &&
    output.payload.verdict === "accepted" &&
    output.payload.criteria.some(({ outcome }) => outcome !== "passed")
  ) {
    return "verdict-contradicts-criteria";
  }
  return null;
}
