export { decideWriteTarget } from "./decision.js";
export type {
  DecideWriteTargetInput,
  WriteGuardReason,
  WriteTargetDecision,
} from "./decision.js";
export { globMatches, isPathGlob, matchesOrderedGlobs } from "./glob-policy.js";
export {
  parseSummaryScope,
  renderSummaryScope,
  scopesAgree,
} from "./scope-document.js";
export type { SummaryScopeParse } from "./scope-document.js";
