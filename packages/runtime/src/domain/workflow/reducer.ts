import {
  isAcceptanceCriterionId,
  type ReadableEvent,
  type SnapshotV1,
} from "@kratos/contracts";

import type {
  EventChainCursor,
  EventReducerRegistry,
  SealableEventDraft,
} from "../events/index.js";

import {
  RUN_PHASES,
  LEGACY_WORKFLOW_POLICY_VERSION,
  WORKFLOW_POLICY_VERSION,
  type RunPhase,
  type WorkflowRepairStop,
  type WorkflowReducerConfiguration,
  type WorkflowState,
} from "./model.js";

function nextPhase(current: RunPhase | null): RunPhase | null {
  if (current === null) return RUN_PHASES[0];
  const index = RUN_PHASES.indexOf(current);
  return index < 0 ? null : (RUN_PHASES[index + 1] ?? null);
}

export function workflowSeed(
  configuration: WorkflowReducerConfiguration,
): WorkflowState {
  return {
    projectId: configuration.projectId,
    feature: configuration.feature,
    runId: configuration.runId,
    status: "idle",
    currentStep: null,
    revision: 0,
    lineage: configuration.lineage,
    createdAt: null,
    updatedAt: null,
    operations: [],
    policyVersion: null,
    acceptanceAttemptCeiling: null,
    tokenCeiling: null,
    attempts: [],
    activeRepairStops: [],
    repairStopHistory: [],
    repairResolutions: [],
    specificationRestart: null,
    retiredCriterionIds: [],
    startedFromSpec: null,
  };
}

type WorkflowV2Event = ReadableEvent & {
  readonly runLimits?: {
    readonly acceptanceAttemptCeiling: number;
    readonly tokenCeiling: number | null;
  };
  readonly acceptanceDecision?: {
    readonly outcome: "passed" | "repair" | "stopped";
    readonly attempts: readonly {
      readonly criterionId: string;
      readonly attempt: number;
    }[];
    readonly repairStops: readonly {
      readonly criterionId: string;
      readonly attempt: number;
      readonly classification: "code" | "specification";
      readonly artifactRef: string;
      readonly artifactDigest: string;
    }[];
  };
  readonly repairResolution?: {
    readonly criterionId: string;
    readonly classification: "code" | "specification";
    readonly resolutionRef: string;
    readonly resolutionDigest: string;
    readonly nextRunId: string | null;
    readonly restartTicketRef: string | null;
    readonly restartTicketDigest: string | null;
  };
  readonly startedFromSpec?: {
    readonly sourceRunId: string;
    readonly restartTicketRef: string;
    readonly restartTicketDigest: string;
    readonly retiredCriterionIds: readonly string[];
  };
};
type WorkflowReducerEvent = ReadableEvent | SealableEventDraft;

function mergeAttempts(
  state: WorkflowState,
  updates: readonly {
    readonly criterionId: string;
    readonly attempt: number;
  }[],
): WorkflowState["attempts"] {
  const updated = new Set(updates.map(({ criterionId }) => criterionId));
  return [
    ...updates.map((attempt) => ({ ...attempt })),
    ...state.attempts.filter(({ criterionId }) => !updated.has(criterionId)),
  ];
}

function mergeRepairStopHistory(
  state: WorkflowState,
  stops: readonly WorkflowRepairStop[],
): WorkflowState["repairStopHistory"] {
  const recorded = new Set(
    state.repairStopHistory.map(({ criterionId }) => criterionId),
  );
  return [
    ...state.repairStopHistory,
    ...stops
      .filter(({ criterionId }) => !recorded.has(criterionId))
      .map((stop) => ({ ...stop })),
  ];
}

