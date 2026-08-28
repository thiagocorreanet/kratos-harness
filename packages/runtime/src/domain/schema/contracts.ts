import type {
  AcceptanceCriteriaSnapshotV1,
  AcceptanceVerdictV1,
  AdapterMessageV1,
  AdapterMessageV1_1,
  AgentOutputV1,
  ApprovalV1,
  HostOperationMessageV1,
  InitAnswersV1,
  InitAnswersV1_1,
  EventV1,
  EventV1_1,
  EvidenceV1,
  FeatureStateV1,
  FeatureScopeV1,
  GapProposalV1,
  GapRecordV1,
  HookObservationV1,
  GateFactsV1,
  GuardrailsV1,
  LockLeaseV1,
  MigrationV1,
  MigrationV1_1,
  PhaseHandoffV1_1,
  ProjectConfigV1,
  ProjectConfigV1_1,
  PreToolUseV1,
  RequirementDiscoveryV1,
  RunUsageV1,
  SessionTelemetryV1,
  SnapshotV1,
  TransactionManifestV1,
  TransactionProgressV1,
  FailureCandidateV1,
} from "@kratos/contracts";

export interface ContractValues {
  readonly "host.adapter-message": AdapterMessageV1 | AdapterMessageV1_1;
  readonly "host.agent-output": AgentOutputV1;
  readonly "host.gap-proposal": GapProposalV1;
  readonly "host.hook-observation": HookObservationV1;
  readonly "host.init-answers": InitAnswersV1 | InitAnswersV1_1;
  readonly "host.operation-message": HostOperationMessageV1;
  readonly "host.phase-handoff": PhaseHandoffV1_1;
  readonly "host.pre-tool-use": PreToolUseV1;
  readonly "state.approval": ApprovalV1;
  readonly "state.acceptance-criteria-snapshot": AcceptanceCriteriaSnapshotV1;
  readonly "state.acceptance-verdict": AcceptanceVerdictV1;
  readonly "state.event": EventV1 | EventV1_1;
  readonly "state.evidence": EvidenceV1;
  readonly "state.failure-candidate": FailureCandidateV1;
  readonly "state.feature": FeatureStateV1;
  readonly "state.feature-scope": FeatureScopeV1;
  readonly "state.gap": GapRecordV1;
  readonly "state.gates": GateFactsV1;
  readonly "state.guardrails": GuardrailsV1;
  readonly "state.lock": LockLeaseV1;
  readonly "state.migration": MigrationV1 | MigrationV1_1;
  readonly "state.project-config": ProjectConfigV1 | ProjectConfigV1_1;
  readonly "state.requirement-discovery": RequirementDiscoveryV1;
  readonly "state.run-usage": RunUsageV1;
  readonly "state.session-telemetry": SessionTelemetryV1;
  readonly "state.snapshot": SnapshotV1;
  readonly "state.transaction-manifest": TransactionManifestV1;
  readonly "state.transaction-progress": TransactionProgressV1;
}

export type ContractId = keyof ContractValues;
export type ContractValue<I extends ContractId, V = unknown> = V extends string
  ? Extract<ContractValues[I], { readonly contractVersion: V }> extends never
    ? ContractValues[I]
    : Extract<ContractValues[I], { readonly contractVersion: V }>
  : ContractValues[I];
export type StructuralReasonCode =
  | "guard.config_corrupt"
  | "guard.guardrails_corrupt"
  | "guard.path_escape"
  | "guard.scope_corrupt"
  | "guard.target_uninspectable"
  | "runtime.state_corrupt"
  | "trail.uso"
  | "trail.output_invalido";
