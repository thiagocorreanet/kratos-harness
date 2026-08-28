import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { Readable } from "node:stream";

import { normalizeProjectPath } from "../fake/index.js";
import type {
  Clock,
  Environment,
  FileStat,
  FileSystem,
  Ids,
  Output,
  StandardInput,
} from "../../ports/index.js";

export { nodeWorkspace } from "./workspace.js";
export {
  nodeTargetInspector,
  type TargetInspectionOperations,
} from "./target-inspection.js";
export { nodeGitRunner, type GitRunnerOptions } from "./git.js";
export { sha256Digests } from "../digests.js";
export {
  nodeDurableFileSystem,
  type DurableOperation,
  type DurableOperationEvent,
  type DurableOperationObserver,
} from "./transactions.js";

export function nodeClock(): Clock {
  return { now: () => new Date() };
}

/** Opaque identifiers, hyphen-free so they match the port's safe-id contract. */
export function nodeIds(): Ids {
  return { next: () => randomUUID().replaceAll("-", "") };
}

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

/**
 * Resolve a project-relative path against the real filesystem.
 *
 * Lexical normalization alone is not enough: a symlink can point outside the
 * project while the path that reaches it looks perfectly safe. The real parent
 * is resolved and checked before any mutation, so a redirected write is refused
 * rather than performed.
 */
async function resolveInside(root: string, path: string): Promise<string> {
  const normalized = normalizeProjectPath(path);
  const absolute = join(root, normalized);
  const realRoot = await realpath(root);

  const parent = dirname(absolute);
  let resolved: string;
  try {
    const realParent = await realpath(parent);
    if (!inside(realRoot, realParent)) {
      throw new Error("Runtime path escapes the project");
    }
    resolved = join(realParent, normalized.split("/").pop() ?? normalized);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("escapes the project")
    ) {
      throw error;
    }
    // The parent does not exist yet, so nothing can redirect it. Its own
    // ancestors are checked when they are created.
    return absolute;
  }

  // Checking the parent alone is not enough: when the final component is itself
  // a symlink, the whole redirect lives in that last segment and the parent is
  // perfectly legitimate. Resolving it is what closes that hole.
  try {
    const realTarget = await realpath(resolved);
    if (!inside(realRoot, realTarget)) {
      throw new Error("Runtime path escapes the project");
    }
    return realTarget;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("escapes the project")
    ) {
      throw error;
    }
    // The final component does not exist yet, so it cannot redirect anywhere.
    return resolved;
  }
}

export function nodeFileSystem(root: string): FileSystem {
  return {
    read: async (path) => readFile(await resolveInside(root, path), "utf8"),
    write: async (path, content) => {
      const absolute = await resolveInside(root, path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content, "utf8");
    },
    remove: async (path) => {
      // Recursive so removing a directory succeeds rather than failing with
      // EISDIR while the in-memory implementation reports success.
      await rm(await resolveInside(root, path), {
        force: true,
        recursive: true,
      });
    },
    makeDirectory: async (path) => {
      await mkdir(await resolveInside(root, path), { recursive: true });
    },
    list: async (path) => {
      const absolute =
        path === "." || path === "" ? root : await resolveInside(root, path);
      // Nothing to enumerate is an empty listing, not an error. A missing path
      // and a non-directory both yield [], which is what the in-memory
      // implementation does and what the shared contract fixes.
      const entries = await readdir(absolute).catch(() => []);
      return entries.sort((left, right) => left.localeCompare(right, "en-US"));
    },
    stat: async (path) => {
      try {
        const absolute = await resolveInside(root, path);
        const details = await stat(absolute);
        const kind = details.isDirectory() ? "directory" : "file";
        return { kind, size: details.size } satisfies FileStat;
      } catch (error) {
        // An escaping path is a refusal, not an absence, so it must not be
        // flattened into null the way a genuinely missing file is.
        if (
          error instanceof Error &&
          error.message.includes("escapes the project")
        ) {
          throw error;
        }
        return null;
      }
    },
  };
}

export function nodeEnvironment(): Environment {
  return {
    get: (name) => process.env[name],
    workingDirectory: () => process.cwd(),
  };
}

/**
 * Standard input, read once and only when it is not a terminal.
 *
 * Reading a TTY would hang the process waiting on a person who was never asked
 * for anything. A stream may be supplied so a test does not need one.
 */
export function nodeStandardInput(
  stream: Readable & { isTTY?: boolean } = process.stdin,
): StandardInput {
  let read = false;
  return {
    read: async () => {
      if (read || stream.isTTY === true) return null;
      read = true;
      // Decoding in the stream keeps the chunk type honest and spares this
      // function a branch for the two shapes a chunk can arrive in.
      stream.setEncoding("utf8");
      let document = "";
      for await (const chunk of stream as AsyncIterable<string>) {
        document += chunk;
      }
      // Zero bytes is a caller who supplied no document, not an empty one.
      return document.length === 0 ? null : document;
    },
  };
}

/** Output streams. A sink may be supplied so a test does not write to them. */
export function nodeOutput(sink?: Output): Output {
  return (
    sink ?? {
      structured: (text) => {
        process.stdout.write(text);
      },
      human: (text) => {
        process.stderr.write(text);
      },
    }
  );
}
