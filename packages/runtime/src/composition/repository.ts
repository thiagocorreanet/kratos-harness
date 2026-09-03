import {
  SCAN_EXCLUDED_DIRECTORIES,
  SCAN_MAX_DEPTH,
  SCAN_MAX_ENTRIES,
  type ManifestContents,
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
 * Safely read declarative top-level manifest files present in root entries.
 * Missing, unreadable, or failing files are skipped silently.
 */
export async function observeManifestContents(
  fileSystem: FileSystem,
  rootEntries: readonly string[],
): Promise<ManifestContents> {
  const manifests: {
    packageJson?: string;
    makefile?: string;
    pyprojectToml?: string;
    cargoToml?: string;
    goMod?: string;
  } = {};

  const candidates: readonly (readonly [string, keyof ManifestContents])[] = [
    ["package.json", "packageJson"],
    ["Makefile", "makefile"],
    ["pyproject.toml", "pyprojectToml"],
    ["Cargo.toml", "cargoToml"],
    ["go.mod", "goMod"],
  ];

  for (const [filename, key] of candidates) {
    if (rootEntries.includes(filename)) {
      try {
        manifests[key] = await fileSystem.read(filename);
      } catch {
        // Ignored safely
      }
    }
  }

  return Object.freeze(manifests);
}
