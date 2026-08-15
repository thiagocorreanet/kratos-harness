import { chmod, mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { validateSafeRelativePath } from "./scenario.ts";
import type { WorkspaceEntry } from "./types.ts";

const maximumWorkspaceBytes = 4 * 1024 * 1024;

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function safePath(path: string): string {
  try {
    return validateSafeRelativePath(path);
  } catch {
    throw new Error("Differential workspace path is unsafe");
  }
}

async function verifyParent(
  project: string,
  destination: string,
): Promise<void> {
  const parent = await realpath(dirname(destination));
  if (!inside(project, parent)) {
    throw new Error("Differential workspace path is unsafe");
  }
}

export async function materializeWorkspace(
  root: string,
  entries: readonly WorkspaceEntry[],
): Promise<string> {
  const resolvedRoot = await realpath(root);
  const aggregateBytes = entries.reduce(
    (total, entry) =>
      total +
      (entry.type === "file" ? Buffer.byteLength(entry.content, "utf8") : 0),
    0,
  );
  if (aggregateBytes > maximumWorkspaceBytes) {
    throw new Error("Differential workspace exceeds the byte limit");
  }
  const foldedPaths = new Set<string>();
  for (const entry of entries) {
    safePath(entry.path);
    if (entry.type === "symlink") safePath(entry.target);
    const folded = entry.path.toLocaleLowerCase("en-US");
    if (foldedPaths.has(folded)) {
      throw new Error("Differential workspace paths collide");
    }
    foldedPaths.add(folded);
  }

  const project = join(resolvedRoot, "project");
  await mkdir(project, { mode: 0o755 });
  const resolvedProject = await realpath(project);

  const directories = entries
    .filter(
      (entry): entry is Extract<WorkspaceEntry, { type: "directory" }> =>
        entry.type === "directory",
    )
    .sort(
      (left, right) =>
        left.path.split("/").length - right.path.split("/").length,
    );
  const files = entries.filter(
    (entry): entry is Extract<WorkspaceEntry, { type: "file" }> =>
      entry.type === "file",
  );
  const links = entries.filter(
    (entry): entry is Extract<WorkspaceEntry, { type: "symlink" }> =>
      entry.type === "symlink",
  );

  for (const entry of directories) {
    const destination = join(resolvedProject, safePath(entry.path));
    await verifyParent(resolvedProject, destination);
    await mkdir(destination, { mode: 0o755 });
  }
  for (const entry of files) {
    const destination = join(resolvedProject, safePath(entry.path));
    await verifyParent(resolvedProject, destination);
    await writeFile(destination, entry.content, {
      encoding: "utf8",
      flag: "wx",
    });
    await chmod(destination, entry.executable ? 0o755 : 0o644);
  }
  for (const entry of links) {
    const destination = join(resolvedProject, safePath(entry.path));
    const target = safePath(entry.target);
    await verifyParent(resolvedProject, destination);
    const resolvedTarget = resolve(dirname(destination), target);
    if (isAbsolute(target) || !inside(resolvedProject, resolvedTarget)) {
      throw new Error("Differential workspace path is unsafe");
    }
    await symlink(target, destination);
  }
  return resolvedProject;
}
