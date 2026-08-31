import type { CurrentEventDraft, ReadableEvent } from "./model.js";
import {
  compareGateFailures,
  GATE_PRIORITIES,
  GATE_REASON_CODES,
} from "../gates/index.js";
import { PHASE_MODEL_ROLE } from "../model-roles/model.js";

type AssignmentPolicy = "forbidden" | "required";

interface EventFactPolicy {
  readonly reasonCode: string;
  readonly eventType: CurrentEventDraft["eventType"];
  readonly effect: CurrentEventDraft["effect"];
  readonly assignment: AssignmentPolicy;
}

export const WORKFLOW_TRANSITION_FACTS = {
  started: {
    reasonCode: "run.started",
    eventType: "transition",
    effect: "state",
    assignment: "forbidden",
  },
  resumed: {
    reasonCode: "run.resumed",
    eventType: "transition",
    effect: "state",
    assignment: "forbidden",
  },
  accepted: {
    reasonCode: "run.transition.accepted",
    eventType: "transition",
    effect: "state",
    assignment: "required",
  },
  rejected: {
    reasonCode: "run.transition.rejected",
    eventType: "decision",
    effect: "state",
    assignment: "forbidden",
  },
  completed: {
    reasonCode: "run.completed",
    eventType: "transition",
    effect: "state",
    assignment: "required",
  },
} as const satisfies Readonly<Record<string, EventFactPolicy>>;

export const WORKFLOW_POLICY_UPGRADE_FACT = {
  reasonCode: "run.policy_upgraded",
  eventType: "recovery",
  effect: "state",
  assignment: "forbidden",
} as const satisfies EventFactPolicy;

export const WORKFLOW_OPERATION_FACTS = {
  "agent.record": {
    reasonCode: "run.agent.recorded",
    eventType: "decision",
    effect: "state-and-artifact",
    assignment: "required",
  },
  "gaps.record": {
    reasonCode: "run.gap.recorded",
    eventType: "decision",
    effect: "state-and-artifact",
    assignment: "forbidden",
  },
  "gaps.resolve": {
    reasonCode: "run.gap.resolved",
    eventType: "decision",
    effect: "state-and-artifact",
    assignment: "forbidden",
  },
  "gaps.waive": {
    reasonCode: "run.gap.waived",
    eventType: "decision",
    effect: "state-and-artifact",
    assignment: "forbidden",
  },
  "gates.record": {
    reasonCode: "run.gates.recorded",
    eventType: "decision",
    effect: "state-and-artifact",
    assignment: "forbidden",
  },
} as const satisfies Readonly<Record<string, EventFactPolicy>>;

export type FactOperation = keyof typeof WORKFLOW_OPERATION_FACTS;

export type LockLifecycleAction = "acquire" | "renew" | "release" | "takeover";

export const LOCK_OPERATION_PATTERN =
  /^lock\.(acquire|renew|release|takeover)\.t(0|[1-9][0-9]*)\.d([a-f0-9]{64})$/u;

export const LOCK_EVENT_REASONS = {
  accepted: "trail.accepted",
  ok: "trail.ok",
} as const;

export const LOCK_EVENT_FACTS = {
  acquire: {
    reasonCode: LOCK_EVENT_REASONS.ok,
    eventType: "operation",
    effect: "state",
    assignment: "forbidden",
  },
  renew: {
    reasonCode: LOCK_EVENT_REASONS.ok,
    eventType: "operation",
    effect: "state",
    assignment: "forbidden",
  },
  release: {
    reasonCode: LOCK_EVENT_REASONS.ok,
    eventType: "operation",
    effect: "state",
    assignment: "forbidden",
  },
  takeover: {
    reasonCode: LOCK_EVENT_REASONS.ok,
    eventType: "recovery",
    effect: "state",
    assignment: "forbidden",
  },
} as const satisfies Readonly<Record<LockLifecycleAction, EventFactPolicy>>;

export const FACT_EVENT_REASONS = {
  "agent.record": WORKFLOW_OPERATION_FACTS["agent.record"].reasonCode,
  "gaps.record": WORKFLOW_OPERATION_FACTS["gaps.record"].reasonCode,
  "gaps.resolve": WORKFLOW_OPERATION_FACTS["gaps.resolve"].reasonCode,
  "gaps.waive": WORKFLOW_OPERATION_FACTS["gaps.waive"].reasonCode,
  "gates.record": WORKFLOW_OPERATION_FACTS["gates.record"].reasonCode,
} as const;

type WorkflowOperationFamily = "start" | "continue" | FactOperation;

