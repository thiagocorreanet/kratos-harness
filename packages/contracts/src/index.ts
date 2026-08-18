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
export type {
  AdapterMessageV1,
  AgentOutputV1,
  ApprovalV1,
  InitAnswersV1,
  HostOperationMessageV1,
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
} from "./generated/contracts.js";
