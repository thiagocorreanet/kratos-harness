import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { join, relative, sep } from "node:path";

import { validateSafeRelativePath } from "./scenario.ts";
import type {
  DifferentialObservation,
  GitObservation,
  ManifestEntry,
  Mutation,
  ProcessObservation,
  StructuredObservation,
} from "./types.ts";

const executeFile = promisify(execFile);
const maximumManifestEntries = 4096;
const maximumFileBytes = 8 * 1024 * 1024;

export interface CaptureSelector {
  structured: readonly { id: string; path: string }[];
  git: boolean;
}

export interface CaptureBaseline {
  manifest: readonly ManifestEntry[];
}

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en-US"))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

async function manifest(project: string): Promise<ManifestEntry[]> {
  const entries: ManifestEntry[] = [];
  async function visit(directory: string): Promise<void> {
    const children = await readdir(directory);
    children.sort((left, right) => left.localeCompare(right, "en-US"));
    for (const name of children) {
      const absolute = join(directory, name);
      const path = relative(project, absolute).split(sep).join("/");
      const stats = await lstat(absolute);
      if (path === ".git") {
        // Record that a repository exists without importing its
        // nondeterministic internals. Creating or removing a repository stays
        // visible as a mutation; `capture.git` observes its semantics.
        entries.push({
          path,
          type: stats.isDirectory() ? "directory" : "file",
          mode: stats.isDirectory() ? "directory" : "file",
          size: 0,
        });
        continue;
      }
      if (stats.isDirectory()) {
        entries.push({ path, type: "directory", mode: "directory", size: 0 });
        await visit(absolute);
      } else if (stats.isFile()) {
        if (stats.size > maximumFileBytes) {
          throw new Error(
            "Differential filesystem capture exceeds the file limit",
          );
        }
        const content = await readFile(absolute);
        entries.push({
          path,
          type: "file",
          mode: (stats.mode & 0o111) === 0 ? "file" : "executable",
          size: content.byteLength,
          sha256: digest(content),
        });
      } else if (stats.isSymbolicLink()) {
        const target = await readlink(absolute);
        entries.push({
          path,
          type: "symlink",
          mode: "symlink",
          size: Buffer.byteLength(target),
          target,
        });
      } else {
        throw new Error("Differential filesystem capture found a special file");
      }
      if (entries.length > maximumManifestEntries) {
        throw new Error(
          "Differential filesystem capture exceeds the entry limit",
        );
      }
    }
  }
  await visit(project);
  return entries;
}

function mutations(
  before: readonly ManifestEntry[],
  after: readonly ManifestEntry[],
): Mutation[] {
  const previous = new Map(before.map((entry) => [entry.path, entry]));
  const current = new Map(after.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...previous.keys(), ...current.keys()])].sort(
    (left, right) => left.localeCompare(right, "en-US"),
  );
  return paths.flatMap((path): Mutation[] => {
    const left = previous.get(path);
    const right = current.get(path);
    if (left === undefined) return [{ path, kind: "added" }];
    if (right === undefined) return [{ path, kind: "deleted" }];
    return JSON.stringify(left) === JSON.stringify(right)
      ? []
      : [{ path, kind: "modified" }];
  });
}

async function gitOutput(
  project: string,
  args: readonly string[],
): Promise<string> {
  const result = await executeFile("git", args, {
    cwd: project,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      LC_ALL: "C",
    },
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
  });
  return result.stdout;
}

function stream(value: string, disclosure: "digest" | "content") {
  return {
    bytes: Buffer.byteLength(value),
    sha256: digest(value),
    ...(disclosure === "content" ? { content: value } : {}),
  };
}

/**
 * A missing `git` binary is a harness failure. Recording it as "not a
 * repository" would make both sides agree vacuously on every Git scenario.
 */
function assertGitRunnable(error: unknown): void {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  ) {
    throw new Error("Differential Git capture cannot run git");
  }
}

/** An unborn HEAD is a real repository state, not an error. */
async function captureHead(project: string): Promise<string | null> {
  try {
    return (await gitOutput(project, ["rev-parse", "HEAD"])).trim() || null;
  } catch (error) {
    assertGitRunnable(error);
    return null;
  }
}

async function captureGit(
  project: string,
  disclosure: "digest" | "content",
): Promise<GitObservation | null> {
  try {
    if (
      (
        await gitOutput(project, ["rev-parse", "--is-inside-work-tree"])
      ).trim() !== "true"
    ) {
      return null;
    }
  } catch (error) {
    assertGitRunnable(error);
    return null;
  }
  const [head, status, worktreeDiff, indexDiff, refsText] = await Promise.all([
    captureHead(project),
    gitOutput(project, ["status", "--porcelain=v2", "--branch"]),
    gitOutput(project, ["diff", "--binary", "--no-ext-diff"]),
    gitOutput(project, ["diff", "--cached", "--binary", "--no-ext-diff"]),
    gitOutput(project, ["for-each-ref", "--format=%(refname)%00%(objectname)"]),
  ]);
  const refs = refsText
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, object] = line.split("\0");
      if (name === undefined || object === undefined) {
        throw new Error("Differential Git capture returned an invalid ref");
      }
      return { name, object };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "en-US"));
  return {
    head,
    status: stream(status, disclosure),
    worktreeDiff: stream(worktreeDiff, disclosure),
    indexDiff: stream(indexDiff, disclosure),
    refs,
  };
}

export async function captureBefore(
  project: string,
  selector: CaptureSelector,
): Promise<CaptureBaseline> {
  void selector;
  return { manifest: await manifest(project) };
}

export async function captureAfter(
  project: string,
  selector: CaptureSelector,
  baseline: CaptureBaseline,
  processObservation: ProcessObservation,
  disclosure: "digest" | "content",
): Promise<DifferentialObservation> {
  const after = await manifest(project);
  const structured = await Promise.all(
    selector.structured.map(
      async ({ id, path }): Promise<StructuredObservation> => {
        try {
          validateSafeRelativePath(path);
        } catch {
          throw new Error("Differential structured capture path is unsafe");
        }
        const absolute = join(project, path);
        let resolved: string;
        try {
          resolved = await realpath(absolute);
        } catch {
          // Missing, or a link with no target: the side produced no artifact.
          return { id, path, state: "absent" };
        }
        // Escaping the sandbox is never an observation; refuse to read it.
        if (!inside(project, resolved)) {
          throw new Error("Differential structured capture path is unsafe");
        }
        const stats = await lstat(resolved);
        if (!stats.isFile()) return { id, path, state: "unreadable" };
        const source = await readFile(resolved);
        try {
          return {
            id,
            path,
            state: "valid",
            value: canonicalize(JSON.parse(source.toString("utf8")) as unknown),
          };
        } catch {
          return {
            id,
            path,
            state: "invalid",
            bytes: source.byteLength,
            sha256: digest(source),
          };
        }
      },
    ),
  );
  return {
    process: processObservation,
    filesystem: {
      before: baseline.manifest,
      after,
      mutations: mutations(baseline.manifest, after),
    },
    structured,
    git: selector.git ? await captureGit(project, disclosure) : null,
  };
}
