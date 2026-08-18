import type { GapProposalV1, GapRecordV1 } from "@kratos/contracts";

import type { GateMode } from "../gates/index.js";

import {
  MAX_DOCUMENT_REFS,
  MAX_PROPOSED_GAPS,
  type ApprovalBoundary,
  type GapPhase,
  type GapRefusal,
  type GapVerdict,
} from "./model.js";

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const TIMESTAMP =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/u;

const MAX_TEXT_LENGTH = 2048;
const MAX_REFERENCE_LENGTH = 1024;

/**
 * Whether a value is the single-line text the published contract accepts.
 *
 * Expressed over code points rather than as a regular expression because the
 * schema counts code points too, and a length measured in UTF-16 units would
 * reject a text the contract accepts.
 */
function printableText(value: string, maximum: number): boolean {
  const points = Array.from(value);
  return (
    points.length > 0 &&
    points.length <= maximum &&
    !points.some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  );
}

export interface GapRecordRequest {
  readonly proposal: GapProposalV1;
  readonly runId: string;
  readonly phase: GapPhase;
  readonly boundary: ApprovalBoundary;
  readonly prdDigest: string;
  readonly specDigest: string;
  readonly policyMode: GateMode;
  readonly recordedAt: string;
  /** Everything the run already recorded, so recording stays idempotent. */
  readonly existing: readonly GapRecordV1[];
}

export type GapRecordDecision =
  | { readonly kind: "recorded"; readonly gaps: readonly GapRecordV1[] }
  | { readonly kind: "unchanged" }
  | { readonly kind: "refused"; readonly reason: GapRefusal };

export interface GapVerdictRequest {
  readonly gapId: string;
  readonly decision: GapVerdict;
  readonly documentChanged: boolean;
  readonly decidedBy: string;
  readonly decidedAt: string;
  readonly observation: string;
  readonly gaps: readonly GapRecordV1[];
}

export interface GapWaiverRequest {
  readonly gapId: string;
  readonly acknowledgedBy: string;
  readonly acknowledgedAt: string;
  readonly observation: string;
  readonly gaps: readonly GapRecordV1[];
}

export type GapUpdateDecision =
  | { readonly kind: "updated"; readonly gap: GapRecordV1 }
  | { readonly kind: "unchanged"; readonly gap: GapRecordV1 }
  | { readonly kind: "refused"; readonly reason: GapRefusal };

/**
 * Receive proposed gaps and decide which of them the run does not hold yet.
 *
 * The model proposes, this decides, and the gate reads what it derived. A gap
 * already on record is never rewritten: re-proposing the same content is a
 * repeat delivery, and re-proposing different content under the same
 * identifier would edit history rather than add to it.
 */
export function decideGapRecord(request: GapRecordRequest): GapRecordDecision {
  if (
    !ID.test(request.runId) ||
    !SHA256.test(request.prdDigest) ||
    !SHA256.test(request.specDigest) ||
    !TIMESTAMP.test(request.recordedAt)
  ) {
    return { kind: "refused", reason: "invalid-request" };
  }
  if (request.boundary === "post-approval") {
    return { kind: "refused", reason: "post-approval" };
  }
  const proposed = request.proposal.gaps;
  if (proposed.length > MAX_PROPOSED_GAPS) {
    return { kind: "refused", reason: "gap-limit" };
  }
  if (new Set(proposed.map(({ gapId }) => gapId)).size !== proposed.length) {
    return { kind: "refused", reason: "duplicate-proposal-id" };
  }
  if (
    proposed.some(({ documentRefs }) => documentRefs.length > MAX_DOCUMENT_REFS)
  ) {
    return { kind: "refused", reason: "document-ref-limit" };
  }
  const recorded: GapRecordV1[] = [];
  for (const gap of proposed) {
    const candidate: GapRecordV1 = {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      gapId: gap.gapId,
      runId: request.runId,
      phase: request.phase,
      category: gap.category,
      weight: gap.weight,
      description: gap.description,
      recommendation: gap.recommendation,
      reasoning: gap.reasoning,
      documentRefs: [gap.documentRefs[0], ...gap.documentRefs.slice(1)],
      prdDigest: request.prdDigest,
      specDigest: request.specDigest,
      policyMode: request.policyMode,
      recordedAt: request.recordedAt,
      resolution: null,
      waiver: null,
    };
    if (!validGap(candidate)) {
      return { kind: "refused", reason: "invalid-request" };
    }
    const existing = request.existing.find(
      ({ gapId }) => gapId === candidate.gapId,
    );
    if (existing === undefined) {
      recorded.push(candidate);
      continue;
    }
    if (!sameFinding(existing, candidate)) {
      return { kind: "refused", reason: "conflicting-gap" };
    }
  }
  if (recorded.length === 0) return { kind: "unchanged" };
  return {
    kind: "recorded",
    gaps: recorded.sort((left, right) =>
      left.gapId.localeCompare(right.gapId, "en-US"),
    ),
  };
}

