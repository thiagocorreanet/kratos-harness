import { isAcceptanceCriterionId } from "@kratos/contracts";

import type { CurrentEventDraft, UpgradeEventDraft } from "../events/index.js";
import {
  WORKFLOW_OPERATION_FACTS,
  WORKFLOW_POLICY_UPGRADE_FACT,
  WORKFLOW_TRANSITION_FACTS,
} from "../events/semantics.js";

import {
  RUN_PHASES,
  LEGACY_WORKFLOW_POLICY_VERSION,
  WORKFLOW_POLICY_VERSION,
  type ContinueWorkflowRequest,
  type FactOperation,
  type PhaseExecutionObservation,
  type ResolveRepairStopRequest,
  type StartWorkflowRequest,
  type WorkflowDecision,
  type WorkflowIdentity,
  type WorkflowAssignment,
  type WorkflowObservation,
} from "./model.js";

const operationId = (
  name: "continue" | "start" | FactOperation,
  correlationId: string,
) => `sdd.${name}:${correlationId}`;

/** Every transition that moves the run, as opposed to recording a fact. */
type MovingTransition =
  "started" | "resumed" | "accepted" | "rejected" | "completed";

const id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const feature = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const reference =
  // eslint-disable-next-line no-control-regex -- persisted references cannot contain control bytes.
  /^(?!\/)(?![A-Za-z]:[\\/])(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))(?![a-z][a-z0-9+.-]*:\/\/)[^\u0000-\u001f\u007f]{1,1024}$/u;
// eslint-disable-next-line no-control-regex -- reject every ASCII control byte in a human note.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

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
    sha256.test(request.lineage.specDigest) &&
    (request.acceptanceAttemptCeiling === undefined ||
      (Number.isSafeInteger(request.acceptanceAttemptCeiling) &&
        request.acceptanceAttemptCeiling > 0)) &&
    (request.tokenCeiling === undefined ||
      request.tokenCeiling === null ||
      (Number.isSafeInteger(request.tokenCeiling) &&
        request.tokenCeiling > 0)) &&
    (request.startFromSpec === undefined ||
      (id.test(request.startFromSpec.sourceRunId) &&
        request.startFromSpec.sourceRunId !== request.runId &&
        reference.test(request.startFromSpec.restartTicketRef) &&
        sha256.test(request.startFromSpec.restartTicketDigest) &&
        request.startFromSpec.retiredCriterionIds.length > 0 &&
        new Set(request.startFromSpec.retiredCriterionIds).size ===
          request.startFromSpec.retiredCriterionIds.length &&
        request.startFromSpec.retiredCriterionIds.every(
          isAcceptanceCriterionId,
        )))
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
      id.test(request.observedIdentity.model)) &&
    (request.phaseExecution === undefined ||
      validPhaseExecution(request.phaseExecution))
  );
}

type RuntimePhaseExecution = Omit<PhaseExecutionObservation, "provenance"> & {
  readonly provenance: unknown;
};

function validPhaseExecution(execution: RuntimePhaseExecution): boolean {
  return (
    (execution.provenance === "host-reported" ||
      execution.provenance === "unknown") &&
    sha256.test(execution.assignmentDigest) &&
    (execution.model === null || id.test(execution.model)) &&
    (execution.effort === null || id.test(execution.effort))
  );
}

function executionMismatch(
  assignment: WorkflowAssignment,
  execution: PhaseExecutionObservation,
): boolean {
  return (
    execution.provenance === "host-reported" &&
    ((execution.model !== null && execution.model !== assignment.model) ||
      (execution.effort !== null && execution.effort !== assignment.effort))
  );
}

function phaseIdentity(
  identity: WorkflowIdentity,
  execution: PhaseExecutionObservation | undefined,
): CurrentEventDraft["observedIdentity"] {
  if (execution === undefined) {
    return { ...identity, effort: null };
  }
  const provenance = execution.provenance;
  switch (provenance) {
    case "host-reported":
      return {
        host: identity.host,
        model: execution.model,
        effort: execution.effort,
      };
    case "unknown":
      return { host: identity.host, model: null, effort: null };
  }
  return unreachablePhaseProvenance(provenance);
}

