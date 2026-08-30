import type { BeatV1, ClockDerivedProgress } from "@kratos/contracts";
import { planOf } from "../effects.js";
import { projectNarration } from "../narration/index.js";
import { resultFor } from "../result/index.js";
import { observingCommand } from "./observed.js";
import type {
  CommandObservation,
  CommandSpec,
  Decision,
  Invocation,
} from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "workflow" }>;

export const narrateCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["narrate"],
    summary: "Project human-friendly narration from the event log.",
    flags: [
      {
        name: "--as-of",
        kind: "value",
        valueLabel: "<iso>",
        summary:
          "Project in-progress elapsed time relative to this ISO timestamp.",
      },
      {
        name: "--json",
        kind: "boolean",
        summary: "Emit structured JSON narration.",
      },
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Operate on the project rooted at this path.",
      },
      {
        name: "--run-id",
        kind: "value",
        valueLabel: "<id>",
        summary: "Operate on this run identifier.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation: Invocation, observation: Observation): Decision => {
    if (observation.workflow.kind !== "present") {
      return absentOrCorrupt(observation);
    }

    const requestedRunId = invocation.flags.get("--run-id");
    const runId =
      typeof requestedRunId === "string"
        ? requestedRunId
        : observation.configuration.runId;

    const requestedAsOf = invocation.flags.get("--as-of");
    const asOf = typeof requestedAsOf === "string" ? requestedAsOf : undefined;

    const narration = projectNarration(
      observation.events,
      asOf !== undefined ? { runId, asOf } : { runId },
    );

    const isJson =
      invocation.globals.json || invocation.flags.get("--json") === true;

    if (isJson) {
      return {
        result: resultFor("runtime.orientation_ok", {
          summary: `Projected narration for run ${narration.runId}.`,
        }),
        plan: planOf(),
        humanStdout: `${JSON.stringify(narration, null, 2)}\n`,
        payload: narration,
      };
    }

    const lines: string[] = narration.beats.map(formatBeat);
    if (narration.pendingProgress !== null) {
      lines.push(formatPendingProgress(narration.pendingProgress));
    }

    return {
      result: resultFor("runtime.orientation_ok", {
        summary: `Projected narration for run ${narration.runId}.`,
        why: lines,
      }),
      plan: planOf(),
      humanStdout: lines.length > 0 ? `${lines.join("\n")}\n` : "",
      payload: null,
    };
  },
);

function formatBeat(beat: BeatV1): string {
  switch (beat.kind) {
    case "work":
      return `[WORK] ${beat.subject}: ${beat.sentence}`;
    case "milestone":
      return `[MILESTONE] ${beat.subject}: ${beat.sentence}`;
    case "resumption":
      return `[RESUME] ${beat.subject}: ${beat.sentence}`;
    case "warning":
      return `[WARN] ${beat.subject}: ${beat.sentence}`;
    case "waiting": {
      const evidence =
        beat.evidenceRefs.length > 0
          ? ` (evidence: ${beat.evidenceRefs.join(", ")})`
          : "";
      return `[WAIT] ${beat.subject}: ${beat.sentence}${evidence}`;
    }
    case "stop": {
      const evidence =
        beat.evidenceRefs.length > 0
          ? ` (evidence: ${beat.evidenceRefs.join(", ")})`
          : "";
      return `[STOP] ${beat.subject}: ${beat.sentence}${evidence}`;
    }
  }
}

function formatPendingProgress(progress: ClockDerivedProgress): string {
  const elapsedSec = Math.floor(progress.elapsedMs / 1000);
  return `[IN PROGRESS] ${progress.operation} (elapsed: ${String(elapsedSec)}s) [clock-derived]`;
}

function absentOrCorrupt(observation: Observation): Decision {
  const corrupt = observation.workflow.kind === "corrupt";
  return {
    result: corrupt
      ? resultFor("runtime.state_corrupt", {
          why: ["The active run could not be replayed."],
          evidence: [
            {
              kind: "artifact",
              ref: `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}`,
            },
          ],
        })
      : resultFor("trail.sem_run"),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
