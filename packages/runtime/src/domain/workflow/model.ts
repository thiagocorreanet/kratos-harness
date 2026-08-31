import type { EventV1, EventV1_1, SnapshotV1 } from "@kratos/contracts";

import type { SealableEventDraft } from "../events/index.js";
import { FACT_EVENT_REASONS, type FactOperation } from "../events/semantics.js";
export { FACT_EVENT_REASONS, type FactOperation };

export const LEGACY_WORKFLOW_POLICY_VERSION = "workflow-v1";
export const WORKFLOW_POLICY_VERSION = "workflow-v2";

export const RUN_PHASES = [
  "prd",
  "spec",
  "plan",
  "code",
  "review",
  "acceptance",
] as const;

export type RunPhase = (typeof RUN_PHASES)[number];

export interface RunLineage {
  readonly prdDigest: string;
  readonly specDigest: string;
}

/**
 * Replay state used by the workflow reducer.
 *
 * `operations` is deliberately kept in replay state rather than the public
 * snapshot contract. It makes delivery idempotency a property of the event
 * history while preserving the frozen snapshot surface.
 */
export interface WorkflowState {
  readonly projectId: string;
  readonly feature: string;
  readonly runId: string;
  readonly status: SnapshotV1["status"];
  readonly currentStep: RunPhase | null;
  readonly revision: number;
  readonly lineage: RunLineage;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  readonly operations: readonly string[];
  readonly policyVersion:
    | typeof LEGACY_WORKFLOW_POLICY_VERSION
    | typeof WORKFLOW_POLICY_VERSION
    | null;
  readonly acceptanceAttemptCeiling: number | null;
  readonly tokenCeiling: number | null;
  readonly attempts: readonly WorkflowAcceptanceAttempt[];
  readonly activeRepairStops: readonly WorkflowRepairStop[];
  /** Every criterion that ever tripped stop-loss in this source run. */
  readonly repairStopHistory: readonly WorkflowRepairStop[];
  readonly repairResolutions: readonly WorkflowRepairResolution[];
  readonly specificationRestart: WorkflowSpecificationRestart | null;
  readonly retiredCriterionIds: readonly string[];
  readonly startedFromSpec: WorkflowStartedFromSpec | null;
}

export interface WorkflowAcceptanceAttempt {
  readonly criterionId: string;
  readonly attempt: number;
}

export interface WorkflowRepairStop extends WorkflowAcceptanceAttempt {
  readonly classification: "code" | "specification";
  readonly artifactRef: string;
  readonly artifactDigest: string;
}

export interface WorkflowSpecificationRestart {
  readonly criterionId: string;
  readonly nextRunId: string;
  readonly restartTicketRef: string;
  readonly restartTicketDigest: string;
}

export interface WorkflowRepairResolution {
  readonly operation: string;
  readonly criterionId: string;
  readonly classification: "code" | "specification";
  readonly resolutionRef: string;
  readonly resolutionDigest: string;
  readonly nextRunId: string | null;
  readonly restartTicketRef: string | null;
  readonly restartTicketDigest: string | null;
}

export interface WorkflowStartedFromSpec {
  readonly sourceRunId: string;
  readonly restartTicketRef: string;
  readonly restartTicketDigest: string;
}

export type WorkflowObservation =
  | { readonly kind: "absent"; readonly operations: readonly string[] }
  | { readonly kind: "present"; readonly state: WorkflowState }
  | { readonly kind: "corrupt" };

export interface WorkflowIdentity {
  readonly host: string;
  readonly model: string | null;
}

export type WorkflowAssignment = NonNullable<EventV1_1["resolvedAssignment"]>;

/** Validated host observation for one runtime-resolved phase assignment. */
export interface PhaseExecutionObservation {
  readonly assignmentDigest: string;
  readonly model: string | null;
  readonly effort: string | null;
  readonly provenance: "host-reported" | "unknown";
}

export interface StartWorkflowRequest {
  readonly projectId: string;
  readonly feature: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly lineage: RunLineage;
  readonly objectiveActive: boolean;
  readonly worktreeClean: boolean;
  readonly observedIdentity: WorkflowIdentity;
  /** Resolved once for a new run; absent callers use the executable default. */
  readonly acceptanceAttemptCeiling?: number | undefined;
  /** The objective's declared token ceiling, or null when it has none. */
  readonly tokenCeiling?: number | null | undefined;
  readonly startFromSpec?:
    | {
        readonly sourceRunId: string;
        readonly restartTicketRef: string;
        readonly restartTicketDigest: string;
        readonly retiredCriterionIds: readonly string[];
      }
    | undefined;
}

export interface ContinueWorkflowRequest {
  readonly feature: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly expectedRevision: number;
  readonly observedIdentity: WorkflowIdentity;
  readonly resolvedAssignment?: WorkflowAssignment;
  readonly phaseExecution?: PhaseExecutionObservation;
  readonly action:
    | {
        readonly kind: "complete-phase";
        readonly artifactRefs: readonly string[];
        readonly evidenceRefs: readonly string[];
        readonly gateFailures: readonly string[];
        readonly allowFinalCompletion: boolean;
      }
    | { readonly kind: "resume" }
    | {
        readonly kind: "reject";
        readonly artifactRefs: readonly string[];
        readonly evidenceRefs: readonly string[];
      };
}

export type WorkflowRefusal =
  | "blocked.context_unreadable"
  | "blocked.feature_mismatch"
  | "blocked.runid_mismatch"
  | "blocked.state_unreadable"
  | "blocked.stop_loss_rejections"
  | "model.assignment_stale"
  | "model.execution_mismatch"
  | "runtime.revision_conflict"
  | "trail.uso"
  | "trail.worktree_dirty";

/**
 * Operations that record a fact a gate will read without moving the run.
 *
 * They carry their own reason codes because replay must distinguish "the run
 * advanced" from "what the run knows changed"; collapsing them would make a
 * recorded gap look like a phase transition in the history.
 */
export type FactEventReason = (typeof FACT_EVENT_REASONS)[FactOperation];

export type WorkflowDecision =
  | {
      readonly kind: "recorded";
      readonly transition:
        | "started"
        | "resumed"
        | "accepted"
        | "rejected"
        | "completed"
        | "upgraded"
        | "observed"
        | "resolved";
      readonly event: SealableEventDraft;
      /** Stable identifiers explaining why a transition was rejected. */
      readonly why?: readonly string[];
    }
  | {
      readonly kind: "unchanged";
      readonly reason: "duplicate" | "already-completed";
    }
  | { readonly kind: "refused"; readonly reasonCode: WorkflowRefusal };

export interface WorkflowReducerConfiguration {
  readonly projectId: string;
  readonly feature: string;
  readonly runId: string;
  readonly lineage: RunLineage;
}

export type WorkflowEvent = Pick<
  EventV1,
  | "occurredAt"
  | "operation"
  | "policyVersion"
  | "reasonCode"
  | "resultingRevision"
>;

export interface ResolveRepairStopRequest {
  readonly feature: string;
  readonly runId: string;
  readonly criterionId: string;
  readonly correlationId: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly expectedRevision: number;
  readonly resolvedBy: string;
  readonly observation: string;
  readonly observedIdentity: WorkflowIdentity;
  readonly resolutionRef: string;
  readonly resolutionDigest: string;
  readonly nextRunId: string | null;
  readonly restartTicketRef: string | null;
  readonly restartTicketDigest: string | null;
}