function hasCanonicalAcceptanceDecision(
  state: WorkflowState,
  event: WorkflowReducerEvent,
  decision: NonNullable<WorkflowV2Event["acceptanceDecision"]>,
  expectedOutcome: "passed" | "repair" | "stopped",
): boolean {
  const ceiling = state.acceptanceAttemptCeiling;
  if (
    ceiling === null ||
    state.currentStep !== "acceptance" ||
    state.activeRepairStops.length !== 0 ||
    decision.outcome !== expectedOutcome
  ) {
    return false;
  }
  const previous = new Map(
    state.attempts.map(({ criterionId, attempt }) => [criterionId, attempt]),
  );
  const criterionIds = new Set<string>();
  for (const attempt of decision.attempts) {
    if (
      !isAcceptanceCriterionId(attempt.criterionId) ||
      criterionIds.has(attempt.criterionId) ||
      attempt.attempt !== (previous.get(attempt.criterionId) ?? 0) + 1 ||
      attempt.attempt > ceiling
    ) {
      return false;
    }
    criterionIds.add(attempt.criterionId);
  }
  if (expectedOutcome === "passed") {
    return decision.attempts.length === 0 && decision.repairStops.length === 0;
  }
  if (decision.attempts.length === 0) return false;
  const tripping = decision.attempts.filter(
    ({ attempt }) => attempt === ceiling,
  );
  if (expectedOutcome === "repair") {
    return tripping.length === 0 && decision.repairStops.length === 0;
  }
  if (
    tripping.length === 0 ||
    decision.repairStops.length !== tripping.length
  ) {
    return false;
  }
  return decision.repairStops.every((stop, index) => {
    const attempt = tripping[index];
    const classification: unknown = stop.classification;
    return (
      attempt?.criterionId === stop.criterionId &&
      attempt.attempt === stop.attempt &&
      (classification === "code" || classification === "specification") &&
      event.artifactRefs.includes(stop.artifactRef)
    );
  });
}

function reduceKnownWorkflowReason(
  state: WorkflowState,
  event: WorkflowReducerEvent,
): WorkflowState {
  if (event.priorRevision !== state.revision) {
    throw new Error("Unsupported workflow event");
  }
  if (
    (state.activeRepairStops.length !== 0 ||
      state.specificationRestart !== null) &&
    (event.reasonCode === "run.resumed" ||
      event.reasonCode === "run.transition.accepted" ||
      event.reasonCode === "run.completed")
  ) {
    throw new Error("Run is blocked by repair stop");
  }
  let status: WorkflowState["status"];
  let currentStep = state.currentStep;
  switch (event.reasonCode) {
    case "run.started":
      if (state.revision !== 0) throw new Error("Run already started");
      status = "active";
      currentStep = RUN_PHASES[0];
      break;
    case "run.resumed":
      if (state.status === "completed") throw new Error("Run completed");
      status = state.activeRepairStops.length === 0 ? "active" : "blocked";
      break;
    case "run.transition.accepted": {
      if (state.status === "completed" || state.currentStep === null) {
        throw new Error("Run cannot advance");
      }
      const following = nextPhase(state.currentStep);
      if (following === null) throw new Error("Final phase needs completion");
      status = "active";
      currentStep = following;
      break;
    }
    case "run.transition.rejected":
      if (state.status === "completed" || state.currentStep === null) {
        throw new Error("Run cannot reject a transition");
      }
      status = "blocked";
      break;
    case "run.agent.recorded":
    case "run.gap.recorded":
    case "run.gap.resolved":
    case "run.gap.waived":
    case "run.gates.recorded":
      // Recording a fact a gate will read does not move the run through its
      // phases. It changes what the next decision sees, which is why it still
      // takes a revision: a gate answer bound to revision 4 must not be read
      // as if it had been true at revision 3.
      if (state.status === "completed" || state.currentStep === null) {
        throw new Error("Run cannot record gate facts");
      }
      status = state.status;
      break;
    case "run.completed":
      if (state.currentStep !== RUN_PHASES.at(-1)) {
        throw new Error("Run is not at final acceptance");
      }
      status = "completed";
      currentStep = null;
      break;
    default:
      throw new Error("Unsupported workflow reason");
  }
  return {
    ...state,
    status,
    currentStep,
    revision: event.resultingRevision,
    createdAt: state.createdAt ?? event.occurredAt,
    updatedAt: event.occurredAt,
    operations: [...state.operations, event.operation],
    policyVersion: event.policyVersion as WorkflowState["policyVersion"],
  };
}

export function reduceWorkflowV1(
  state: WorkflowState,
  event: ReadableEvent,
): WorkflowState {
  if (event.policyVersion !== LEGACY_WORKFLOW_POLICY_VERSION) {
    throw new Error("Unsupported workflow event");
  }
  return reduceKnownWorkflowReason(state, event);
}

