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
  readonly details?: readonly string[];
}

export interface StackProfileReadinessObservation {
  readonly authoritativeState:
    | { readonly kind: "valid" }
    | {
        readonly kind: "migration-required";
        readonly reasonCode: "profile.config_migration_required";
      }
    | { readonly kind: "invalid"; readonly reasonCode: string };
  readonly exists: boolean;
  readonly regularFile: boolean;
  readonly readable: boolean;
  readonly expectedBytes: {
    readonly size: number;
    readonly sha256: string;
  } | null;
  readonly actualBytes: {
    readonly size: number;
    readonly sha256: string;
  } | null;
  readonly unresolvedKeys: readonly string[];
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

/** Classify the generated stack profile without interpreting its Markdown. */
export function deriveStackProfileCheck(
  observation: StackProfileReadinessObservation,
): DoctorObservation {
  if (observation.authoritativeState.kind === "invalid") {
    return {
      name: "stack-profile",
      evidenceRef: ".brain/config.json",
      status: "fail",
      details: ["The authoritative project configuration is invalid."],
    };
  }
  const base = {
    name: "stack-profile",
    evidenceRef: ".brain/01-architecture/stack-profile.md",
  } as const;
  if (observation.authoritativeState.kind === "migration-required") {
    return {
      ...base,
      status: "block",
      details: ["The project configuration requires explicit migration."],
    };
  }
  const unresolvedDetails = observation.unresolvedKeys.map(
    (key) =>
      `Resolve ${key} in the typed initialization answers, then rerun \`kratos init\`.`,
  );
  if (!observation.exists) {
    return {
      ...base,
      status: "warn",
      details: [
        "The stack profile is missing; rerun `kratos init` to regenerate it.",
        ...unresolvedDetails,
      ],
    };
  }
  if (!observation.regularFile) {
    return {
      ...base,
      status: "fail",
      details: [
        "The stack profile destination is not a regular file.",
        ...unresolvedDetails,
      ],
    };
  }
  if (!observation.readable) {
    return {
      ...base,
      status: "fail",
      details: [
        "The stack profile destination is unreadable.",
        ...unresolvedDetails,
      ],
    };
  }
  let bytesMatch = false;
  if (observation.actualBytes !== null) {
    if (observation.expectedBytes !== null) {
      bytesMatch =
        observation.actualBytes.size === observation.expectedBytes.size &&
        observation.actualBytes.sha256 === observation.expectedBytes.sha256;
    }
  }
  if (!bytesMatch) {
    return {
      ...base,
      status: "warn",
      details: [
        "The stack profile differs from authoritative state; rerun `kratos init` to regenerate it.",
        ...unresolvedDetails,
      ],
    };
  }
  if (unresolvedDetails.length > 0) {
    return { ...base, status: "warn", details: unresolvedDetails };
  }
  return { ...base, status: "pass", details: [] };
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
