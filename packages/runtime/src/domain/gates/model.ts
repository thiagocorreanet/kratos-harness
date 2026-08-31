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

export type ProjectPolicyMode = "standard" | "strict";
export type GateOutcome = "pass" | "warn" | "block";
export type GateModes = Readonly<Record<GateId, GateMode>>;

export const GATE_PRIORITIES: Readonly<Record<GateId, number>> = Object.freeze({
  "context-readable": 10,
  "stop-loss": 20,
  "prd-present": 30,
  "spec-approved": 40,
  "gaps-closed": 50,
  "partition-approved": 60,
  "acceptance-criteria": 70,
  "final-acceptance": 80,
});

export type GateFailureReason =
  | "blocked.context_unreadable"
  | "blocked.stop_loss_budget"
  | "blocked.stop_loss_flag"
  | "gate.aceitacao_final"
  | "gate.ac_incomplete"
  | "gate.aprovacao_spec"
  | "gate.gaps_abertos"
  | "gate.particionamento"
  | "gate.prd_ausente"
  | "gate.prd_section_missing"
  | "gate.prd_untouched";

export const GATE_REASON_CODES = {
  "context-readable": ["blocked.context_unreadable"],
  "stop-loss": ["blocked.stop_loss_budget", "blocked.stop_loss_flag"],
  "prd-present": [
    "gate.prd_ausente",
    "gate.prd_section_missing",
    "gate.prd_untouched",
  ],
  "spec-approved": ["gate.aprovacao_spec"],
  "gaps-closed": ["gate.gaps_abertos"],
  "partition-approved": ["gate.particionamento"],
  "acceptance-criteria": ["gate.ac_incomplete"],
  "final-acceptance": ["gate.aceitacao_final"],
} as const satisfies Readonly<Record<GateId, readonly GateFailureReason[]>>;

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
  readonly gateModes: GateModes;
  readonly phase: "prd" | "spec" | "plan" | "code" | "review" | "acceptance";
  readonly contextReadable: boolean;
  readonly stopLoss: { readonly tripped: boolean; readonly exhausted: boolean };
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

export interface AcceptanceCriterionGateState {
  readonly criterionId: string;
  readonly state: "passed" | "failed" | "not-run" | "unreported";
  readonly checked: boolean;
  readonly evidenceValid: boolean;
}

export interface GateFailure {
  readonly gateId: GateId;
  readonly reasonCode: GateFailureReason;
  readonly priority: number;
  readonly mode: GateMode;
  readonly evidenceRefs: readonly string[];
  readonly detail: string | null;
}

export interface GateAggregation {
  readonly outcome: GateOutcome;
  readonly primary: GateFailure | null;
  readonly failures: readonly GateFailure[];
}

export interface GateDecision {
  readonly outcome: GateOutcome;
  readonly primary: GateFailure | null;
  readonly failures: readonly GateFailure[];
  readonly gateModes: GateModes;
  readonly advisories?: readonly GateAdvisory[];
  readonly criteria: readonly AcceptanceCriterionGateState[];
}
