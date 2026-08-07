export { captureAfter, captureBefore } from "./capture.ts";
export type { CaptureBaseline, CaptureSelector } from "./capture.ts";
export { compareGolden, compareObservations } from "./compare.ts";
export { materializeWorkspace } from "./materialize.ts";
export { normalizeObservation } from "./normalize.ts";
export { runScenario, runScenarioSide } from "./runner.ts";
export type { RunSideOptions, SideRun } from "./runner.ts";
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
