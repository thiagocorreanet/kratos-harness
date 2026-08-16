import { planOf } from "../effects.js";
import {
  deriveBudget,
  deriveStats,
  deriveStatus,
  diagnose,
  explainReason,
} from "../diagnostics/index.js";
import { resultFor } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type {
  CommandObservation,
  CommandSpec,
  Decision,
  Invocation,
} from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "workflow" }>;

const ROOT_FLAG: CommandSpec["flags"] = [
  {
    name: "--root",
    kind: "value",
    valueLabel: "<path>",
    summary: "Operate on the project rooted at this path.",
  },
];

export const statusCommand: CommandSpec = observed("status", (observation) => {
  if (observation.workflow.kind !== "present") {
    return absentOrCorrupt(observation);
  }
  const status = deriveStatus(observation.workflow.state);
  return orientation(
    `Run ${status.runId} is ${status.status} at revision ${String(status.revision)}.`,
    [
      `Run: ${status.runId}`,
      `Feature: ${status.feature}`,
      `Status: ${status.status}`,
      `Phase: ${status.currentPhase ?? "none"}`,
      `Revision: ${String(status.revision)}`,
    ],
  );
});

export const statsCommand: CommandSpec = observed("stats", (observation) => {
  if (observation.workflow.kind !== "present") {
    return absentOrCorrupt(observation);
  }
  const state = observation.workflow.state;
  const stats = deriveStats(observation.events);
  return orientation(
    `Run ${state.runId} has ${String(stats.events)} recorded events.`,
    [
      `Events: ${String(stats.events)}`,
      `Operations: ${String(state.operations.length)}`,
      `Accepted transitions: ${String(stats.acceptedTransitions)}`,
      `Rejected transitions: ${String(stats.rejectedTransitions)}`,
      `Evidence references: ${String(stats.evidenceRefs)}`,
    ],
  );
});

export const budgetsCommand: CommandSpec = observed(
  "budgets",
  (observation) => {
    if (observation.workflow.kind !== "present") {
      return absentOrCorrupt(observation);
    }
    // Token usage is unknown until a host reports it. Null is preserved rather
    // than presenting an unobserved value as zero consumption.
    const budget = deriveBudget(observation.tokenBudget, null);
    return orientation(
      budget.allocated === null
        ? `Run ${observation.workflow.state.runId} has no configured token budget.`
        : `Run ${observation.workflow.state.runId} has an explicit budget of ${String(budget.allocated)} tokens.`,
      [
        `Allocated: ${budget.allocated === null ? "unbounded" : String(budget.allocated)}`,
        `Used: ${budget.used === null ? "unknown" : String(budget.used)}`,
        `Remaining: ${budget.remaining === null ? "unbounded" : String(budget.remaining)}`,
      ],
    );
  },
);

export const handoffCommand: CommandSpec = observed(
  "handoff",
  (observation) => {
    if (observation.workflow.kind !== "present") {
      return absentOrCorrupt(observation);
    }
    const state = observation.workflow.state;
    const blockers = observation.gateDecision.failures.map(
      ({ gateId }) => gateId,
    );
    const nextAction =
      observation.gateDecision.outcome === "block"
        ? "Resolve the reported gate blockers and rerun kratos doctor."
        : state.currentStep === "acceptance"
          ? "Review the evidence bundle, record final approval, and run kratos done."
          : `Complete the ${state.currentStep ?? "current"} phase and run kratos continue.`;
    return orientation(
      `Run ${state.runId} handoff is ready for ${state.currentStep ?? "completion"}.`,
      [
        `Objective: feature ${state.feature}, digest ${observation.objectiveDigest}`,
        `Run: ${state.runId}`,
        `Status: ${state.status}`,
        `Phase: ${state.currentStep ?? "none"}`,
        `Gate outcome: ${observation.gateDecision.outcome}`,
        `Blockers: ${blockers.length === 0 ? "none" : blockers.join(", ")}`,
        `Next action: ${nextAction}`,
      ],
    );
  },
);

