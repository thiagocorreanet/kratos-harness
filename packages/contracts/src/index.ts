import type {
  EventV1,
  EventV1_1,
  ProjectConfigV1,
  ProjectConfigV1_1,
  ProjectConfigV1_2,
  ProjectConfigV1_2Contract,
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
  ApprovalV1,
  InitAnswersV1,
  InitAnswersV1_1,
  InitAnswersV1_2,
  HostOperationMessageV1,
  EventV1,
  EventV1_1,
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
  PhaseHandoffV1_1,
  ProjectConfigV1,
  ProjectConfigV1_1,
  ProjectConfigV1_2,
  PreToolUseV1,
  RequirementDiscoveryV1,
  RunUsageV1,
  SessionTelemetryV1,
  SnapshotV1,
  TransactionManifestV1,
  TransactionProgressV1,
  FailureCandidateV1,
} from "./generated/contracts.js";

export type LanguagePolicyV1 = ProjectConfigV1_2Contract.LanguagePolicy;
export type ModelRole = "planner" | "implementer" | "judge";
export type ModelAssignmentV1_1 =
  string | { readonly model: string; readonly effort: string };
export type CurrentEvent = EventV1_1;
export type ReadableEvent = EventV1 | EventV1_1;
export type CurrentProjectConfig = ProjectConfigV1_2;
export type ReadableProjectConfig =
  ProjectConfigV1 | ProjectConfigV1_1 | ProjectConfigV1_2;
