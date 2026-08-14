import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import {
  ACTIVE_FEATURE_PATH,
  featurePaths,
  type ObjectiveObservation,
} from "../domain/objective/index.js";
import type { Result } from "../domain/result/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { anchorPorts, resolveCommandRoot } from "./root.js";
import { createSchemaRegistry } from "./schema.js";

export type ObservedObjective =
  | { readonly kind: "failure"; readonly result: Result }
  | {
      readonly kind: "observed";
      readonly observation: CommandObservation;
      /** The ports this command's plan must be committed through. */
      readonly ports: RuntimePorts;
    };

/**
 * Read what the project already says it is for.
 *
 * Everything the decision needs travels back as data, including the instant and
 * the history the next line is appended to. A handler that read either for
 * itself would be a handler no test could pin down.
 */
export async function observeObjective(
  invocation: Invocation,
  ports: RuntimePorts,
  registry: SchemaRegistry = createSchemaRegistry(),
): Promise<ObservedObjective> {
  const root = await resolveCommandRoot(invocation, ports, registry);
  if (root.kind === "failure") return { kind: "failure", result: root.result };
  const anchored = anchorPorts(root.target, ports);

  const feature = await readActiveFeature(anchored);
  const objective =
    feature === null
      ? ({ kind: "none" } as const)
      : await readFeatureState(feature, anchored, registry);
  return {
    kind: "observed",
    observation: {
      kind: "objective",
      objective,
      history: feature === null ? "" : await readHistory(feature, anchored),
      now: anchored.clock.now().toISOString(),
    },
    ports: anchored,
  };
}

/**
 * The feature the project is working on, if it names one.
 *
 * `init` writes this file empty, so an empty file is the ordinary "nothing
 * started yet" rather than damage.
 */
async function readActiveFeature(ports: RuntimePorts): Promise<string | null> {
  const entry = await ports.durableFileSystem.inspect(ACTIVE_FEATURE_PATH);
  if (entry.kind !== "file") return null;
  const name = (await ports.durableFileSystem.readText(ACTIVE_FEATURE_PATH))
    .split("\n")[0]
    ?.trim();
  return name === undefined || name === "" ? null : name;
}

async function readFeatureState(
  feature: string,
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<ObjectiveObservation> {
  const path = featurePaths(feature).state;
  const entry = await ports.durableFileSystem.inspect(path);
  // An active feature whose state is missing or is not a file is state no
  // protocol can interpret, which is a refusal rather than a fresh start: a
  // fresh start would silently discard whatever that feature was for.
  if (entry.kind !== "file") return { kind: "unreadable" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await ports.durableFileSystem.readText(path),
    ) as unknown;
  } catch {
    return { kind: "unreadable" };
  }
  const validated = registry.validate({
    id: "state.feature",
    version: "1.0.0",
    value: parsed,
    structuralReasonCode: "runtime.state_corrupt",
  });
  return validated.kind === "valid"
    ? { kind: "present", state: validated.value }
    : { kind: "unreadable" };
}

async function readHistory(
  feature: string,
  ports: RuntimePorts,
): Promise<string> {
  const path = featurePaths(feature).history;
  const entry = await ports.durableFileSystem.inspect(path);
  return entry.kind === "file" ? ports.durableFileSystem.readText(path) : "";
}