const workflowOperation =
  /^sdd\.(start|continue|agent\.record|gaps\.record|gaps\.resolve|gaps\.waive|gates\.record):[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const acceptanceOperation =
  /^sdd\.acceptance\.record:[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const repairResolutionOperation =
  /^sdd\.repair\.resolve:[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const specificationRestartOperation =
  /^sdd\.repair\.restart:[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

const policiesByOperation = {
  start: [
    WORKFLOW_TRANSITION_FACTS.started,
    WORKFLOW_TRANSITION_FACTS.resumed,
    WORKFLOW_POLICY_UPGRADE_FACT,
  ],
  continue: [
    WORKFLOW_TRANSITION_FACTS.resumed,
    WORKFLOW_TRANSITION_FACTS.accepted,
    WORKFLOW_TRANSITION_FACTS.rejected,
    WORKFLOW_TRANSITION_FACTS.completed,
  ],
  "agent.record": [WORKFLOW_OPERATION_FACTS["agent.record"]],
  "gaps.record": [WORKFLOW_OPERATION_FACTS["gaps.record"]],
  "gaps.resolve": [WORKFLOW_OPERATION_FACTS["gaps.resolve"]],
  "gaps.waive": [WORKFLOW_OPERATION_FACTS["gaps.waive"]],
  "gates.record": [WORKFLOW_OPERATION_FACTS["gates.record"]],
} as const satisfies Readonly<
  Record<WorkflowOperationFamily, readonly EventFactPolicy[]>
>;

const reservedReasons = new Set<string>([
  ...Object.values(WORKFLOW_TRANSITION_FACTS).map(
    ({ reasonCode }) => reasonCode,
  ),
  ...Object.values(WORKFLOW_OPERATION_FACTS).map(
    ({ reasonCode }) => reasonCode,
  ),
  WORKFLOW_POLICY_UPGRADE_FACT.reasonCode,
  ...Object.values(LOCK_EVENT_REASONS),
]);

function matchesPolicy(
  event: ReadableEvent,
  policy: EventFactPolicy,
  hasAssignment: boolean,
): boolean {
  return (
    event.reasonCode === policy.reasonCode &&
    event.eventType === policy.eventType &&
    event.effect === policy.effect &&
    hasAssignment === (policy.assignment === "required")
  );
}

function hasConsistentAcceptanceMetadata(
  event: Extract<
    ReadableEvent,
    { readonly stateContract: "1.2.0" | "1.3.0" | "1.4.0" }
  >,
): boolean {
  const decision = event.acceptanceDecision;
  if (decision === undefined) return false;
  const attempts = new Map<string, number>();
  for (const attempt of decision.attempts) {
    if (attempts.has(attempt.criterionId)) return false;
    attempts.set(attempt.criterionId, attempt.attempt);
  }
  if (
    (decision.outcome === "passed" &&
      (decision.attempts.length !== 0 || decision.repairStops.length !== 0)) ||
    (decision.outcome === "repair" &&
      (decision.attempts.length === 0 || decision.repairStops.length !== 0)) ||
    (decision.outcome === "stopped" && decision.repairStops.length === 0)
  ) {
    return false;
  }
  const stoppedCriteria = new Set<string>();
  let priorAttemptIndex = -1;
  for (const stop of decision.repairStops) {
    if (
      stoppedCriteria.has(stop.criterionId) ||
      attempts.get(stop.criterionId) !== stop.attempt ||
      !event.artifactRefs.includes(stop.artifactRef)
    ) {
      return false;
    }
    const attemptIndex = decision.attempts.findIndex(
      ({ criterionId }) => criterionId === stop.criterionId,
    );
    if (attemptIndex <= priorAttemptIndex) return false;
    priorAttemptIndex = attemptIndex;
    stoppedCriteria.add(stop.criterionId);
  }
  return true;
}

export function assertEventSemanticPolicy(event: ReadableEvent): void {
  if (event.stateContract === "1.0.0") return;
  const hasAssignment = Object.hasOwn(event, "resolvedAssignment");
  const workflowEvent =
    event.stateContract === "1.2.0" ||
    event.stateContract === "1.3.0" ||
    event.stateContract === "1.4.0"
      ? event
      : null;
  const current =
    event.stateContract === "1.3.0" || event.stateContract === "1.4.0"
      ? event
      : null;
  const hasRunLimits = workflowEvent?.runLimits !== undefined;
  const hasAcceptanceDecision = workflowEvent?.acceptanceDecision !== undefined;
  const hasRepairResolution = current?.repairResolution !== undefined;
  const hasStartedFromSpec = current?.startedFromSpec !== undefined;
  if (
    event.resolvedAssignment !== undefined &&
    event.resolvedAssignment.role !==
      PHASE_MODEL_ROLE[event.resolvedAssignment.phase]
  ) {
    throw new Error("invalid event semantics");
  }
  if ("gateFailures" in event) {
    const ids = event.gateFailures.map(({ gateId }) => gateId);
    if (new Set(ids).size !== ids.length) {
      throw new Error("invalid event semantics");
    }
    if (
      event.gateFailures.some(
        (failure) =>
          failure.priority !== GATE_PRIORITIES[failure.gateId] ||
          !(GATE_REASON_CODES[failure.gateId] as readonly string[]).includes(
            failure.reasonCode,
          ),
      )
    ) {
      throw new Error("invalid event semantics");
    }
    if (
      event.gateFailures.some((failure, index, failures) => {
        const previous = index === 0 ? undefined : failures[index - 1];
        return (
          previous !== undefined && compareGateFailures(previous, failure) > 0
        );
      })
    ) {
      throw new Error("invalid event semantics");
    }
    if (
      !event.operation.startsWith("sdd.continue:") &&
      event.gateFailures.length > 0
    ) {
      throw new Error("invalid event semantics");
    }
  }
  if (event.operation.startsWith("lock.")) {
    if (
      hasRunLimits ||
      hasAcceptanceDecision ||
      hasRepairResolution ||
      hasStartedFromSpec
    ) {
      throw new Error("invalid event semantics");
    }
    const lockMatch = LOCK_OPERATION_PATTERN.exec(event.operation);
    if (lockMatch === null) throw new Error("invalid event semantics");
    const action = lockMatch[1] as LockLifecycleAction;
    const lockPolicy = LOCK_EVENT_FACTS[action];
    if (!matchesPolicy(event, lockPolicy, hasAssignment)) {
      throw new Error("invalid event semantics");
    }
    return;
  }
  if (acceptanceOperation.test(event.operation)) {
    if (
      workflowEvent === null ||
      event.policyVersion !== "workflow-v2" ||
      hasAssignment ||
      hasRunLimits ||
      hasRepairResolution ||
      hasStartedFromSpec ||
      workflowEvent.acceptanceDecision === undefined ||
      !hasConsistentAcceptanceMetadata(workflowEvent) ||
      event.eventType !== "decision" ||
      event.effect !== "state-and-artifact"
    ) {
      throw new Error("invalid event semantics");
    }
    const expectedReason = {
      passed: "run.acceptance.passed",
      repair: "run.acceptance.repair_required",
      stopped: "run.stop_loss.repeated_rejection",
    }[workflowEvent.acceptanceDecision.outcome];
    if (event.reasonCode !== expectedReason) {
      throw new Error("invalid event semantics");
    }
    return;
  }
  if (repairResolutionOperation.test(event.operation)) {
    const resolution = current?.repairResolution;
    if (
      current === null ||
      event.policyVersion !== "workflow-v2" ||
      hasAssignment ||
      hasRunLimits ||
      hasAcceptanceDecision ||
      hasStartedFromSpec ||
      resolution === undefined ||
      event.eventType !== "recovery" ||
      event.effect !== "state-and-artifact" ||
      event.reasonCode !== "run.repair_stop.resolved" ||
      !event.artifactRefs.includes(resolution.resolutionRef)
    ) {
      throw new Error("invalid event semantics");
    }
    const specification = resolution.classification === "specification";
    if (
      specification !== (resolution.nextRunId !== null) ||
      specification !== (resolution.restartTicketRef !== null) ||
      specification !== (resolution.restartTicketDigest !== null) ||
      (resolution.restartTicketRef !== null &&
        !event.artifactRefs.includes(resolution.restartTicketRef))
    ) {
      throw new Error("invalid event semantics");
    }
    return;
  }
  if (specificationRestartOperation.test(event.operation)) {
    const restart = current?.startedFromSpec;
    if (
      current === null ||
      event.policyVersion !== "workflow-v2" ||
      hasAssignment ||
      !hasRunLimits ||
      hasAcceptanceDecision ||
      hasRepairResolution ||
      restart === undefined ||
      event.eventType !== "recovery" ||
      event.effect !== "state-and-artifact" ||
      event.reasonCode !== "run.started_from_spec" ||
      !event.artifactRefs.includes(restart.restartTicketRef)
    ) {
      throw new Error("invalid event semantics");
    }
    return;
  }
  if (event.operation.startsWith("sdd.")) {
    const operation = workflowOperation.exec(event.operation)?.[1] as
      WorkflowOperationFamily | undefined;
    if (operation === undefined) throw new Error("invalid event semantics");
    const isWorkflowV2LimitBoundary =
      workflowEvent !== null &&
      event.policyVersion === "workflow-v2" &&
      (event.reasonCode === "run.started" ||
        (event.stateContract === "1.4.0" &&
          event.reasonCode === WORKFLOW_POLICY_UPGRADE_FACT.reasonCode));
    if (
      hasAcceptanceDecision ||
      hasRepairResolution ||
      hasStartedFromSpec ||
      hasRunLimits !== isWorkflowV2LimitBoundary ||
      (event.reasonCode === WORKFLOW_POLICY_UPGRADE_FACT.reasonCode &&
        event.stateContract !== "1.4.0")
    ) {
      throw new Error("invalid event semantics");
    }
    const matches = policiesByOperation[operation].filter((policy) =>
      matchesPolicy(event, policy, hasAssignment),
    );
    if (matches.length !== 1) throw new Error("invalid event semantics");
    return;
  }
  if (
    event.eventType !== "operation" ||
    event.effect !== "state" ||
    hasAssignment ||
    reservedReasons.has(event.reasonCode) ||
    hasRunLimits ||
    hasAcceptanceDecision ||
    hasRepairResolution ||
    hasStartedFromSpec
  ) {
    throw new Error("invalid event semantics");
  }
}
