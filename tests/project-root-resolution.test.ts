import { describe, expect, it } from "vitest";

import {
  resolveRoot,
  type DirectoryProbe,
  type DiscoveryRequest,
  type WorkspaceObservation,
} from "@mestre-yoda/runtime/domain/project";

function probe(
  path: string,
  overrides: Partial<DirectoryProbe> = {},
): DirectoryProbe {
  return {
    path,
    brain: "absent",
    git: "absent",
    legacyBrain: false,
    configuration: { kind: "absent" },
    ...overrides,
  };
}

function request(overrides: Partial<DiscoveryRequest> = {}): DiscoveryRequest {
  return {
    workingDirectory: "/work/project/src",
    explicitRoot: null,
    worktreeMode: "principal",
    ...overrides,
  };
}

function observation(
  overrides: Partial<WorkspaceObservation> = {},
): WorkspaceObservation {
  return {
    canonicalWorkingDirectory: "/work/project/src",
    canonicalExplicitRoot: null,
    ancestors: [
      probe("/work/project/src"),
      probe("/work/project"),
      probe("/work"),
      probe("/"),
    ],
    principalAncestors: [],
    worktree: null,
    ...overrides,
  };
}

describe("project root resolution", () => {
  it("pins an explicit canonical root without walking ancestors", () => {
    const selected = probe("/other/project", { brain: "directory" });
    expect(
      resolveRoot(
        request({ explicitRoot: "../../other/project" }),
        observation({
          canonicalExplicitRoot: "/other/project",
          ancestors: [selected, probe("/other", { brain: "directory" })],
        }),
      ),
    ).toEqual({ kind: "selected", root: "/other/project", probe: selected });
  });

  it("refuses an explicit root that could not be canonicalized", () => {
    expect(
      resolveRoot(
        request({ explicitRoot: "missing" }),
        observation({ canonicalExplicitRoot: null, ancestors: [] }),
      ),
    ).toEqual({ kind: "refused", reasonCode: "trail.uso" });
  });

  it("refuses an explicit root whose probe was not observed", () => {
    expect(
      resolveRoot(
        request({ explicitRoot: "/work/missing-probe" }),
        observation({
          canonicalExplicitRoot: "/work/missing-probe",
          ancestors: [],
        }),
      ),
    ).toEqual({ kind: "refused", reasonCode: "trail.uso" });
  });

  it("returns an explicit usable directory without a marker as root-only", () => {
    const root = probe("/work/new-project");
    expect(
      resolveRoot(
        request({ explicitRoot: "/work/new-project" }),
        observation({
          canonicalExplicitRoot: "/work/new-project",
          ancestors: [root],
        }),
      ),
    ).toEqual({ kind: "root-only", root: "/work/new-project" });
  });

  it("chooses the nearest project-local marker", () => {
    const nearest = probe("/work/project/packages/api", {
      brain: "directory",
    });
    expect(
      resolveRoot(
        request(),
        observation({
          ancestors: [
            probe("/work/project/packages/api/src"),
            nearest,
            probe("/work/project", { brain: "directory" }),
          ],
        }),
      ),
    ).toEqual({
      kind: "selected",
      root: "/work/project/packages/api",
      probe: nearest,
    });
  });

  it("refuses a working directory that could not be canonicalized", () => {
    expect(
      resolveRoot(request(), observation({ canonicalWorkingDirectory: null })),
    ).toEqual({ kind: "refused", reasonCode: "trail.uso" });
  });

  it.each(["other", "escaping"] as const)(
    "refuses a nearest %s marker instead of falling through",
    (brain) => {
      expect(
        resolveRoot(
          request(),
          observation({
            ancestors: [
              probe("/work/project/src"),
              probe("/work/project", { brain }),
              probe("/work", { brain: "directory" }),
            ],
          }),
        ),
      ).toEqual({
        kind: "marker-unusable",
        root: "/work/project",
        reasonCode: "guard.project_marker_corrupt",
      });
    },
  );

  it("classifies a legacy sibling without using it as current state", () => {
    expect(
      resolveRoot(
        request(),
        observation({
          ancestors: [
            probe("/work/project/src"),
            probe("/work/project", { legacyBrain: true }),
          ],
        }),
      ),
    ).toEqual({
      kind: "migration-pending",
      root: "/work/project",
      reasonCode: "brain_migration_pending",
    });
  });

  it("lets a local marker win before principal worktree fallback", () => {
    const local = probe("/worktrees/café task", { brain: "directory" });
    expect(
      resolveRoot(
        request(),
        observation({
          ancestors: [local],
          principalAncestors: [probe("/repos/café", { brain: "directory" })],
          worktree: {
            kind: "linked",
            topLevel: "/worktrees/café task",
            principal: "/repos/café",
          },
        }),
      ),
    ).toMatchObject({ kind: "selected", root: "/worktrees/café task" });
  });

  it("falls back to the principal worktree by default", () => {
    const principal = probe("/repos/project", { brain: "directory" });
    expect(
      resolveRoot(
        request(),
        observation({
          ancestors: [probe("/worktrees/task")],
          principalAncestors: [principal],
          worktree: {
            kind: "linked",
            topLevel: "/worktrees/task",
            principal: "/repos/project",
          },
        }),
      ),
    ).toEqual({
      kind: "selected",
      root: "/repos/project",
      probe: principal,
    });
  });

  it("uses the principal checkout root when it has no marker", () => {
    expect(
      resolveRoot(
        request(),
        observation({
          ancestors: [probe("/worktrees/task")],
          principalAncestors: [probe("/repos/project")],
          worktree: {
            kind: "linked",
            topLevel: "/worktrees/task",
            principal: "/repos/project",
          },
        }),
      ),
    ).toEqual({ kind: "root-only", root: "/repos/project" });
  });

  it("keeps local worktree mode at the linked Git root", () => {
    expect(
      resolveRoot(
        request({ worktreeMode: "local" }),
        observation({
          ancestors: [probe("/worktrees/task", { git: "present" })],
          principalAncestors: [probe("/repos/project", { brain: "directory" })],
          worktree: {
            kind: "linked",
            topLevel: "/worktrees/task",
            principal: "/repos/project",
          },
        }),
      ),
    ).toEqual({ kind: "root-only", root: "/worktrees/task" });
  });

  it("uses an ordinary Git top level when no marker exists", () => {
    expect(
      resolveRoot(
        request(),
        observation({
          ancestors: [
            probe("/work/project/src"),
            probe("/work/project", { git: "present" }),
          ],
          worktree: {
            kind: "principal",
            topLevel: "/work/project",
            principal: "/work/project",
          },
        }),
      ),
    ).toEqual({ kind: "root-only", root: "/work/project" });
  });

  it("uses an ancestor Git marker when topology lookup is unavailable", () => {
    expect(
      resolveRoot(
        request(),
        observation({
          ancestors: [
            probe("/work/project/src"),
            probe("/work/project", { git: "present" }),
          ],
          worktree: null,
        }),
      ),
    ).toEqual({ kind: "root-only", root: "/work/project" });
  });

  it("returns a stable not-found result outside a project", () => {
    const input = observation();
    expect(resolveRoot(request(), input)).toEqual({
      kind: "not-found",
      reasonCode: "guard.config_missing",
    });
    expect(resolveRoot(request(), input)).toEqual(
      resolveRoot(request(), input),
    );
  });
});
