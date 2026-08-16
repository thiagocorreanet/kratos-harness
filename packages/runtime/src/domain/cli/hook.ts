import { planOf } from "../effects.js";
import { resultFor, usageFailure } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Observation = Extract<
  CommandObservation,
  { readonly kind: "host-operation" }
>;

export const hookCommand: CommandSpec = observingCommand(
  "host-operation",
  {
    path: ["hook"],
    summary: "Accept one versioned host hook message from standard input.",
    flags: [
      {
        name: "--host",
        kind: "value",
        valueLabel: "<id>",
        summary: "Require the hook to name this host.",
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
    decide(invocation.flags.get("--host"), observation),
);

function decide(
  requestedHost: string | true | undefined,
  observation: Observation,
): Decision {
  if (typeof requestedHost !== "string") {
    return refusal("The hook host must be supplied explicitly.");
  }
  if (observation.message.kind !== "hook") {
    return refusal("The hook command accepts only hook lifecycle messages.");
  }
  if (observation.message.payload.host !== requestedHost) {
    return refusal("The supplied host differs from the hook payload host.");
  }
  return {
    result: resultFor("runtime.orientation_ok", {
      summary: "The host hook message satisfied its transport contract.",
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function refusal(why: string): Decision {
  return {
    result: usageFailure(why),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
