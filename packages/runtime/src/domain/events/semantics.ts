import type { CurrentEventDraft, ReadableEvent } from "./model.js";

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

export const LOCK_EVENT_FACTS = {
  acquire: {
    reasonCode: "trail.ok",
    eventType: "operation",
    effect: "state",
    assignment: "forbidden",
  },
  renew: {
    reasonCode: "trail.ok",
    eventType: "operation",
    effect: "state",
    assignment: "forbidden",
  },
  release: {
    reasonCode: "trail.ok",
    eventType: "operation",
    effect: "state",
    assignment: "forbidden",
  },
  takeover: {
    reasonCode: "trail.ok",
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

const policiesByOperation = {
  start: [WORKFLOW_TRANSITION_FACTS.started, WORKFLOW_TRANSITION_FACTS.resumed],
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

const reservedReasons = new Set<string>(
  [
    ...Object.values(WORKFLOW_TRANSITION_FACTS),
    ...Object.values(WORKFLOW_OPERATION_FACTS),
  ].map(({ reasonCode }) => reasonCode),
);

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

export function assertEventSemanticPolicy(event: ReadableEvent): void {
  if (event.stateContract === "1.0.0") return;
  const hasAssignment = Object.hasOwn(event, "resolvedAssignment");
  if (event.operation.startsWith("lock.")) {
    const lockMatch = LOCK_OPERATION_PATTERN.exec(event.operation);
    if (lockMatch === null) throw new Error("invalid event semantics");
    const action = lockMatch[1] as LockLifecycleAction;
    const lockPolicy = LOCK_EVENT_FACTS[action];
    if (!matchesPolicy(event, lockPolicy, hasAssignment)) {
      throw new Error("invalid event semantics");
    }
    return;
  }
  if (event.operation.startsWith("sdd.")) {
    const operation = workflowOperation.exec(event.operation)?.[1] as
      WorkflowOperationFamily | undefined;
    if (operation === undefined) throw new Error("invalid event semantics");
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
    reservedReasons.has(event.reasonCode)
  ) {
    throw new Error("invalid event semantics");
  }
}
