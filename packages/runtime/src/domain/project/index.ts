export { classifyConfiguration } from "./configuration.js";
export type { ConfigurationOutcome } from "./configuration.js";
export { resolveConfigurationLayers } from "./layers.js";
export type { ConfigurationLayers, FlagValue, Resolved } from "./layers.js";
export type {
  BrainMarker,
  ConfigurationObservation,
  DirectoryProbe,
  WorkspaceObservation,
  WorktreeLocation,
} from "./observation.js";
export type { DiscoveryRequest, WorktreeMode } from "./request.js";
export { resolveProject } from "./resolve.js";
export { resolveRoot } from "./resolve-root.js";
export type { RootSelection } from "./resolve-root.js";
export type { ProjectResolution } from "./resolution.js";
export type {
  ConfigurationValidation,
  ConfigurationValidator,
} from "./validation.js";
