export {
  internalFailure,
  resultFor,
  usageFailure,
  USAGE_WHY,
} from "./result.js";
export type { EvidenceRef, Result, ResultDetail } from "./result.js";
export { ResultContractError, validateResult } from "./validate.js";
export { renderResultHuman, renderResultJson } from "./render.js";
export type { Rendered } from "./render.js";
