import { planOf } from "../effects.js";
import { unlockStopLoss } from "../hooks/index.js";
import { resultFor, usageFailure } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Observation = Extract<CommandObservation, { kind: "stop-loss-unlock" }>;

export const unlockStopLossCommand: CommandSpec = observingCommand(
  "stop-loss-unlock",
  {
    path: ["unlock", "stop-loss"],
    summary: "Explicitly release a named run's latched stop-loss.",
    flags: [
      {
        name: "--run",
        kind: "value",
        valueLabel: "<id>",
        summary: "Name the active run to unlock.",
      },
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Operate on the project rooted at this path.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) =>
    decide(invocation.flags.get("--run"), observation),
);

function decide(
  requested: string | true | undefined,
  observation: Observation,
): Decision {
  if (typeof requested !== "string" || requested !== observation.runId) {
    return refusal("The unlock must name the active run exactly.");
  }
  if (observation.confirmation?.trim() !== `UNLOCK ${observation.runId}`) {
    return refusal(`Confirmation must be exactly UNLOCK ${observation.runId}.`);
  }
  if (
    !observation.gates.stopLoss.tripped &&
    !observation.gates.stopLoss.exhausted
  ) {
    return {
      result: resultFor("trail.ok", {
        summary: `Run ${observation.runId} is already unlocked.`,
        stateChanged: false,
        evidence: [{ kind: "artifact", ref: gatesPath(observation) }],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  const usage = unlockStopLoss(observation.usage, observation.now);
  const gates = {
    ...observation.gates,
    stopLoss: { tripped: false, exhausted: false },
    derivedAt: observation.now,
  };
  const usagePath = `${runRoot(observation)}/usage.json`;
  return {
    result: resultFor("trail.ok", {
      summary: `Unlocked stop-loss for run ${observation.runId}.`,
      evidence: [
        { kind: "artifact", ref: usagePath },
        { kind: "artifact", ref: gatesPath(observation) },
      ],
    }),
    plan: planOf(
      {
        kind: "write_file",
        path: usagePath,
        content: `${JSON.stringify(usage, null, 2)}\n`,
        expected: observation.usageExpected,
      },
      {
        kind: "write_file",
        path: gatesPath(observation),
        content: `${JSON.stringify(gates, null, 2)}\n`,
        expected: observation.gatesExpected,
      },
    ),
    humanStdout: null,
    payload: null,
  };
}

function runRoot(observation: Observation): string {
  return `.brain/02-features/${observation.feature}/runs/${observation.runId}`;
}

function gatesPath(observation: Observation): string {
  return `${runRoot(observation)}/gates.json`;
}

function refusal(why: string): Decision {
  return {
    result: usageFailure(why),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
