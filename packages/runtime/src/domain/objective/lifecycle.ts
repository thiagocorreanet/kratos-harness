import type { FeatureStateV1 } from "@kratos/contracts";

import { featureIdentity } from "./identity.js";

/** What the project holds today, read before anything is decided. */
export type ObjectiveObservation =
  | { readonly kind: "none" }
  | { readonly kind: "present"; readonly state: FeatureStateV1 }
  | { readonly kind: "unreadable" };

export interface ObjectiveRequest {
  /** The demand exactly as the caller wrote it. */
  readonly text: string;
  /** Whether the caller explicitly authorized replacing a divergent objective. */
  readonly replace: boolean;
  /** The instant this run observed, supplied rather than read. */
  readonly now: string;
}

export type ObjectiveDecision =
  | {
      readonly kind: "recorded";
      readonly transition: "created" | "replaced" | "reopened";
      readonly feature: string;
      readonly state: FeatureStateV1;
      readonly previous: FeatureStateV1 | null;
    }
  | {
      readonly kind: "unchanged";
      readonly feature: string;
      readonly state: FeatureStateV1;
    }
  | {
      readonly kind: "refused";
      readonly reasonCode:
        "trail.uso" | "trail.objetivo_divergente" | "runtime.state_corrupt";
    };

/**
 * Decide what one objective demand does to the project.
 *
 * Pure and total: the same observation, request, and instant always produce the
 * same decision, which is what makes the lifecycle replayable from the event
 * stream rather than only reproducible by running the command again.
 *
 * The rules, in the order they apply:
 *
 * - Empty or unnameable text is a usage failure. Nothing is written.
 * - The same text as the active objective changes nothing, whatever else was
 *   asked. Repetition is how a caller confirms where they are.
 * - Different text against an active objective is refused unless the caller
 *   said `--replace`. Replacing somebody's stated objective silently is how a
 *   trail stops describing the work it claims to.
 * - Different text against a completed objective opens a new one. There is
 *   nothing unfinished to protect.
 */
export function decideObjective(
  observation: ObjectiveObservation,
  request: ObjectiveRequest,
): ObjectiveDecision {
  if (observation.kind === "unreadable") {
    return { kind: "refused", reasonCode: "runtime.state_corrupt" };
  }
  const text = request.text.trim();
  const feature = text === "" ? null : featureIdentity(text);
  if (feature === null) return { kind: "refused", reasonCode: "trail.uso" };

  if (observation.kind === "none") {
    return {
      kind: "recorded",
      transition: "created",
      feature,
      state: stateFor(feature, text, "active", request.now, request.now, 1),
      previous: null,
    };
  }

  const current = observation.state;
  if (current.objective.text === text) {
    return { kind: "unchanged", feature: current.feature, state: current };
  }
  if (current.objective.status === "active" && !request.replace) {
    return { kind: "refused", reasonCode: "trail.objetivo_divergente" };
  }
  return {
    kind: "recorded",
    transition: current.objective.status === "active" ? "replaced" : "reopened",
    feature,
    state: stateFor(
      feature,
      text,
      "active",
      request.now,
      request.now,
      current.objective.revision + 1,
    ),
    previous: current,
  };
}

/**
 * Complete the active objective.
 *
 * No frozen command surface completes an objective -- that arrives with the
 * acceptance semantics in `SDD-06`. The transition is modeled here because a
 * completed objective is what makes a later replacement legal, and a lifecycle
 * that cannot reach its terminal state cannot be tested against one.
 */
export function completeObjective(
  observation: ObjectiveObservation,
  now: string,
): ObjectiveDecision {
  if (observation.kind !== "present") {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  const current = observation.state;
  if (current.objective.status === "completed") {
    return { kind: "unchanged", feature: current.feature, state: current };
  }
  return {
    kind: "recorded",
    transition: "created",
    feature: current.feature,
    state: {
      ...current,
      objective: {
        ...current.objective,
        status: "completed",
        updatedAt: now,
        revision: current.objective.revision + 1,
      },
    },
    previous: current,
  };
}

function stateFor(
  feature: string,
  text: string,
  status: FeatureStateV1["objective"]["status"],
  createdAt: string,
  updatedAt: string,
  revision: number,
): FeatureStateV1 {
  // A budget is absent unless something explicitly asks for one, and no frozen
  // surface asks yet. Writing a default here would be a limit nobody set.
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    feature,
    objective: { text, status, createdAt, updatedAt, revision },
  };
}
