import type { ApprovalV1 } from "@kratos/contracts";

import { planOf } from "../effects.js";
import { resultFor } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type {
  CommandObservation,
  CommandSpec,
  Decision,
  Invocation,
} from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "workflow" }>;

export const approveCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["approve"],
    summary: "Record a content-bound approval or rejection for one gate.",
    flags: [
      {
        name: "--approver",
        kind: "value",
        valueLabel: "<id>",
        summary: "Record the identity making the decision.",
      },
      {
        name: "--correlation-id",
        kind: "value",
        valueLabel: "<id>",
        summary: "Use this idempotency correlation identifier.",
      },
      {
        name: "--expires-at",
        kind: "value",
        valueLabel: "<timestamp>",
        summary: "Expire the approval at this UTC instant.",
      },
      {
        name: "--observation",
        kind: "value",
        valueLabel: "<text>",
        summary: "Record a single-line review observation.",
      },
      {
        name: "--reject",
        kind: "boolean",
        summary: "Record rejection instead of approval.",
      },
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Operate on the project rooted at this path.",
      },
    ],
    positionals: { min: 1, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => decideApproval(invocation, observation),
);

function decideApproval(
  invocation: Invocation,
  observation: Observation,
): Decision {
  if (
    observation.workflow.kind !== "present" ||
    !observation.approvalsReadable ||
    observation.approvalChallenge === null
  ) {
    return refusal("runtime.state_corrupt");
  }
  const gate = invocation.positionals[0] ?? "";
  const approver = invocation.flags.get("--approver");
  const expiresAt = invocation.flags.get("--expires-at");
  const note = invocation.flags.get("--observation");
  const correlation = invocation.flags.get("--correlation-id");
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(gate) ||
    typeof approver !== "string" ||
    typeof expiresAt !== "string" ||
    typeof note !== "string" ||
    note.includes("\n") ||
    note.includes("\r") ||
    note.length === 0 ||
    note.length > 4096 ||
    !validFutureExpiry(observation.occurredAt, expiresAt) ||
    (typeof correlation === "string" &&
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(correlation))
  ) {
    return refusal("trail.uso");
  }
  const approval: ApprovalV1 = {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    approvalId:
      typeof correlation === "string" ? correlation : observation.eventId,
    runId: observation.configuration.runId,
    gate,
    decision:
      invocation.flags.get("--reject") === true ? "rejected" : "approved",
    prdDigest: observation.configuration.lineage.prdDigest,
    specDigest: observation.configuration.lineage.specDigest,
    policyVersion: "workflow-v1",
    approver,
    observation: note,
    challenge: observation.approvalChallenge,
    decidedAt: observation.occurredAt,
    expiresAt,
  };
  const path = `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}/approvals/${approval.approvalId}.json`;
  const existing = observation.approvals.find(
    ({ approvalId }) => approvalId === approval.approvalId,
  );
  if (existing !== undefined) {
    const same =
      existing.runId === approval.runId &&
      existing.gate === approval.gate &&
      existing.decision === approval.decision &&
      existing.prdDigest === approval.prdDigest &&
      existing.specDigest === approval.specDigest &&
      existing.policyVersion === approval.policyVersion &&
      existing.approver === approval.approver &&
      existing.observation === approval.observation &&
      existing.challenge === approval.challenge &&
      existing.expiresAt === approval.expiresAt;
    return same && Date.parse(existing.expiresAt) >= Date.parse(observation.occurredAt)
      ? {
          result: resultFor("trail.ok", {
            summary: `Approval ${approval.approvalId} was already recorded.`,
            stateChanged: false,
            evidence: [{ kind: "approval", ref: path }],
          }),
          plan: planOf(),
          humanStdout: null,
          payload: null,
        }
      : refusal("trail.uso");
  }
  return {
    result: resultFor("trail.ok", {
      summary: `Recorded ${approval.decision} for gate ${gate}.`,
      stateChanged: true,
      evidence: [{ kind: "approval", ref: path }],
    }),
    plan: planOf({
      kind: "write_file",
      path,
      content: `${JSON.stringify(approval, null, 2)}\n`,
    }),
    humanStdout: null,
    payload: null,
  };
}

function validFutureExpiry(now: string, expiresAt: string): boolean {
  const current = Date.parse(now);
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(current) && Number.isFinite(expiry) && expiry > current;
}

function refusal(reasonCode: "runtime.state_corrupt" | "trail.uso"): Decision {
  const evidence =
    reasonCode === "runtime.state_corrupt"
      ? [{ kind: "artifact" as const, ref: ".brain/02-features" }]
      : [];
  return {
    result: resultFor(reasonCode, {
      why: ["The approval request or its persisted context is not valid."],
      evidence,
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
