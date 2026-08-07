import { YODA_VERSION } from "@mestre-yoda/contracts";

import { planOf } from "../effects.js";
import { buildHandshakeResponse } from "../handshake.js";
import { resultFor } from "../result/index.js";
import { renderHelp } from "./help.js";
import type {
  CommandRegistry,
  CommandSpec,
  Decision,
  Invocation,
} from "./spec.js";

function orientation(summary: string, humanStdout: string): Decision {
  return {
    result: resultFor("runtime.orientation_ok", { summary }),
    plan: planOf(),
    humanStdout,
    payload: null,
  };
}

const helpCommand: CommandSpec = {
  path: ["help"],
  summary: "Print the command usage text.",
  flags: [],
  positionals: { min: 0, max: 0 },
  jsonContract: "result@1.0.0",
  handler: (invocation: Invocation): Decision =>
    orientation(
      "The runtime published its command usage text.",
      renderHelp(invocation.registry),
    ),
};

const versionCommand: CommandSpec = {
  path: ["version"],
  summary: "Print the runtime version.",
  flags: [],
  positionals: { min: 0, max: 0 },
  jsonContract: "result@1.0.0",
  handler: (): Decision =>
    orientation(`Runtime version ${YODA_VERSION}.`, `${YODA_VERSION}\n`),
};

const handshakeCommand: CommandSpec = {
  path: ["handshake"],
  summary: "Report the contract versions this runtime carries.",
  flags: [],
  positionals: { min: 0, max: 0 },
  jsonContract: "adapter-message@1.0.0",
  handler: (): Decision => {
    const message = buildHandshakeResponse("cli");
    return {
      result: resultFor("runtime.orientation_ok", {
        summary: "The runtime reported the contract versions it carries.",
      }),
      plan: planOf(),
      humanStdout: `${JSON.stringify(message)}\n`,
      payload: message,
    };
  },
};

export const DEFAULT_REGISTRY: CommandRegistry = [
  handshakeCommand,
  helpCommand,
  versionCommand,
];
