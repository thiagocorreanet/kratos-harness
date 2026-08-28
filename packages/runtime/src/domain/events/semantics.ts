import type { CurrentEventDraft, ReadableEvent } from "./model.js";

type AssignmentPolicy = "forbidden" | "required";

interface EventFactPolicy {
  readonly reasonCode: string;
  readonly eventType: CurrentEventDraft["eventType"];
  readonly effect: CurrentEventDraft["effect"];
  readonly operations: readonly string[];
  readonly assignment: AssignmentPolicy;
}

export const WORKFLOW_TRANSITION_FACTS = {
  started: {
    reasonCode: "run.started",
    eventType: "transition",
    effect: "state",
    operations: ["start"],
    assignment: "forbidden",
  },
  resumed: {
    reasonCode: "run.resumed",
    eventType: "transition",
    effect: "state",
    operations: ["start", "continue"],
    assignment: "forbidden",
  },
  accepted: {
    reasonCode: "run.transition.accepted",
    eventType: "transition",
    effect: "state",
    operations: ["continue"],
    assignment: "required",
  },
  rejected: {
    reasonCode: "run.transition.rejected",
    eventType: "decision",
    effect: "state",
    operations: ["continue"],
    assignment: "forbidden",
  },
  completed: {
    reasonCode: "run.completed",
    eventType: "transition",
    effect: "state",
    operations: ["continue"],
    assignment: "required",
  },
} as const satisfies Readonly<Record<string, EventFactPolicy>>;

export const WORKFLOW_OPERATION_FACTS = {
  "agent.record": {
    reasonCode: "run.agent.recorded",
    eventType: "decision",
    effect: "state-and-artifact",
    operations: ["agent.record"],
    assignment: "required",
  },
  "gaps.record": {
    reasonCode: "run.gap.recorded",
    eventType: "decision",
    effect: "state-and-artifact",
    operations: ["gaps.record"],
    assignment: "forbidden",
  },
  "gaps.resolve": {
    reasonCode: "run.gap.resolved",
    eventType: "decision",
    effect: "state-and-artifact",
    operations: ["gaps.resolve"],
    assignment: "forbidden",
  },
  "gaps.waive": {
    reasonCode: "run.gap.waived",
    eventType: "decision",
    effect: "state-and-artifact",
    operations: ["gaps.waive"],
    assignment: "forbidden",
  },
  "gates.record": {
    reasonCode: "run.gates.recorded",
    eventType: "decision",
    effect: "state-and-artifact",
    operations: ["gates.record"],
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
} as const satisfies Readonly<
  Record<LockLifecycleAction, Omit<EventFactPolicy, "operations">>
>;

export const FACT_EVENT_REASONS = {
  "agent.record": WORKFLOW_OPERATION_FACTS["agent.record"].reasonCode,
  "gaps.record": WORKFLOW_OPERATION_FACTS["gaps.record"].reasonCode,
  "gaps.resolve": WORKFLOW_OPERATION_FACTS["gaps.resolve"].reasonCode,
  "gaps.waive": WORKFLOW_OPERATION_FACTS["gaps.waive"].reasonCode,
  "gates.record": WORKFLOW_OPERATION_FACTS["gates.record"].reasonCode,
} as const;

const workflowOperation =
  /^sdd\.([a-z]+(?:\.[a-z]+)*):[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const policies: readonly EventFactPolicy[] = [
  ...Object.values(WORKFLOW_TRANSITION_FACTS),
  ...Object.values(WORKFLOW_OPERATION_FACTS),
];

export function assertEventSemanticPolicy(event: ReadableEvent): void {
  if (event.stateContract === "1.0.0") return;
  const hasAssignment = Object.hasOwn(event, "resolvedAssignment");
  const lockMatch = LOCK_OPERATION_PATTERN.exec(event.operation);
  if (lockMatch !== null) {
    const action = lockMatch[1] as LockLifecycleAction;
    const lockPolicy = LOCK_EVENT_FACTS[action];
    if (
      event.eventType !== lockPolicy.eventType ||
      event.effect !== lockPolicy.effect ||
      event.reasonCode !== lockPolicy.reasonCode ||
      hasAssignment
    ) {
      throw new Error("invalid event semantics");
    }
    return;
  }
  const policy = policies.find(
    ({ reasonCode }) => reasonCode === event.reasonCode,
  );
  if (policy === undefined) {
    if (hasAssignment) throw new Error("invalid event semantics");
    return;
  }
  const operation = workflowOperation.exec(event.operation)?.[1];
  if (
    operation === undefined ||
    !policy.operations.includes(operation) ||
    event.eventType !== policy.eventType ||
    event.effect !== policy.effect ||
    hasAssignment !== (policy.assignment === "required")
  ) {
    throw new Error("invalid event semantics");
  }
}
