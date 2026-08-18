import type {
  AdapterMessageV1,
  AgentOutputV1,
  ApprovalV1,
  HostOperationMessageV1,
  InitAnswersV1,
  EventV1,
  EvidenceV1,
  FeatureStateV1,
  GapProposalV1,
  GapRecordV1,
  GateFactsV1,
  LockLeaseV1,
  MigrationV1,
  ProjectConfigV1,
  SnapshotV1,
  TransactionManifestV1,
  TransactionProgressV1,
} from "@kratos/contracts";

export interface ContractValues {
  readonly "host.adapter-message": AdapterMessageV1;
  readonly "host.agent-output": AgentOutputV1;
  readonly "host.gap-proposal": GapProposalV1;
  readonly "host.init-answers": InitAnswersV1;
  readonly "host.operation-message": HostOperationMessageV1;
  readonly "state.approval": ApprovalV1;
  readonly "state.event": EventV1;
  readonly "state.evidence": EvidenceV1;
  readonly "state.feature": FeatureStateV1;
  readonly "state.gap": GapRecordV1;
  readonly "state.gates": GateFactsV1;
  readonly "state.lock": LockLeaseV1;
  readonly "state.migration": MigrationV1;
  readonly "state.project-config": ProjectConfigV1;
  readonly "state.snapshot": SnapshotV1;
  readonly "state.transaction-manifest": TransactionManifestV1;
  readonly "state.transaction-progress": TransactionProgressV1;
}

export type ContractId = keyof ContractValues;
export type ContractValue<I extends ContractId> = ContractValues[I];
export type StructuralReasonCode =
  | "guard.config_corrupt"
  | "runtime.state_corrupt"
  | "trail.uso"
  | "trail.output_invalido";
