import type { WorkspaceObservation, DirectoryProbe } from "./observation.js";
import type { DiscoveryRequest } from "./request.js";

export type RootSelection =
  | {
      readonly kind: "selected";
      readonly root: string;
      readonly probe: DirectoryProbe;
    }
  | { readonly kind: "root-only"; readonly root: string }
  | {
      readonly kind: "migration-pending";
      readonly root: string;
      readonly reasonCode: "brain_migration_pending";
    }
  | {
      readonly kind: "marker-unusable";
      readonly root: string;
      readonly reasonCode: "guard.project_marker_corrupt";
    }
  | {
      readonly kind: "not-found";
      readonly reasonCode: "guard.config_missing";
    }
  | { readonly kind: "refused"; readonly reasonCode: "trail.uso" };

function classify(probe: DirectoryProbe): RootSelection | null {
  if (probe.brain === "directory") {
    return { kind: "selected", root: probe.path, probe };
  }
  if (probe.brain === "other" || probe.brain === "escaping") {
    return {
      kind: "marker-unusable",
      root: probe.path,
      reasonCode: "guard.project_marker_corrupt",
    };
  }
  if (probe.legacyBrain) {
    return {
      kind: "migration-pending",
      root: probe.path,
      reasonCode: "brain_migration_pending",
    };
  }
  return null;
}

function scan(probes: readonly DirectoryProbe[]): RootSelection | null {
  for (const probe of probes) {
    const selection = classify(probe);
    if (selection !== null) return selection;
  }
  return null;
}

/** Select one canonical root without reading or mutating the workspace. */
export function resolveRoot(
  request: DiscoveryRequest,
  observation: WorkspaceObservation,
): RootSelection {
  if (request.explicitRoot !== null) {
    if (observation.canonicalExplicitRoot === null) {
      return { kind: "refused", reasonCode: "trail.uso" };
    }
    const probe = observation.ancestors.find(
      ({ path }) => path === observation.canonicalExplicitRoot,
    );
    if (probe === undefined) {
      return { kind: "refused", reasonCode: "trail.uso" };
    }
    return classify(probe) ?? { kind: "root-only", root: probe.path };
  }

  if (observation.canonicalWorkingDirectory === null) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  const local = scan(observation.ancestors);
  if (local !== null) return local;

  if (
    observation.worktree?.kind === "linked" &&
    request.worktreeMode === "principal"
  ) {
    const principal = scan(observation.principalAncestors);
    return (
      principal ?? {
        kind: "root-only",
        root: observation.worktree.principal,
      }
    );
  }

  if (observation.worktree !== null) {
    return { kind: "root-only", root: observation.worktree.topLevel };
  }
  const gitRoot = observation.ancestors.find(({ git }) => git === "present");
  if (gitRoot !== undefined) {
    return { kind: "root-only", root: gitRoot.path };
  }
  return { kind: "not-found", reasonCode: "guard.config_missing" };
}
