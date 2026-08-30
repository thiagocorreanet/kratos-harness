import type { Effect } from "../effects.js";
import { planOf } from "../effects.js";
import { recordUsageSample } from "../hooks/index.js";
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
  if (observation.hook === null) {
    return refusal("The normalized hook artifact is absent or invalid.");
  }
  const context = observation.context;
  if (context === null || observation.hook.kind === "tool.before") {
    return unchanged("The hook had no active run state to update.");
  }

  const hook = observation.hook;
  const cumulativeGrossTokens = hook.usage?.cumulativeGrossTokens ?? null;
  const sampled = recordUsageSample(context.usage, {
    sessionId: hook.sessionId,
    cumulativeGrossTokens,
    budget: context.budget,
    now: hook.occurredAt,
  });
  const runRoot = `.brain/02-features/${context.feature}/runs/${context.runId}`;
  const usagePath = `${runRoot}/usage.json`;
  const gatesPath = `${runRoot}/gates.json`;
  const gates = {
    ...context.gates,
    stopLoss: {
      tripped: context.gates.stopLoss.tripped || sampled.stopLoss.tripped,
      exhausted: context.gates.stopLoss.exhausted || sampled.stopLoss.exhausted,
    },
    derivedAt: hook.occurredAt,
  };
  const effects: Effect[] = [];
  if (JSON.stringify(sampled.usage) !== JSON.stringify(context.usage)) {
    effects.push(write(usagePath, sampled.usage, context.usageExpected));
  }
  if (JSON.stringify(gates) !== JSON.stringify(context.gates)) {
    effects.push(write(gatesPath, gates, context.gatesExpected));
  }

  const cachePath = `.brain/03-memory/.cache/hooks/${hook.sessionId}/telemetry.json`;
  const cache = {
    startedAt: context.cache?.startedAt ?? hook.occurredAt,
    grossTokens: Math.max(
      context.cache?.grossTokens ?? 0,
      cumulativeGrossTokens ?? 0,
    ),
    toolFailures:
      (context.cache?.toolFailures ?? 0) +
      (hook.kind === "tool.failed" ? 1 : 0),
  };

  if (hook.kind === "tool.failed") {
    if (context.capture?.write === true) {
      effects.push(
        write(
          `.brain/03-memory/candidates/${context.capture.candidate.candidateId}.json`,
          context.capture.candidate,
          { kind: "missing" },
        ),
      );
    }
    effects.push(write(cachePath, cache));
  } else if (hook.kind === "session.sample") {
    effects.push(write(cachePath, cache));
  } else {
    if (!context.telemetryExists) {
      effects.push(
        write(
          `.brain/03-memory/telemetry/${hook.sessionId}.json`,
          {
            contractVersion: "1.0.0",
            stateContract: "1.0.0",
            sessionId: hook.sessionId,
            runId: context.runId,
            startedAt: cache.startedAt,
            endedAt: hook.occurredAt,
            grossTokens: cache.grossTokens,
            toolFailures: cache.toolFailures,
          },
          { kind: "missing" },
        ),
      );
    }
    for (const path of context.transientFiles) {
      effects.push({ kind: "delete_file", path });
    }
  }

  if (effects.length === 0)
    return unchanged("The hook was already reflected in state.");
  return {
    result: resultFor("trail.ok", {
      summary: "The normalized host observation was recorded.",
      evidence: [
        {
          kind: "artifact",
          ref: observation.message.payload.artifact.ref,
          sha256: observation.message.payload.artifact.sha256,
        },
      ],
    }),
    plan: planOf(...effects),
    humanStdout: null,
    payload: null,
  };
}

function write(
  path: string,
  value: unknown,
  expected?: Extract<Effect, { kind: "write_file" }>["expected"],
): Extract<Effect, { kind: "write_file" }> {
  return expected === undefined
    ? {
        kind: "write_file",
        path,
        content: `${JSON.stringify(value, null, 2)}\n`,
      }
    : {
        kind: "write_file",
        path,
        content: `${JSON.stringify(value, null, 2)}\n`,
        expected,
      };
}

function unchanged(summary: string): Decision {
  return {
    result: resultFor("runtime.orientation_ok", { summary }),
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
