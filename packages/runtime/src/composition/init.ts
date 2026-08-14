import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import {
  resolveProject,
  type ProjectResolution,
  type WorktreeMode,
} from "../domain/project/index.js";
import {
  destinationsOf,
  profileStack,
  resolveInitAnswers,
  skeletonEffects,
  type ManagedFileObservation,
  type ResolvedInitAnswers,
} from "../domain/init/index.js";
import {
  usageFailure,
  USAGE_WHY,
  type Result,
} from "../domain/result/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { observeWorkspace } from "./discovery.js";
import { createRuntimeAt } from "./index.js";
import { configurationValidator, createSchemaRegistry } from "./schema.js";

export type Observed =
  | { readonly kind: "failure"; readonly result: Result }
  | {
      readonly kind: "observed";
      readonly observation: CommandObservation;
      /**
       * The ports the plan must be applied through.
       *
       * A run that targets a directory other than the one the process started
       * in needs ports anchored there. Returning them keeps the command from
       * deciding about one project and writing into another.
       */
      readonly ports: RuntimePorts;
    };

/**
 * Collect every fact `init` decides from, and refuse a usage it cannot.
 *
 * Reading happens here because a handler that reached a filesystem would stop
 * being testable without one. What it returns is data: the same observation
 * produces the same decision, whichever machine collected it.
 */
export async function observeInitialization(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry = createSchemaRegistry(),
): Promise<Observed> {
  const root = await resolveRoot(invocation, ports, registry);
  if (root.kind === "failure") return root;
  const anchored = anchor(root.target, ports);

  const answersPath = invocation.flags.get("--answers");
  const piped = await anchored.standardInput.read();

  if (typeof answersPath === "string" && piped !== null) {
    // Deciding silently which one wins is how somebody initializes a project
    // from the answers they did not mean.
    return failure(USAGE_WHY.conflictingFlag);
  }
  const document =
    typeof answersPath === "string"
      ? await readAnswers(answersPath, anchored)
      : piped;
  if (document === null) return failure(USAGE_WHY.missingValue);

  const answers = resolveInitAnswers(parse(document), registry);
  const rootEntries = await anchored.fileSystem.list(".");
  return {
    kind: "observed",
    observation: {
      kind: "initialization",
      resolution: root.resolution,
      answers,
      rootEntries,
      destinations: await observeDestinations(answers, rootEntries, anchored),
    },
    ports: anchored,
  };
}

/**
 * Observe exactly the destinations these answers imply.
 *
 * The skeleton is a pure function, so asking it which paths it would write
 * costs nothing and keeps this list from drifting from the one that is
 * actually generated. An invalid answers document implies no destinations, and
 * the handler refuses before it would look at them.
 */
async function observeDestinations(
  answers: ResolvedInitAnswers,
  rootEntries: readonly string[],
  ports: RuntimePorts,
): Promise<readonly (readonly [string, ManagedFileObservation])[]> {
  if (answers.kind === "invalid") return [];
  const paths = destinationsOf(
    skeletonEffects(answers.answers, profileStack({ rootEntries })),
  );
  const observed: (readonly [string, ManagedFileObservation])[] = [];
  for (const path of paths) {
    observed.push([path, await observeDestination(path, ports)]);
  }
  return observed;
}

async function observeDestination(
  path: string,
  ports: RuntimePorts,
): Promise<ManagedFileObservation> {
  const entry = await ports.durableFileSystem.inspect(path);
  if (entry.kind === "missing") return { kind: "absent" };
  if (entry.kind !== "file") return { kind: "other" };
  return { kind: "file", text: await ports.durableFileSystem.readText(path) };
}

/**
 * Decide which directory this run initializes.
 *
 * Without a flag, that is the directory the caller is standing in. A command
 * that creates state should not walk up the tree and initialize a directory
 * somebody forgot they had state in, so detection is something you ask for.
 */
async function resolveRoot(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | { readonly kind: "failure"; readonly result: Result }
  | {
      readonly kind: "root";
      readonly resolution: ProjectResolution | null;
      /** Absolute target, or null when it is where the process already is. */
      readonly target: string | null;
    }
> {
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
 * Point the ports at the directory this run initializes.
 *
 * Anchoring is skipped when the target is where the process already is, which
 * is the ordinary case and the one every fake in the tests relies on.
 */
function anchor(target: string | null, ports: RuntimePorts): RuntimePorts {
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

async function readAnswers(
  path: string,
  ports: RuntimePorts,
): Promise<string | null> {
  try {
    return await ports.fileSystem.read(path);
  } catch {
    // An unreadable path is the caller naming a file that is not there, which
    // the answers contract then reports as an invalid document.
    return null;
  }
}

function parse(document: string): unknown {
  try {
    return JSON.parse(document) as unknown;
  } catch {
    // Malformed JSON is an invalid answers document, and the contract names
    // that failure rather than this function.
    return null;
  }
}

function failure(why: string): Observed {
  return { kind: "failure", result: usageFailure(why) };
}
