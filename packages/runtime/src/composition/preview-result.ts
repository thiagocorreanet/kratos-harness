import {
  resultFor,
  type EvidenceRef,
  type Result,
} from "../domain/result/index.js";
import type { MutationPreview, PreviewOperation } from "./index.js";

/**
 * Render a decision through the universal result envelope.
 *
 * Explanation is a projection, not an output family of its own. The envelope
 * already carries a reason, the causes behind it, and the evidence to look at;
 * a preview that invented its own shape would be one more thing to learn and
 * one more thing to keep consistent with the rest of the runtime.
 */
export function previewResult(preview: MutationPreview): Result {
  switch (preview.kind) {
    case "noop":
      // Deciding that the requested state already holds is a decision, and
      // saying so is more useful than rendering an empty plan.
      return resultFor("trail.ok", {
        summary: "The project already holds the requested state.",
        why: ["Every requested effect matches what the project already has."],
        evidence: [],
        stateChanged: false,
      });
    case "ready":
      return resultFor("trail.ok", {
        summary: `${describeCount(preview.operations.length)} would change.`,
        why: [
          "No effect was published; this is the decision, not its result.",
          `The plan this describes has digest ${preview.planDigest}.`,
        ],
        evidence: previewEvidence(preview.operations),
        stateChanged: false,
      });
    case "blocked":
      return resultFor(preview.reasonCode, {
        summary: "The project cannot commit this plan in its current state.",
        why: ["The decision stopped before any effect was computed."],
        evidence: preview.evidence,
        stateChanged: false,
      });
  }
}

function describeCount(operations: number): string {
  return operations === 1
    ? "One destination"
    : `${String(operations)} destinations`;
}

/**
 * One evidence entry per destination, carrying the digest and never the bytes.
 *
 * Sorting by path makes two renderings of the same decision byte-identical,
 * which is what lets a person compare a preview they read yesterday against
 * the one in front of them.
 */
function previewEvidence(
  operations: readonly PreviewOperation[],
): readonly EvidenceRef[] {
  return [...operations]
    .sort((left, right) => left.path.localeCompare(right.path, "en-US"))
    .map((operation) =>
      operation.result.kind === "file"
        ? {
            kind: "artifact" as const,
            ref: operation.path,
            sha256: operation.result.sha256,
          }
        : { kind: "artifact" as const, ref: operation.path },
    );
}
