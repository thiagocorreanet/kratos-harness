import type { GapProposalV1, GapRecordV1 } from "@kratos/contracts";

import type { ValidationDiagnostic } from "../schema/index.js";

/**
 * The closed set of things that count as a gap.
 *
 * A gap is a question the documents cannot answer: a rule that admits two
 * readings which produce different code, a decision only the owner can make, a
 * contradiction between two passages, or an external dependency nobody has
 * confirmed. Anything outside this set is a task, not a gap, and the schema
 * refuses it rather than letting it inflate the count a gate reads.
 */
export const GAP_CATEGORIES = [
  "ambiguous-rule",
  "document-contradiction",
  "owner-decision",
  "unconfirmed-dependency",
] as const;

export type GapCategory = (typeof GAP_CATEGORIES)[number];

/** Where the argument is worth having, not how hard the work is. */
export const GAP_WEIGHTS = ["high", "medium", "low"] as const;

export type GapWeight = (typeof GAP_WEIGHTS)[number];

/**
 * The phases in which a gap can be detected.
 *
 * Detection stops at specification approval. After it the remaining questions
 * are technical by construction, and a technical question is not a gap.
 */
export const GAP_PHASES = ["prd", "spec"] as const;

export type GapPhase = (typeof GAP_PHASES)[number];

export type ApprovalBoundary = "pre-approval" | "post-approval";

export type GapVerdict = NonNullable<GapRecordV1["resolution"]>["decision"];

/**
 * Bounds on one proposal.
 *
 * The schema states the shape; these state the size. Keeping the limit here
 * rather than in the schema is what lets a caller learn which limit it crossed
 * instead of reading a tuple-shaped validation error.
 */
export const MAX_PROPOSED_GAPS = 64;
export const MAX_DOCUMENT_REFS = 16;

export type GapRefusal =
  | "conflicting-gap"
  | "conflicting-verdict"
  | "document-ref-limit"
  | "duplicate-proposal-id"
  | "gap-limit"
  | "invalid-request"
  | "post-approval"
  | "unknown-gap";

/** One sentence per refusal, so every surface reports the same cause. */
export function describeGapRefusal(reason: GapRefusal): string {
  switch (reason) {
    case "conflicting-gap":
      return "A gap with this identifier was already recorded with different content.";
    case "conflicting-verdict":
      return "This gap already carries a different verdict.";
    case "document-ref-limit":
      return `A gap may cite at most ${String(MAX_DOCUMENT_REFS)} document references.`;
    case "duplicate-proposal-id":
      return "The proposal repeats a gap identifier.";
    case "gap-limit":
      return `A proposal may carry at most ${String(MAX_PROPOSED_GAPS)} gaps.`;
    case "invalid-request":
      return "The request does not satisfy the published gap contract.";
    case "post-approval":
      return "Gap detection is confined to the phases before specification approval.";
    case "unknown-gap":
      return "No gap with this identifier was recorded for the active run.";
  }
}

/** A gap nobody has answered and nobody has explicitly proceeded over. */
export function isOpenGap(gap: GapRecordV1): boolean {
  return gap.resolution === null && gap.waiver === null;
}

/**
 * What the runtime found where a proposal was expected.
 *
 * A proposal is untrusted input from the model, so its absence, its
 * unreadability, and its invalidity are three different answers the owner
 * deserves to be told apart.
 */
export type GapProposalObservation =
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly ref: string }
  | {
      readonly kind: "invalid";
      readonly ref: string;
      readonly diagnostics: readonly ValidationDiagnostic[];
    }
  | {
      readonly kind: "valid";
      readonly ref: string;
      readonly value: GapProposalV1;
    };

/** Name the first thing the proposal got wrong, without quoting its content. */
export function describeProposalFailure(
  observation: Extract<GapProposalObservation, { readonly kind: "invalid" }>,
): string {
  const first = observation.diagnostics[0];
  if (first === undefined) {
    return "The proposal does not satisfy the published gap proposal contract.";
  }
  // The pointer is rendered as a dotted path rather than a JSON pointer: the
  // result contract refuses publishable text that reads as a filesystem path,
  // and a leading slash is exactly that.
  const location = first.pointer.split("/").filter(Boolean).join(".");
  return `The proposal violates ${first.contract}@${first.version ?? "unknown"} at ${
    location === "" ? "the document root" : location
  } (${first.keyword}).`;
}
