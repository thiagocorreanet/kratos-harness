import { planOf, type Effect } from "../effects.js";

type WriteEffect = Extract<Effect, { readonly kind: "write_file" }>;
import {
  ACTIVE_FEATURE_PATH,
  decideObjective,
  featurePaths,
  historyLine,
  objectiveDocument,
  type ObjectiveDecision,
} from "../objective/index.js";
import { resultFor } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "objective" }>;

/**
 * Record what this project is for.
 *
 * The objective is the root of every plan, budget, and piece of evidence that
 * follows, so the command's whole job is to keep that root honest: the text is
 * preserved exactly, a divergent one is refused unless the caller said so, and
 * repeating the same demand changes nothing.
 */
export const objectiveCommand: CommandSpec = observingCommand(
  "objective",
  {
    path: ["objective"],
    summary: "Record the objective this project is working toward.",
    flags: [
      {
        name: "--replace",
        kind: "boolean",
        summary: "Replace a divergent active objective with this text.",
      },
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Operate on the project rooted at this path.",
      },
    ],
    positionals: { min: 0, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) =>
    decide(
      invocation.positionals[0] ?? "",
      invocation.flags.get("--replace") === true,
      observation,
    ),
);

function decide(
  text: string,
  replace: boolean,
  observation: Observation,
): Decision {
  const decision = decideObjective(observation.objective, {
    text,
    replace,
    now: observation.now,
  });

  if (decision.kind === "refused") return refusal(decision.reasonCode);
  if (decision.kind === "unchanged") {
    // Repetition is how a caller confirms where they are. Nothing is written,
    // and the result says what the project is working toward.
    return orientation(decision, "The objective is already recorded.");
  }
  // History belongs to the feature that owns it. A replacement names a new
  // feature, and that feature's history starts with the line explaining what it
  // displaced -- inheriting the previous feature's entries would attribute work
  // to an objective that never asked for it.
  const inherited =
    decision.previous !== null && decision.previous.feature === decision.feature
      ? observation.history
      : "";
  return recorded(decision, inherited);
}

function recorded(
  decision: Extract<ObjectiveDecision, { readonly kind: "recorded" }>,
  history: string,
): Decision {
  const paths = featurePaths(decision.feature);
  const effects: WriteEffect[] = [
    {
      kind: "write_file",
      path: paths.state,
      content: `${JSON.stringify(decision.state, null, 2)}\n`,
    },
    {
      kind: "write_file",
      path: paths.objective,
      content: objectiveDocument(decision.state),
    },
    {
      kind: "write_file",
      path: paths.history,
      content: appendedHistory(decision, history),
    },
    {
      kind: "write_file",
      path: ACTIVE_FEATURE_PATH,
      content: `${decision.feature}\n`,
    },
  ];

  return {
    result: resultFor("trail.ok", {
      summary: summaryFor(decision),
      stateChanged: true,
      evidence: effects.map((effect) => ({
        kind: "artifact" as const,
        ref: effect.path,
      })),
    }),
    plan: planOf(...effects),
    humanStdout: null,
    payload: null,
  };
}

/**
 * The history is append-only, so the new line follows what was already there.
 *
 * The previous entries travel through the observation rather than being read
 * again here, which is what keeps this decision pure and lets a replay produce
 * the same file from the same facts.
 */
function appendedHistory(
  decision: Extract<ObjectiveDecision, { readonly kind: "recorded" }>,
  history: string,
): string {
  const line = historyLine({
    transition: decision.transition,
    at: decision.state.objective.updatedAt,
    revision: decision.state.objective.revision,
    text: decision.state.objective.text,
    replaced: decision.previous?.objective.text ?? null,
  });
  return `${history}${line}`;
}

function summaryFor(
  decision: Extract<ObjectiveDecision, { readonly kind: "recorded" }>,
): string {
  const verb =
    decision.transition === "created"
      ? "Recorded"
      : decision.transition === "replaced"
        ? "Replaced"
        : "Reopened";
  return `${verb} the objective for feature ${decision.feature}.`;
}

function orientation(
  decision: Extract<ObjectiveDecision, { readonly kind: "unchanged" }>,
  summary: string,
): Decision {
  return {
    result: resultFor("trail.ok", {
      summary,
      stateChanged: false,
      evidence: [
        { kind: "artifact", ref: featurePaths(decision.feature).objective },
      ],
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function refusal(reasonCode: RefusalReason): Decision {
  const evidence =
    reasonCode === "trail.uso"
      ? []
      : [{ kind: "artifact" as const, ref: ACTIVE_FEATURE_PATH }];
  return {
    result: resultFor(reasonCode, {
      why: [WHY[reasonCode]],
      evidence,
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

type RefusalReason = Extract<
  ObjectiveDecision,
  { readonly kind: "refused" }
>["reasonCode"];

const WHY: Readonly<Record<RefusalReason, string>> = {
  "trail.uso": "An objective needs text that can name a feature.",
  "trail.objetivo_divergente":
    "A different objective is already active in this project.",
  "runtime.state_corrupt":
    "The recorded objective state cannot be read as state.",
};
