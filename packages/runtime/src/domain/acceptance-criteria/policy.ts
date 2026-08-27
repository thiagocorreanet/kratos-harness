import type {
  AcceptanceCriteriaSnapshotV1,
  AcceptanceVerdictV1,
  EvidenceV1,
} from "@kratos/contracts";
import type { AcceptanceCriterionOutcome } from "./model.js";

export type AcceptancePhase =
  "prd" | "spec" | "plan" | "code" | "review" | "acceptance";

export interface FrozenCriterion {
  readonly criterionId: string;
  readonly workUnit: string;
  readonly task: string;
  readonly kind: "main" | "edge";
  readonly ordinal: number;
  readonly declarationDigest: string;
}

export interface CurrentCriterion extends FrozenCriterion {
  readonly checked: boolean;
}

export type CriteriaChangeDecision =
  | { readonly kind: "unchanged" }
  | { readonly kind: "append"; readonly appendedIds: readonly string[] }
  | {
      readonly kind: "refused";
      readonly reasonCode:
        | "gate.ac_declaration_changed"
        | "gate.ac_append_forbidden"
        | "gate.ac_checkbox_forbidden";
      readonly criterionId: string;
    };

export function compareCriteriaSnapshot(request: {
  readonly phase: AcceptancePhase;
  readonly frozen: readonly FrozenCriterion[];
  readonly current: readonly CurrentCriterion[];
  readonly latestOutcomes?: ReadonlyMap<string, AcceptanceCriterionOutcome>;
}): CriteriaChangeDecision {
  const sharedLength = Math.min(request.frozen.length, request.current.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const frozen = request.frozen.at(index);
    const current = request.current.at(index);
    if (frozen === undefined || current === undefined) continue;
    if (!sameDeclaration(frozen, current)) {
      return {
        kind: "refused",
        reasonCode: "gate.ac_declaration_changed",
        criterionId: frozen.criterionId,
      };
    }
  }
  if (request.current.length < request.frozen.length) {
    const removed = request.frozen.at(request.current.length);
    if (removed === undefined) return { kind: "unchanged" };
    return {
      kind: "refused",
      reasonCode: "gate.ac_declaration_changed",
      criterionId: removed.criterionId,
    };
  }

  for (const criterion of request.current) {
    const expected =
      request.latestOutcomes?.get(criterion.criterionId) === "passed";
    if (criterion.checked !== expected) {
      return {
        kind: "refused",
        reasonCode: "gate.ac_checkbox_forbidden",
        criterionId: criterion.criterionId,
      };
    }
  }

  if (request.current.length === request.frozen.length)
    return { kind: "unchanged" };
  const appended = request.current.slice(request.frozen.length);
  const firstAppended = appended.at(0);
  if (firstAppended === undefined) return { kind: "unchanged" };
  if (request.phase !== "acceptance") {
    return {
      kind: "refused",
      reasonCode: "gate.ac_append_forbidden",
      criterionId: firstAppended.criterionId,
    };
  }
  return {
    kind: "append",
    appendedIds: appended.map(({ criterionId }) => criterionId),
  };
}

function sameDeclaration(
  left: FrozenCriterion,
  right: FrozenCriterion,
): boolean {
  return (
    left.criterionId === right.criterionId &&
    left.workUnit === right.workUnit &&
    left.task === right.task &&
    left.kind === right.kind &&
    left.ordinal === right.ordinal &&
    left.declarationDigest === right.declarationDigest
  );
}

export interface ReportedCriterion {
  readonly criterionId: string;
  readonly outcome: AcceptanceCriterionOutcome;
  readonly evidenceRef: string;
}

export interface BoundCriterionVerdict {
  readonly criterionId: string;
  readonly outcome: AcceptanceCriterionOutcome;
  readonly evidenceId: string;
  readonly evidenceRef: string;
  readonly evidenceDigest: string;
}

export type AcceptanceVerdictDecision =
  | {
      readonly kind: "refused";
      readonly reasonCode:
        | "gate.ac_verdict_mismatch"
        | "gate.ac_evidence_missing"
        | "gate.ac_evidence_invalid";
      readonly criterionId: string;
    }
  | {
      readonly kind: "accepted";
      readonly criteria: readonly BoundCriterionVerdict[];
      readonly checkboxOutcomes: ReadonlyMap<
        string,
        AcceptanceCriterionOutcome
      >;
    };

