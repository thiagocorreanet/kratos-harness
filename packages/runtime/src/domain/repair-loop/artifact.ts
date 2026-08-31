import type {
  AcceptanceDecisionMetadata,
  RepairLoopDecision,
  RepairLoopStopBinding,
  RepairLoopStopArtifact,
  RepairLoopStopArtifactInput,
  RepairResolutionArtifact,
  RepairResolutionArtifactInput,
  RepairRestartArtifact,
  RepairRestartArtifactInput,
} from "./model.js";
import { isAcceptanceCriterionId } from "@kratos/contracts";

const id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const sha256 = /^[a-f0-9]{64}$/u;
const reference =
  // eslint-disable-next-line no-control-regex -- persisted references cannot contain control bytes.
  /^(?!\/)(?![A-Za-z]:[\\/])(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))(?![a-z][a-z0-9+.-]*:\/\/)[^\u0000-\u001f\u007f]{1,1024}$/u;
// eslint-disable-next-line no-control-regex -- reject every ASCII control byte in a human note.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const timestamp =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/u;

/** Build the immutable diagnosis record whose digest is carried by an event. */
export function buildRepairLoopStop(
  input: RepairLoopStopArtifactInput,
): RepairLoopStopArtifact {
  return Object.freeze({
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    ...input,
  });
}

/** Bind a pure loop decision to immutable stop artifact references. */
export function buildAcceptanceDecisionMetadata(
  decision: Exclude<RepairLoopDecision, { readonly kind: "refused" }>,
  bindings: readonly RepairLoopStopBinding[],
): AcceptanceDecisionMetadata {
  if (decision.kind !== "stopped") {
    if (bindings.length !== 0) {
      throw new Error("Repair stop bindings are unexpected");
    }
    return {
      outcome: decision.kind === "passed" ? "passed" : "repair",
      attempts: decision.kind === "passed" ? [] : [...decision.attempts],
      repairStops: [],
    };
  }

  const byCriterion = new Map(
    bindings.map((binding) => [binding.criterionId, binding]),
  );
  if (byCriterion.size !== decision.stops.length) {
    throw new Error("Repair stop bindings are incomplete");
  }
  return {
    outcome: "stopped",
    attempts: [...decision.attempts],
    repairStops: decision.stops.map((stop) => {
      const binding = byCriterion.get(stop.criterionId);
      if (binding === undefined) {
        throw new Error("Repair stop binding is missing");
      }
      return {
        criterionId: stop.criterionId,
        attempt: stop.attempt,
        classification: stop.classification,
        artifactRef: binding.artifactRef,
        artifactDigest: binding.artifactDigest,
      };
    }),
  };
}

export function buildRepairResolution(
  input: RepairResolutionArtifactInput,
): RepairResolutionArtifact {
  const classification: unknown = input.classification;
  if (
    !id.test(input.resolutionId) ||
    !id.test(input.runId) ||
    !isAcceptanceCriterionId(input.criterionId) ||
    (classification !== "code" && classification !== "specification") ||
    !reference.test(input.stopRef) ||
    !sha256.test(input.stopDigest) ||
    !id.test(input.resolvedBy) ||
    input.observation.trim().length < 1 ||
    input.observation.length > 2048 ||
    CONTROL_CHARACTERS.test(input.observation) ||
    !timestamp.test(input.resolvedAt) ||
    (input.nextRunId !== null && !id.test(input.nextRunId)) ||
    (classification === "code") !== (input.nextRunId === null)
  ) {
    throw new Error("Invalid repair resolution artifact");
  }
  return Object.freeze({
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    ...input,
  });
}

export function buildRepairRestartTicket(
  input: RepairRestartArtifactInput,
): RepairRestartArtifact {
  if (
    !id.test(input.ticketId) ||
    !id.test(input.sourceRunId) ||
    !id.test(input.nextRunId) ||
    input.sourceRunId === input.nextRunId ||
    !reference.test(input.resolutionRef) ||
    !sha256.test(input.resolutionDigest) ||
    input.retiredCriterionIds.length === 0 ||
    input.retiredCriterionIds.length > 256 ||
    new Set(input.retiredCriterionIds).size !==
      input.retiredCriterionIds.length ||
    !input.retiredCriterionIds.every(isAcceptanceCriterionId) ||
    !timestamp.test(input.createdAt)
  ) {
    throw new Error("Invalid repair restart ticket");
  }
  const [firstCriterionId, ...remainingCriterionIds] =
    input.retiredCriterionIds;
  const retiredCriterionIds: [string, ...string[]] = [
    firstCriterionId,
    ...remainingCriterionIds,
  ];
  return Object.freeze({
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    ...input,
    retiredCriterionIds,
    startPhase: "spec",
  });
}
