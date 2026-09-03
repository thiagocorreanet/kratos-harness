import { CONTRACT_VERSIONS } from "@kratos/contracts";

import { planOf } from "../effects.js";
import type {
  PartialProjectProfile,
  ProjectProfileLeaf,
} from "../init/index.js";
import { resultFor } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Observation = Extract<
  CommandObservation,
  { readonly kind: "project-profile" }
>;

/** One profile answer, in the document order the packaged interview asks in. */
interface DerivedEntry {
  readonly key: string;
  readonly leaf: ProjectProfileLeaf<string | readonly string[]>;
}

const UNRESOLVED = { status: "unresolved" } as const;

/**
 * Publish the profile the runtime derives, and nothing a host inferred.
 *
 * The packaged interview presents one candidate per question. Without a
 * command that answers what those candidates are, every host produced them by
 * reading the repository itself, and two operators initializing one repository
 * were offered two different sets. This is that command: the same pure
 * derivation `init` performs, observed rather than applied.
 */
export const profileDeriveCommand: CommandSpec = observingCommand(
  "project-profile",
  {
    path: ["profile", "derive"],
    summary:
      "Report the project profile the runtime derives from the repository.",
    flags: [
      {
        name: "--detect-root",
        kind: "boolean",
        summary: "Search ancestors for the project root instead of using here.",
      },
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Derive from exactly this directory, searching no ancestor.",
      },
      {
        name: "--worktree-local",
        kind: "boolean",
        summary: "In a linked worktree, ignore the principal checkout.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "project-profile@1.0.0",
  },
  (_invocation, observation) => decide(observation),
);

function decide(observation: Observation): Decision {
  const entries = entriesOf(observation.derived);
  const derived = entries.filter(({ leaf }) => leaf.status === "derived");
  const lines = entries.map(describe);
  return {
    result: resultFor("runtime.orientation_ok", {
      summary: `The runtime derived ${String(derived.length)} of ${String(entries.length)} project profile answers.`,
      // Every answer is reported, including the ones nothing derived, because
      // a host that cannot tell "derived nothing" from "was not asked" fills
      // the silence with a candidate the runtime never produced.
      why: lines,
      evidence: [{ kind: "observation", ref: "project-profile" }],
    }),
    plan: planOf(),
    humanStdout: `${lines.join("\n")}\n`,
    payload: {
      contractVersion: CONTRACT_VERSIONS["host.project-profile"],
      hostContract: "1.4.0",
      profile: {
        commands: {
          test: leafOf(observation.derived.commands?.test),
          lint: leafOf(observation.derived.commands?.lint),
          build: leafOf(observation.derived.commands?.build),
          run: leafOf(observation.derived.commands?.run),
        },
        paths: {
          source: leafOf(observation.derived.paths?.source),
          tests: leafOf(observation.derived.paths?.tests),
          configuration: leafOf(observation.derived.paths?.configuration),
        },
        conventions: {
          directoryLayout: leafOf(
            observation.derived.conventions?.directoryLayout,
          ),
          naming: leafOf(observation.derived.conventions?.naming),
          implementationLanguages: leafOf(
            observation.derived.conventions?.implementationLanguages,
          ),
        },
      },
    },
  };
}

/**
 * Report an answer nothing derived as unresolved rather than as absent.
 *
 * An absent key and an underived one are the same fact, and saying it one way
 * keeps a reader from inventing a difference between them.
 */
function leafOf<T>(
  leaf: ProjectProfileLeaf<T> | undefined,
): ProjectProfileLeaf<T> | typeof UNRESOLVED {
  return leaf ?? UNRESOLVED;
}

function entriesOf(derived: PartialProjectProfile): readonly DerivedEntry[] {
  return [
    {
      key: "projectProfile.commands.test",
      leaf: leafOf(derived.commands?.test),
    },
    {
      key: "projectProfile.commands.lint",
      leaf: leafOf(derived.commands?.lint),
    },
    {
      key: "projectProfile.commands.build",
      leaf: leafOf(derived.commands?.build),
    },
    { key: "projectProfile.commands.run", leaf: leafOf(derived.commands?.run) },
    { key: "projectProfile.paths.source", leaf: leafOf(derived.paths?.source) },
    { key: "projectProfile.paths.tests", leaf: leafOf(derived.paths?.tests) },
    {
      key: "projectProfile.paths.configuration",
      leaf: leafOf(derived.paths?.configuration),
    },
    {
      key: "projectProfile.conventions.directoryLayout",
      leaf: leafOf(derived.conventions?.directoryLayout),
    },
    {
      key: "projectProfile.conventions.naming",
      leaf: leafOf(derived.conventions?.naming),
    },
    {
      key: "projectProfile.conventions.implementationLanguages",
      leaf: leafOf(derived.conventions?.implementationLanguages),
    },
  ];
}

function describe({ key, leaf }: DerivedEntry): string {
  if (leaf.status !== "derived") return `${key}: not derived`;
  const value = Array.isArray(leaf.value)
    ? leaf.value.join(", ")
    : String(leaf.value);
  return `${key}: ${value} (${leaf.evidence})`;
}
