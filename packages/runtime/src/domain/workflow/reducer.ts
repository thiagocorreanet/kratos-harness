import type { ReadableEvent, SnapshotV1 } from "@kratos/contracts";

import type {
  EventChainCursor,
  EventReducerRegistry,
} from "../events/index.js";

import {
  RUN_PHASES,
  WORKFLOW_POLICY_VERSION,
  type RunPhase,
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
  };
}

export function reduceWorkflow(
  state: WorkflowState,
  event: ReadableEvent,
): WorkflowState {
  if (
    event.policyVersion !== WORKFLOW_POLICY_VERSION ||
    event.priorRevision !== state.revision
  ) {
    throw new Error("Unsupported workflow event");
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
      status = "active";
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
  };
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
    policyVersion: WORKFLOW_POLICY_VERSION,
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
    reducers: { [WORKFLOW_POLICY_VERSION]: reduceWorkflow },
    materialize,
  };
}
