export { budgetExhausted, deriveGateFacts } from "./derive.js";
export type { GateFactsRequest } from "./derive.js";
export {
  GAP_CATEGORIES,
  GAP_PHASES,
  GAP_WEIGHTS,
  MAX_DOCUMENT_REFS,
  MAX_PROPOSED_GAPS,
  describeGapRefusal,
  describeProposalFailure,
  isOpenGap,
} from "./model.js";
export type {
  ApprovalBoundary,
  GapCategory,
  GapProposalObservation,
  GapPhase,
  GapRefusal,
  GapVerdict,
  GapWeight,
} from "./model.js";
export {
  decideGapRecord,
  decideGapVerdict,
  decideGapWaiver,
} from "./record.js";
export type {
  GapRecordDecision,
  GapRecordRequest,
  GapUpdateDecision,
  GapVerdictRequest,
  GapWaiverRequest,
} from "./record.js";
