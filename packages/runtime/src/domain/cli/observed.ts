import { planOf } from "../effects.js";
import { internalFailure } from "../result/index.js";

import type {
  CommandObservation,
  CommandPrerequisite,
  CommandSpec,
  Decision,
  Invocation,
} from "./spec.js";

/**
 * Declare a command that decides from observed facts rather than from argv
 * alone.
 *
 * The narrowing lives here, once. A handler written this way receives its
 * observation already typed and has no branch for the case where the
 * composition root failed to collect it -- which is the branch that would
 * otherwise be copied, untested, into every command that observes anything.
 */
export function observingCommand<Kind extends CommandPrerequisite>(
  prerequisite: Kind,
  spec: Omit<CommandSpec, "prerequisite" | "handler">,
  handler: (
    invocation: Invocation,
    observation: Extract<CommandObservation, { readonly kind: Kind }>,
  ) => Decision,
): CommandSpec {
  return {
    ...spec,
    prerequisite,
    handler: (invocation: Invocation): Decision => {
      const observation = invocation.observation;
      if (observation.kind !== prerequisite) {
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
      return handler(
        invocation,
        observation as Extract<CommandObservation, { readonly kind: Kind }>,
      );
    },
  };
}
