import { execFile } from "node:child_process";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type {
  ConfigurationObservation,
  DirectoryProbe,
  WorktreeLocation,
} from "../../domain/project/index.js";
import type { Workspace } from "../../ports/index.js";

const run = promisify(execFile);

function unsafe(path: string): boolean {
  let control = false;
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) control = true;
  }
  return (
    path.length === 0 ||
    path.includes("\\") ||
    /^[A-Za-z]:/u.test(path) ||
    control
  );
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function absent(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

async function optionalStat(
  path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (absent(error)) return null;
    throw error;
  }
}

async function markerKind(root: string): Promise<DirectoryProbe["brain"]> {
  const marker = join(root, ".brain");
  const details = await optionalStat(marker);
  if (details === null) return "absent";
  if (!details.isSymbolicLink()) {
    return details.isDirectory() ? "directory" : "other";
  }
  let target: string;
  try {
    target = await realpath(marker);
  } catch {
    return "other";
  }
  if (!inside(root, target)) return "escaping";
  return (await stat(target)).isDirectory() ? "directory" : "other";
}

async function configuration(
  root: string,
  brain: DirectoryProbe["brain"],
): Promise<ConfigurationObservation> {
  if (brain !== "directory") return { kind: "absent" };
  const path = join(root, ".brain", "config.json");
  const details = await optionalStat(path);
  if (details === null) return { kind: "absent" };
  if (details.isDirectory()) return { kind: "other" };
  if (details.isSymbolicLink()) {
    let target: string;
    try {
      target = await realpath(path);
    } catch {
      return { kind: "other" };
    }
    if (!inside(root, target) || !(await stat(target)).isFile()) {
      return { kind: "other" };
    }
  } else if (!details.isFile()) {
    return { kind: "other" };
  }
  return { kind: "file", text: await readFile(path, "utf8") };
}

async function probe(path: string): Promise<DirectoryProbe> {
  const brain = await markerKind(path);
  const legacy = join(dirname(path), `${basename(path)}-brain`, ".brain");
  const [gitMarker, legacyMarker, observedConfiguration] = await Promise.all([
    optionalStat(join(path, ".git")),
    optionalStat(legacy),
    configuration(path, brain),
  ]);
  return {
    path,
    brain,
    git: gitMarker === null ? "absent" : "present",
    legacyBrain:
      legacyMarker !== null &&
      !legacyMarker.isSymbolicLink() &&
      legacyMarker.isDirectory(),
    configuration: observedConfiguration,
  };
}

async function gitOutput(
  cwd: string,
  args: readonly string[],
): Promise<string | null> {
  try {
    const result = await run("git", [...args], {
      cwd,
      encoding: "utf8",
      env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", LC_ALL: "C" },
    });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

/** Real read-only workspace observations before a project root is trusted. */
export function nodeWorkspace(): Workspace {
  const canonicalize = async (
    path: string,
    base: string,
  ): Promise<string | null> => {
    if (unsafe(path) || unsafe(base)) return null;
    try {
      const candidate = await realpath(resolve(base, path));
      return (await stat(candidate)).isDirectory() ? candidate : null;
    } catch {
      return null;
    }
  };

  return {
    canonicalize,
    inspect: async (path) => {
      const canonical = await canonicalize(path, path);
      if (canonical === null) throw new Error("Workspace path is unusable");
      return probe(canonical);
    },
    ancestors: async (start) => {
      const canonical = await canonicalize(start, start);
      if (canonical === null) return [];
      const paths: string[] = [];
      let current = canonical;
      for (;;) {
        paths.push(current);
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
      }
      return Promise.all(paths.map((path) => probe(path)));
    },
    locateWorktree: async (start): Promise<WorktreeLocation | null> => {
      const canonical = await canonicalize(start, start);
      if (canonical === null) return null;
      const [topLevelText, commonText, gitDirText] = await Promise.all([
        gitOutput(canonical, ["rev-parse", "--show-toplevel"]),
        gitOutput(canonical, [
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ]),
        gitOutput(canonical, [
          "rev-parse",
          "--path-format=absolute",
          "--git-dir",
        ]),
      ]);
      if (topLevelText === null || commonText === null || gitDirText === null) {
        return null;
      }
      const [topLevel, common, gitDirectory] = await Promise.all([
        realpath(topLevelText),
        realpath(commonText),
        realpath(gitDirText),
      ]);
      const linked = common !== gitDirectory;
      return {
        kind: linked ? "linked" : "principal",
        topLevel,
        principal: linked ? dirname(common) : topLevel,
      };
    },
  };
}
