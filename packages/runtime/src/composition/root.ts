import type { Invocation } from "../domain/cli/index.js";
import {
  resolveProject,
  type ProjectResolution,
  type WorktreeMode,
} from "../domain/project/index.js";
import {
  usageFailure,
  USAGE_WHY,
  type Result,
} from "../domain/result/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { observeWorkspace } from "./discovery.js";
import { createRuntimeAt } from "./index.js";
import { configurationValidator } from "./schema.js";

/** Where a command runs, and the ports it must be committed through. */
export type ResolvedRoot =
  | { readonly kind: "failure"; readonly result: Result }
  | {
      readonly kind: "root";
      readonly resolution: ProjectResolution | null;
      /** Absolute target, or null when it is where the process already is. */
      readonly target: string | null;
    };

/**
 * Decide which directory a command runs against.
 *
 * Without a flag, that is the directory the caller is standing in. A command
 * that creates state should not walk up the tree and initialize a directory
 * somebody forgot they had state in, so detection is something you ask for.
 */
export async function resolveCommandRoot(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ResolvedRoot> {
  const explicit = invocation.flags.get("--root");
  const detect = invocation.flags.get("--detect-root") === true;
  if (typeof explicit === "string" && detect) {
    // One names a directory and the other asks for a search. Honouring both
    // means picking one silently.
    return { kind: "failure", result: usageFailure(USAGE_WHY.conflictingFlag) };
  }
  if (!detect) {
    return {
      kind: "root",
      resolution: null,
      target: typeof explicit === "string" ? explicit : null,
    };
  }

  const worktreeMode: WorktreeMode =
    invocation.flags.get("--worktree-local") === true ? "local" : "principal";
  const resolution = resolveProject(
    {
      workingDirectory: ports.environment.workingDirectory(),
      explicitRoot: null,
      worktreeMode,
    },
    await observeWorkspace(
      {
        workingDirectory: ports.environment.workingDirectory(),
        explicitRoot: null,
        worktreeMode,
      },
      { workspace: ports.workspace, environment: ports.environment },
    ),
    configurationValidator(registry),
  );
  if (resolution.kind === "not-found" || resolution.kind === "refused") {
    // The caller asked for detection and it found nothing. Falling back to the
    // current directory would initialize somewhere they did not name.
    return { kind: "failure", result: usageFailure(USAGE_WHY.missingValue) };
  }
  return { kind: "root", resolution, target: resolution.root };
}

/**
 * Point the ports at the directory a command runs against.
 *
 * Anchoring is skipped when the target is where the process already is, which
 * is the ordinary case and the one every fake in the tests relies on.
 */
export function anchorPorts(
  target: string | null,
  ports: RuntimePorts,
): RuntimePorts {
  if (target === null || target === ports.environment.workingDirectory()) {
    return ports;
  }
  return createRuntimeAt(target, {
    environment: ports.environment,
    output: ports.output,
    standardInput: ports.standardInput,
    workspace: ports.workspace,
  });
}
