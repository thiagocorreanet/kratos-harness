import type { HostOperationMessageV1 } from "@kratos/contracts";

export interface DeliveryCursor {
  readonly correlationId: string;
  readonly operationId: string;
  readonly lastSequence: number;
  readonly seenMessageIds: readonly string[];
}

export type DeliveryDecision =
  | {
      readonly kind: "accepted";
      readonly stateChanged: true;
      readonly cursor: DeliveryCursor;
    }
  | {
      readonly kind: "duplicate";
      readonly stateChanged: false;
      readonly cursor: DeliveryCursor;
    }
  | {
      readonly kind: "rejected";
      readonly stateChanged: false;
      readonly reason:
        "correlation_mismatch" | "operation_mismatch" | "out_of_order";
      readonly cursor: DeliveryCursor | null;
    };

/**
 * Classify one host delivery without reading a clock, host, or filesystem.
 *
 * Duplicate delivery is idempotent. A gap, stale sequence, or changed
 * correlation is refused without advancing the cursor, so a retry cannot skip
 * a host event or apply an event to another operation.
 */
export function classifyDelivery(
  cursor: DeliveryCursor | null,
  message: HostOperationMessageV1,
): DeliveryDecision {
  if (cursor === null) {
    if (message.sequence !== 0) {
      return {
        kind: "rejected",
        stateChanged: false,
        reason: "out_of_order",
        cursor: null,
      };
    }
    return {
      kind: "accepted",
      stateChanged: true,
      cursor: initialCursor(message),
    };
  }

  if (cursor.seenMessageIds.includes(message.messageId)) {
    return { kind: "duplicate", stateChanged: false, cursor };
  }
  if (message.correlationId !== cursor.correlationId) {
    return {
      kind: "rejected",
      stateChanged: false,
      reason: "correlation_mismatch",
      cursor,
    };
  }
  if (message.operationId !== cursor.operationId) {
    return {
      kind: "rejected",
      stateChanged: false,
      reason: "operation_mismatch",
      cursor,
    };
  }
  if (message.sequence !== cursor.lastSequence + 1) {
    return {
      kind: "rejected",
      stateChanged: false,
      reason: "out_of_order",
      cursor,
    };
  }

  return {
    kind: "accepted",
    stateChanged: true,
    cursor: Object.freeze({
      correlationId: cursor.correlationId,
      operationId: cursor.operationId,
      lastSequence: message.sequence,
      seenMessageIds: Object.freeze([
        ...cursor.seenMessageIds,
        message.messageId,
      ]),
    }),
  };
}

/**
 * The first accepted message fixes the operation and correlation identities.
 */
function initialCursor(message: HostOperationMessageV1): DeliveryCursor {
  return Object.freeze({
    correlationId: message.correlationId,
    operationId: message.operationId,
    lastSequence: message.sequence,
    seenMessageIds: Object.freeze([message.messageId]),
  });
}

const CAPABILITY_BY_KIND = Object.freeze({
  approval: "interaction.approval",
  hook: "lifecycle.hook",
  timeout: "lifecycle.timeout",
  cancellation: "lifecycle.cancellation",
  error: "lifecycle.error",
} as const satisfies Readonly<Record<HostOperationMessageV1["kind"], string>>);

export function requiredCapability(message: HostOperationMessageV1): string {
  return CAPABILITY_BY_KIND[message.kind];
}

export function mutationNeedsRecovery(
  message: HostOperationMessageV1,
): boolean {
  if (
    message.kind !== "timeout" &&
    message.kind !== "cancellation" &&
    message.kind !== "error"
  ) {
    return false;
  }
  return (
    message.payload.mutation.state === "prepared" ||
    message.payload.mutation.state === "publishing"
  );
}
