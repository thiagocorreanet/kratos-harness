import type { GapRecordV1, GateFactsV1 } from "@kratos/contracts";

import { planOf, type Effect } from "../effects.js";
import {
  budgetExhausted,
  decideGapRecord,
  decideGapVerdict,
  decideGapWaiver,
  deriveGateFacts,
  describeGapRefusal,
  describeProposalFailure,
  GAP_PHASES,
  type ApprovalBoundary,
  type GapPhase,
  type GapUpdateDecision,
  type GapVerdict,
} from "../gaps/index.js";
import { resultFor, type Result } from "../result/index.js";
import {
  decideRecordFact,
  workflowReducerRegistry,
  type FactOperation,
  type WorkflowDecision,
} from "../workflow/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "workflow" }>;

const VERDICTS = new Set(["accepted", "adjusted", "rejected"]);

const ROOT_FLAG = {
  name: "--root",
  kind: "value",
  valueLabel: "<path>",
  summary: "Operate on the project rooted at this path.",
} as const;

const CORRELATION_FLAG = {
  name: "--correlation-id",
  kind: "value",
  valueLabel: "<id>",
  summary: "Use this idempotency correlation identifier.",
} as const;

export const gapsRecordCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["gaps", "record"],
    summary: "Receive proposed gaps and derive the facts the gates read.",
    flags: [CORRELATION_FLAG, ROOT_FLAG],
    positionals: { min: 1, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) => decideRecord(observation),
);

export const gapsResolveCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["gaps", "resolve"],
    summary: "Record the owner's verdict on one recorded gap.",
    flags: [
      CORRELATION_FLAG,
      {
        name: "--decided-by",
        kind: "value",
        valueLabel: "<id>",
        summary: "Record the identity making the decision.",
      },
      {
        name: "--decision",
        kind: "value",
        valueLabel: "<accepted|adjusted|rejected>",
        summary: "Record the verdict on the recommendation.",
      },
      {
        name: "--document-changed",
        kind: "boolean",
        summary: "Record that a document changed because of this verdict.",
      },
      {
        name: "--observation",
        kind: "value",
        valueLabel: "<text>",
        summary: "Record a single-line decision observation.",
      },
      ROOT_FLAG,
    ],
    positionals: { min: 1, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => {
    const decision = invocation.flags.get("--decision");
    const decidedBy = invocation.flags.get("--decided-by");
    const note = invocation.flags.get("--observation");
    if (
      typeof decision !== "string" ||
      !VERDICTS.has(decision) ||
      typeof decidedBy !== "string" ||
      typeof note !== "string"
    ) {
      return usage([
        "The verdict, its owner, and an observation are required.",
      ]);
    }
    return decideUpdate(
      observation,
      "gaps.resolve",
      decideGapVerdict({
        gapId: invocation.positionals[0] ?? "",
        decision: decision as GapVerdict,
        documentChanged: invocation.flags.get("--document-changed") === true,
        decidedBy,
        decidedAt: observation.occurredAt,
        observation: note,
        gaps: observation.gaps,
      }),
    );
  },
);

export const gapsWaiveCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["gaps", "waive"],
    summary: "Record the owner proceeding over a gap nobody answered.",
    flags: [
      {
        name: "--acknowledged-by",
        kind: "value",
        valueLabel: "<id>",
        summary: "Record the identity proceeding over the open gap.",
      },
      CORRELATION_FLAG,
      {
        name: "--observation",
        kind: "value",
        valueLabel: "<text>",
        summary: "Record a single-line acknowledgement observation.",
      },
      ROOT_FLAG,
    ],
    positionals: { min: 1, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => {
    const acknowledgedBy = invocation.flags.get("--acknowledged-by");
    const note = invocation.flags.get("--observation");
    if (typeof acknowledgedBy !== "string" || typeof note !== "string") {
      return usage([
        "An acknowledging identity and an observation are required.",
      ]);
    }
    return decideUpdate(
      observation,
      "gaps.waive",
      decideGapWaiver({
        gapId: invocation.positionals[0] ?? "",
        acknowledgedBy,
        acknowledgedAt: observation.occurredAt,
        observation: note,
        gaps: observation.gaps,
      }),
    );
  },
);

