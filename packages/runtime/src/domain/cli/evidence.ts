import { planOf } from "../effects.js";
import { recordEvidence } from "../evidence/index.js";
import { resultFor } from "../result/index.js";

import { observingCommand } from "./observed.js";
import type {
  CommandObservation,
  CommandSpec,
  Decision,
  Invocation,
} from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "workflow" }>;

const KINDS = new Set(["artifact", "event", "approval", "test", "observation"]);
const CLASSIFICATIONS = new Set(["public", "internal", "restricted"]);
const REDACTIONS = new Set(["none", "metadata-only", "redacted"]);

export const evidenceRecordCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["evidence", "record"],
    summary: "Record digest-bound evidence for the active run.",
    flags: [
      {
        name: "--classification",
        kind: "value",
        valueLabel: "<public|internal|restricted>",
        summary: "Classify the evidence before it is persisted.",
      },
      {
        name: "--correlation-id",
        kind: "value",
        valueLabel: "<id>",
        summary: "Use this idempotency correlation identifier.",
      },
      {
        name: "--kind",
        kind: "value",
        valueLabel: "<kind>",
        summary: "Classify the evidence as an artifact, event, approval, test, or observation.",
      },
      {
        name: "--redaction",
        kind: "value",
        valueLabel: "<none|metadata-only|redacted>",
        summary: "Record the redaction treatment applied to the referenced content.",
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
  (invocation, observation) => decideEvidence(invocation, observation),
);

function decideEvidence(
  invocation: Invocation,
  observation: Observation,
): Decision {
  if (observation.workflow.kind !== "present" || !observation.evidenceReadable) {
    return refusal("runtime.state_corrupt");
  }
  const ref = invocation.positionals[0] ?? "";
  const source = observation.referencedFiles.find((file) => file.ref === ref);
  const kind = invocation.flags.get("--kind") ?? "observation";
  const classification = invocation.flags.get("--classification") ?? "internal";
  const redaction = invocation.flags.get("--redaction") ?? "none";
  const correlation = invocation.flags.get("--correlation-id");
  if (
    source === undefined ||
    typeof kind !== "string" ||
    !KINDS.has(kind) ||
    typeof classification !== "string" ||
    !CLASSIFICATIONS.has(classification) ||
    typeof redaction !== "string" ||
    !REDACTIONS.has(redaction) ||
    (classification === "restricted" && redaction === "none") ||
    (typeof correlation === "string" &&
      !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(correlation))
  ) {
    return refusal("trail.uso");
  }
  const evidence = recordEvidence(
    {
      evidenceId:
        typeof correlation === "string" ? correlation : observation.eventId,
      kind: kind as "artifact" | "event" | "approval" | "test" | "observation",
      ref,
      content: source.content,
      classification: classification as "public" | "internal" | "restricted",
      redaction: redaction as "none" | "metadata-only" | "redacted",
      recordedAt: observation.occurredAt,
    },
    { sha256: () => source.sha256 },
  );
  const path = `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}/evidence/${evidence.evidenceId}.json`;
  const existing = observation.evidence.find(
    ({ evidenceId }) => evidenceId === evidence.evidenceId,
  );
  if (existing !== undefined) {
    const same =
      existing.kind === evidence.kind &&
      existing.ref === evidence.ref &&
      existing.sha256 === evidence.sha256 &&
      existing.classification === evidence.classification &&
      existing.redaction === evidence.redaction;
    return same
      ? {
          result: resultFor("trail.ok", {
            summary: `Evidence ${evidence.evidenceId} was already recorded.`,
            stateChanged: false,
            evidence: [{ kind: "artifact", ref: path }],
          }),
          plan: planOf(),
          humanStdout: null,
          payload: null,
        }
      : refusal("trail.uso");
  }
  return {
    result: resultFor("trail.ok", {
      summary: `Recorded ${evidence.kind} evidence ${evidence.evidenceId}.`,
      stateChanged: true,
      evidence: [{ kind: "artifact", ref: path }],
    }),
    plan: planOf({
      kind: "write_file",
      path,
      content: `${JSON.stringify(evidence, null, 2)}\n`,
    }),
    humanStdout: null,
    payload: null,
  };
}

function refusal(reasonCode: "runtime.state_corrupt" | "trail.uso"): Decision {
  const evidence =
    reasonCode === "runtime.state_corrupt"
      ? [{ kind: "artifact" as const, ref: ".brain/02-features" }]
      : [];
  return {
    result: resultFor(reasonCode, {
      why: ["The evidence request or referenced content is not valid."],
      evidence,
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}
