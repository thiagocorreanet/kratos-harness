import { planOf } from "../effects.js";
import { resultFor } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "workflow" }>;

const ROOT_FLAG: CommandSpec["flags"] = [
  {
    name: "--root",
    kind: "value",
    valueLabel: "<path>",
    summary: "Operate on the project rooted at this path.",
  },
];

export const auditCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["audit"],
    summary: "Replay the active run and report snapshot integrity.",
    flags: ROOT_FLAG,
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => audit(observation),
);

export const repairCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["repair"],
    summary: "Preview or apply a replay-derived snapshot repair.",
    flags: [
      ...ROOT_FLAG,
      {
        name: "--apply",
        kind: "boolean",
        summary: "Apply the exact repair plan through a managed transaction.",
      },
      {
        name: "--authorization",
        kind: "value",
        valueLabel: "<plan-digest>",
        summary: "Authorize the exact repair plan digest shown by preview.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) =>
    repair(
      invocation.flags.get("--apply") === true,
      invocation.flags.get("--authorization"),
      observation,
    ),
);

export const evidenceBundleCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["evidence", "bundle"],
    summary: "Write a digest-bound local evidence bundle.",
    flags: [
      ...ROOT_FLAG,
      {
        name: "--output",
        kind: "value",
        valueLabel: "<path>",
        summary: "Write the bundle to this managed project path.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => {
    if (observation.evidenceBundle === null) return noRun();
    const requested = invocation.flags.get("--output");
    const path =
      typeof requested === "string"
        ? requested
        : `.brain/evidence/${observation.configuration.runId}-bundle.json`;
    return writeArtifact(
      path,
      `${JSON.stringify(observation.evidenceBundle, null, 2)}\n`,
      `Wrote evidence bundle ${observation.evidenceBundle.digest}.`,
    );
  },
);

export const dashboardCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["dashboard"],
    summary: "Write a script-free static dashboard for the active run.",
    flags: [
      ...ROOT_FLAG,
      {
        name: "--output",
        kind: "value",
        valueLabel: "<path>",
        summary: "Write the dashboard to this managed project path.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => {
    if (observation.dashboardHtml === null) return noRun();
    const requested = invocation.flags.get("--output");
    const path =
      typeof requested === "string"
        ? requested
        : `.brain/dashboard/${observation.configuration.runId}.html`;
    return writeArtifact(
      path,
      observation.dashboardHtml,
      `Wrote the static dashboard for run ${observation.configuration.runId}.`,
    );
  },
);

function audit(observation: Observation): Decision {
  const report = observation.integrityAudit;
  if (report === null) return noRun();
  if (report.kind === "unreadable") {
    return {
      result: resultFor("runtime.state_corrupt", {
        why: ["The active run cannot be replayed safely."],
        evidence: report.artifactRefs.map((ref) => ({
          kind: "artifact" as const,
          ref,
        })),
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  if (report.kind === "divergent") {
    return {
      result: resultFor("runtime.state_corrupt", {
        why: report.divergences.map(
          ({ field }) => `Persisted field ${field} differs from replay.`,
        ),
        evidence: [
          {
            kind: "artifact",
            ref: `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}/state.json`,
          },
        ],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  return orientation(
    `Replay verified revision ${String(report.eventCursor)} with snapshot digest ${report.snapshotDigest}.`,
  );
}

function repair(
  apply: boolean,
  authorization: string | true | undefined,
  observation: Observation,
): Decision {
  const repair = observation.repairPlan;
  if (repair === null) return noRun();
  if (repair.kind === "blocked") {
    return {
      result: resultFor("runtime.state_corrupt", {
        why: ["Repair is blocked because no verified replay is available."],
        evidence: repair.evidenceRefs.map((ref) => ({
          kind: "artifact" as const,
          ref,
        })),
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  if (repair.kind === "noop") {
    return orientation("Replay and the persisted snapshot already agree.");
  }
  if (!apply) {
    return orientation(
      `Repair preview ${repair.planDigest} would write ${String(repair.writes.length)} artifact.`,
    );
  }
  if (authorization !== repair.planDigest) {
    return {
      result: resultFor("trail.uso", {
        why: ["Repair authorization does not match the current plan digest."],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  if (observation.persistedSnapshot === null) return noRun();
  const repairRoot = `.brain/repairs/${repair.planDigest}`;
  return {
    result: resultFor("trail.ok", {
      summary: `Applied repair plan ${repair.planDigest}.`,
      stateChanged: true,
      evidence: repair.evidenceRefs.map((ref) => ({
        kind: "artifact" as const,
        ref,
      })),
    }),
    plan: planOf(
      {
        kind: "write_file",
        path: `${repairRoot}/original.json`,
        content: `${JSON.stringify(observation.persistedSnapshot, null, 2)}\n`,
      },
      {
        kind: "write_file",
        path: `${repairRoot}/authorization.json`,
        content: `${JSON.stringify({ planDigest: repair.planDigest, authorizedAt: observation.occurredAt }, null, 2)}\n`,
      },
      ...repair.writes.map(({ path, content }) => ({
        kind: "write_file" as const,
        path,
        content,
      })),
    ),
    humanStdout: null,
    payload: null,
    revalidateRepairDigest: repair.planDigest,
  };
}

function writeArtifact(
  path: string,
  content: string,
  summary: string,
): Decision {
  return {
    result: resultFor("trail.ok", {
      summary,
      stateChanged: true,
      evidence: [{ kind: "artifact", ref: path }],
    }),
    plan: planOf({ kind: "write_file", path, content }),
    humanStdout: null,
    payload: null,
  };
}

function orientation(summary: string): Decision {
  return {
    result: resultFor("runtime.orientation_ok", { summary }),
    plan: planOf(),
    humanStdout: `${summary}\n`,
    payload: null,
  };
}

function noRun(): Decision {
  return {
    result: resultFor("trail.sem_run"),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
