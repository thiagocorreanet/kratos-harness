import type {
  EventV1,
  EventV1_1,
  EventV1_2,
  ProjectConfigV1,
  ProjectConfigV1_1,
  ProjectConfigV1_2,
  ProjectConfigV1_3,
  ProjectConfigV1_4,
  ProjectConfigV1_4Contract,
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
  AgentOutputV1_2,
  ApprovalV1,
  InitAnswersV1,
  InitAnswersV1_1,
  InitAnswersV1_2,
  InitAnswersV1_3,
  HostOperationMessageV1,
  EventV1,
  EventV1_1,
  EventV1_2,
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
  PhaseMeasurementV1,
  PhaseLifecycleV1,
  PhaseHandoffV1_1,
  PhaseHandoffV1_2,
  ProjectConfigV1,
  ProjectConfigV1_1,
  ProjectConfigV1_2,
  ProjectConfigV1_3,
  ProjectConfigV1_4,
  PreToolUseV1,
  RequirementDiscoveryV1,
  RunUsageV1,
  SessionTelemetryV1,
  SnapshotV1,
  TransactionManifestV1,
  TransactionProgressV1,
  FailureCandidateV1,
  CuratedMemoryV1,
  MemoryCaptureV1_2,
  MemoryChangeV1_2,
  MemoryMigrationV1_2,
} from "./generated/contracts.js";

export type LanguagePolicyV1 = ProjectConfigV1_4Contract.LanguagePolicy;
export type ModelRole = "planner" | "implementer" | "judge";
export type ModelAssignmentV1_1 =
  string | { readonly model: string; readonly effort: string };
export type CurrentEvent = EventV1_2;
export type ReadableEvent = EventV1 | EventV1_1 | EventV1_2;
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
