export { evaluateWriteRequest } from "./policy.js";
export type { PolicyEvaluation, PolicyState } from "./policy.js";
export {
  extractMutationTargets,
  inspectMutationTarget,
  inspectMutationTargets,
} from "./targets.js";
export type { CanonicalTarget, InspectedTargets } from "./targets.js";
export type { GuardWriteOutcome, ScopeRecordOutcome } from "./operations.js";
