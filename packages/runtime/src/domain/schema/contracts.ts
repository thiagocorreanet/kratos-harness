import type {
  AdapterMessageV1,
  ApprovalV1,
  EventV1,
  EvidenceV1,
  LockLeaseV1,
  MigrationV1,
  ProjectConfigV1,
  SnapshotV1,
} from "@mestre-yoda/contracts";

export interface ContractValues {
  readonly "host.adapter-message": AdapterMessageV1;
  readonly "state.approval": ApprovalV1;
  readonly "state.event": EventV1;
  readonly "state.evidence": EvidenceV1;
  readonly "state.lock": LockLeaseV1;
  readonly "state.migration": MigrationV1;
  readonly "state.project-config": ProjectConfigV1;
  readonly "state.snapshot": SnapshotV1;
}

export type ContractId = keyof ContractValues;
export type ContractValue<I extends ContractId> = ContractValues[I];
export type StructuralReasonCode =
  | "guard.config_corrupt"
  | "runtime.state_corrupt"
  | "trail.uso"
  | "trail.output_invalido";
