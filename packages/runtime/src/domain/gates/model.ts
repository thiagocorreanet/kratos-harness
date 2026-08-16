import type { ApprovalV1 } from "@kratos/contracts";

export type GateMode = "shadow" | "warn" | "enforce";

export const GATE_IDS = [
  "context-readable",
  "stop-loss",
  "prd-present",
  "spec-approved",
  "gaps-closed",
  "partition-approved",
  "final-acceptance",
] as const;

export type GateId = (typeof GATE_IDS)[number];

export interface GateContext {
  readonly mode: GateMode;
  readonly phase: "prd" | "spec" | "plan" | "code" | "review" | "acceptance";
  readonly contextReadable: boolean;
  readonly stopLoss: { readonly tripped: boolean; readonly exhausted: boolean };
  readonly prdDigest: string | null;
  readonly specDigest: string | null;
  readonly approvals: readonly ApprovalV1[];
  readonly openGaps: number;
  readonly partitionRequired: boolean;
  readonly partitionApproved: boolean;
  readonly finalAcceptance: boolean;
}

export interface GateFailure {
  readonly gateId: GateId;
  readonly reasonCode:
    | "blocked.context_unreadable"
    | "blocked.stop_loss_budget"
    | "blocked.stop_loss_flag"
    | "gate.aceitacao_final"
    | "gate.aprovacao_spec"
    | "gate.gaps_abertos"
    | "gate.particionamento"
    | "gate.prd_ausente";
  readonly priority: number;
  readonly evidenceRefs: readonly string[];
}

export interface GateDecision {
  readonly outcome: "pass" | "warn" | "block";
  readonly primary: GateFailure | null;
  readonly failures: readonly GateFailure[];
  readonly mode: GateMode;
}
