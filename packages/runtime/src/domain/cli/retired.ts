import { planOf } from "../effects.js";
import { resultFor } from "../result/index.js";
import type { CommandSpec, Decision } from "./spec.js";

/**
 * The phase commands the frozen surface retired.
 *
 * Kratos v3 drives one agent trail, and the runtime picks each phase from
 * persisted state. These names once picked a phase directly. They stay
 * registered rather than forgotten: a script, a habit, or an agent still spells
 * them, and "not registered in this runtime" tells that caller nothing about
 * where the capability went.
 */
export const RETIRED_COMMANDS = [
  "auto",
  "code",
  "eval",
  "next",
  "prd",
  "review",
  "run",
  "spec",
] as const;

export type RetiredCommandName = (typeof RETIRED_COMMANDS)[number];

/**
 * Operands a retired command tolerates before it refuses.
 *
 * A legacy invocation carries whatever arguments its phase once took. Counting
 * them would make the answer depend on how wrong the caller was, when the
 * answer is the same either way: this name no longer selects a phase.
 */
const ANY_OPERANDS = Number.MAX_SAFE_INTEGER;

/**
 * Why a retired name refuses.
 *
 * The name is interpolated from the closed list above, never from the caller's
 * argv, so this stays a fixed public cause like every other one.
 */
export function retiredWhy(name: RetiredCommandName): readonly string[] {
  return [
    `The \`${name}\` phase command was retired from the supported surface.`,
    "This runtime advances one agent-driven trail and selects each phase from persisted state, so no command selects a phase.",
  ];
}

function refusal(name: RetiredCommandName): Decision {
  return {
    result: resultFor("trail.uso", {
      summary: `The retired phase command \`${name}\` was refused.`,
      why: retiredWhy(name),
    }),
    // Empty, and the reason reports `stateChanged: false`. A retired name that
    // wrote anything would be the manual phase control it exists to refuse.
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

/**
 * Build the specification for one retired phase command.
 *
 * `prerequisite: "none"` is deliberate. Refusing does not depend on where the
 * caller stands, so the answer is the same inside a project, outside one, and
 * in a directory the runtime cannot read.
 */
export function retiredCommand(name: RetiredCommandName): CommandSpec {
  return {
    path: [name],
    summary: `Retired: this name no longer selects the ${name} phase.`,
    flags: [],
    positionals: { min: 0, max: ANY_OPERANDS },
    jsonContract: "result@1.0.0",
    prerequisite: "none",
    retired: true,
    handler: () => refusal(name),
  };
}

export const RETIRED_COMMAND_SPECS: readonly CommandSpec[] =
  RETIRED_COMMANDS.map(retiredCommand);
