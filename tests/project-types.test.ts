import { describe, expect, expectTypeOf, it } from "vitest";

import type { ProjectConfigV1 } from "@kratos/contracts";
import type {
  ConfigurationValidator,
  DirectoryProbe,
  DiscoveryRequest,
  ProjectResolution,
  WorkspaceObservation,
} from "@kratos/runtime/domain/project";

const request: DiscoveryRequest = {
  workingDirectory: "/workspace/project/src",
  explicitRoot: null,
  worktreeMode: "principal",
};

const probe: DirectoryProbe = {
  path: "/workspace/project",
  brain: "directory",
  git: "present",
  legacyBrain: false,
  configuration: {
    kind: "file",
    text: '{"stateContract":"1.0.0"}',
  },
};

const observation: WorkspaceObservation = {
  canonicalWorkingDirectory: "/workspace/project/src",
  canonicalExplicitRoot: null,
  ancestors: [probe],
  principalAncestors: [],
  worktree: {
    kind: "principal",
    topLevel: "/workspace/project",
    principal: "/workspace/project",
  },
};

describe("project discovery vocabulary", () => {
  it("keeps requests and observations inert", () => {
    expect(request).toEqual({
      workingDirectory: "/workspace/project/src",
      explicitRoot: null,
      worktreeMode: "principal",
    });
    expect(observation.ancestors).toEqual([probe]);
  });

  it("requires validation before configuration becomes typed", () => {
    const validator: ConfigurationValidator = (value) =>
      typeof value === "object" && value !== null
        ? { kind: "valid", value: value as ProjectConfigV1 }
        : { kind: "invalid" };

    expect(validator(null)).toEqual({ kind: "invalid" });
    expectTypeOf(validator).returns.toEqualTypeOf<
      | { readonly kind: "valid"; readonly value: ProjectConfigV1 }
      | { readonly kind: "invalid" }
    >();
  });

  it("exposes a closed resolution union", () => {
    const resolutions = [
      {
        kind: "initialized",
        root: "/workspace/project",
        configuration: {} as ProjectConfigV1,
      },
      { kind: "root-only", root: "/workspace/project" },
      {
        kind: "migration-pending",
        root: "/workspace/project",
        reasonCode: "brain_migration_pending",
      },
      {
        kind: "marker-unusable",
        root: "/workspace/project",
        reasonCode: "guard.project_marker_corrupt",
      },
      {
        kind: "configuration-unusable",
        root: "/workspace/project",
        reasonCode: "guard.config_corrupt",
      },
      { kind: "not-found", reasonCode: "guard.config_missing" },
      { kind: "refused", reasonCode: "trail.uso" },
    ] as const satisfies readonly ProjectResolution[];

    expect(resolutions.map(({ kind }) => kind)).toEqual([
      "initialized",
      "root-only",
      "migration-pending",
      "marker-unusable",
      "configuration-unusable",
      "not-found",
      "refused",
    ]);
  });
});
