import { lstatSync, realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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

async function inspectTarget(root: string, target: string) {
  const request = await nodeTargetInspector(root).capture();
  return request.inspect(target);
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

    await expect(inspectTarget(root, outside)).resolves.toEqual({
      kind: "escape",
    });
  });

  it("classifies a drive-absolute target as a lexical escape", async () => {
    const root = await temporaryRoot("guard-root");

    await expect(inspectTarget(root, "C:/outside/secret.txt")).resolves.toEqual(
      { kind: "escape" },
    );
  });

  it("refuses an existing symlink that resolves outside the project", async () => {
    const root = await temporaryRoot("guard-root");
    const outside = await temporaryRoot("guard-outside");
    await writeFile(join(outside, "secret.txt"), "outside", "utf8");
    await symlink(outside, join(root, "linked"));

    await expect(inspectTarget(root, "linked/secret.txt")).resolves.toEqual({
      kind: "escape",
    });
  });

  it("fails closed when the target is a dangling symlink", async () => {
    const root = await temporaryRoot("guard-root");
    await symlink("missing-target", join(root, "dangling"));

    await expect(inspectTarget(root, "dangling")).resolves.toEqual({
      kind: "uninspectable",
    });
  });

  it("reattaches missing suffixes to the nearest canonical in-root ancestor", async () => {
    const root = await temporaryRoot("guard-root");
    await mkdir(join(root, "canonical"));
    await symlink("canonical", join(root, "alias"));

    await expect(
      inspectTarget(root, "alias/new/deep/file.ts"),
    ).resolves.toEqual({
      kind: "inside",
      lexicalPath: "alias/new/deep/file.ts",
      canonicalPath: "canonical/new/deep/file.ts",
    });
  });

  it("captures one canonical root identity for multiple target inspections", async () => {
    const root = await temporaryRoot("guard-root");
    await mkdir(join(root, "src"));
    let observations = 0;
    const inspector = nodeTargetInspector(root, {
      captureRoot: (path) => {
        observations += 1;
        const details = lstatSync(path);
        return {
          path: realpathSync(path),
          device: details.dev,
          inode: details.ino,
        };
      },
      lstat,
      realpath,
    });

    const request = await inspector.capture();
    await request.inspect("src/one.ts");
    await request.inspect("src/two.ts");

    expect(observations).toBe(1);
  });
});