export const doctorCommand: CommandSpec = observed("doctor", (observation) => {
  const report = diagnose([
    {
      name: "active-run",
      status:
        observation.workflow.kind === "corrupt"
          ? "fail"
          : observation.workflow.kind === "absent"
            ? "warn"
            : "pass",
      evidenceRef: ".brain/02-features/active",
    },
    {
      name: "approvals",
      status: observation.approvalsReadable ? "pass" : "fail",
      evidenceRef: `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}/approvals`,
    },
    {
      name: "objective",
      status: observation.objectiveActive ? "pass" : "warn",
      evidenceRef: ".brain/02-features/active",
    },
    {
      name: "event-integrity",
      status:
        observation.integrityAudit?.kind === "divergent" ||
        observation.integrityAudit?.kind === "unreadable"
          ? "fail"
          : observation.integrityAudit === null
            ? "warn"
            : "pass",
      evidenceRef: `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}/events.jsonl`,
    },
    {
      name: "evidence",
      status:
        !observation.evidenceReadable ||
        observation.invalidEvidenceIds.length > 0
          ? "fail"
          : observation.evidence.length === 0
            ? "warn"
            : "pass",
      evidenceRef: `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}/evidence`,
    },
    {
      name: "gates",
      status:
        observation.gateDecision.outcome === "block"
          ? "block"
          : observation.gateDecision.failures.length > 0
            ? "warn"
            : "pass",
      evidenceRef: `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}/gates.json`,
    },
    {
      name: "worktree",
      status: observation.worktreeClean ? "pass" : "warn",
      evidenceRef: null,
    },
  ]);
  if (report.health === "corrupt") {
    return {
      result: resultFor("runtime.state_corrupt", {
        evidence: report.checks.flatMap(({ evidenceRef }) =>
          evidenceRef === null
            ? []
            : [{ kind: "artifact" as const, ref: evidenceRef }],
        ),
        why: ["At least one deterministic integrity check failed."],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  return orientation(
    `Doctor classified the project as ${report.health}.`,
    report.checks.map(({ name, status }) => `${name}: ${status}`),
  );
});

export const explainCommand: CommandSpec = {
  path: ["explain"],
  summary: "Explain one stable reason code and its recovery action.",
  flags: [],
  positionals: { min: 1, max: 1 },
  jsonContract: "result@1.0.0",
  prerequisite: "none",
  handler: (invocation: Invocation): Decision => {
    const explanation = explainReason(invocation.positionals[0] ?? "");
    if (!explanation.known) {
      return {
        result: resultFor("trail.uso", {
          why: [explanation.description],
        }),
        plan: planOf(),
        humanStdout: null,
        payload: null,
      };
    }
    return orientation(explanation.description, [
      `Reason: ${explanation.code}`,
      `Retryable: ${String(explanation.retryable)}`,
      `Recovery: ${explanation.recovery ?? "none"}`,
    ]);
  },
};

function observed(
  name: "budgets" | "doctor" | "handoff" | "stats" | "status",
  handler: (observation: Observation) => Decision,
): CommandSpec {
  return observingCommand(
    "workflow",
    {
      path: [name],
      summary: `${name === "doctor" ? "Diagnose" : "Report"} ${name === "doctor" ? "managed state integrity" : `the active run ${name}`} without mutation.`,
      flags: ROOT_FLAG,
      positionals: { min: 0, max: 0 },
      jsonContract: "result@1.0.0",
    },
    (_invocation, observation) => handler(observation),
  );
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

function orientation(summary: string, lines: readonly string[]): Decision {
  return {
    result: resultFor("runtime.orientation_ok", { summary, why: lines }),
    plan: planOf(),
    humanStdout: `${lines.join("\n")}\n`,
    payload: null,
  };
}
