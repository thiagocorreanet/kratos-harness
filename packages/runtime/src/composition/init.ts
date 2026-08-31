import type { CommandObservation, Invocation } from "../domain/cli/index.js";
import type { WriteFilePrecondition } from "../domain/effects.js";
import {
  destinationsOf,
  profileStack,
  resolveInitAnswers,
  skeletonEffects,
  type ManagedFileObservation,
  type ResolvedInitAnswers,
  type ResolvedProjectProfile,
} from "../domain/init/index.js";
import {
  resultFor,
  usageFailure,
  USAGE_WHY,
  type Result,
} from "../domain/result/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import type { RuntimePorts } from "../ports/index.js";

import { anchorPorts, resolveCommandRoot } from "./root.js";
import { observeModelCatalog } from "./model-routing.js";
import { createSchemaRegistry } from "./schema.js";

const encoder = new TextEncoder();

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

  const persisted = await observePersistedProfile(anchored, registry);
  if (persisted.kind === "failure") return persisted;

  const answers = await resolveInitAnswers(
    parse(document),
    registry,
    {
      observe: (host) => observeModelCatalog(anchored.modelRouting, host),
    },
    persisted.profile,
  );
  const rootEntries = await anchored.fileSystem.list(".");
  return {
    kind: "observed",
    observation: {
      kind: "initialization",
      resolution: root.resolution,
      answers,
      configExpected: persisted.expected,
      rootEntries,
      destinations: await observeDestinations(answers, rootEntries, anchored),
    },
    ports: anchored,
  };
}

async function observePersistedProfile(
  ports: RuntimePorts,
  registry: SchemaRegistry,
): Promise<
  | {
      readonly kind: "profile";
      readonly profile?: ResolvedProjectProfile;
      readonly expected: WriteFilePrecondition;
    }
  | Extract<Observed, { readonly kind: "failure" }>
> {
  const path = ".brain/config.json";
  const before = await ports.durableFileSystem.inspect(path);
  if (before.kind === "missing") {
    return { kind: "profile", expected: { kind: "missing" } };
  }
  if (before.kind !== "file")
    return configurationFailure("guard.config_corrupt");

  let content: string;
  try {
    content = await ports.durableFileSystem.readText(path);
  } catch {
    return configurationFailure("runtime.revision_conflict");
  }
  const after = await ports.durableFileSystem.inspect(path);
  if (
    after.kind !== "file" ||
    after.size !== before.size ||
    after.sha256 !== before.sha256 ||
    encoder.encode(content).byteLength !== before.size ||
    ports.digests.sha256(content) !== before.sha256
  ) {
    return configurationFailure("runtime.revision_conflict");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return configurationFailure("guard.config_corrupt");
  }
  const version = stateContract(parsed);
  if (
    version === "1.0.0" ||
    version === "1.1.0" ||
    version === "1.2.0" ||
    version === "1.3.0"
  ) {
    return configurationFailure("profile.config_migration_required");
  }
  const validated = registry.validate({
    id: "state.project-config",
    version,
    value: parsed,
    structuralReasonCode: "guard.config_corrupt",
  });
  if (validated.kind !== "valid" || validated.value.stateContract !== "1.4.0") {
    return configurationFailure(
      validated.kind === "invalid"
        ? (validated.diagnostics[0]?.reasonCode ?? "guard.config_corrupt")
        : "guard.config_corrupt",
    );
  }
  return {
    kind: "profile",
    profile: validated.value.projectProfile,
    expected: { kind: "file", size: before.size, sha256: before.sha256 },
  };
}

function stateContract(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>).stateContract
    : undefined;
}

function configurationFailure(
  reasonCode: string,
): Extract<Observed, { readonly kind: "failure" }> {
  return {
    kind: "failure",
    result: resultFor(reasonCode, {
      why: [
        "The existing project configuration must be usable before initialization can preserve its profile.",
      ],
      evidence: [{ kind: "artifact", ref: ".brain/config.json" }],
    }),
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
