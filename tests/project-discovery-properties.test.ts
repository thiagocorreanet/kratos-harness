import { posix } from "node:path";

import {
  discoverProject,
  observeWorkspace,
} from "@kratos/runtime/composition/discovery";
import {
  fixedEnvironment,
  memoryWorkspace,
} from "@kratos/runtime/infra/fake";
import { describe, expect, it } from "vitest";

function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
}

describe("project discovery properties", () => {
  it("canonicalizes generated safe directories idempotently", async () => {
    const seed = 0x18_20_26;
    const next = generator(seed);
    const segments = ["ordinary", "space name", "café", "cafe\u0301"];
    const paths = Array.from({ length: 100 }, () => {
      const depth = (next() % 4) + 1;
      return `/${Array.from(
        { length: depth },
        () => segments[next() % segments.length] ?? "ordinary",
      ).join("/")}`;
    });
    const workspace = memoryWorkspace({ directories: paths });
    for (const path of paths) {
      const first = await workspace.canonicalize(path, "/");
      expect(first, `seed=${String(seed)} path=${path}`).not.toBeNull();
      expect(
        await workspace.canonicalize(first ?? "", "/"),
        `seed=${String(seed)} path=${path}`,
      ).toBe(first);
    }
  });

  it("refuses every generated unsafe spelling", async () => {
    const seed = 0x18_00_bad;
    const next = generator(seed);
    const unsafe = ["", "bad\u0000name", "bad\nname", "a\\b", "C:\\root"];
    const workspace = memoryWorkspace({ directories: ["/project"] });
    for (let index = 0; index < 100; index += 1) {
      const path = unsafe[next() % unsafe.length] ?? "";
      expect(
        await workspace.canonicalize(path, "/project"),
        `seed=${String(seed)} path=${JSON.stringify(path)}`,
      ).toBeNull();
    }
  });

  it("resolves a relative explicit root only when that directory exists", async () => {
    const workspace = memoryWorkspace({
      directories: ["/workspace/current", "/workspace/target"],
    });
    expect(
      await workspace.canonicalize("../target", "/workspace/current"),
    ).toBe("/workspace/target");
    expect(
      await workspace.canonicalize("../../private", "/workspace/current"),
    ).toBeNull();
  });

  it("never turns an escaping marker into selected project state", async () => {
    const root = "/workspace/project";
    const workspace = memoryWorkspace({
      directories: [root, "/workspace/private"],
      files: { "/workspace/private/config.json": "secret" },
      symlinks: { [`${root}/.brain`]: "/workspace/private" },
    });
    const ports = {
      workspace,
      environment: fixedEnvironment({}, root),
    };
    const request = {
      workingDirectory: root,
      explicitRoot: null,
      worktreeMode: "principal" as const,
    };
    const before = await observeWorkspace(request, ports);
    expect(
      await discoverProject(request, ports, () => {
        throw new Error("escaping state must not be validated");
      }),
    ).toEqual({
      kind: "marker-unusable",
      root,
      reasonCode: "guard.project_marker_corrupt",
    });
    expect(await observeWorkspace(request, ports)).toEqual(before);
    expect(posix.relative(root, "/workspace/private")).toBe("../private");
  });

  it("performs a full failed discovery with read-only ports only", async () => {
    const root = "/outside/project";
    const ports = {
      workspace: memoryWorkspace({ directories: [root] }),
      environment: fixedEnvironment({}, root),
    };
    const result = await discoverProject(
      {
        workingDirectory: root,
        explicitRoot: null,
        worktreeMode: "principal",
      },
      ports,
      () => {
        throw new Error("no configuration should be validated");
      },
    );
    expect(result).toEqual({
      kind: "not-found",
      reasonCode: "guard.config_missing",
    });
    expect(Object.keys(ports.workspace).sort()).toEqual([
      "ancestors",
      "canonicalize",
      "inspect",
      "locateWorktree",
    ]);
  });
});
