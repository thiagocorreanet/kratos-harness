export { KRATOS_VERSION } from "./version.js";
export {
  CONTRACT_IDENTITIES,
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
  AgentOutputV1,
  ApprovalV1,
  InitAnswersV1,
  HostOperationMessageV1,
  EventV1,
  EvidenceV1,
  FeatureStateV1,
  FeatureScopeV1,
  GapProposalV1,
  GapRecordV1,
  GateFactsV1,
  GuardrailsV1,
  LockLeaseV1,
  MigrationV1,
  ProjectConfigV1,
  PreToolUseV1,
  RequirementDiscoveryV1,
  SnapshotV1,
  TransactionManifestV1,
  TransactionProgressV1,
} from "./generated/contracts.js";
