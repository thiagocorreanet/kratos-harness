import type { ApprovalV1 } from "@kratos/contracts";

import type { Digests } from "../../ports/index.js";
import { canonicalizeJson } from "../schema/index.js";

export interface ApprovalBinding {
  readonly runId: string;
  readonly gate: string;
  readonly prdDigest: string;
  readonly specDigest: string;
  readonly policyVersion: string;
  readonly policyMode: string;
  readonly objectiveDigest: string;
  readonly revision: number;
}

export interface ApprovalRequest extends ApprovalBinding {
  readonly approvalId: string;
  readonly decision: ApprovalV1["decision"];
  readonly approver: string;
  readonly observation: string;
  readonly decidedAt: string;
  readonly expiresAt: string;
}

export type ApprovalValidation =
  | { readonly kind: "valid"; readonly approval: ApprovalV1 }
  | {
      readonly kind:
        | "expired"
        | "rejected"
        | "replayed"
        | "stale"
        | "tampered";
    };

export function approvalChallenge(
  binding: ApprovalBinding,
  digests: Pick<Digests, "sha256">,
): string {
  return digests.sha256(
    canonicalizeJson({
      gate: binding.gate,
      policyVersion: binding.policyVersion,
      policyMode: binding.policyMode,
      objectiveDigest: binding.objectiveDigest,
      prdDigest: binding.prdDigest,
      runId: binding.runId,
      revision: binding.revision,
      specDigest: binding.specDigest,
    }),
  );
}

export function issueApproval(
  request: ApprovalRequest,
  digests: Pick<Digests, "sha256">,
): ApprovalV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    approvalId: request.approvalId,
    runId: request.runId,
    gate: request.gate,
    decision: request.decision,
    prdDigest: request.prdDigest,
    specDigest: request.specDigest,
    policyVersion: request.policyVersion,
    approver: request.approver,
    observation: request.observation,
    challenge: approvalChallenge(request, digests),
    decidedAt: request.decidedAt,
    expiresAt: request.expiresAt,
  };
}

export function validateApproval(
  approval: ApprovalV1,
  binding: ApprovalBinding,
  now: string,
  seenApprovalIds: ReadonlySet<string>,
  digests: Pick<Digests, "sha256">,
): ApprovalValidation {
  if (seenApprovalIds.has(approval.approvalId)) return { kind: "replayed" };
  if (
    approval.runId !== binding.runId ||
    approval.gate !== binding.gate ||
    approval.prdDigest !== binding.prdDigest ||
    approval.specDigest !== binding.specDigest ||
    approval.policyVersion !== binding.policyVersion
  ) {
    return { kind: "stale" };
  }
  if (approval.challenge !== approvalChallenge(binding, digests)) {
    return { kind: "tampered" };
  }
  const observed = Date.parse(now);
  const decided = Date.parse(approval.decidedAt);
  const expires = Date.parse(approval.expiresAt);
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(decided) ||
    !Number.isFinite(expires) ||
    decided > observed ||
    expires < observed ||
    expires < decided
  ) {
    return { kind: "expired" };
  }
  if (approval.decision !== "approved") return { kind: "rejected" };
  return { kind: "valid", approval };
}
