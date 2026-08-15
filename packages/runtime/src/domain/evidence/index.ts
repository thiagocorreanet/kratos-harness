import type { EvidenceV1 } from "@kratos/contracts";

import type { Digests } from "../../ports/index.js";

export interface EvidenceRequest {
  readonly evidenceId: string;
  readonly kind: EvidenceV1["kind"];
  readonly ref: string;
  readonly content: string;
  readonly classification: EvidenceV1["classification"];
  readonly redaction: EvidenceV1["redaction"];
  readonly recordedAt: string;
}

export interface HandoffManifest {
  readonly contractVersion: "1.0.0";
  readonly runId: string;
  readonly fromPhase: string;
  readonly toPhase: string;
  readonly evidence: readonly Pick<
    EvidenceV1,
    "evidenceId" | "kind" | "ref" | "sha256"
  >[];
  readonly digest: string;
}

export function recordEvidence(
  request: EvidenceRequest,
  digests: Pick<Digests, "sha256">,
): EvidenceV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    evidenceId: request.evidenceId,
    kind: request.kind,
    ref: request.ref,
    sha256: digests.sha256(request.content),
    classification: request.classification,
    redaction: request.redaction,
    recordedAt: request.recordedAt,
  };
}

export function verifyEvidence(
  evidence: EvidenceV1,
  content: string,
  digests: Pick<Digests, "sha256">,
): "valid" | "digest-mismatch" | "redaction-policy-invalid" {
  if (
    evidence.classification === "restricted" &&
    evidence.redaction === "none"
  ) {
    return "redaction-policy-invalid";
  }
  return evidence.sha256 === digests.sha256(content)
    ? "valid"
    : "digest-mismatch";
}

export function buildHandoff(
  input: {
    readonly runId: string;
    readonly fromPhase: string;
    readonly toPhase: string;
    readonly evidence: readonly EvidenceV1[];
  },
  digests: Pick<Digests, "sha256">,
): HandoffManifest {
  const evidence = input.evidence
    .map(({ evidenceId, kind, ref, sha256 }) => ({
      evidenceId,
      kind,
      ref,
      sha256,
    }))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  const body = JSON.stringify({
    contractVersion: "1.0.0",
    evidence,
    fromPhase: input.fromPhase,
    runId: input.runId,
    toPhase: input.toPhase,
  });
  return {
    contractVersion: "1.0.0",
    runId: input.runId,
    fromPhase: input.fromPhase,
    toPhase: input.toPhase,
    evidence,
    digest: digests.sha256(body),
  };
}
