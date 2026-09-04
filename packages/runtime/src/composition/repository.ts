import {
  CI_FILE_MAX_BYTES,
  CI_WORKFLOW_MAX_FILES,
  SCAN_EXCLUDED_DIRECTORIES,
  SCAN_MAX_DEPTH,
  SCAN_MAX_ENTRIES,
  type ManifestContents,
  type ManifestFile,
  type RepositoryEvidence,
} from "../domain/init/index.js";
import type { FileSystem } from "../ports/index.js";

interface Frontier {
  readonly path: string;
  readonly depth: number;
}

/**
 * Collect the names the classifier decides from.
 *
 * Reading happens here because the classifier is pure: it is handed a listing
 * and never reaches a disk. The walk is bounded in depth and in entries, so a
 * repository nobody expected degrades to a partial profile that says so rather
 * than to a run that never returns. Nothing is opened: only names, their
 * directories, and whether each entry is a file.
 */
export async function observeRepositoryEvidence(
  fileSystem: FileSystem,
): Promise<RepositoryEvidence> {
  const rootEntries = await fileSystem.list(".");
  const files: string[] = [];
  let frontier: readonly Frontier[] = [{ path: ".", depth: 0 }];
  let budget = SCAN_MAX_ENTRIES;
  let truncated = false;

  // Breadth first, so a budget spent early still describes the shallow part of
  // the tree completely. Depth first would report a monorepo as whichever
  // application sorts first.
  while (frontier.length > 0 && !truncated) {
    const next: Frontier[] = [];
    for (const directory of frontier) {
      const entries =
        directory.depth === 0
          ? rootEntries
          : await fileSystem.list(directory.path);
      for (const name of [...entries].sort(compareText)) {
        if (budget <= 0) {
          truncated = true;
          break;
        }
        budget -= 1;
        const path =
          directory.path === "." ? name : `${directory.path}/${name}`;
        const entry = await inspect(fileSystem, path);
        if (entry === null) continue;
        if (entry.kind !== "directory") {
          files.push(path);
          continue;
        }
        if (SCAN_EXCLUDED_DIRECTORIES.includes(name)) continue;
        if (directory.depth < SCAN_MAX_DEPTH) {
          next.push({ path, depth: directory.depth + 1 });
        }
      }
      if (truncated) break;
    }
    frontier = next;
  }

  return Object.freeze({
    rootEntries,
    files: Object.freeze(files),
    truncated,
  });
}

/**
 * What an entry is, or nothing.
 *
 * A path the filesystem refuses — one that leaves the project through a
 * symbolic link, one that vanished between the listing and the question — is
 * an entry this scan does not count, not a failed initialization.
 */
async function inspect(
  fileSystem: FileSystem,
  path: string,
): Promise<{ readonly kind: string } | null> {
  try {
    return await fileSystem.stat(path);
  } catch {
    return null;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Where a devcontainer configuration is allowed to sit, most conventional
 * first.
 */
const DEVCONTAINER_PATHS: readonly string[] = [
  ".devcontainer/devcontainer.json",
  ".devcontainer.json",
  "devcontainer.json",
];

/**
 * The task-runner files, by the spellings a repository actually uses.
 *
 * Each entry is tried in order and the first one present answers, so a
 * repository holding both `Taskfile.yml` and `Taskfile.yaml` is read once and
 * deterministically.
 */
const TASK_RUNNER_CANDIDATES: readonly (readonly [
  "taskfile" | "justfile" | "miseToml",
  readonly string[],
])[] = [
  ["taskfile", ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml"]],
  ["justfile", ["justfile", "Justfile", ".justfile"]],
  ["miseToml", ["mise.toml", ".mise.toml", "mise/config.toml"]],
];

/**
 * Safely read the declarative files that state what this project runs.
 *
 * Three kinds of file, in one pass: the top-level manifests whose contents are
 * parsed, the language-agnostic task runners that name their tasks the way a
 * Makefile names targets, and the CI workflows that record the literal
 * commands this repository runs on every push.
 *
 * Everything stays bounded and offline. Only paths the scan already saw are
 * opened, each is measured before it is read, and a missing, oversized, or
 * unreadable file is skipped in silence rather than failing initialization.
 */
export async function observeManifestContents(
  fileSystem: FileSystem,
  evidence: RepositoryEvidence,
): Promise<ManifestContents> {
  const manifests: {
    packageJson?: string;
    makefile?: string;
    pyprojectToml?: string;
    taskfile?: ManifestFile;
    justfile?: ManifestFile;
    miseToml?: ManifestFile;
    devcontainerJson?: ManifestFile;
    workflows?: readonly ManifestFile[];
  } = {};

  const candidates: readonly (readonly [
    string,
    "packageJson" | "makefile" | "pyprojectToml",
  ])[] = [
    ["package.json", "packageJson"],
    ["Makefile", "makefile"],
    ["pyproject.toml", "pyprojectToml"],
  ];

  for (const [filename, key] of candidates) {
    if (evidence.rootEntries.includes(filename)) {
      try {
        manifests[key] = await fileSystem.read(filename);
      } catch {
        // Ignored safely
      }
    }
  }

  const observed = new Set([
    ...evidence.rootEntries,
    ...(evidence.files ?? []),
  ]);

  for (const [key, paths] of TASK_RUNNER_CANDIDATES) {
    const file = await readBounded(fileSystem, observed, paths);
    if (file !== undefined) manifests[key] = file;
  }

  const devcontainer = await readBounded(
    fileSystem,
    observed,
    DEVCONTAINER_PATHS,
  );
  if (devcontainer !== undefined) manifests.devcontainerJson = devcontainer;

  const workflows = await readWorkflows(fileSystem, evidence);
  if (workflows.length > 0) manifests.workflows = Object.freeze(workflows);

  return Object.freeze(manifests);
}

/**
 * Read the first of several paths the scan saw, within the size ceiling.
 *
 * A file larger than the ceiling is not read at all: it is measured first, so
 * a repository holding a generated configuration of any size costs one `stat`
 * rather than the memory to hold it.
 */
async function readBounded(
  fileSystem: FileSystem,
  observed: ReadonlySet<string>,
  paths: readonly string[],
): Promise<ManifestFile | undefined> {
  for (const path of paths) {
    if (!observed.has(path)) continue;
    try {
      const stat = await fileSystem.stat(path);
      if (stat === null || stat.kind === "directory") continue;
      if (stat.size > CI_FILE_MAX_BYTES) continue;
      return Object.freeze({ path, content: await fileSystem.read(path) });
    } catch {
      // Unreadable is indistinguishable from absent for a derivation.
    }
  }
  return undefined;
}

/**
 * The workflow files the scan saw, in path order and within both ceilings.
 *
 * Path order rather than directory order, so the command a repository derives
 * does not depend on how a filesystem happened to enumerate its entries.
 */
async function readWorkflows(
  fileSystem: FileSystem,
  evidence: RepositoryEvidence,
): Promise<readonly ManifestFile[]> {
  const paths = (evidence.files ?? [])
    .filter(
      (path) =>
        path.startsWith(".github/workflows/") &&
        (path.endsWith(".yml") || path.endsWith(".yaml")),
    )
    .sort(compareText)
    .slice(0, CI_WORKFLOW_MAX_FILES);

  const workflows: ManifestFile[] = [];
  for (const path of paths) {
    const file = await readBounded(fileSystem, new Set([path]), [path]);
    if (file !== undefined) workflows.push(file);
  }
  return workflows;
}
