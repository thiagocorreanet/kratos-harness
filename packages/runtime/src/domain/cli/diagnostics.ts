import { planOf } from "../effects.js";
import {
  deriveBudget,
  deriveStats,
  deriveStatus,
  deriveStackProfileCheck,
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
    if (observation.phaseAssignment.kind === "refused") {
      return handoffRefusal(
        observation.phaseAssignment.reasonCode,
        observation.phaseAssignment.subject,
      );
    }
    const payload = observation.phaseAssignment.value;
    return {
      result: resultFor("runtime.orientation_ok", {
        summary: `Run ${payload.runId} handoff is ready for ${payload.phase}.`,
      }),
      plan: planOf(),
      humanStdout: null,
      payload,
    };
  },
);

export function renderPhaseHandoffHuman(payload: {
  readonly feature: string;
  readonly objectiveDigest: string;
  readonly runId: string;
  readonly status: string;
  readonly phase: string;
  readonly gateOutcome: string;
  readonly blockers: readonly string[];
  readonly openGaps: number;
  readonly nextAction: string;
  readonly host: string;
  readonly assignment: {
    readonly role: string;
    readonly model: string;
    readonly effort: string;
  };
  readonly assignmentDigest: string;
}): string {
  return [
    `Objective: feature ${payload.feature}, digest ${payload.objectiveDigest}`,
    `Run: ${payload.runId}`,
    `Status: ${payload.status}`,
    `Phase: ${payload.phase}`,
    `Gate outcome: ${payload.gateOutcome}`,
    `Blockers: ${payload.blockers.length === 0 ? "none" : payload.blockers.join(", ")}`,
    `Open gaps: ${String(payload.openGaps)}`,
    `Next action: ${payload.nextAction}`,
    `Host: ${payload.host}`,
    `Assignment: ${payload.assignment.role} ${payload.assignment.model} (${payload.assignment.effort})`,
    `Assignment digest: ${payload.assignmentDigest}`,
    "",
  ].join("\n");
}

export const doctorCommand: CommandSpec = observed("doctor", (observation) => {
  if (
    observation.stackProfile.authoritativeState.kind === "migration-required"
  ) {
    return {
      result: resultFor(
        observation.stackProfile.authoritativeState.reasonCode,
        {
          why: [
            "The project configuration must be migrated before doctor can derive the current stack profile.",
          ],
          evidence: [{ kind: "artifact", ref: ".brain/config.json" }],
        },
      ),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
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
    deriveStackProfileCheck(observation.stackProfile),
  ]);
  if (report.health === "corrupt") {
    return {
      result: resultFor("runtime.state_corrupt", {
        evidence: [
          ...new Set(
            report.checks.flatMap(({ evidenceRef }) =>
              evidenceRef === null ? [] : [evidenceRef],
            ),
          ),
        ].map((ref) => ({ kind: "artifact" as const, ref })),
        why: [
          "At least one deterministic integrity check failed.",
          ...report.checks.flatMap(({ name, status, details }) => [
            `${name}: ${status}`,
            ...(details ?? []),
          ]),
        ],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  return orientation(
    `Doctor classified the project as ${report.health}.`,
    report.checks.flatMap(({ name, status, details }) => [
      `${name}: ${status}`,
      ...(details ?? []),
    ]),
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
      jsonContract: name === "handoff" ? "phase-handoff@1.2.0" : "result@1.0.0",
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

function handoffRefusal(reasonCode: string, subject: string): Decision {
  if (reasonCode === "memory.migration_required") {
    return {
      result: resultFor(reasonCode, {
        why: [
          "Custom legacy memory must be explicitly adopted before code or review handoff.",
        ],
        evidence: [{ kind: "artifact", ref: subject }],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  if (reasonCode === "memory.projection_drift") {
    return {
      result: resultFor(reasonCode, {
        why: [
          "The rendered curated-memory projection does not match its ledger.",
        ],
        evidence: [
          { kind: "artifact", ref: ".brain/03-memory/curated-memory.json" },
          { kind: "artifact", ref: ".brain/03-memory/gotchas.md" },
        ],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  if (reasonCode === "runtime.state_corrupt") {
    return {
      result: resultFor(reasonCode, {
        why: ["The curated-memory state could not be read safely."],
        evidence: [{ kind: "artifact", ref: subject }],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  if (subject === "launcher:absent" || subject === "launcher:unsupported") {
    const missing = subject === "launcher:absent";
    return {
      result: resultFor(reasonCode, {
        why: [
          missing
            ? "A launcher identity is required for handoff routing."
            : "The launcher identity is unsupported for handoff routing.",
          "Accepted launcher identities are claude-code and codex.",
        ],
        evidence: [
          {
            kind: "observation",
            ref: "model-routing/launcher",
          },
        ],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  return {
    result: resultFor(reasonCode, {
      why: [`Model routing could not resolve the bounded subject ${subject}.`],
      evidence: [
        {
          kind: "observation",
          ref: `model-routing/${subject}`,
        },
      ],
    }),
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
