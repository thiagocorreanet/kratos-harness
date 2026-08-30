import type { AgentOutputV1_2 } from "@kratos/contracts";

import type { ValidationDiagnostic } from "../schema/index.js";

/**
 * The agents that may address the runtime, one per run phase.
 *
 * Kept as its own list rather than reused from `RUN_PHASES` because the two
 * answer different questions: `RUN_PHASES` is the order a run walks, and this
 * is who is allowed to speak. They coincide today, and a test asserts that
 * they still do, which is what makes the coincidence a decision rather than an
 * accident.
 */
export const AGENTS = [
  "prd",
  "spec",
  "plan",
  "code",
  "review",
  "acceptance",
] as const;

export type Agent = (typeof AGENTS)[number];

/** What the agent says about itself. */
export const AGENT_STATUSES = [
  "completed",
  "awaiting-input",
  "blocked",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * What the agent suggests the runtime does next.
 *
 * A hint, never a decision. The runtime reads it alongside the gates and the
 * recorded state; an agent that says `proceed` past a failing gate is
 * describing its own view, not authorizing a transition.
 */
export const ROUTING_HINTS = [
  "proceed",
  "wait",
  "retry",
  "finish",
  "stop",
] as const;

export type RoutingHint = (typeof ROUTING_HINTS)[number];

/**
 * The one delimiter that marks the machine block.
 *
 * Deliberately not a Markdown fence. A reply is allowed to contain fenced
 * examples, including fenced JSON and fenced examples of this very contract,
 * and a fence-shaped delimiter would make the extractor's answer depend on
 * what the surrounding prose happened to illustrate. These two lines have no
 * meaning in Markdown, so nothing renders them by accident.
 */
export const AGENT_BLOCK_OPEN = "===KRATOS-AGENT-OUTPUT-V1===";
export const AGENT_BLOCK_CLOSE = "===END-KRATOS-AGENT-OUTPUT-V1===";

/**
 * The largest machine block the extractor will read, in code units.
 *
 * Extraction runs on untrusted model output on every phase completion, so the
 * work it can be asked to do is bounded before the parser sees it rather than
 * after.
 */
export const MAX_BLOCK_LENGTH = 262_144;

/** Every way a block can be present and still unusable before parsing. */
export type BlockMalformation =
  | "block-too-large"
  | "duplicate-close"
  | "duplicate-open"
  | "empty-block"
  | "invalid-json"
  | "misordered"
  | "non-object"
  | "trailing-content"
  | "unopened"
  | "unterminated";

/**
 * What the extractor found in one reply.
 *
 * Three exits, because a caller acts differently on each: nothing was emitted,
 * something was emitted that is not a block, and a block was emitted. Schema
 * validity is a separate question asked afterwards, on the value this carries.
 */
export type BlockExtraction =
  | { readonly kind: "absent" }
  | { readonly kind: "malformed"; readonly reason: BlockMalformation }
  | {
      readonly kind: "extracted";
      /** The parsed document, still untrusted and not yet validated. */
      readonly value: unknown;
      /** Exactly the characters between the delimiters, for digesting. */
      readonly text: string;
    };

/** One sentence per malformation, so every surface reports the same cause. */
export function describeBlockMalformation(reason: BlockMalformation): string {
  switch (reason) {
    case "block-too-large":
      return `The machine block exceeds the ${String(MAX_BLOCK_LENGTH)} character limit.`;
    case "duplicate-close":
      return "The reply closes the machine block more than once.";
    case "duplicate-open":
      return "The reply opens the machine block more than once.";
    case "empty-block":
      return "The machine block carries no content.";
    case "invalid-json":
      return "The machine block is not a single JSON document.";
    case "misordered":
      return "The machine block closes before it opens.";
    case "non-object":
      return "The machine block carries a JSON value that is not an object.";
    case "trailing-content":
      return "The reply continues after the machine block closes.";
    case "unopened":
      return "The reply closes a machine block it never opened.";
    case "unterminated":
      return "The reply opens a machine block it never closes.";
  }
}

/**
 * What the runtime found where one agent reply was expected.
 *
 * A reply is untrusted model output, so absence, malformation, and schema
 * invalidity are three different answers, and each names a different thing for
 * the caller to fix.
 */
export type AgentOutputObservation =
  | { readonly kind: "none" }
  | { readonly kind: "unreadable"; readonly ref: string }
  | { readonly kind: "absent"; readonly ref: string }
  | {
      readonly kind: "malformed";
      readonly ref: string;
      readonly reason: BlockMalformation;
    }
  | {
      readonly kind: "invalid";
      readonly ref: string;
      readonly diagnostics: readonly ValidationDiagnostic[];
    }
  | {
      readonly kind: "valid";
      readonly ref: string;
      readonly value: AgentOutputV1_2;
    };

/** Name the first thing the block got wrong, without quoting its content. */
export function describeAgentOutputFailure(
  observation: Extract<AgentOutputObservation, { readonly kind: "invalid" }>,
): string {
  const first = observation.diagnostics[0];
  if (first === undefined) {
    return "The machine block does not satisfy the published agent output contract.";
  }
  // The pointer is rendered as a dotted path rather than a JSON pointer: the
  // result contract refuses publishable text that reads as a filesystem path,
  // and a leading slash is exactly that.
  const location = first.pointer.split("/").filter(Boolean).join(".");
  return `The machine block violates ${first.contract}@${first.version ?? "unknown"} at ${
    location === "" ? "the document root" : location
  } (${first.keyword}).`;
}
