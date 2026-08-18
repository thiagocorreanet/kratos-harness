import type { GapRecordV1, GateFactsV1 } from "@kratos/contracts";

import { isOpenGap, type ApprovalBoundary } from "./model.js";

export interface GateFactsRequest {
  readonly runId: string;
  /** Every gap record the run holds, valid or not yet answered. */
  readonly gaps: readonly GapRecordV1[];
  readonly boundary: ApprovalBoundary;
  readonly stopLoss: {
    readonly tripped: boolean;
    readonly exhausted: boolean;
  };
  readonly partitionRequired: boolean;
  readonly partitionApproved: boolean;
  readonly derivedAt: string;
}

/**
 * Derive the facts the gates read from the records the run holds.
 *
 * A pure function of its inputs, and deliberately the only producer of
 * `gates.json`: the gate that reads a fact and the command that writes it stay
 * separable only while nothing else can invent one.
 *
 * After specification approval the open count is zero by construction. The
 * records stay on disk, so a gap raised too late is still visible in history;
 * it just no longer stops a run whose remaining questions are technical.
 */
export function deriveGateFacts(request: GateFactsRequest): GateFactsV1 {
  const openGapIds =
    request.boundary === "post-approval"
      ? []
      : request.gaps
          .filter((gap) => gap.runId === request.runId && isOpenGap(gap))
          .map(({ gapId }) => gapId)
          .sort((left, right) => left.localeCompare(right, "en-US"));
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    runId: request.runId,
    openGaps: openGapIds.length,
    openGapIds,
    stopLoss: {
      tripped: request.stopLoss.tripped,
      exhausted: request.stopLoss.exhausted,
    },
    partitionRequired: request.partitionRequired,
    partitionApproved: request.partitionApproved,
    derivedAt: request.derivedAt,
  };
}

/**
 * Whether the measured spend exhausted the allocation.
 *
 * An absent allocation cannot be exhausted. Reporting exhaustion against a
 * budget nobody set would block runs on a number the project never chose.
 */
export function budgetExhausted(
  allocated: number | null,
  used: number,
): boolean {
  return (
    allocated !== null &&
    Number.isSafeInteger(allocated) &&
    Number.isSafeInteger(used) &&
    used >= 0 &&
    used >= allocated
  );
}