export function decideAcceptanceVerdict(request: {
  readonly declarations: readonly { readonly criterionId: string }[];
  readonly globalVerdict: "accepted" | "rejected";
  readonly criteria: readonly ReportedCriterion[];
  readonly evidence: readonly EvidenceV1[];
  readonly invalidEvidenceIds?: readonly string[];
}): AcceptanceVerdictDecision {
  const declared = new Set(
    request.declarations.map(({ criterionId }) => criterionId),
  );
  const reports = new Map<string, ReportedCriterion>();
  for (const report of request.criteria) {
    if (!declared.has(report.criterionId) || reports.has(report.criterionId)) {
      return {
        kind: "refused",
        reasonCode: "gate.ac_verdict_mismatch",
        criterionId: report.criterionId,
      };
    }
    reports.set(report.criterionId, report);
  }
  const evidenceByRef = new Map(
    request.evidence.map((item) => [item.ref, item]),
  );
  const invalid = new Set(request.invalidEvidenceIds ?? []);
  const bound: BoundCriterionVerdict[] = [];
  for (const declaration of request.declarations) {
    const report = reports.get(declaration.criterionId);
    if (report === undefined) {
      return {
        kind: "refused",
        reasonCode: "gate.ac_verdict_mismatch",
        criterionId: declaration.criterionId,
      };
    }
    const evidence = evidenceByRef.get(report.evidenceRef);
    if (evidence === undefined) {
      return {
        kind: "refused",
        reasonCode: "gate.ac_evidence_missing",
        criterionId: declaration.criterionId,
      };
    }
    if (invalid.has(evidence.evidenceId)) {
      return {
        kind: "refused",
        reasonCode: "gate.ac_evidence_invalid",
        criterionId: declaration.criterionId,
      };
    }
    bound.push({
      criterionId: declaration.criterionId,
      outcome: report.outcome,
      evidenceId: evidence.evidenceId,
      evidenceRef: evidence.ref,
      evidenceDigest: evidence.sha256,
    });
  }
  const allPassed = bound.every(({ outcome }) => outcome === "passed");
  if ((request.globalVerdict === "accepted") !== allPassed) {
    return {
      kind: "refused",
      reasonCode: "gate.ac_verdict_mismatch",
      criterionId:
        bound.find(({ outcome }) => outcome !== "passed")?.criterionId ??
        bound.at(0)?.criterionId ??
        "AC-0.0.0",
    };
  }
  return {
    kind: "accepted",
    criteria: bound,
    checkboxOutcomes: new Map(
      bound.map(({ criterionId, outcome }) => [criterionId, outcome]),
    ),
  };
}

export function buildCriteriaSnapshot(
  input: Omit<
    AcceptanceCriteriaSnapshotV1,
    "contractVersion" | "stateContract"
  >,
): AcceptanceCriteriaSnapshotV1 {
  return { contractVersion: "1.0.0", stateContract: "1.0.0", ...input };
}

export function buildAcceptanceVerdict(
  input: Omit<AcceptanceVerdictV1, "contractVersion" | "stateContract">,
): AcceptanceVerdictV1 {
  return { contractVersion: "1.0.0", stateContract: "1.0.0", ...input };
}

export function isLegacyPlanBaseline(input: {
  readonly documentRef: string;
  readonly documentDigest: string;
  readonly event: {
    readonly eventType: string;
    readonly reasonCode: string;
    readonly operation: string;
    readonly artifactRefs: readonly string[];
  };
  readonly lineage: {
    readonly artifactRef?: unknown;
    readonly artifactDigest?: unknown;
    readonly phase?: unknown;
    readonly producerCommand?: unknown;
  };
}): boolean {
  return (
    input.event.eventType === "transition" &&
    input.event.reasonCode === "run.transition.accepted" &&
    input.event.artifactRefs.includes(input.documentRef) &&
    input.lineage.artifactRef === input.documentRef &&
    input.lineage.artifactDigest === input.documentDigest &&
    input.lineage.phase === "plan" &&
    input.lineage.producerCommand === input.event.operation
  );
}

export function findLegacyPlanBaselineIndex(input: {
  readonly documentRef: string;
  readonly documentDigest: string;
  readonly candidates: readonly {
    readonly event: Parameters<typeof isLegacyPlanBaseline>[0]["event"];
    readonly lineage: Parameters<typeof isLegacyPlanBaseline>[0]["lineage"];
  }[];
}): number {
  return input.candidates.findIndex(({ event, lineage }) =>
    isLegacyPlanBaseline({
      documentRef: input.documentRef,
      documentDigest: input.documentDigest,
      event,
      lineage,
    }),
  );
}
