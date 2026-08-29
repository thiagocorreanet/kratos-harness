import { planOf, type Effect, type WriteFilePrecondition } from "../effects.js";
import { resultFor } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type { CommandSpec, Decision } from "./spec.js";

const ROOT_FLAG: CommandSpec["flags"] = [
  {
    name: "--root",
    kind: "value",
    valueLabel: "<path>",
    summary: "Operate on the project rooted at this path.",
  },
];

export const memoryListCommand: CommandSpec = observingCommand(
  "memory",
  {
    path: ["memory", "list"],
    summary: "List local failure candidates without changing curated memory.",
    flags: ROOT_FLAG,
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => {
    if (observation.operation !== "list") return internal();
    const candidates = observation.candidates;
    return {
      result: resultFor("runtime.orientation_ok", {
        summary:
          candidates.length === 0
            ? "No local memory candidates are available."
            : `${String(candidates.length)} local memory candidate${candidates.length === 1 ? " is" : "s are"} available.`,
      }),
      plan: planOf(),
      humanStdout:
        candidates.length === 0
          ? "No local memory candidates are available.\n"
          : `${candidates.map((candidate) => `${candidate.candidateId} ${candidate.diagnostic}`).join("\n")}\n`,
      payload: null,
    };
  },
);

export const memoryCaptureCommand: CommandSpec = observingCommand(
  "memory",
  {
    path: ["memory", "capture"],
    summary: "Capture one validated local failure proposal as a candidate.",
    flags: ROOT_FLAG,
    positionals: { min: 1, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => {
    if (observation.operation !== "capture") return internal();
    const decision = observation.capture;
    if (!decision.write) {
      return {
        result: resultFor("runtime.orientation_ok", {
          summary: "The matching local memory candidate already exists.",
          evidence: [
            {
              kind: "artifact",
              ref: `.brain/03-memory/candidates/${decision.candidate.candidateId}.json`,
            },
          ],
        }),
        plan: planOf(),
        humanStdout: null,
        payload: null,
      };
    }
    const path = `.brain/03-memory/candidates/${decision.candidate.candidateId}.json`;
    return {
      result: resultFor("trail.ok", {
        summary: "The local memory candidate was captured.",
        evidence: [{ kind: "artifact", ref: path }],
      }),
      plan: planOf(write(path, decision.candidate, { kind: "missing" })),
      humanStdout: null,
      payload: null,
    };
  },
);

function write(
  path: string,
  value: unknown,
  expected: WriteFilePrecondition,
): Extract<Effect, { kind: "write_file" }> {
  return {
    path,
    content: `${JSON.stringify(value, null, 2)}\n`,
    expected,
    kind: "write_file",
  };
}

function internal(): Decision {
  return {
    result: resultFor("runtime.internal_failure"),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
