import type { FeatureStateV1 } from "@kratos/contracts";

/**
 * The objective as a person reads it.
 *
 * The text is reproduced exactly as it was supplied -- the demand is the
 * artifact, and a document that paraphrases it is a document that quietly
 * changes what was asked for.
 */
export function objectiveDocument(state: FeatureStateV1): string {
  return [
    "# Objective",
    "",
    state.objective.text,
    "",
    "## Record",
    "",
    `- Feature: ${state.feature}`,
    `- Status: ${state.objective.status}`,
    `- Revision: ${String(state.objective.revision)}`,
    `- Created: ${state.objective.createdAt}`,
    `- Updated: ${state.objective.updatedAt}`,
    "",
    "Everything in this file is written by Kratos from the recorded",
    "objective. Edit the objective through the command instead, so the change",
    "is one the history can explain.",
    "",
  ].join("\n");
}

export interface HistoryEntry {
  readonly transition: "created" | "replaced" | "reopened" | "completed";
  readonly at: string;
  readonly revision: number;
  readonly text: string;
  /** The text this entry displaced, when it displaced one. */
  readonly replaced: string | null;
}

/**
 * One history line, appended and never rewritten.
 *
 * JSON Lines with sorted keys, so two runs that record the same transition
 * produce the same bytes and a diff of the file shows only what happened.
 */
export function historyLine(entry: HistoryEntry): string {
  return `${JSON.stringify({
    at: entry.at,
    replaced: entry.replaced,
    revision: entry.revision,
    text: entry.text,
    transition: entry.transition,
  })}\n`;
}

/** Where a feature keeps what it is for. */
export function featurePaths(feature: string): {
  readonly state: string;
  readonly objective: string;
  readonly history: string;
} {
  const root = `.brain/02-features/${feature}`;
  return {
    state: `${root}/state.json`,
    objective: `${root}/objective.md`,
    history: `${root}/objective-history.jsonl`,
  };
}

/** The file naming the feature currently being worked on. */
export const ACTIVE_FEATURE_PATH = ".brain/02-features/active";
