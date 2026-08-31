export interface RepairLoopAttempt {
  readonly criterionId: string;
  readonly attempt: number;
}

export interface RepairLoopCriterion {
  readonly criterionId: string;
  readonly outcome: "passed" | "failed";
}

export interface RepairLoopFault {
  readonly criterionId: string;
  readonly classification: "code" | "specification";
  readonly diagnosis: string;
}

export interface RepairLoopStop extends RepairLoopFault {
  readonly attempt: number;
}

export interface RepairLoopCandidate {
  readonly attemptCeiling: number;
  readonly attempts: readonly RepairLoopAttempt[];
  readonly criteria: readonly RepairLoopCriterion[];
  readonly faults: readonly RepairLoopFault[];
}

export type RepairLoopDecision =
  | {
      readonly kind: "passed" | "repair";
      readonly attempts: readonly RepairLoopAttempt[];
    }
  | {
      readonly kind: "stopped";
      readonly attempts: readonly RepairLoopAttempt[];
      readonly stops: readonly RepairLoopStop[];
    }
  | {
      readonly kind: "refused";
      readonly reason:
        | "active-stop"
        | "duplicate-criterion"
        | "invalid-attempt"
        | "invalid-ceiling"
        | "invalid-criterion"
        | "invalid-fault"
        | "missing-fault"
        | "unexpected-fault";
      readonly criterionId?: string;
    };

import type {
  CurrentRepairLoopStop,
  CurrentRepairResolution,
  RepairRestartV1,
} from "@kratos/contracts";
import type { EventV1_2 } from "@kratos/contracts";

export type RepairLoopStopArtifact = CurrentRepairLoopStop;

export type RepairLoopStopArtifactInput = Omit<
  RepairLoopStopArtifact,
  "contractVersion" | "stateContract"
>;

export type AcceptanceDecisionMetadata = NonNullable<
  EventV1_2["acceptanceDecision"]
>;

export interface RepairLoopStopBinding {
  readonly criterionId: string;
  readonly artifactRef: string;
  readonly artifactDigest: string;
}

export type RepairResolutionArtifact = CurrentRepairResolution;
export type RepairResolutionArtifactInput = Omit<
  RepairResolutionArtifact,
  "contractVersion" | "stateContract"
>;
export type RepairRestartArtifact = RepairRestartV1;
export type RepairRestartArtifactInput = Omit<
  RepairRestartArtifact,
  "contractVersion" | "stateContract" | "startPhase"
>;
