import type {
  AgentOutputV1,
  AgentOutputV1_1,
  AgentOutputV1_2,
  AgentOutputV1_3,
  EventV1,
  EventV1_1,
  EventV1_2,
  EventV1_3,
  EventV1_4,
  PhaseHandoffV1_1,
  PhaseHandoffV1_2,
  PhaseHandoffV1_3,
  ProjectConfigV1,
  ProjectConfigV1_1,
  ProjectConfigV1_2,
  ProjectConfigV1_3,
  ProjectConfigV1_4,
  ProjectConfigV1_4Contract,
  RepairLoopStopV1,
  RepairLoopStopV1_1,
  RepairResolutionV1,
  RepairResolutionV1_1,
} from "./generated/contracts.js";

export { KRATOS_VERSION } from "./version.js";
export {
  CONTRACT_IDENTITIES,
  CONTRACT_VERSIONS,
  classifyContractVersion,
  contractFailureResult,
} from "./compatibility.js";
export type {
  CompatibilityClass,
  ContractClassification,
  ContractFailureResult,
  ContractFamily,
} from "./compatibility.js";
export { REASON_CATALOG, reasonPolicy } from "./reasons.js";
export type { ReasonPolicy } from "./reasons.js";
export {
  OperationResultContractError,
  validateOperationPublicText,
  validateOperationResult,
} from "./operation-result.js";
export type {
  OperationResultEvidenceV1,
  OperationResultV1,
} from "./operation-result.js";
export {
  ACCEPTANCE_CRITERION_ID_MAX_LENGTH,
  ACCEPTANCE_CRITERION_ID_PATTERN,
  isAcceptanceCriterionId,
} from "./acceptance-criteria.js";
export type {
  AcceptanceCriteriaSnapshotV1,
  AcceptanceVerdictV1,
  AdapterMessageV1,
  AdapterMessageV1_1,
  AgentOutputV1,
  AgentOutputV1_1,
  AgentOutputV1_2,
  AgentOutputV1_3,
  ApprovalV1,
  InitAnswersV1,
  InitAnswersV1_1,
  InitAnswersV1_2,
  InitAnswersV1_3,
  InitAnswersV1_4,
  HostOperationMessageV1,
  EventV1,
  EventV1_1,
  EventV1_2,
  EventV1_3,
  EventV1_4,
  EvidenceV1,
  FeatureStateV1,
  FeatureScopeV1,
  GapProposalV1,
  GapRecordV1,
  GateFactsV1,
  HookObservationV1,
  GuardrailsV1,
  LockLeaseV1,
  MigrationV1,
  MigrationV1_1,
  PhaseLifecycleV1,
  PhaseMeasurementV1,
  PhaseHandoffV1_1,
  PhaseHandoffV1_2,
  PhaseHandoffV1_3,
  ProjectConfigV1,
  ProjectConfigV1_1,
  ProjectConfigV1_2,
  ProjectConfigV1_3,
  ProjectConfigV1_4,
  PreToolUseV1,
  RequirementDiscoveryV1,
  RepairLoopStopV1,
  RepairLoopStopV1_1,
  RepairResolutionV1,
  RepairResolutionV1_1,
  RepairRestartV1,
  RunUsageV1,
  SessionTelemetryV1,
  SnapshotV1,
  TransactionManifestV1,
  TransactionProgressV1,
  FailureCandidateV1,
  FailureCandidateV1_1,
  CuratedMemoryV1,
  CuratedMemoryV1_1,
  MemoryCaptureV1_2,
  MemoryChangeV1_2,
  MemoryChangeV1_4,
  MemoryCurationV1_4,
  MemoryMigrationV1_2,
  MemoryMigrationV1_4,
} from "./generated/contracts.js";

export type LanguagePolicyV1 = ProjectConfigV1_4Contract.LanguagePolicy;
export type ModelRole = "planner" | "implementer" | "judge";
export type ModelAssignmentV1_1 =
  string | { readonly model: string; readonly effort: string };
export type CurrentEvent = EventV1_4;
export type ReadableEvent =
  EventV1 | EventV1_1 | EventV1_2 | EventV1_3 | EventV1_4;
export type CurrentAgentOutput = AgentOutputV1_3;
export type ReadableAgentOutput =
  AgentOutputV1 | AgentOutputV1_1 | AgentOutputV1_2 | AgentOutputV1_3;
export type CurrentPhaseHandoff = PhaseHandoffV1_3;
export type ReadablePhaseHandoff =
  PhaseHandoffV1_1 | PhaseHandoffV1_2 | PhaseHandoffV1_3;
export type CurrentRepairLoopStop = RepairLoopStopV1_1;
export type ReadableRepairLoopStop = RepairLoopStopV1 | RepairLoopStopV1_1;
export type CurrentRepairResolution = RepairResolutionV1_1;
export type ReadableRepairResolution =
  RepairResolutionV1 | RepairResolutionV1_1;
export type CurrentProjectConfig = ProjectConfigV1_4;
export type ReadableProjectConfig =
  | ProjectConfigV1
  | ProjectConfigV1_1
  | ProjectConfigV1_2
  | ProjectConfigV1_3
  | ProjectConfigV1_4;
export type {
  BeatKind,
  BeatV1,
  ClockDerivedProgress,
  NarrationV1,
} from "./narration.js";
