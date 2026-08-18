import type { ApprovalV1 } from "@kratos/contracts";

import type {
  GateContext,
  GateDecision,
  GateFailure,
  GateId,
} from "./model.js";

const PRIORITY: Readonly<Record<GateId, number>> = {
  "context-readable": 10,
  "stop-loss": 20,
  "prd-present": 30,
  "spec-approved": 40,
  "gaps-closed": 50,
  "partition-approved": 60,
  "final-acceptance": 70,
};

function failure(
  gateId: GateId,
  reasonCode: GateFailure["reasonCode"],
  evidenceRefs: readonly string[],
  detail: string | null = null,
): GateFailure {
  return {
    gateId,
    reasonCode,
    priority: PRIORITY[gateId],
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

/** Pure, ordered policy evaluation. No evaluator reads time, disk, Git, or I/O. */
export function evaluateGates(context: GateContext): GateDecision {
  const failures: GateFailure[] = [];
  if (!context.contextReadable) {
    failures.push(
      failure("context-readable", "blocked.context_unreadable", [
        ".brain/config.json",
      ]),
    );
  }
  if (context.stopLoss.tripped) {
    failures.push(
      failure("stop-loss", "blocked.stop_loss_flag", [
        ".brain/03-memory/task_metrics.md",
      ]),
    );
  } else if (context.stopLoss.exhausted) {
    failures.push(
      failure("stop-loss", "blocked.stop_loss_budget", [
        ".brain/03-memory/task_metrics.md",
      ]),
    );
  }
  if (context.prdDocument.kind === "missing") {
    failures.push(
      failure("prd-present", "gate.prd_ausente", [".brain/02-features/active"]),
    );
  } else if (context.prdDocument.kind === "untouched") {
    failures.push(
      failure("prd-present", "gate.prd_untouched", [
        ".brain/02-features/active",
      ]),
    );
  } else if (context.prdDocument.kind === "incomplete") {
    failures.push(
      failure(
        "prd-present",
        "gate.prd_section_missing",
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
      failure("spec-approved", "gate.aprovacao_spec", [".brain/approvals"]),
    );
  }
  if (context.openGaps > 0) {
    failures.push(
      failure("gaps-closed", "gate.gaps_abertos", [
        ".brain/02-features/active",
      ]),
    );
  }
  if (context.partitionRequired && !context.partitionApproved) {
    failures.push(
      failure("partition-approved", "gate.particionamento", [
        ".brain/approvals",
      ]),
    );
  }
  if (context.phase === "acceptance" && !context.finalAcceptance) {
    failures.push(
      failure("final-acceptance", "gate.aceitacao_final", [".brain/approvals"]),
    );
  }
  failures.sort(
    (left, right) =>
      left.priority - right.priority ||
      left.gateId.localeCompare(right.gateId, "en-US"),
  );
  const immutable = Object.freeze(failures.map((item) => Object.freeze(item)));
  return {
    outcome:
      failures.length === 0
        ? "pass"
        : context.mode === "enforce"
          ? "block"
          : context.mode === "warn"
            ? "warn"
            : "pass",
    primary: immutable[0] ?? null,
    failures: immutable,
    mode: context.mode,
  };
}
