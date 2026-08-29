import { reasonPolicy, type ReadableEvent } from "@kratos/contracts";

import type { WorkflowState } from "../workflow/index.js";

export interface RunStatusReport {
  readonly runId: string;
  readonly feature: string;
  readonly status: WorkflowState["status"];
  readonly currentPhase: WorkflowState["currentStep"];
  readonly revision: number;
  readonly updatedAt: string | null;
}

export interface RunStats {
  readonly events: number;
  readonly acceptedTransitions: number;
  readonly rejectedTransitions: number;
  readonly resumes: number;
  readonly artifactRefs: number;
  readonly evidenceRefs: number;
}

export interface BudgetReport {
  readonly allocated: number | null;
  readonly used: number | null;
  readonly remaining: number | null;
  readonly exhausted: boolean;
}

export interface DoctorObservation {
  readonly name: string;
  readonly status: "pass" | "warn" | "block" | "fail";
  readonly evidenceRef: string | null;
}

export interface DoctorReport {
  readonly health: "healthy" | "degraded" | "blocked" | "corrupt";
  readonly checks: readonly DoctorObservation[];
}

export function deriveStatus(state: WorkflowState): RunStatusReport {
  return {
    runId: state.runId,
    feature: state.feature,
    status: state.status,
    currentPhase: state.currentStep,
    revision: state.revision,
    updatedAt: state.updatedAt,
  };
}

export function deriveStats(events: readonly ReadableEvent[]): RunStats {
  return {
    events: events.length,
    acceptedTransitions: events.filter(
      ({ reasonCode }) => reasonCode === "run.transition.accepted",
    ).length,
    rejectedTransitions: events.filter(
      ({ reasonCode }) => reasonCode === "run.transition.rejected",
    ).length,
    resumes: events.filter(({ reasonCode }) => reasonCode === "run.resumed")
      .length,
    artifactRefs: new Set(events.flatMap(({ artifactRefs }) => artifactRefs))
      .size,
    evidenceRefs: new Set(events.flatMap(({ evidenceRefs }) => evidenceRefs))
      .size,
  };
}

export function deriveBudget(
  allocated: number | null,
  used: number | null,
): BudgetReport {
  if (
    (allocated !== null &&
      (!Number.isSafeInteger(allocated) || allocated < 1)) ||
    (used !== null && (!Number.isSafeInteger(used) || used < 0))
  ) {
    throw new Error("Budget observation is invalid");
  }
  const remaining =
    allocated === null || used === null ? null : Math.max(0, allocated - used);
  return {
    allocated,
    used,
    remaining,
    exhausted: allocated !== null && used !== null && used >= allocated,
  };
}

export function diagnose(
  observations: readonly DoctorObservation[],
): DoctorReport {
  const checks = [...observations].sort((left, right) =>
    left.name.localeCompare(right.name, "en-US"),
  );
  const health = checks.some(({ status }) => status === "fail")
    ? "corrupt"
    : checks.some(({ status }) => status === "block")
      ? "blocked"
      : checks.some(({ status }) => status === "warn")
        ? "degraded"
        : "healthy";
  return { health, checks };
}

export function explainReason(code: string): {
  readonly known: boolean;
  readonly code: string;
  readonly description: string;
  readonly retryable: boolean | null;
  readonly recovery: string | null;
} {
  const policy = reasonPolicy(code);
  return policy === null
    ? {
        known: false,
        code,
        description: "The reason code is not registered in this runtime.",
        retryable: null,
        recovery: null,
      }
    : {
        known: true,
        code,
        description: policy.description,
        retryable: policy.retryable,
        recovery: policy.recovery,
      };
}
