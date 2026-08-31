import type { ApprovalV1, LanguagePolicyV1 } from "@kratos/contracts";

import type {
  GateAdvisory,
  GateContext,
  GateDecision,
  GateFailure,
  GateId,
} from "./model.js";
import { GATE_PRIORITIES } from "./model.js";
import { aggregateGateFailures } from "./policy.js";

function failure(
  gateId: GateId,
  reasonCode: GateFailure["reasonCode"],
  context: GateContext,
  evidenceRefs: readonly string[],
  detail: string | null = null,
): GateFailure {
  return {
    gateId,
    reasonCode,
    priority: GATE_PRIORITIES[gateId],
    mode: context.gateModes[gateId],
    evidenceRefs,
    detail,
  };
}

function advisory(
  reasonCode: GateAdvisory["reasonCode"],
  evidenceRefs: readonly string[],
  detail: string | null = null,
  gateId?: GateId,
): GateAdvisory {
  return {
    ...(gateId !== undefined ? { gateId } : {}),
    reasonCode,
    evidenceRefs,
    detail,
  };
}

function approved(
  approvals: readonly ApprovalV1[],
  gate: string,
  context: GateContext,
): boolean {
  return approvals.some(
    (approval) =>
      approval.gate === gate &&
      approval.decision === "approved" &&
      approval.prdDigest === context.prdDigest &&
      approval.specDigest === context.specDigest,
  );
}

function expectedLanguageForArtifactType(
  policy: LanguagePolicyV1 | null | undefined,
  artifactType: string | undefined,
): string | undefined {
  if (!policy || !artifactType) return undefined;
  switch (artifactType) {
    case "conversation":
      return policy.conversation;
    case "documentation":
      return policy.documentation;
    case "comments":
      return policy.comments;
    case "identifiers":
      return policy.identifiers;
    case "commits":
      return policy.commits;
    default:
      return undefined;
  }
}

/** Pure, ordered policy evaluation. No evaluator reads time, disk, Git, or I/O. */
export function evaluateGates(context: GateContext): GateDecision {
  const failures: GateFailure[] = [];
  const advisories: GateAdvisory[] = [];

  if (!context.contextReadable) {
    failures.push(
      failure("context-readable", "blocked.context_unreadable", context, [
        ".brain/config.json",
      ]),
    );
  }
  for (const stop of context.stopLoss.repeatedRejections ?? []) {
    failures.push(
      failure(
        "stop-loss",
        "blocked.stop_loss_rejections",
        context,
        [stop.artifactRef],
        `Acceptance criterion ${stop.criterionId} stopped at attempt ${String(stop.attempt)} with classification ${stop.classification}.`,
      ),
    );
  }
  if (context.stopLoss.exhausted) {
    failures.push(
      failure("stop-loss", "blocked.stop_loss_budget", context, [
        ".brain/03-memory/task_metrics.md",
      ]),
    );
  }
  if (context.stopLoss.tripped) {
    failures.push(
      failure("stop-loss", "blocked.stop_loss_flag", context, [
        ".brain/03-memory/task_metrics.md",
      ]),
    );
  }
  if (context.prdDocument.kind === "missing") {
    failures.push(
      failure("prd-present", "gate.prd_ausente", context, [
        ".brain/02-features/active",
      ]),
    );
  } else if (context.prdDocument.kind === "untouched") {
    failures.push(
      failure("prd-present", "gate.prd_untouched", context, [
        ".brain/02-features/active",
      ]),
    );
  } else if (context.prdDocument.kind === "incomplete") {
    failures.push(
      failure(
        "prd-present",
        "gate.prd_section_missing",
        context,
        [".brain/02-features/active"],
        `Missing required section: ${context.prdDocument.missingSection}`,
      ),
    );
  }
  if (
    ["plan", "code", "review", "acceptance"].includes(context.phase) &&
    !approved(context.approvals, "spec", context)
  ) {
    failures.push(
      failure("spec-approved", "gate.aprovacao_spec", context, [
        ".brain/approvals",
      ]),
    );
  }
  if (context.openGaps > 0) {
    failures.push(
      failure("gaps-closed", "gate.gaps_abertos", context, [
        ".brain/02-features/active",
      ]),
    );
  }
  if (context.partitionRequired && !context.partitionApproved) {
    failures.push(
      failure("partition-approved", "gate.particionamento", context, [
        ".brain/approvals",
      ]),
    );
  }
  const criteria = Object.freeze(
    (context.acceptanceCriteria ?? []).map((criterion) =>
      Object.freeze({ ...criterion }),
    ),
  );
  const incomplete = criteria.find(
    ({ state, checked, evidenceValid }) =>
      state !== "passed" || !checked || !evidenceValid,
  );
  if (context.phase === "acceptance" && incomplete !== undefined) {
    failures.push(
      failure(
        "acceptance-criteria",
        "gate.ac_incomplete",
        context,
        [".brain/02-features/active"],
        `Acceptance criterion ${incomplete.criterionId} is incomplete.`,
      ),
    );
  }
  if (context.phase === "acceptance" && !context.finalAcceptance) {
    failures.push(
      failure("final-acceptance", "gate.aceitacao_final", context, [
        ".brain/approvals",
      ]),
    );
  }

  const enforcement = context.languagePolicy?.enforcement ?? "advisory";
  if (enforcement !== "off") {
    if (context.languageMismatch) {
      advisories.push(
        advisory(
          "policy.language_convention_mismatch_advisory",
          [".brain/02-features/active"],
          "Artifact language differs from declared language policy.",
        ),
      );
    }
    if (
      context.languageObservations &&
      context.languageObservations.length > 0
    ) {
      for (const obs of context.languageObservations) {
        const expectedFromPolicy = expectedLanguageForArtifactType(
          context.languagePolicy,
          obs.artifactType,
        );
        const expectedLanguage = obs.expectedLanguage ?? expectedFromPolicy;

        const isMismatch =
          obs.mismatch === true ||
          (obs.observedLanguage !== undefined &&
            expectedLanguage !== undefined &&
            obs.observedLanguage !== expectedLanguage);

        if (isMismatch) {
          const evidenceRef = obs.artifactRef ?? ".brain/02-features/active";
          const detail =
            obs.detail ??
            (obs.observedLanguage && expectedLanguage
              ? `Language divergence detected: expected '${expectedLanguage}', observed '${obs.observedLanguage}' in ${obs.artifactRef ?? "artifact"}.`
              : `Language divergence detected in ${obs.artifactRef ?? "artifact"}.`);
          advisories.push(
            advisory(
              "policy.language_convention_mismatch_advisory",
              [evidenceRef],
              detail,
            ),
          );
        }
      }
    }
  }

  const immutableAdvisories = Object.freeze(
    advisories.map((item) => Object.freeze(item)),
  );
  const aggregate = aggregateGateFailures(failures);
  return {
    ...aggregate,
    gateModes: context.gateModes,
    advisories: immutableAdvisories,
    criteria,
  };
}