/** Record what the owner decided, and whether a document changed as a result. */
export function decideGapVerdict(
  request: GapVerdictRequest,
): GapUpdateDecision {
  const gap = request.gaps.find(({ gapId }) => gapId === request.gapId);
  if (gap === undefined) return { kind: "refused", reason: "unknown-gap" };
  if (
    !ID.test(request.decidedBy) ||
    !TIMESTAMP.test(request.decidedAt) ||
    !printableText(request.observation, MAX_TEXT_LENGTH)
  ) {
    return { kind: "refused", reason: "invalid-request" };
  }
  const resolution = {
    decision: request.decision,
    documentChanged: request.documentChanged,
    decidedBy: request.decidedBy,
    decidedAt: request.decidedAt,
    observation: request.observation,
  } as const;
  if (gap.resolution !== null) {
    return sameResolution(gap.resolution, resolution)
      ? { kind: "unchanged", gap }
      : { kind: "refused", reason: "conflicting-verdict" };
  }
  return { kind: "updated", gap: { ...gap, resolution } };
}

/**
 * Record the owner proceeding over a gap nobody answered.
 *
 * A waived gap stops blocking and stays on record as unanswered, because the
 * point of the record is that the work went on with the question still open.
 */
export function decideGapWaiver(request: GapWaiverRequest): GapUpdateDecision {
  const gap = request.gaps.find(({ gapId }) => gapId === request.gapId);
  if (gap === undefined) return { kind: "refused", reason: "unknown-gap" };
  if (
    !ID.test(request.acknowledgedBy) ||
    !TIMESTAMP.test(request.acknowledgedAt) ||
    !printableText(request.observation, MAX_TEXT_LENGTH)
  ) {
    return { kind: "refused", reason: "invalid-request" };
  }
  if (gap.resolution !== null) {
    return { kind: "refused", reason: "conflicting-verdict" };
  }
  const waiver = {
    acknowledgedBy: request.acknowledgedBy,
    acknowledgedAt: request.acknowledgedAt,
    observation: request.observation,
  } as const;
  if (gap.waiver !== null) {
    return sameWaiver(gap.waiver, waiver)
      ? { kind: "unchanged", gap }
      : { kind: "refused", reason: "conflicting-verdict" };
  }
  return { kind: "updated", gap: { ...gap, waiver } };
}

function validGap(gap: GapRecordV1): boolean {
  return (
    ID.test(gap.gapId) &&
    printableText(gap.description, MAX_TEXT_LENGTH) &&
    printableText(gap.recommendation, MAX_TEXT_LENGTH) &&
    printableText(gap.reasoning, MAX_TEXT_LENGTH) &&
    gap.documentRefs.every((ref) => printableText(ref, MAX_REFERENCE_LENGTH)) &&
    new Set(gap.documentRefs).size === gap.documentRefs.length
  );
}

/**
 * Whether two records describe the same finding.
 *
 * Provenance is deliberately excluded: the same gap proposed twice under two
 * policy modes is one gap observed twice, not a contradiction.
 */
function sameFinding(left: GapRecordV1, right: GapRecordV1): boolean {
  return (
    left.runId === right.runId &&
    left.phase === right.phase &&
    left.category === right.category &&
    left.weight === right.weight &&
    left.description === right.description &&
    left.recommendation === right.recommendation &&
    left.reasoning === right.reasoning &&
    left.documentRefs.length === right.documentRefs.length &&
    left.documentRefs.every(
      (ref, index) => ref === right.documentRefs[index],
    ) &&
    left.prdDigest === right.prdDigest &&
    left.specDigest === right.specDigest
  );
}

function sameResolution(
  left: NonNullable<GapRecordV1["resolution"]>,
  right: NonNullable<GapRecordV1["resolution"]>,
): boolean {
  return (
    left.decision === right.decision &&
    left.documentChanged === right.documentChanged &&
    left.decidedBy === right.decidedBy &&
    left.observation === right.observation
  );
}

function sameWaiver(
  left: NonNullable<GapRecordV1["waiver"]>,
  right: NonNullable<GapRecordV1["waiver"]>,
): boolean {
  return (
    left.acknowledgedBy === right.acknowledgedBy &&
    left.observation === right.observation
  );
}
