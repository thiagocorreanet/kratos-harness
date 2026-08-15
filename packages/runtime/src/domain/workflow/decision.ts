import type { EventDraftV1 } from "../events/index.js";

import {
  RUN_PHASES,
  WORKFLOW_POLICY_VERSION,
  type ContinueWorkflowRequest,
  type StartWorkflowRequest,
  type WorkflowDecision,
  type WorkflowIdentity,
  type WorkflowObservation,
} from "./model.js";

const operationId = (name: "continue" | "start", correlationId: string) =>
  `sdd.${name}:${correlationId}`;

const id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const feature = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const sha256 = /^[a-f0-9]{64}$/u;

function validStartRequest(request: StartWorkflowRequest): boolean {
  return (
    id.test(request.projectId) &&
    feature.test(request.feature) &&
    id.test(request.runId) &&
    id.test(request.correlationId) &&
    id.test(request.eventId) &&
    id.test(operationId("start", request.correlationId)) &&
    id.test(request.observedIdentity.host) &&
    (request.observedIdentity.model === null ||
      id.test(request.observedIdentity.model)) &&
    sha256.test(request.lineage.prdDigest) &&
    sha256.test(request.lineage.specDigest)
  );
}

function validContinueRequest(request: ContinueWorkflowRequest): boolean {
  return (
    feature.test(request.feature) &&
    id.test(request.runId) &&
    id.test(request.correlationId) &&
    id.test(request.eventId) &&
    id.test(operationId("continue", request.correlationId)) &&
    Number.isSafeInteger(request.expectedRevision) &&
    request.expectedRevision >= 0 &&
    id.test(request.observedIdentity.host) &&
    (request.observedIdentity.model === null ||
      id.test(request.observedIdentity.model))
  );
}

function hasOperation(
  observation: WorkflowObservation,
  operation: string,
): boolean {
  return (
    observation.kind !== "corrupt" &&
    observation.operations.includes(operation)
  );
}

function event(
  input: {
    readonly eventId: string;
    readonly occurredAt: string;
    readonly operation: string;
    readonly revision: number;
    readonly identity: WorkflowIdentity;
  },
  transition: Extract<WorkflowDecision, { readonly kind: "recorded" }>["transition"],
  artifactRefs: readonly string[] = [],
  evidenceRefs: readonly string[] = [],
): EventDraftV1 {
  const reasonCode: Readonly<
    Record<
      Extract<WorkflowDecision, { readonly kind: "recorded" }>["transition"],
      string
    >
  > = {
    accepted: "run.transition.accepted",
    completed: "run.completed",
    rejected: "run.transition.rejected",
    resumed: "run.resumed",
    started: "run.started",
  };
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    eventId: input.eventId,
    eventType: transition === "rejected" ? "decision" : "transition",
    occurredAt: input.occurredAt,
    operation: input.operation,
    policyVersion: WORKFLOW_POLICY_VERSION,
    priorRevision: input.revision,
    resultingRevision: input.revision + 1,
    reasonCode: reasonCode[transition],
    effect: "state",
    artifactRefs: [...artifactRefs],
    evidenceRefs: [...evidenceRefs],
    observedIdentity: input.identity,
  };
}

export function decideStartWorkflow(
  observation: WorkflowObservation,
  request: StartWorkflowRequest,
): WorkflowDecision {
  if (!validStartRequest(request)) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  if (observation.kind === "corrupt") {
    return { kind: "refused", reasonCode: "blocked.state_unreadable" };
  }
  if (!request.objectiveActive) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  if (!request.worktreeClean) {
    return { kind: "refused", reasonCode: "trail.worktree_dirty" };
  }
  const operation = operationId("start", request.correlationId);
  if (hasOperation(observation, operation)) {
    return { kind: "unchanged", reason: "duplicate" };
  }
  if (observation.kind === "present") {
    if (observation.state.feature !== request.feature) {
      return { kind: "refused", reasonCode: "blocked.feature_mismatch" };
    }
    if (observation.state.runId !== request.runId) {
      return { kind: "refused", reasonCode: "blocked.runid_mismatch" };
    }
    if (observation.state.status === "completed") {
      return { kind: "unchanged", reason: "already-completed" };
    }
    return {
      kind: "recorded",
      transition: "resumed",
      event: event(
        {
          eventId: request.eventId,
          occurredAt: request.occurredAt,
          operation,
          revision: observation.state.revision,
          identity: request.observedIdentity,
        },
        "resumed",
      ),
    };
  }
  return {
    kind: "recorded",
    transition: "started",
    event: event(
      {
        eventId: request.eventId,
        occurredAt: request.occurredAt,
        operation,
        revision: 0,
        identity: request.observedIdentity,
      },
      "started",
    ),
  };
}

export function decideContinueWorkflow(
  observation: WorkflowObservation,
  request: ContinueWorkflowRequest,
): WorkflowDecision {
  if (!validContinueRequest(request)) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  if (observation.kind === "corrupt") {
    return { kind: "refused", reasonCode: "blocked.state_unreadable" };
  }
  if (observation.kind === "absent") {
    return { kind: "refused", reasonCode: "blocked.context_unreadable" };
  }
  const state = observation.state;
  if (state.feature !== request.feature) {
    return { kind: "refused", reasonCode: "blocked.feature_mismatch" };
  }
  if (state.runId !== request.runId) {
    return { kind: "refused", reasonCode: "blocked.runid_mismatch" };
  }
  const operation = operationId("continue", request.correlationId);
  if (state.operations.includes(operation)) {
    return { kind: "unchanged", reason: "duplicate" };
  }
  if (state.status === "completed") {
    return { kind: "unchanged", reason: "already-completed" };
  }
  if (request.expectedRevision !== state.revision) {
    return { kind: "refused", reasonCode: "runtime.revision_conflict" };
  }

  if (request.action.kind === "resume") {
    return recorded(request, operation, state.revision, "resumed");
  }
  if (request.action.kind === "reject") {
    return recorded(
      request,
      operation,
      state.revision,
      "rejected",
      request.action.artifactRefs,
      request.action.evidenceRefs,
    );
  }
  if (
    request.action.gateFailures.length !== 0 ||
    request.action.artifactRefs.length === 0 ||
    request.action.evidenceRefs.length === 0
  ) {
    return recorded(
      request,
      operation,
      state.revision,
      "rejected",
      request.action.artifactRefs,
      request.action.evidenceRefs,
    );
  }
  const finalPhase = state.currentStep === RUN_PHASES.at(-1);
  if (finalPhase && !request.action.allowFinalCompletion) {
    return recorded(
      request,
      operation,
      state.revision,
      "rejected",
      request.action.artifactRefs,
      request.action.evidenceRefs,
    );
  }
  return recorded(
    request,
    operation,
    state.revision,
    finalPhase ? "completed" : "accepted",
    request.action.artifactRefs,
    request.action.evidenceRefs,
  );
}

function recorded(
  request: ContinueWorkflowRequest,
  operation: string,
  revision: number,
  transition: Extract<WorkflowDecision, { readonly kind: "recorded" }>["transition"],
  artifactRefs: readonly string[] = [],
  evidenceRefs: readonly string[] = [],
): WorkflowDecision {
  return {
    kind: "recorded",
    transition,
    event: event(
      {
        eventId: request.eventId,
        occurredAt: request.occurredAt,
        operation,
        revision,
        identity: request.observedIdentity,
      },
      transition,
      artifactRefs,
      evidenceRefs,
    ),
  };
}
