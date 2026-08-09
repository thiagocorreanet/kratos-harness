import { reasonPolicy } from "@mestre-yoda/contracts";

export interface EvidenceRef {
  readonly kind: "artifact" | "event" | "approval" | "test" | "observation";
  readonly ref: string;
  readonly sha256?: string;
}

/** The universal result envelope, in canonical field order. */
export interface Result {
  readonly contractVersion: "1.0.0";
  readonly status: "success" | "failure" | "blocked";
  readonly exitCode: number;
  readonly reasonCode: string;
  readonly summary: string;
  readonly why: readonly string[];
  readonly evidence: readonly EvidenceRef[];
  readonly stateChanged: boolean;
  readonly retryable: boolean;
  readonly recovery: string | null;
}

export interface ResultDetail {
  readonly summary?: string;
  readonly why?: readonly string[];
  readonly evidence?: readonly EvidenceRef[];
  readonly stateChanged?: boolean;
}

export interface TransactionFailureDetail {
  readonly reasonCode:
    | "guard.outside_allow"
    | "runtime.internal_failure"
    | "runtime.recovery_required"
    | "runtime.revision_conflict"
    | "runtime.state_corrupt";
  readonly evidence: readonly EvidenceRef[];
}

/** Build a result whose policy comes from the reason it reports. */
export function resultFor(code: string, detail: ResultDetail = {}): Result {
  const policy = reasonPolicy(code);
  if (policy === null) throw new Error("Unknown reason code");
  return {
    contractVersion: "1.0.0",
    status: policy.status,
    exitCode: policy.exitCode,
    reasonCode: code,
    summary: detail.summary ?? policy.description,
    why: detail.why ?? [],
    evidence: detail.evidence ?? [],
    stateChanged: detail.stateChanged ?? policy.stateChanged,
    retryable: policy.retryable,
    recovery: policy.recovery,
  };
}

/** Fixed public causes that never interpolate caller-supplied arguments. */
export const USAGE_WHY = {
  unknownCommand: "The requested command is not registered in this runtime.",
  unknownFlag: "A supplied flag is not part of the command usage contract.",
  missingValue: "A flag that requires a value was supplied without one.",
  conflictingFlag: "A repeated global flag supplied conflicting values.",
  arity: "The number of positional arguments does not match the command usage.",
} as const;

export function usageFailure(why: string): Result {
  return resultFor("trail.uso", { why: [why] });
}

export function internalFailure(): Result {
  return resultFor("runtime.internal_failure", {
    summary: "The operation stopped after an unexpected internal failure.",
    why: ["A sanitized runtime boundary caught an unexpected condition."],
  });
}

/** Render a typed transaction failure through the universal reason catalog. */
export function transactionFailureResult(
  error: TransactionFailureDetail,
): Result {
  if (error.reasonCode === "runtime.internal_failure") {
    return internalFailure();
  }
  return resultFor(error.reasonCode, {
    evidence: error.evidence,
    summary: "The managed transaction did not reach a committed state.",
    why: ["The durable transaction boundary reported a blocked condition."],
  });
}