export const gatesRecordCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["gates", "record"],
    summary: "Record measured stop-loss and partition facts for the run.",
    flags: [
      CORRELATION_FLAG,
      {
        name: "--partition",
        kind: "value",
        valueLabel: "<required|optional>",
        summary: "Record whether this run requires a partition decision.",
      },
      {
        name: "--partition-approval",
        kind: "value",
        valueLabel: "<approved|pending>",
        summary: "Record whether the partition decision is approved.",
      },
      ROOT_FLAG,
      {
        name: "--stop-loss",
        kind: "value",
        valueLabel: "<tripped>",
        summary: "Record the host-observed stop-loss flag.",
      },
      {
        name: "--tokens-used",
        kind: "value",
        valueLabel: "<count>",
        summary: "Record the tokens the run consumed against its budget.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => {
    const stopLoss = invocation.flags.get("--stop-loss");
    const partition = invocation.flags.get("--partition");
    const approval = invocation.flags.get("--partition-approval");
    const tokens = invocation.flags.get("--tokens-used");
    const used = typeof tokens === "string" ? Number(tokens) : null;
    if (
      (stopLoss !== undefined &&
        stopLoss !== "tripped" &&
        stopLoss !== "tripped") ||
      (partition !== undefined &&
        partition !== "required" &&
        partition !== "optional") ||
      (approval !== undefined &&
        approval !== "approved" &&
        approval !== "pending") ||
      (used !== null && (!Number.isSafeInteger(used) || used < 0))
    ) {
      return usage([
        "A recorded gate fact used a value outside its vocabulary.",
      ]);
    }
    const unusable = unusableState(observation);
    if (unusable !== null) return unusable;
    const facts = deriveGateFacts({
      runId: observation.configuration.runId,
      gaps: observation.gaps,
      boundary: boundaryOf(observation),
      stopLoss: {
        tripped:
          stopLoss === undefined
            ? observation.gateFacts.stopLoss.tripped
            : stopLoss === "tripped",
        exhausted:
          used === null
            ? observation.gateFacts.stopLoss.exhausted
            : budgetExhausted(observation.tokenBudget, used),
      },
      partitionRequired:
        partition === undefined
          ? observation.gateFacts.partitionRequired
          : partition === "required",
      partitionApproved:
        approval === undefined
          ? observation.gateFacts.partitionApproved
          : approval === "approved",
      derivedAt: observation.occurredAt,
    });
    return commit(
      observation,
      "gates.record",
      [factsEffect(observation, facts)],
      `Recorded the gate facts for run ${observation.configuration.runId}.`,
      [gatesPath(observation)],
    );
  },
);

function decideRecord(observation: Observation): Decision {
  const unusable = unusableState(observation);
  if (unusable !== null) return unusable;
  const proposal = observation.gapProposal;
  if (proposal.kind !== "valid") {
    return usage([
      proposal.kind === "invalid"
        ? describeProposalFailure(proposal)
        : "The proposal file could not be read as JSON.",
    ]);
  }
  const phase = gapPhase(observation);
  const decision = decideGapRecord({
    proposal: proposal.value,
    runId: observation.configuration.runId,
    phase: phase ?? "prd",
    boundary: boundaryOf(observation),
    prdDigest: observation.observedLineage.prdDigest,
    specDigest: observation.observedLineage.specDigest,
    policyMode: observation.policyMode,
    recordedAt: observation.occurredAt,
    existing: observation.gaps,
  });
  if (decision.kind === "refused") {
    return usage([describeGapRefusal(decision.reason)]);
  }
  if (decision.kind === "unchanged") {
    return settled(
      `Every proposed gap was already recorded for run ${observation.configuration.runId}.`,
      [gatesPath(observation)],
    );
  }
  const facts = deriveGateFacts({
    runId: observation.configuration.runId,
    gaps: [...observation.gaps, ...decision.gaps],
    boundary: boundaryOf(observation),
    stopLoss: observation.gateFacts.stopLoss,
    partitionRequired: observation.gateFacts.partitionRequired,
    partitionApproved: observation.gateFacts.partitionApproved,
    derivedAt: observation.occurredAt,
  });
  const written = decision.gaps.map((gap) => gapPath(observation, gap.gapId));
  return commit(
    observation,
    "gaps.record",
    [
      ...decision.gaps.map((gap) => gapEffect(observation, gap)),
      factsEffect(observation, facts),
    ],
    `Recorded ${String(decision.gaps.length)} gap${
      decision.gaps.length === 1 ? "" : "s"
    } and derived ${String(facts.openGaps)} open.`,
    [...written, gatesPath(observation)],
  );
}

function decideUpdate(
  observation: Observation,
  operation: FactOperation,
  update: GapUpdateDecision,
): Decision {
  const unusable = unusableState(observation);
  if (unusable !== null) return unusable;
  if (update.kind === "refused") {
    return usage([describeGapRefusal(update.reason)]);
  }
  if (update.kind === "unchanged") {
    return settled(`Gap ${update.gap.gapId} already carries that answer.`, [
      gapPath(observation, update.gap.gapId),
    ]);
  }
  const gaps = observation.gaps.map((gap) =>
    gap.gapId === update.gap.gapId ? update.gap : gap,
  );
  const facts = deriveGateFacts({
    runId: observation.configuration.runId,
    gaps,
    boundary: boundaryOf(observation),
    stopLoss: observation.gateFacts.stopLoss,
    partitionRequired: observation.gateFacts.partitionRequired,
    partitionApproved: observation.gateFacts.partitionApproved,
    derivedAt: observation.occurredAt,
  });
  return commit(
    observation,
    operation,
    [gapEffect(observation, update.gap), factsEffect(observation, facts)],
    `Answered gap ${update.gap.gapId}; ${String(facts.openGaps)} remain open.`,
    [gapPath(observation, update.gap.gapId), gatesPath(observation)],
  );
}

