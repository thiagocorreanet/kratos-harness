import {
  resolveProject,
  type ConfigurationValidator,
  type DiscoveryRequest,
  type ProjectResolution,
  type WorkspaceObservation,
} from "../domain/project/index.js";
import { nodeEnvironment, nodeWorkspace } from "../infra/node/index.js";
import type { Environment, Workspace } from "../ports/index.js";
import { configurationValidator, createSchemaRegistry } from "./schema.js";

export interface DiscoveryPorts {
  readonly workspace: Workspace;
  readonly environment: Environment;
}

export function createDiscoveryPorts(
  overrides: Partial<DiscoveryPorts> = {},
): DiscoveryPorts {
  return {
    workspace: nodeWorkspace(),
    environment: nodeEnvironment(),
    ...overrides,
  };
}

/** Collect every read-only fact needed by the pure resolver. */
export async function observeWorkspace(
  request: DiscoveryRequest,
  ports: DiscoveryPorts,
): Promise<WorkspaceObservation> {
  const processWorkingDirectory = ports.environment.workingDirectory();
  const canonicalWorkingDirectory = await ports.workspace.canonicalize(
    request.workingDirectory,
    processWorkingDirectory,
  );
  if (request.explicitRoot !== null) {
    const canonicalExplicitRoot = await ports.workspace.canonicalize(
      request.explicitRoot,
      processWorkingDirectory,
    );
    return {
      canonicalWorkingDirectory,
      canonicalExplicitRoot,
      ancestors:
        canonicalExplicitRoot === null
          ? []
          : [await ports.workspace.inspect(canonicalExplicitRoot)],
      principalAncestors: [],
      worktree: null,
    };
  }
  if (canonicalWorkingDirectory === null) {
    return {
      canonicalWorkingDirectory: null,
      canonicalExplicitRoot: null,
      ancestors: [],
      principalAncestors: [],
      worktree: null,
    };
  }
  const [ancestors, worktree] = await Promise.all([
    ports.workspace.ancestors(canonicalWorkingDirectory),
    ports.workspace.locateWorktree(canonicalWorkingDirectory),
  ]);
  const principalAncestors =
    worktree?.kind === "linked" && request.worktreeMode === "principal"
      ? await ports.workspace.ancestors(worktree.principal)
      : [];
  return {
    canonicalWorkingDirectory,
    canonicalExplicitRoot: null,
    ancestors,
    principalAncestors,
    worktree,
  };
}

/** Observe and resolve without ever composing a mutation port. */
export async function discoverProject(
  request: DiscoveryRequest,
  ports: DiscoveryPorts,
  validateConfiguration: ConfigurationValidator = configurationValidator(
    createSchemaRegistry(),
  ),
): Promise<ProjectResolution> {
  return resolveProject(
    request,
    await observeWorkspace(request, ports),
    validateConfiguration,
  );
}

export { createRuntimeAt } from "./index.js";
