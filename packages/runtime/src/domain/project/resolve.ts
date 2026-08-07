import { classifyConfiguration } from "./configuration.js";
import type { WorkspaceObservation } from "./observation.js";
import type { DiscoveryRequest } from "./request.js";
import { resolveRoot } from "./resolve-root.js";
import type { ProjectResolution } from "./resolution.js";
import type { ConfigurationValidator } from "./validation.js";

/** Resolve one complete project answer from inert observations. */
export function resolveProject(
  request: DiscoveryRequest,
  observation: WorkspaceObservation,
  validateConfiguration: ConfigurationValidator,
): ProjectResolution {
  const root = resolveRoot(request, observation);
  if (root.kind !== "selected") return root;
  const configuration = classifyConfiguration(
    root.probe.configuration,
    validateConfiguration,
  );
  if (configuration.kind === "failure") {
    return {
      kind: "configuration-unusable",
      root: root.root,
      reasonCode: configuration.reasonCode,
    };
  }
  return {
    kind: "initialized",
    root: root.root,
    configuration: configuration.value,
  };
}
