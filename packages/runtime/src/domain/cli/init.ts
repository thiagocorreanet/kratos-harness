import { planOf, type Effect } from "../effects.js";
import type { ModelRoleRefusal } from "../model-roles/index.js";
import {
  MANAGED_SECTION_BEGIN,
  planManagedFile,
  profileStack,
  skeletonEffects,
  type ManagedFileObservation,
  type ResolvedAnswers,
} from "../init/index.js";
import { resultFor, usageFailure, USAGE_WHY } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Answers = ResolvedAnswers;
type Host = Answers["hosts"][number];
type Observation = Extract<
  CommandObservation,
  { readonly kind: "initialization" }
>;

const HOSTS: readonly Host[] = ["claude", "codex"];
const CREATE_ONCE_DESTINATIONS: readonly string[] = [
  ".brain/03-memory/task_log.jsonl",
  ".brain/03-memory/task_metrics.md",
];

/**
 * Establish the managed surface a project needs before anything else runs.
 *
 * The decision is pure: it reads observed facts and returns one plan. What
 * makes a second run report nothing to do is that the plan is byte-identical,
 * which the transaction normalizer then collapses.
 */
export const initCommand: CommandSpec = observingCommand(
  "initialization",
  {
    path: ["init"],
    summary: "Establish the managed project surface.",
    flags: [
      {
        name: "--answers",
        kind: "value",
        valueLabel: "<path>",
        summary: "Read the answers document from a file instead of stdin.",
      },
      {
        name: "--detect-root",
        kind: "boolean",
        summary: "Search ancestors for the project root instead of using here.",
      },
      {
        name: "--force",
        kind: "boolean",
        summary: "Replace an instruction file that carries no managed section.",
      },
      {
        name: "--host",
        kind: "value",
        valueLabel: "<id>",
        summary: "Generate only this host's surface, out of those enabled.",
      },
      {
        name: "--merge",
        kind: "boolean",
        summary: "Append the managed section to an unmarked instruction file.",
      },
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Initialize exactly this directory, searching no ancestor.",
      },
      {
        name: "--worktree-local",
        kind: "boolean",
        summary: "In a linked worktree, ignore the principal checkout.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => decide(invocation.flags, observation),
);

function decide(
  flags: ReadonlyMap<string, string | true>,
  observation: Observation,
): Decision {
  if (observation.answers.kind === "invalid") {
    if (observation.answers.subject !== undefined) {
      return modelRefusal(
        observation.answers.reasonCode,
        observation.answers.subject,
      );
    }
    return refusal(observation.answers.reasonCode, [
      "The answers document does not satisfy its contract.",
    ]);
  }
  const answers = narrowHosts(observation.answers.answers, flags.get("--host"));
  if (answers === null) return usage(USAGE_WHY.unknownFlag);

  const generated = skeletonEffects(
    answers,
    profileStack({ rootEntries: observation.rootEntries }),
  );
  const observed = new Map(observation.destinations);
  const authorization = {
    merge: flags.get("--merge") === true,
    force: flags.get("--force") === true,
  };

  const effects: Effect[] = [];
  const outcomes: DestinationOutcome[] = [];
  const writes = generated.filter(
    (effect): effect is Extract<Effect, { readonly kind: "write_file" }> =>
      effect.kind === "write_file",
  );
  for (const effect of writes) {
    /* v8 ignore next -- the observation covers every destination generated */
    const existing = observed.get(effect.path) ?? { kind: "absent" };
    const createOnce = CREATE_ONCE_DESTINATIONS.includes(effect.path);
    if (createOnce && existing.kind === "file") {
      outcomes.push({ path: effect.path, outcome: "preserved" });
      continue;
    }
    // Only the instruction files carry a managed section. Everything else is
    // generated whole, and asking the section planner about it would refuse a
    // file for lacking markers it was never supposed to have.
    const content = effect.content.includes(MANAGED_SECTION_BEGIN)
      ? planManagedFile(existing, effect.content, authorization)
      : ({ kind: "write", content: effect.content } as const);
    if (content.kind === "refused") {
      return refusal(content.reasonCode, [
        "A destination carries content this run is not authorized to change.",
      ]);
    }
    effects.push({
      ...effect,
      content: content.content,
      ...(effect.path === ".brain/config.json"
        ? { expected: observation.configExpected }
        : createOnce
          ? { expected: { kind: "missing" } as const }
          : {}),
    });
    outcomes.push({
      path: effect.path,
      outcome: classify(existing, content.content),
    });
  }

  return {
    result: resultFor("trail.ok", {
      summary: report(outcomes),
      // The plan carries every destination whether or not it differs, and the
      // transaction decides what actually moved. Claiming no change here while
      // handing over a non-empty plan would be two answers to one question.
      stateChanged: true,
      evidence: outcomes.map(({ path }) => ({
        kind: "artifact" as const,
        ref: path,
      })),
      why: outcomes
        .filter(({ outcome }) => outcome !== "created")
        .map(({ path, outcome }) => `${outcome}: ${path}`)
        .concat(
          observation.answers.defaulted.map((path) => `defaulted: ${path}`),
        ),
    }),
    plan: planOf(...effects),
    humanStdout: null,
    payload: null,
    rootMode: "initialize",
  };
}

function modelRefusal(
  reasonCode: ModelRoleRefusal,
  subject: { readonly host: "claude" | "codex"; readonly role?: string },
): Decision {
  const role = subject.role;
  const why =
    reasonCode === "model.effort_unsupported"
      ? `The configured effort for role \`${role ?? "unknown"}\` on host \`${subject.host}\` is unsupported.`
      : reasonCode === "model.independence_violation"
        ? `The judge role for host \`${subject.host}\` must resolve to a model independent from implementer.`
        : reasonCode === "model.resolution_unavailable" && role === undefined
          ? `The model catalog for host \`${subject.host}\` is unavailable.`
          : `The configured role \`${role ?? "unknown"}\` for host \`${subject.host}\` cannot be resolved.`;
  return {
    result: resultFor(reasonCode, {
      why: [why],
      evidence: [
        {
          kind: "observation",
          ref:
            role === undefined
              ? `model-routing/${subject.host}`
              : `model-routing/${subject.host}/${role}`,
        },
      ],
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

interface DestinationOutcome {
  readonly path: string;
  readonly outcome: "created" | "updated" | "preserved";
}

/**
 * What happened to one destination, decided before anything is written.
 *
 * A person needs to know which of their files the tool touched more than they
 * need a count, and `preserved` is the word that answers the question they are
 * actually asking.
 */
function classify(
  existing: ManagedFileObservation,
  content: string,
): DestinationOutcome["outcome"] {
  if (existing.kind !== "file") return "created";
  return existing.text === content ? "preserved" : "updated";
}

function report(outcomes: readonly DestinationOutcome[]): string {
  const count = (outcome: DestinationOutcome["outcome"]): number =>
    outcomes.filter((candidate) => candidate.outcome === outcome).length;
  return `Created ${String(count("created"))}, updated ${String(count("updated"))}, preserved ${String(count("preserved"))}.`;
}

/**
 * Apply `--host`, which narrows what the answers enabled and never extends it.
 *
 * Answers are the configuration. A flag that quietly added a host would make
 * the same document produce two different projects.
 */
function narrowHosts(
  answers: Answers,
  requested: string | true | undefined,
): Answers | null {
  if (requested === undefined || requested === true) return answers;
  const host = HOSTS.find((candidate) => candidate === requested);
  if (host === undefined || !answers.hosts.includes(host)) return null;
  const roles = answers.modelRoles[host];
  return {
    ...answers,
    hosts: [host],
    modelRoles: roles === undefined ? {} : { [host]: roles },
  };
}

function refusal(reasonCode: string, why: readonly string[]): Decision {
  return {
    result: resultFor(reasonCode, { why: [...why] }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function usage(why: string): Decision {
  return {
    result: usageFailure(why),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

export type { ManagedFileObservation };
