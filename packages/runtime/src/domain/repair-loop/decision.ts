import { isAcceptanceCriterionId } from "@kratos/contracts";

import type {
  RepairLoopCandidate,
  RepairLoopDecision,
  RepairLoopFault,
} from "./model.js";

const validPositiveInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

function refused(
  reason: Extract<RepairLoopDecision, { readonly kind: "refused" }>["reason"],
  criterionId?: string,
): RepairLoopDecision {
  return {
    kind: "refused",
    reason,
    ...(criterionId === undefined ? {} : { criterionId }),
  };
}

function validFault(fault: RepairLoopFault): boolean {
  const classification: unknown = fault.classification;
  const hasControlCharacter = Array.from(fault.diagnosis).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  return (
    isAcceptanceCriterionId(fault.criterionId) &&
    (classification === "code" || classification === "specification") &&
    fault.diagnosis.trim().length > 0 &&
    fault.diagnosis.length <= 2048 &&
    !hasControlCharacter
  );
}

/** Decide one complete acceptance verdict without mutating replay state. */
export function decideRepairLoop(
  candidate: RepairLoopCandidate,
): RepairLoopDecision {
  if (!validPositiveInteger(candidate.attemptCeiling)) {
    return refused("invalid-ceiling");
  }

  const prior = new Map<string, number>();
  for (const attempt of candidate.attempts) {
    if (
      !isAcceptanceCriterionId(attempt.criterionId) ||
      !validPositiveInteger(attempt.attempt)
    ) {
      return refused("invalid-attempt", attempt.criterionId);
    }
    if (prior.has(attempt.criterionId)) {
      return refused("duplicate-criterion", attempt.criterionId);
    }
    if (attempt.attempt >= candidate.attemptCeiling) {
      return refused("active-stop", attempt.criterionId);
    }
    prior.set(attempt.criterionId, attempt.attempt);
  }

  const criteria = new Set<string>();
  for (const criterion of candidate.criteria) {
    const outcome: unknown = criterion.outcome;
    if (
      !isAcceptanceCriterionId(criterion.criterionId) ||
      (outcome !== "passed" && outcome !== "failed")
    ) {
      return refused("invalid-criterion", criterion.criterionId);
    }
    if (criteria.has(criterion.criterionId)) {
      return refused("duplicate-criterion", criterion.criterionId);
    }
    criteria.add(criterion.criterionId);
  }

  const faults = new Map<string, RepairLoopFault>();
  for (const fault of candidate.faults) {
    if (!validFault(fault)) return refused("invalid-fault", fault.criterionId);
    if (faults.has(fault.criterionId)) {
      return refused("invalid-fault", fault.criterionId);
    }
    faults.set(fault.criterionId, fault);
  }

  const attempts = candidate.criteria.flatMap((criterion) => {
    if (criterion.outcome !== "failed") return [];
    return [
      {
        criterionId: criterion.criterionId,
        attempt: (prior.get(criterion.criterionId) ?? 0) + 1,
      },
    ];
  });
  if (attempts.length === 0) {
    const unexpected = candidate.faults[0];
    return unexpected === undefined
      ? { kind: "passed", attempts: [...candidate.attempts] }
      : refused("unexpected-fault", unexpected.criterionId);
  }

  const tripping = attempts.filter(
    ({ attempt }) => attempt >= candidate.attemptCeiling,
  );
  for (const attempt of tripping) {
    if (!faults.has(attempt.criterionId)) {
      return refused("missing-fault", attempt.criterionId);
    }
  }
  for (const fault of candidate.faults) {
    if (
      !tripping.some(({ criterionId }) => criterionId === fault.criterionId)
    ) {
      return refused("unexpected-fault", fault.criterionId);
    }
  }
  if (tripping.length === 0) return { kind: "repair", attempts };

  return {
    kind: "stopped",
    attempts,
    stops: tripping.map(({ criterionId, attempt }) => {
      const fault = faults.get(criterionId);
      if (fault === undefined) throw new Error("Missing validated fault");
      return { ...fault, attempt };
    }),
  };
}