function unreachablePhaseProvenance(provenance: never): never {
  void provenance;
  throw new Error("Unvalidated phase execution provenance");
}

function hasOperation(
  observation: WorkflowObservation,
  operation: string,
): boolean {
  switch (observation.kind) {
    case "absent":
      return observation.operations.includes(operation);
    case "present":
      return observation.state.operations.includes(operation);
    case "corrupt":
      return false;
  }
}

function event(
  input: {
    readonly eventId: string;
    readonly occurredAt: string;
    readonly operation: string;
    readonly revision: number;
    readonly identity: WorkflowIdentity;
  },
  transition: MovingTransition,
  artifactRefs: readonly string[] = [],
  evidenceRefs: readonly string[] = [],
  resolvedAssignment?: WorkflowAssignment,
  phaseExecution?: PhaseExecutionObservation,
  runLimits?: {
    readonly acceptanceAttemptCeiling: number;
    readonly tokenCeiling: number | null;
  },
): CurrentEventDraft {
  const fact = WORKFLOW_TRANSITION_FACTS[transition];
  return {
    contractVersion: "1.2.0",
    stateContract: "1.2.0",
    eventId: input.eventId,
    eventType: fact.eventType,
    occurredAt: input.occurredAt,
    operation: input.operation,
    policyVersion: WORKFLOW_POLICY_VERSION,
    priorRevision: input.revision,
    resultingRevision: input.revision + 1,
    reasonCode: fact.reasonCode,
    effect: fact.effect,
    artifactRefs: [...artifactRefs],
    evidenceRefs: [...evidenceRefs],
    observedIdentity: phaseIdentity(input.identity, phaseExecution),
    ...(resolvedAssignment === undefined ? {} : { resolvedAssignment }),
    ...(runLimits === undefined ? {} : { runLimits }),
  };
}

