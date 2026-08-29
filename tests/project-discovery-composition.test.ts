import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ProjectConfigV1_1 } from "@kratos/contracts";
import projectConfig from "../fixtures/contracts/v1.1/project-config.json" with { type: "json" };
import {
  createDiscoveryPorts,
  createRuntimeAt,
  discoverProject,
  observeWorkspace,
} from "@kratos/runtime/composition/discovery";
import { fixedEnvironment, memoryWorkspace } from "@kratos/runtime/infra/fake";
import type { Workspace } from "@kratos/runtime/ports";
import { describe, expect, it } from "vitest";

const configuration: ProjectConfigV1_1 = {
  contractVersion: "1.1.0",
  stateContract: "1.1.0",
  pluginVersion: "0.0.0-development",
  hostContract: "1.1.0",
  language: "en",
  policyMode: "standard",
  managedState: {
    directory: ".brain",
    eventLog: "events.jsonl",
    snapshots: false,
  },
  modelRoles: {
    codex: {
      planner: "planner",
      implementer: "implementer",
      judge: "judge",
    },
  },
};

const validator = () => ({ kind: "valid", value: configuration }) as const;

describe("project discovery composition", () => {
  it("uses production schema validation when no override is provided", async () => {
    const root = "/project";
    const request = {
      workingDirectory: root,
      explicitRoot: null,
      worktreeMode: "principal" as const,
    };
    const ports = {
      workspace: memoryWorkspace({
        directories: [root, `${root}/.brain`],
        files: {
          [`${root}/.brain/config.json`]: JSON.stringify(projectConfig),
        },
      }),
      environment: fixedEnvironment({}, root),
    };

    await expect(discoverProject(request, ports)).resolves.toEqual({
      kind: "initialized",
      root,
      configuration: projectConfig,
    });
  });

  it("collects a linked workspace and resolves its local project", async () => {
    const local = "/worktrees/project";
    const principal = "/repos/project";
    const start = `${local}/src`;
    const workspace = memoryWorkspace({
      directories: [start, `${local}/.brain`, principal],
      files: {
        [`${local}/.brain/config.json`]: JSON.stringify(configuration),
      },
      gitRoots: [local, principal],
      worktrees: [
        { kind: "linked", topLevel: local, principal },
        { kind: "principal", topLevel: principal, principal },
      ],
    });
    const request = {
      workingDirectory: start,
      explicitRoot: null,
      worktreeMode: "principal" as const,
    };
    const ports = {
      workspace,
      environment: fixedEnvironment({}, start),
    };

    const observed = await observeWorkspace(request, ports);
    expect(observed.principalAncestors[0]?.path).toBe(principal);
    const validated: unknown[] = [];
    expect(
      await discoverProject(request, ports, (value) => {
        validated.push(value);
        return validator();
      }),
    ).toEqual({
      kind: "initialized",
      root: local,
      configuration,
    });
    expect(validated).toEqual([configuration]);
    expect(await observeWorkspace(request, ports)).toEqual(observed);
  });

  it("pins an explicit relative root without observing its ancestors", async () => {
    const calls: string[] = [];
    const target = "/workspace/target";
    const workspace: Workspace = {
      canonicalize: (path, base) => {
        calls.push(`canonicalize:${path}:${base}`);
        return Promise.resolve(
          path === "../target" ? target : "/workspace/src",
        );
      },
      inspect: (path) => {
        calls.push(`inspect:${path}`);
        return Promise.resolve({
          path,
          brain: "absent",
          git: "absent",
          legacyBrain: false,
          configuration: { kind: "absent" },
        });
      },
      ancestors: (path) => {
        calls.push(`ancestors:${path}`);
        return Promise.resolve([]);
      },
      locateWorktree: (path) => {
        calls.push(`worktree:${path}`);
        return Promise.resolve(null);
      },
    };
    const request = {
      workingDirectory: ".",
      explicitRoot: "../target",
      worktreeMode: "principal" as const,
    };
    const resolution = await discoverProject(
      request,
      {
        workspace,
        environment: fixedEnvironment({}, "/workspace/src"),
      },
      validator,
    );
    expect(resolution).toEqual({ kind: "root-only", root: target });
    expect(calls).toEqual([
      "canonicalize:.:/workspace/src",
      "canonicalize:../target:/workspace/src",
      `inspect:${target}`,
    ]);
  });

  it("stops observation when the working directory is unavailable", async () => {
    const calls: string[] = [];
    const workspace: Workspace = {
      canonicalize: (path) => {
        calls.push(`canonicalize:${path}`);
        return Promise.resolve(null);
      },
      inspect: () => {
        throw new Error("inspect must not run");
      },
      ancestors: () => {
        throw new Error("ancestors must not run");
      },
      locateWorktree: () => {
        throw new Error("worktree lookup must not run");
      },
    };

    await expect(
      observeWorkspace(
        {
          workingDirectory: "/missing",
          explicitRoot: null,
          worktreeMode: "principal",
        },
        {
          workspace,
          environment: fixedEnvironment({}, "/process"),
        },
      ),
    ).resolves.toEqual({
      canonicalWorkingDirectory: null,
      canonicalExplicitRoot: null,
      ancestors: [],
      principalAncestors: [],
      worktree: null,
    });
    expect(calls).toEqual(["canonicalize:/missing"]);
  });

  it("does not inspect an explicit root that cannot be canonicalized", async () => {
    const workspace = memoryWorkspace({ directories: ["/process"] });
    await expect(
      observeWorkspace(
        {
          workingDirectory: ".",
          explicitRoot: "/missing",
          worktreeMode: "principal",
        },
        {
          workspace,
          environment: fixedEnvironment({}, "/process"),
        },
      ),
    ).resolves.toMatchObject({
      canonicalWorkingDirectory: "/process",
      canonicalExplicitRoot: null,
      ancestors: [],
    });
  });

  it("returns configuration failures without constructing mutation ports", async () => {
    const root = "/project";
    const ports = {
      workspace: memoryWorkspace({
        directories: [root, `${root}/.brain`],
        files: {
          [`${root}/.brain/config.json`]: '{"stateContract":"1.1.0"}',
        },
      }),
      environment: fixedEnvironment({}, root),
    };
    expect(
      await discoverProject(
        {
          workingDirectory: root,
          explicitRoot: null,
          worktreeMode: "principal",
        },
        ports,
        () => ({ kind: "invalid" }),
      ),
    ).toEqual({
      kind: "configuration-unusable",
      root,
      reasonCode: "guard.config_corrupt",
    });
    expect(Object.keys(ports).sort()).toEqual(["environment", "workspace"]);
  });

  it("creates rooted mutation ports only after discovery succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "kratos-rooted-runtime-"));
    try {
      const runtime = createRuntimeAt(root);
      await runtime.fileSystem.write("proof.txt", "rooted");
      expect(await readFile(join(root, "proof.txt"), "utf8")).toBe("rooted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("provides a production bootstrap with no mutation capability", () => {
    expect(Object.keys(createDiscoveryPorts()).sort()).toEqual([
      "environment",
      "workspace",
    ]);
  });
});
