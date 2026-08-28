import type { EventV1, EventV1_1, SnapshotV1 } from "@kratos/contracts";

import type { CurrentEventDraft } from "../events/index.js";
import { FACT_EVENT_REASONS, type FactOperation } from "../events/semantics.js";
export { FACT_EVENT_REASONS, type FactOperation };

export const WORKFLOW_POLICY_VERSION = "workflow-v1";

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
        | "observed";
      readonly event: CurrentEventDraft;
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