function policyUpgradeEvent(
  input: {
    readonly eventId: string;
    readonly occurredAt: string;
    readonly operation: string;
    readonly revision: number;
    readonly identity: WorkflowIdentity;
  },
  runLimits: {
    readonly acceptanceAttemptCeiling: number;
    readonly tokenCeiling: number | null;
  },
): UpgradeEventDraft {
  return {
    contractVersion: "1.4.0",
    stateContract: "1.4.0",
    eventId: input.eventId,
    eventType: WORKFLOW_POLICY_UPGRADE_FACT.eventType,
    occurredAt: input.occurredAt,
    operation: input.operation,
    policyVersion: WORKFLOW_POLICY_VERSION,
    priorRevision: input.revision,
    resultingRevision: input.revision + 1,
    reasonCode: WORKFLOW_POLICY_UPGRADE_FACT.reasonCode,
    effect: WORKFLOW_POLICY_UPGRADE_FACT.effect,
    artifactRefs: [],
    evidenceRefs: [],
    observedIdentity: phaseIdentity(input.identity, undefined),
    runLimits,
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
    if (
      observation.state.policyVersion === LEGACY_WORKFLOW_POLICY_VERSION &&
      observation.state.acceptanceAttemptCeiling === null &&
      observation.state.tokenCeiling === null &&
      observation.state.attempts.length === 0 &&
      observation.state.activeRepairStops.length === 0 &&
      observation.state.repairStopHistory.length === 0 &&
      observation.state.repairResolutions.length === 0 &&
      observation.state.specificationRestart === null &&
      observation.state.retiredCriterionIds.length === 0 &&
      observation.state.startedFromSpec === null
    ) {
      return {
        kind: "recorded",
        transition: "upgraded",
        event: policyUpgradeEvent(
          {
            eventId: request.eventId,
            occurredAt: request.occurredAt,
            operation,
            revision: observation.state.revision,
            identity: request.observedIdentity,
          },
          {
            acceptanceAttemptCeiling: request.acceptanceAttemptCeiling ?? 3,
            tokenCeiling: request.tokenCeiling ?? null,
          },
        ),
      };
    }
    if (
      observation.state.policyVersion !== WORKFLOW_POLICY_VERSION ||
      observation.state.acceptanceAttemptCeiling === null
    ) {
      return { kind: "refused", reasonCode: "trail.uso" };
    }
    if (
      observation.state.activeRepairStops.length !== 0 ||
      observation.state.specificationRestart !== null
    ) {
      return {
        kind: "refused",
        reasonCode: "blocked.stop_loss_rejections",
      };
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
  if (request.startFromSpec !== undefined) {
    const [firstCriterionId, ...remainingCriterionIds] =
      request.startFromSpec.retiredCriterionIds;
    if (firstCriterionId === undefined)
      return { kind: "refused", reasonCode: "trail.uso" };
    return {
      kind: "recorded",
      transition: "started",
      event: {
        contractVersion: "1.3.0",
        stateContract: "1.3.0",
        eventId: request.eventId,
        eventType: "recovery",
        occurredAt: request.occurredAt,
        operation: `sdd.repair.restart:${request.correlationId}`,
        policyVersion: WORKFLOW_POLICY_VERSION,
        priorRevision: 0,
        resultingRevision: 1,
        reasonCode: "run.started_from_spec",
        effect: "state-and-artifact",
        artifactRefs: [request.startFromSpec.restartTicketRef],
        evidenceRefs: [],
        observedIdentity: phaseIdentity(request.observedIdentity, undefined),
        runLimits: {
          acceptanceAttemptCeiling: request.acceptanceAttemptCeiling ?? 3,
          tokenCeiling: request.tokenCeiling ?? null,
        },
        startedFromSpec: {
          ...request.startFromSpec,
          retiredCriterionIds: [firstCriterionId, ...remainingCriterionIds],
        },
      },
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
      [],
      [],
      undefined,
      undefined,
      {
        acceptanceAttemptCeiling: request.acceptanceAttemptCeiling ?? 3,
        tokenCeiling: request.tokenCeiling ?? null,
      },
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
  if (
    state.policyVersion !== WORKFLOW_POLICY_VERSION ||
    state.acceptanceAttemptCeiling === null
  ) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  if (request.expectedRevision !== state.revision) {
    return { kind: "refused", reasonCode: "runtime.revision_conflict" };
  }

  if (
    request.action.kind !== "reject" &&
    (state.activeRepairStops.length !== 0 ||
      state.specificationRestart !== null)
  ) {
    return {
      kind: "refused",
      reasonCode: "blocked.stop_loss_rejections",
    };
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
      ["explicit-reject"],
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
      rejectionWhy(request.action),
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
      ["final-completion-not-allowed"],
    );
  }
  if (request.resolvedAssignment === undefined) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  if (request.phaseExecution === undefined) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  if (executionMismatch(request.resolvedAssignment, request.phaseExecution)) {
    return { kind: "refused", reasonCode: "model.execution_mismatch" };
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

export function decideResolveRepairStop(
  observation: WorkflowObservation,
  request: ResolveRepairStopRequest,
): WorkflowDecision {
  const operation = `sdd.repair.resolve:${request.correlationId}`;
  if (
    !feature.test(request.feature) ||
    !id.test(request.runId) ||
    !isAcceptanceCriterionId(request.criterionId) ||
    !id.test(request.correlationId) ||
    !id.test(request.eventId) ||
    !id.test(operation) ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0 ||
    !id.test(request.resolvedBy) ||
    request.observation.trim().length < 1 ||
    request.observation.length > 2048 ||
    CONTROL_CHARACTERS.test(request.observation) ||
    !id.test(request.observedIdentity.host) ||
    (request.observedIdentity.model !== null &&
      !id.test(request.observedIdentity.model)) ||
    !reference.test(request.resolutionRef) ||
    !sha256.test(request.resolutionDigest)
  ) {
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
  const priorResolution = state.repairResolutions.find(
    (resolution) => resolution.operation === operation,
  );
  if (state.operations.includes(operation)) {
    const requestClassification =
      request.nextRunId === null ? "code" : "specification";
    return priorResolution?.criterionId === request.criterionId &&
      priorResolution.classification === requestClassification &&
      priorResolution.resolutionRef === request.resolutionRef &&
      priorResolution.resolutionDigest === request.resolutionDigest &&
      priorResolution.nextRunId === request.nextRunId &&
      priorResolution.restartTicketRef === request.restartTicketRef &&
      priorResolution.restartTicketDigest === request.restartTicketDigest
      ? { kind: "unchanged", reason: "duplicate" }
      : { kind: "refused", reasonCode: "runtime.revision_conflict" };
  }
  if (
    state.policyVersion !== WORKFLOW_POLICY_VERSION ||
    state.status !== "blocked" ||
    state.specificationRestart !== null
  ) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  if (request.expectedRevision !== state.revision) {
    return { kind: "refused", reasonCode: "runtime.revision_conflict" };
  }
  const stop = state.activeRepairStops.find(
    ({ criterionId }) => criterionId === request.criterionId,
  );
  if (stop === undefined) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  const specification = stop.classification === "specification";
  if (
    specification &&
    state.activeRepairStops.some(
      (candidate) => candidate.classification === "code",
    )
  ) {
    return {
      kind: "refused",
      reasonCode: "blocked.stop_loss_rejections",
    };
  }
  if (
    specification !== (request.nextRunId !== null) ||
    specification !== (request.restartTicketRef !== null) ||
    specification !== (request.restartTicketDigest !== null) ||
    (request.nextRunId !== null &&
      (!id.test(request.nextRunId) || request.nextRunId === request.runId)) ||
    (request.restartTicketRef !== null &&
      !reference.test(request.restartTicketRef)) ||
    (request.restartTicketDigest !== null &&
      !sha256.test(request.restartTicketDigest))
  ) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  const artifactRefs = [
    request.resolutionRef,
    ...(request.restartTicketRef === null ? [] : [request.restartTicketRef]),
  ];
  return {
    kind: "recorded",
    transition: "resolved",
    event: {
      contractVersion: "1.3.0",
      stateContract: "1.3.0",
      eventId: request.eventId,
      eventType: "recovery",
      occurredAt: request.occurredAt,
      operation,
      policyVersion: WORKFLOW_POLICY_VERSION,
      priorRevision: state.revision,
      resultingRevision: state.revision + 1,
      reasonCode: "run.repair_stop.resolved",
      effect: "state-and-artifact",
      artifactRefs,
      evidenceRefs: [],
      observedIdentity: phaseIdentity(request.observedIdentity, undefined),
      repairResolution: {
        criterionId: request.criterionId,
        classification: stop.classification,
        resolutionRef: request.resolutionRef,
        resolutionDigest: request.resolutionDigest,
        nextRunId: request.nextRunId,
        restartTicketRef: request.restartTicketRef,
        restartTicketDigest: request.restartTicketDigest,
      },
    },
  };
}

function rejectionWhy(
  action: Extract<
    ContinueWorkflowRequest["action"],
    { readonly kind: "complete-phase" }
  >,
): readonly string[] {
  const reasons = [...action.gateFailures];
  if (
    action.artifactRefs.length === 0 &&
    !reasons.includes("artifact-unreadable")
  ) {
    reasons.push("artifact-missing");
  }
  if (
    action.evidenceRefs.length === 0 &&
    !reasons.includes("evidence-invalid")
  ) {
    reasons.push("evidence-missing");
  }
  return [...new Set(reasons)];
}

function recorded(
  request: ContinueWorkflowRequest,
  operation: string,
  revision: number,
  transition: MovingTransition,
  artifactRefs: readonly string[] = [],
  evidenceRefs: readonly string[] = [],
  why?: readonly string[],
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
      transition === "accepted" || transition === "completed"
        ? request.resolvedAssignment
        : undefined,
      transition === "accepted" || transition === "completed"
        ? request.phaseExecution
        : undefined,
    ),
    ...(why === undefined ? {} : { why: [...why] }),
  };
}

export interface RecordFactRequest {
  readonly feature: string;
  readonly runId: string;
  readonly correlationId: string;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly expectedRevision: number;
  readonly operation: FactOperation;
  readonly artifactRefs: readonly string[];
  readonly observedIdentity: WorkflowIdentity;
  readonly resolvedAssignment?: WorkflowAssignment;
  readonly phaseExecution?: PhaseExecutionObservation;
}

/**
 * Decide the event that records a fact the gates will read.
 *
 * The same preconditions as any other operation on an open run, and the same
 * idempotency: a repeated correlation identifier is a repeated delivery, not a
 * second gap.
 */
export function decideRecordFact(
  observation: WorkflowObservation,
  request: RecordFactRequest,
): WorkflowDecision {
  if (
    !feature.test(request.feature) ||
    !id.test(request.runId) ||
    !id.test(request.correlationId) ||
    !id.test(request.eventId) ||
    !id.test(operationId(request.operation, request.correlationId)) ||
    !Number.isSafeInteger(request.expectedRevision) ||
    request.expectedRevision < 0 ||
    !id.test(request.observedIdentity.host) ||
    (request.observedIdentity.model !== null &&
      !id.test(request.observedIdentity.model)) ||
    (request.phaseExecution !== undefined &&
      !validPhaseExecution(request.phaseExecution)) ||
    !request.artifactRefs.every((ref) => ref.length > 0)
  ) {
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
  const operation = operationId(request.operation, request.correlationId);
  if (state.operations.includes(operation)) {
    return { kind: "unchanged", reason: "duplicate" };
  }
  if (state.status === "completed") {
    return { kind: "unchanged", reason: "already-completed" };
  }
  if (
    state.policyVersion !== WORKFLOW_POLICY_VERSION ||
    state.acceptanceAttemptCeiling === null
  ) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  if (request.expectedRevision !== state.revision) {
    return { kind: "refused", reasonCode: "runtime.revision_conflict" };
  }
  const requiresAssignment = request.operation === "agent.record";
  if (
    requiresAssignment &&
    (request.resolvedAssignment === undefined ||
      request.phaseExecution === undefined)
  ) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  if (
    !requiresAssignment &&
    (request.resolvedAssignment !== undefined ||
      request.phaseExecution !== undefined)
  ) {
    return { kind: "refused", reasonCode: "trail.uso" };
  }
  if (
    request.resolvedAssignment !== undefined &&
    request.phaseExecution !== undefined &&
    executionMismatch(request.resolvedAssignment, request.phaseExecution)
  ) {
    return { kind: "refused", reasonCode: "model.execution_mismatch" };
  }
  return {
    kind: "recorded",
    transition: "observed",
    event: {
      contractVersion: "1.2.0",
      stateContract: "1.2.0",
      eventId: request.eventId,
      eventType: WORKFLOW_OPERATION_FACTS[request.operation].eventType,
      occurredAt: request.occurredAt,
      operation,
      policyVersion: WORKFLOW_POLICY_VERSION,
      priorRevision: state.revision,
      resultingRevision: state.revision + 1,
      reasonCode: WORKFLOW_OPERATION_FACTS[request.operation].reasonCode,
      effect: WORKFLOW_OPERATION_FACTS[request.operation].effect,
      artifactRefs: [...request.artifactRefs],
      evidenceRefs: [],
      observedIdentity: phaseIdentity(
        request.observedIdentity,
        request.phaseExecution,
      ),
      ...(request.resolvedAssignment === undefined
        ? {}
        : { resolvedAssignment: request.resolvedAssignment }),
    },
  };
}