/**
 * Turn a set of artifact effects into the decision that also records them.
 *
 * Every fact-recording command writes files and appends one event, and the
 * event is what makes the write replayable. Sharing the assembly keeps a
 * command from persisting a fact the history does not mention.
 */
function commit(
  observation: Observation,
  operation: FactOperation,
  effects: readonly Effect[],
  summary: string,
  artifactRefs: readonly string[],
): Decision {
  const workflow = decideRecordFact(observation.workflow, {
    feature: observation.configuration.feature,
    runId: observation.configuration.runId,
    correlationId: observation.correlationId,
    eventId: observation.eventId,
    occurredAt: observation.occurredAt,
    expectedRevision:
      observation.workflow.kind === "present"
        ? observation.workflow.state.revision
        : 0,
    operation,
    artifactRefs,
    observedIdentity: observation.observedIdentity,
  });
  if (workflow.kind === "refused") return refused(workflow, observation);
  if (workflow.kind === "unchanged") {
    return settled(
      "The recording was already reflected in the run history.",
      artifactRefs,
    );
  }
  return {
    result: resultFor("trail.ok", {
      summary,
      stateChanged: true,
      evidence: [
        ...artifactRefs.map((ref) => ({ kind: "artifact" as const, ref })),
        {
          kind: "event" as const,
          ref: `${runRoot(observation)}/events.jsonl`,
        },
      ],
    }),
    plan: planOf(...effects, {
      kind: "append_event",
      feature: observation.configuration.feature,
      runId: observation.configuration.runId,
      event: workflow.event,
    }),
    humanStdout: null,
    payload: null,
    eventReducers: workflowReducerRegistry(observation.configuration),
  };
}

/**
 * Where gap detection stands relative to the approval that ends it.
 *
 * A phase past the specification, or an approved specification, both mean the
 * same thing: the questions left are technical, and a technical question is
 * not a gap.
 */
function boundaryOf(observation: Observation): ApprovalBoundary {
  return observation.specApproved || gapPhase(observation) === null
    ? "post-approval"
    : "pre-approval";
}

function gapPhase(observation: Observation): GapPhase | null {
  const phase =
    observation.workflow.kind === "present"
      ? observation.workflow.state.currentStep
      : null;
  return GAP_PHASES.find((candidate) => candidate === phase) ?? null;
}

/**
 * Why this run cannot record a fact right now, or null when it can.
 *
 * State the runtime cannot read is not the same failure as a run that does not
 * exist yet, and a caller can act on exactly one of them.
 */
function unusableState(observation: Observation): Decision | null {
  if (
    observation.workflow.kind === "corrupt" ||
    !observation.gapsReadable ||
    !observation.gateFacts.readable
  ) {
    return corrupt();
  }
  if (observation.workflow.kind === "absent") {
    return decisionOf(
      resultFor("blocked.context_unreadable", {
        why: ["No active run exists to record a gate fact against."],
        evidence: [{ kind: "artifact", ref: ".brain/02-features/active" }],
      }),
    );
  }
  return null;
}

function runRoot(observation: Observation): string {
  return `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}`;
}

function gapPath(observation: Observation, gapId: string): string {
  return `${runRoot(observation)}/gaps/${gapId}.json`;
}

function gatesPath(observation: Observation): string {
  return `${runRoot(observation)}/gates.json`;
}

function gapEffect(observation: Observation, gap: GapRecordV1): Effect {
  return {
    kind: "write_file",
    path: gapPath(observation, gap.gapId),
    content: `${JSON.stringify(gap, null, 2)}\n`,
  };
}

function factsEffect(observation: Observation, facts: GateFactsV1): Effect {
  return {
    kind: "write_file",
    path: gatesPath(observation),
    content: `${JSON.stringify(facts, null, 2)}\n`,
  };
}

function settled(summary: string, refs: readonly string[]): Decision {
  return {
    result: resultFor("trail.ok", {
      summary,
      stateChanged: false,
      evidence: refs.map((ref) => ({ kind: "artifact" as const, ref })),
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function usage(why: readonly string[]): Decision {
  return decisionOf(resultFor("trail.uso", { why: [...why], evidence: [] }));
}

function corrupt(): Decision {
  return decisionOf(
    resultFor("runtime.state_corrupt", {
      why: ["The recorded gap state could not be read as its contract."],
      evidence: [{ kind: "artifact", ref: ".brain/02-features" }],
    }),
  );
}

function refused(
  workflow: Extract<WorkflowDecision, { readonly kind: "refused" }>,
  observation: Observation,
): Decision {
  return decisionOf(
    resultFor(workflow.reasonCode, {
      why: ["The persisted run preconditions did not authorize this record."],
      evidence:
        workflow.reasonCode === "trail.uso"
          ? []
          : [{ kind: "artifact", ref: runRoot(observation) }],
    }),
  );
}

function decisionOf(result: Result): Decision {
  return { result, plan: planOf(), humanStdout: null, payload: null };
}