export function reduceWorkflow(
  state: WorkflowState,
  event: WorkflowReducerEvent,
): WorkflowState {
  if (
    event.policyVersion !== WORKFLOW_POLICY_VERSION ||
    event.priorRevision !== state.revision
  ) {
    throw new Error("Unsupported workflow event");
  }
  const v2 = event as WorkflowV2Event;
  if (event.reasonCode === "run.policy_upgraded") {
    if (
      event.stateContract !== "1.4.0" ||
      event.eventType !== "recovery" ||
      event.effect !== "state" ||
      !event.operation.startsWith("sdd.start:") ||
      state.revision === 0 ||
      state.policyVersion !== LEGACY_WORKFLOW_POLICY_VERSION ||
      state.acceptanceAttemptCeiling !== null ||
      state.tokenCeiling !== null ||
      state.attempts.length !== 0 ||
      state.activeRepairStops.length !== 0 ||
      state.repairStopHistory.length !== 0 ||
      state.repairResolutions.length !== 0 ||
      state.specificationRestart !== null ||
      state.retiredCriterionIds.length !== 0 ||
      state.startedFromSpec !== null ||
      v2.runLimits === undefined
    ) {
      throw new Error("Workflow policy upgrade is inconsistent");
    }
    return {
      ...state,
      revision: event.resultingRevision,
      updatedAt: event.occurredAt,
      operations: [...state.operations, event.operation],
      policyVersion: WORKFLOW_POLICY_VERSION,
      acceptanceAttemptCeiling: v2.runLimits.acceptanceAttemptCeiling,
      tokenCeiling: v2.runLimits.tokenCeiling,
    };
  }
  if (event.reasonCode === "run.started") {
    if (v2.runLimits === undefined) {
      throw new Error("Workflow limits are missing");
    }
    return {
      ...reduceKnownWorkflowReason(state, event),
      acceptanceAttemptCeiling: v2.runLimits.acceptanceAttemptCeiling,
      tokenCeiling: v2.runLimits.tokenCeiling,
    };
  }
  if (event.reasonCode === "run.started_from_spec") {
    if (
      state.revision !== 0 ||
      v2.runLimits === undefined ||
      v2.startedFromSpec === undefined ||
      v2.startedFromSpec.retiredCriterionIds.length === 0
    ) {
      throw new Error("Specification restart is inconsistent");
    }
    return {
      ...state,
      status: "active",
      currentStep: "spec",
      revision: event.resultingRevision,
      createdAt: event.occurredAt,
      updatedAt: event.occurredAt,
      operations: [event.operation],
      policyVersion: WORKFLOW_POLICY_VERSION,
      acceptanceAttemptCeiling: v2.runLimits.acceptanceAttemptCeiling,
      tokenCeiling: v2.runLimits.tokenCeiling,
      retiredCriterionIds: [...v2.startedFromSpec.retiredCriterionIds],
      startedFromSpec: {
        sourceRunId: v2.startedFromSpec.sourceRunId,
        restartTicketRef: v2.startedFromSpec.restartTicketRef,
        restartTicketDigest: v2.startedFromSpec.restartTicketDigest,
      },
    };
  }
  if (state.acceptanceAttemptCeiling === null) {
    throw new Error("Workflow limits are missing");
  }
  if (event.reasonCode === "run.acceptance.passed") {
    if (
      v2.acceptanceDecision === undefined ||
      !hasCanonicalAcceptanceDecision(
        state,
        event,
        v2.acceptanceDecision,
        "passed",
      )
    ) {
      throw new Error("Acceptance decision is inconsistent");
    }
    return {
      ...state,
      revision: event.resultingRevision,
      updatedAt: event.occurredAt,
      operations: [...state.operations, event.operation],
      policyVersion: WORKFLOW_POLICY_VERSION,
    };
  }
  if (event.reasonCode === "run.acceptance.repair_required") {
    if (
      v2.acceptanceDecision === undefined ||
      !hasCanonicalAcceptanceDecision(
        state,
        event,
        v2.acceptanceDecision,
        "repair",
      )
    ) {
      throw new Error("Acceptance decision is inconsistent");
    }
    return {
      ...state,
      status: "active",
      currentStep: "code",
      revision: event.resultingRevision,
      updatedAt: event.occurredAt,
      operations: [...state.operations, event.operation],
      policyVersion: WORKFLOW_POLICY_VERSION,
      attempts: mergeAttempts(state, v2.acceptanceDecision.attempts),
    };
  }
  if (event.reasonCode === "run.stop_loss.repeated_rejection") {
    if (
      v2.acceptanceDecision === undefined ||
      !hasCanonicalAcceptanceDecision(
        state,
        event,
        v2.acceptanceDecision,
        "stopped",
      )
    ) {
      throw new Error("Acceptance decision is inconsistent");
    }
    const repairStops = v2.acceptanceDecision.repairStops.map((stop) => ({
      ...stop,
    }));
    return {
      ...state,
      status: "blocked",
      revision: event.resultingRevision,
      updatedAt: event.occurredAt,
      operations: [...state.operations, event.operation],
      policyVersion: WORKFLOW_POLICY_VERSION,
      attempts: mergeAttempts(state, v2.acceptanceDecision.attempts),
      activeRepairStops: repairStops,
      repairStopHistory: mergeRepairStopHistory(state, repairStops),
    };
  }
  if (event.reasonCode === "run.repair_stop.resolved") {
    const resolution = v2.repairResolution;
    if (
      resolution === undefined ||
      state.status !== "blocked" ||
      state.specificationRestart !== null
    ) {
      throw new Error("Repair resolution is inconsistent");
    }
    const stop = state.activeRepairStops.find(
      ({ criterionId }) => criterionId === resolution.criterionId,
    );
    if (stop?.classification !== resolution.classification) {
      throw new Error("Repair resolution is inconsistent");
    }
    const remainingStops = state.activeRepairStops.filter(
      ({ criterionId }) => criterionId !== resolution.criterionId,
    );
    const common: WorkflowState = {
      ...state,
      revision: event.resultingRevision,
      updatedAt: event.occurredAt,
      operations: [...state.operations, event.operation],
      policyVersion: WORKFLOW_POLICY_VERSION,
      activeRepairStops: remainingStops,
      repairResolutions: [
        ...state.repairResolutions,
        {
          operation: event.operation,
          criterionId: resolution.criterionId,
          classification: resolution.classification,
          resolutionRef: resolution.resolutionRef,
          resolutionDigest: resolution.resolutionDigest,
          nextRunId: resolution.nextRunId,
          restartTicketRef: resolution.restartTicketRef,
          restartTicketDigest: resolution.restartTicketDigest,
        },
      ],
    };
    if (resolution.classification === "specification") {
      if (
        remainingStops.some(
          ({ classification }) => classification === "code",
        ) ||
        resolution.nextRunId === null ||
        resolution.restartTicketRef === null ||
        resolution.restartTicketDigest === null
      ) {
        throw new Error("Repair resolution is inconsistent");
      }
      return {
        ...common,
        status: "blocked",
        specificationRestart: {
          criterionId: resolution.criterionId,
          nextRunId: resolution.nextRunId,
          restartTicketRef: resolution.restartTicketRef,
          restartTicketDigest: resolution.restartTicketDigest,
        },
      };
    }
    if (
      resolution.nextRunId !== null ||
      resolution.restartTicketRef !== null ||
      resolution.restartTicketDigest !== null
    ) {
      throw new Error("Repair resolution is inconsistent");
    }
    return {
      ...common,
      status: remainingStops.length === 0 ? "active" : "blocked",
      currentStep: remainingStops.length === 0 ? "code" : state.currentStep,
      attempts: state.attempts.filter(
        ({ criterionId }) => criterionId !== resolution.criterionId,
      ),
    };
  }
  return reduceKnownWorkflowReason(state, event);
}

function materialize(
  state: WorkflowState,
  cursor: EventChainCursor,
): SnapshotV1 {
  if (
    state.createdAt === null ||
    state.updatedAt === null ||
    cursor.hash === null ||
    state.revision !== cursor.revision
  ) {
    throw new Error("Workflow state cannot be materialized");
  }
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    projectId: state.projectId,
    runId: state.runId,
    status: state.status,
    currentStep: state.currentStep,
    eventCursor: cursor.revision,
    eventHash: cursor.hash,
    policyVersion: state.policyVersion ?? WORKFLOW_POLICY_VERSION,
    lineage: state.lineage,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export function workflowReducerRegistry(
  configuration: WorkflowReducerConfiguration,
): EventReducerRegistry<WorkflowState> {
  return {
    seed: workflowSeed(configuration),
    reducers: {
      [LEGACY_WORKFLOW_POLICY_VERSION]: reduceWorkflowV1,
      [WORKFLOW_POLICY_VERSION]: reduceWorkflow,
    },
    materialize,
  };
}
