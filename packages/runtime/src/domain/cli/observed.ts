import { internalFailure } from "../result/index.js";
import { planOf } from "../effects.js";

import type {
  CommandObservation,
  CommandSpec,
  Decision,
  Invocation,
} from "./spec.js";

type InitializationObservation = Extract<
  CommandObservation,
  { readonly kind: "initialization" }
>;

/**
 * Declare a command that decides from observed facts rather than from argv
 * alone.
 *
 * The narrowing lives here, once. A handler written this way receives its
 * observation already typed and has no branch for the case where the
 * composition root failed to collect it -- which is the branch that would
 * otherwise be copied, untested, into every command that observes anything.
 */
export function observingCommand(
  spec: Omit<CommandSpec, "prerequisite" | "handler">,
  handler: (
    invocation: Invocation,
    observation: InitializationObservation,
  ) => Decision,
): CommandSpec {
  return {
    ...spec,
    prerequisite: "initialization",
    handler: (invocation: Invocation): Decision => {
      const observation = invocation.observation;
      if (observation.kind !== "initialization") {
        // A dispatch that skipped the prerequisite is a wiring defect, not a
        // usage failure: the caller did nothing wrong and there is nothing
        // they can do about it.
        return {
          result: internalFailure(),
          plan: planOf(),
          humanStdout: null,
          payload: null,
        };
      }
      return handler(invocation, observation);
    },
  };
}
