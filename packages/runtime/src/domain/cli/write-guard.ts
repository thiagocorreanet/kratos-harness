import { planOf } from "../effects.js";
import { resultFor } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

const rootFlag = {
  name: "--root",
  kind: "value" as const,
  valueLabel: "<path>",
  summary: "Operate on the project rooted at this path.",
};

export const guardWriteCommand: CommandSpec = observingCommand(
  "write-guard",
  {
    path: ["guard", "write"],
    summary: "Decide whether a structured host mutation may proceed.",
    flags: [rootFlag],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => guardDecision(observation),
);

export const scopeRecordCommand: CommandSpec = observingCommand(
  "scope-record",
  {
    path: ["scope", "record"],
    summary: "Record the active feature scope from reviewer prose.",
    flags: [rootFlag],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => scopeDecision(observation),
);

function guardDecision(
  observation: Extract<CommandObservation, { readonly kind: "write-guard" }>,
): Decision {
  if (observation.outcome.kind === "refused") {
    return refusal(
      observation.outcome.reasonCode,
      observation.outcome.evidenceKind,
      observation.outcome.evidenceRef,
    );
  }
  return {
    result: resultFor("runtime.orientation_ok", {
      summary: "The structured mutation request may proceed.",
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function scopeDecision(
  observation: Extract<CommandObservation, { readonly kind: "scope-record" }>,
): Decision {
  const outcome = observation.outcome;
  if (outcome.kind === "refused") {
    return refusal(outcome.reasonCode, "artifact", outcome.evidenceRef);
  }
  if (outcome.kind === "unchanged") {
    return {
      result: resultFor("trail.ok", {
        summary: "The active feature scope already agrees with reviewer prose.",
        evidence: [{ kind: "artifact", ref: outcome.path }],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  return {
    result: resultFor("trail.ok", {
      summary: "Recorded the active feature scope from reviewer prose.",
      stateChanged: true,
      evidence: [{ kind: "artifact", ref: outcome.path }],
    }),
    plan: planOf({
      kind: "write_file",
      path: outcome.path,
      content: `${JSON.stringify(outcome.scope, null, 2)}\n`,
    }),
    humanStdout: null,
    payload: null,
  };
}

function refusal(
  reasonCode: string,
  evidenceKind: "artifact" | "observation",
  evidenceRef: string,
): Decision {
  return {
    result: resultFor(reasonCode, {
      why: ["The pre-write guard refused the requested operation."],
      evidence: [{ kind: evidenceKind, ref: evidenceRef }],
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
