import type { ApprovalV1, LanguagePolicyV1 } from "@kratos/contracts";
import type { PrdDocumentObservation } from "../feature-documents/index.js";

export type GateMode = "shadow" | "warn" | "enforce";

export const GATE_IDS = [
  "context-readable",
  "stop-loss",
  "prd-present",
  "spec-approved",
  "gaps-closed",
  "partition-approved",
  "acceptance-criteria",
  "final-acceptance",
] as const;

export type GateId = (typeof GATE_IDS)[number];

export interface LanguageObservationMetadata {
  readonly artifactRef?: string;
  readonly artifactType?:
    "conversation" | "documentation" | "comments" | "identifiers" | "commits";
  readonly observedLanguage?: string;
  readonly expectedLanguage?: string;
  readonly mismatch?: boolean;
  readonly detail?: string | null;
}

export interface GateAdvisory {
  readonly gateId?: GateId;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly string[];
  readonly detail: string | null;
}

export interface GateContext {
  readonly mode: GateMode;
  readonly phase: "prd" | "spec" | "plan" | "code" | "review" | "acceptance";
  readonly contextReadable: boolean;
  readonly stopLoss: {
    readonly tripped: boolean;
    readonly exhausted: boolean;
    readonly repeatedRejections?: readonly RepeatedRejectionGateState[];
  };
  readonly prdDigest: string | null;
  readonly prdDocument: PrdDocumentObservation;
  readonly specDigest: string | null;
  readonly approvals: readonly ApprovalV1[];
  readonly openGaps: number;
  readonly partitionRequired: boolean;
  readonly partitionApproved: boolean;
  readonly finalAcceptance: boolean;
  readonly acceptanceCriteria?: readonly AcceptanceCriterionGateState[];
  readonly languagePolicy?: LanguagePolicyV1 | null;
  readonly languageObservations?: readonly LanguageObservationMetadata[];
  readonly languageMismatch?: boolean;
}

export interface RepeatedRejectionGateState {
  readonly criterionId: string;
  readonly attempt: number;
  readonly classification: "code" | "specification";
  readonly artifactRef: string;
}

export interface AcceptanceCriterionGateState {
  readonly criterionId: string;
  readonly state: "passed" | "failed" | "not-run" | "unreported";
  readonly checked: boolean;
  readonly evidenceValid: boolean;
}

export interface GateFailure {
  readonly gateId: GateId;
  readonly reasonCode:
    | "blocked.context_unreadable"
    | "blocked.stop_loss_budget"
    | "blocked.stop_loss_flag"
    | "blocked.stop_loss_rejections"
    | "gate.aceitacao_final"
    | "gate.ac_incomplete"
    | "gate.aprovacao_spec"
    | "gate.gaps_abertos"
    | "gate.particionamento"
    | "gate.prd_ausente"
    | "gate.prd_section_missing"
    | "gate.prd_untouched";
  readonly priority: number;
  readonly evidenceRefs: readonly string[];
  readonly detail: string | null;
}

export interface GateDecision {
  readonly outcome: "pass" | "warn" | "block";
  readonly primary: GateFailure | null;
  readonly failures: readonly GateFailure[];
  readonly advisories?: readonly GateAdvisory[];
  readonly mode: GateMode;
  readonly criteria: readonly AcceptanceCriterionGateState[];
}
