import { memoryWorkspace } from "@mestre-yoda/runtime/infra/fake";
import { describe, expect, it } from "vitest";

import { describeWorkspaceContract } from "./support/workspace-contract.js";

const principal = "/repos/café project";
const project = "/worktrees/café task";
const start = `${project}/src/deep`;

function fixture() {
  return memoryWorkspace({
    directories: [start, `${project}/.brain`, principal],
    files: {
      [`${project}/.brain/config.json`]: '{"stateContract":"1.0.0"}\n',
    },
    gitRoots: [project, principal],
    worktrees: [
      { kind: "linked", topLevel: project, principal },
      { kind: "principal", topLevel: principal, principal },
    ],
  });
}

describeWorkspaceContract("memory", () =>
  Promise.resolve({
    port: fixture(),
    start,
    project,
    principal,
    dispose: () => Promise.resolve(),
  }),
);

describe("memory workspace edge classifications", () => {
  it("distinguishes marker files from directories", async () => {
    const workspace = memoryWorkspace({
      directories: ["/project"],
      files: { "/project/.brain": "not a directory" },
    });
    expect((await workspace.ancestors("/project"))[0]).toMatchObject({
      brain: "other",
      configuration: { kind: "absent" },
    });
  });

  it("accepts an internal marker symlink and reads through it", async () => {
    const workspace = memoryWorkspace({
      directories: ["/project", "/project/state"],
      files: { "/project/state/config.json": "safe" },
      symlinks: { "/project/.brain": "/project/state" },
    });
    expect((await workspace.ancestors("/project"))[0]).toMatchObject({
      brain: "directory",
      configuration: { kind: "file", text: "safe" },
    });
  });

  it("classifies an escaping marker symlink without reading it", async () => {
    const workspace = memoryWorkspace({
      directories: ["/project", "/private/state"],
      files: { "/private/state/config.json": "secret" },
      symlinks: { "/project/.brain": "/private/state" },
    });
    expect((await workspace.ancestors("/project"))[0]).toMatchObject({
      brain: "escaping",
      configuration: { kind: "absent" },
    });
  });

  it("observes a legacy sibling without reading its configuration", async () => {
    const workspace = memoryWorkspace({
      directories: ["/project", "/project-brain/.brain"],
      files: { "/project-brain/.brain/config.json": "legacy" },
    });
    expect((await workspace.ancestors("/project"))[0]).toMatchObject({
      brain: "absent",
      legacyBrain: true,
      configuration: { kind: "absent" },
    });
  });
});
