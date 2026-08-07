export { compareGolden, compareObservations } from "./compare.ts";
export { normalizeObservation } from "./normalize.ts";
export { loadScenario, validateSafeRelativePath } from "./scenario.ts";
export type {
  CapturedStream,
  DifferentialObservation,
  DifferentialReport,
  DifferentialScenario,
  GitObservation,
  GoldenAssertions,
  ManifestEntry,
  Mismatch,
  Mutation,
  NormalizationRule,
  ProcessObservation,
  StructuredObservation,
  WorkspaceEntry,
} from "./types.ts";
