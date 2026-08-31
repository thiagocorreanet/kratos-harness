import { isAcceptanceCriterionId } from "@kratos/contracts";

import { planOf } from "../effects.js";
import { resultFor } from "../result/index.js";
import {
  decideResolveRepairStop,
  decideStartWorkflow,
  workflowReducerRegistry,
} from "../workflow/index.js";

import { observingCommand } from "./observed.js";
import type { CommandSpec, Decision } from "./spec.js";

const HUMAN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
// eslint-disable-next-line no-control-regex -- reject every ASCII control byte in a human note.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function refusal(): Decision {
  return {
    result: resultFor("trail.uso", {
      why: [
        "Repair resolution requires a recorded stop, an explicit human identity, and a written observation.",
      ],
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

export const repairResolveCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["repair", "resolve"],
    summary: "Resolve one recorded repair stop with explicit human authority.",
    flags: [
      {
        name: "--correlation-id",
        kind: "value",
        valueLabel: "<id>",
        summary: "Use this idempotency correlation identifier.",
      },
      {
        name: "--next-run",
        kind: "value",
        valueLabel: "<id>",
        summary: "Name the fresh run required by a specification resolution.",
      },
      {
        name: "--observation",
        kind: "value",
        valueLabel: "<text>",
        summary: "Record the human's written resolution observation.",
      },
      {
        name: "--resolved-by",
        kind: "value",
        valueLabel: "<id>",
        summary: "Record the explicit human identity authorizing resolution.",
      },
      {
        name: "--root",
        kind: "value",
        valueLabel: "<path>",
        summary: "Operate on the project rooted at this path.",
      },
      {
        name: "--run",
        kind: "value",
        valueLabel: "<id>",
        summary: "Select the blocked source run explicitly.",
      },
    ],
    positionals: { min: 1, max: 1 },
    jsonContract: "result@1.0.0",
  },
  (invocation, workflowObservation) => {
    const criterionId = invocation.positionals[0];
    const runId = invocation.flags.get("--run");
    const resolvedBy = invocation.flags.get("--resolved-by");
    const observation = invocation.flags.get("--observation");
    if (
      criterionId === undefined ||
      !isAcceptanceCriterionId(criterionId) ||
      typeof runId !== "string" ||
      !RUN_ID.test(runId) ||
      typeof resolvedBy !== "string" ||
      !HUMAN_ID.test(resolvedBy) ||
      typeof observation !== "string" ||
      observation.trim().length < 1 ||
      observation.length > 2048 ||
      CONTROL_CHARACTERS.test(observation)
    ) {
      return refusal();
    }
    const workflow = workflowObservation.workflow;
    if (
      workflow.kind !== "present" ||
      workflow.state.runId !== runId ||
      workflowObservation.configuration.runId !== runId ||
      !workflowObservation.repairLoopStopsReadable
    ) {
      return refusal();
    }
    const operation = `sdd.repair.resolve:${workflowObservation.correlationId}`;
    const existing = workflowObservation.events.find(
      (event) => event.operation === operation,
    );
    const existingResolution =
      existing?.stateContract === "1.3.0" || existing?.stateContract === "1.4.0"
        ? existing.repairResolution
        : undefined;
    const prepared = workflowObservation.repairResolution;
    const nextRun = invocation.flags.get("--next-run");
    const priorArtifact = workflowObservation.repairResolutionHistory.find(
      (candidate) => candidate.operation === operation,
    )?.artifact;
    if (
      existing !== undefined &&
      (priorArtifact?.criterionId !== criterionId ||
        priorArtifact.resolvedBy !== resolvedBy ||
        priorArtifact.observation !== observation ||
        priorArtifact.nextRunId !==
          (typeof nextRun === "string" ? nextRun : null))
    ) {
      return {
        result: resultFor("runtime.revision_conflict", {
          why: [
            "The correlation identifier is already bound to a different repair resolution.",
          ],
        }),
        plan: planOf(),
        humanStdout: null,
        payload: null,
      };
    }
    const decision = decideResolveRepairStop(workflowObservation.workflow, {
      feature: workflowObservation.configuration.feature,
      runId,
      criterionId,
      correlationId: workflowObservation.correlationId,
      eventId: workflowObservation.eventId,
      occurredAt: workflowObservation.occurredAt,
      expectedRevision: workflow.state.revision,
      resolvedBy,
      observation,
      observedIdentity: workflowObservation.observedIdentity,
      resolutionRef:
        prepared?.ref ?? existingResolution?.resolutionRef ?? "invalid",
      resolutionDigest:
        prepared?.digest ?? existingResolution?.resolutionDigest ?? "invalid",
      nextRunId: typeof nextRun === "string" ? nextRun : null,
      restartTicketRef:
        prepared?.restart?.ref ?? existingResolution?.restartTicketRef ?? null,
      restartTicketDigest:
        prepared?.restart?.digest ??
        existingResolution?.restartTicketDigest ??
        null,
    });
    if (decision.kind === "unchanged") {
      return {
        result: resultFor("run.resuming", {
          summary: "The repair resolution was already reflected in state.",
        }),
        plan: planOf(),
        humanStdout: null,
        payload: null,
      };
    }
    if (decision.kind === "refused" || prepared === null) {
      return {
        result: resultFor(
          decision.kind === "refused" ? decision.reasonCode : "trail.uso",
          {
            why: [
              "The persisted repair stop did not authorize this resolution.",
            ],
          },
        ),
        plan: planOf(),
        humanStdout: null,
        payload: null,
      };
    }
    const resolution =
      decision.event.stateContract === "1.3.0" ||
      decision.event.stateContract === "1.4.0"
        ? decision.event.repairResolution
        : undefined;
    const runRoot = `.brain/02-features/${workflowObservation.configuration.feature}/runs/${runId}`;
    if (resolution?.classification === "specification") {
      if (
        prepared.restart === null ||
        typeof nextRun !== "string" ||
        workflowObservation.acceptanceAttemptCeiling.kind !== "resolved"
      )
        return refusal();
      const nextConfiguration = {
        projectId: workflowObservation.configuration.projectId,
        feature: workflowObservation.configuration.feature,
        runId: nextRun,
        lineage: workflowObservation.observedLineage,
      };
      const restart = decideStartWorkflow(
        { kind: "absent", operations: [] },
        {
          ...nextConfiguration,
          correlationId: workflowObservation.correlationId,
          eventId: workflowObservation.eventId,
          occurredAt: workflowObservation.occurredAt,
          objectiveActive: workflowObservation.objectiveActive,
          worktreeClean: workflowObservation.worktreeClean,
          observedIdentity: workflowObservation.observedIdentity,
          acceptanceAttemptCeiling:
            workflowObservation.acceptanceAttemptCeiling.value,
          tokenCeiling: workflowObservation.objectiveTokenBudget,
          startFromSpec: {
            sourceRunId: runId,
            restartTicketRef: prepared.restart.ref,
            restartTicketDigest: prepared.restart.digest,
            retiredCriterionIds: prepared.restart.value.retiredCriterionIds,
          },
        },
      );
      if (restart.kind !== "recorded") return refusal();
      const nextRoot = `.brain/02-features/${workflowObservation.configuration.feature}/runs/${nextRun}`;
      return {
        result: resultFor("trail.ok", {
          summary: `Recorded specification resolution ${criterionId} and started ${nextRun} from spec.`,
          stateChanged: true,
          evidence: [
            { kind: "artifact", ref: prepared.ref },
            { kind: "artifact", ref: prepared.restart.ref },
            { kind: "event", ref: `${runRoot}/events.jsonl` },
            { kind: "event", ref: `${nextRoot}/events.jsonl` },
          ],
        }),
        plan: planOf(
          {
            kind: "write_file",
            path: prepared.ref,
            content: `${JSON.stringify(prepared.value, null, 2)}\n`,
          },
          {
            kind: "write_file",
            path: prepared.restart.ref,
            content: `${JSON.stringify(prepared.restart.value, null, 2)}\n`,
          },
          {
            kind: "append_event",
            feature: workflowObservation.configuration.feature,
            runId,
            event: decision.event,
          },
          {
            kind: "append_event",
            feature: workflowObservation.configuration.feature,
            runId: nextRun,
            event: restart.event,
          },
          {
            kind: "write_file",
            path: `.brain/02-features/${workflowObservation.configuration.feature}/active-run`,
            content: `${nextRun}\n`,
          },
        ),
        humanStdout: null,
        payload: null,
        eventReducerRegistries: [
          {
            feature: workflowObservation.configuration.feature,
            runId,
            reducers: workflowReducerRegistry(
              workflowObservation.configuration,
            ),
          },
          {
            feature: workflowObservation.configuration.feature,
            runId: nextRun,
            reducers: workflowReducerRegistry(nextConfiguration),
          },
        ],
      };
    }
    if (resolution?.classification !== "code") return refusal();
    return {
      result: resultFor("trail.ok", {
        summary: `Resolved code repair stop ${criterionId}.`,
        stateChanged: true,
        evidence: [
          { kind: "artifact", ref: prepared.ref },
          { kind: "event", ref: `${runRoot}/events.jsonl` },
        ],
      }),
      plan: planOf(
        {
          kind: "write_file",
          path: prepared.ref,
          content: `${JSON.stringify(prepared.value, null, 2)}\n`,
        },
        {
          kind: "append_event",
          feature: workflowObservation.configuration.feature,
          runId,
          event: decision.event,
        },
      ),
      humanStdout: null,
      payload: null,
      eventReducers: workflowReducerRegistry(workflowObservation.configuration),
    };
  },
);
