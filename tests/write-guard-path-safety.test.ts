import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { nodeTargetInspector } from "@kratos/runtime/infra/node";

const roots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `kratos-${label}-`));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("canonical write-target inspection", () => {
  it("refuses a lexically outside absolute target", async () => {
    const root = await temporaryRoot("guard-root");
    const outside = await temporaryRoot("guard-outside");

    await expect(nodeTargetInspector(root).inspect(outside)).resolves.toEqual({
      kind: "escape",
    });
  });

  it("classifies a drive-absolute target as a lexical escape", async () => {
    const root = await temporaryRoot("guard-root");

    await expect(
      nodeTargetInspector(root).inspect("C:/outside/secret.txt"),
    ).resolves.toEqual({ kind: "escape" });
  });

  it("refuses an existing symlink that resolves outside the project", async () => {
    const root = await temporaryRoot("guard-root");
    const outside = await temporaryRoot("guard-outside");
    await writeFile(join(outside, "secret.txt"), "outside", "utf8");
    await symlink(outside, join(root, "linked"));

    await expect(
      nodeTargetInspector(root).inspect("linked/secret.txt"),
    ).resolves.toEqual({ kind: "escape" });
  });

  it("fails closed when the target is a dangling symlink", async () => {
    const root = await temporaryRoot("guard-root");
    await symlink("missing-target", join(root, "dangling"));

    await expect(
      nodeTargetInspector(root).inspect("dangling"),
    ).resolves.toEqual({ kind: "uninspectable" });
  });

  it("reattaches missing suffixes to the nearest canonical in-root ancestor", async () => {
    const root = await temporaryRoot("guard-root");
    await mkdir(join(root, "canonical"));
    await symlink("canonical", join(root, "alias"));

    await expect(
      nodeTargetInspector(root).inspect("alias/new/deep/file.ts"),
    ).resolves.toEqual({
      kind: "inside",
      path: "canonical/new/deep/file.ts",
    });
  });
});
