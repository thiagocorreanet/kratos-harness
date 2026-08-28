import type { CommandObservation, Invocation } from "../domain/cli/index.js";
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

import { anchorPorts, resolveCommandRoot } from "./root.js";
import { createSchemaRegistry } from "./schema.js";

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
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return { kind: "failure", result: root.result };
  const anchored = anchorPorts(root.target, ports);

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

  const answers = await resolveInitAnswers(
    parse(document),
    registry,
    anchored.modelRouting,
  );
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
