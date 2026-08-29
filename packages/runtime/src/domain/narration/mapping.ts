import type { BeatKind, ReadableEvent } from "@kratos/contracts";
import { reasonPolicy } from "@kratos/contracts";

export interface EventBeatRule {
  readonly id: string;
  readonly match: (event: ReadableEvent) => boolean;
  readonly kind: BeatKind;
}

export const EVENT_BEAT_RULES: readonly EventBeatRule[] = [
  // 1. Resumption: recovery event type or resumption reason codes
  {
    id: "recovery-event",
    match: (e) =>
      e.eventType === "recovery" ||
      e.reasonCode.includes("resumed") ||
      e.reasonCode.includes("recovered") ||
      e.reasonCode.startsWith("brain_migration_"),
    kind: "resumption",
  },
  // 2. Waiting: human approval or intervention required
  {
    id: "waiting-human-approval",
    match: (e) =>
      e.reasonCode === "gate.approval_required" ||
      e.reasonCode.includes("approval_required") ||
      e.reasonCode.includes("human_intervention") ||
      e.reasonCode.includes("interaction_required") ||
      e.reasonCode.includes("prompt_required") ||
      e.reasonCode.startsWith("blocked.human") ||
      e.reasonCode.startsWith("blocked.user"),
    kind: "waiting",
  },
  // 3. Milestone: workflow phase completed or successful transitions / completions
  {
    id: "milestone-phase-completed",
    match: (e) =>
      e.reasonCode === "workflow.phase_completed" ||
      e.reasonCode.endsWith("_completed") ||
      e.reasonCode.startsWith("complete.") ||
      e.reasonCode.startsWith("done.") ||
      e.reasonCode.endsWith("_passed") ||
      e.reasonCode.endsWith("_approved"),
    kind: "milestone",
  },
  {
    id: "milestone-transition-success",
    match: (e) =>
      e.eventType === "transition" &&
      (reasonPolicy(e.reasonCode)?.status === "success" ||
        !reasonPolicy(e.reasonCode)),
    kind: "milestone",
  },
  // 4. Warning: advisory status or warning reason codes
  {
    id: "warning-advisory",
    match: (e) =>
      reasonPolicy(e.reasonCode)?.status === "advisory" ||
      e.reasonCode.startsWith("warn.") ||
      e.reasonCode.includes("warning"),
    kind: "warning",
  },
  // 5. Stop: failure, blocked, decision events or unrecognized errors
  {
    id: "stop-failure-or-blocked",
    match: (e) => {
      const policy = reasonPolicy(e.reasonCode);
      if (policy?.status === "failure" || policy?.status === "blocked") {
        return true;
      }
      if (e.eventType === "decision") {
        return true;
      }
      if (
        !policy &&
        (e.reasonCode.includes("fail") ||
          e.reasonCode.includes("error") ||
          e.reasonCode.includes("unknown") ||
          e.reasonCode.includes("reject") ||
          e.reasonCode.includes("abort"))
      ) {
        return true;
      }
      return false;
    },
    kind: "stop",
  },
  // 6. Work: operations or active work
  {
    id: "work-operation",
    match: (e) =>
      e.eventType === "operation" ||
      e.reasonCode.endsWith("_started") ||
      reasonPolicy(e.reasonCode)?.status === "success",
    kind: "work",
  },
  // 7. Fallback for unrecognized reason codes on any remaining events
  {
    id: "fallback-unrecognized",
    match: () => true,
    kind: "stop",
  },
];

export function resolveBeatKind(event: ReadableEvent): BeatKind {
  for (const rule of EVENT_BEAT_RULES) {
    if (rule.match(event)) {
      return rule.kind;
    }
  }
  return "stop";
}

export function resolveBeatSentence(event: ReadableEvent): string {
  const policy = reasonPolicy(event.reasonCode);
  if (policy && policy.description.trim().length > 0) {
    return policy.description;
  }
  return `Encountered reason ${event.reasonCode}.`;
}

export function resolveBeatSubject(event: ReadableEvent): string {
  if (!event.operation) {
    return "run";
  }
  if (
    event.operation === "prd" ||
    event.operation === "spec" ||
    event.operation === "plan" ||
    event.operation === "code" ||
    event.operation === "review" ||
    event.operation === "acceptance"
  ) {
    return `phase:${event.operation}`;
  }
  return event.operation;
}
