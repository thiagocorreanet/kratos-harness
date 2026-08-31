import type { AgentOutputV1_2, ReadableAgentOutput } from "@kratos/contracts";

import {
  checkAgentOutput,
  describeAgentOutputFailure,
  describeAgentOutputRefusal,
  describeBlockMalformation,
  type AgentOutputObservation,
} from "../agent/index.js";
import { planOf, type Effect } from "../effects.js";
import {
  compareCriteriaSnapshot,
  decideAcceptanceVerdict,
  renderCriterionCheckboxes,
} from "../acceptance-criteria/index.js";
import { resultFor, type Result } from "../result/index.js";
import {
  observePhaseMeasurementIdentity,
  renderPhaseMeasurementLog,
  samePhaseMeasurementAssignment,
  upsertPhaseMeasurement,
} from "../measurements/index.js";
import {
  decideRecordFact,
  WORKFLOW_POLICY_VERSION,
  workflowReducerRegistry,
  type WorkflowDecision,
} from "../workflow/index.js";
import type { CurrentEventDraft } from "../events/index.js";
import {
  buildAcceptanceDecisionMetadata,
  type RepairLoopDecision,
} from "../repair-loop/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "workflow" }>;

export const agentRecordCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["agent", "record"],
    summary: "Extract, validate, and persist one agent reply's machine block.",
    flags: [
      {
        name: "--correlation-id",
        kind: "value",
        valueLabel: "<id>",
        summary: "Use this idempotency correlation identifier.",
      },
      {
        name: "--host",
        kind: "value",
        valueLabel: "<id>",
        summary: "Record the host that observed this operation.",
      },
      {
        name: "--model",
        kind: "value",
        valueLabel: "<id>",
        summary: "Record the model that observed this operation.",
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
  (_invocation, observation) => decideRecord(observation),
);

/**
 * Turn one agent reply into recorded, typed run state.
 *
 * The reply is model output, so the order here is the whole point: extract the
 * block, validate it against its published contract, check that it does not
 * contradict itself, and only then let any of it reach a decision. Every step
 * before the last one can only refuse; none of them can advance the run.
 */
function decideRecord(observation: Observation): Decision {
  const unusable = unusableState(observation);
  if (unusable !== null) return unusable;

  const observed = observation.agentOutput;
  const phase =
    observation.workflow.kind === "present"
      ? observation.workflow.state.currentStep
      : null;
  if (
    (phase === "code" || phase === "review") &&
    observed.kind === "invalid" &&
    observed.missingMemoryAcknowledgement === true
  ) {
    return phaseContextStale(observed.ref);
  }
  if (observed.kind !== "valid") return refuseReply(observed);

  const refusal = checkAgentOutput(observed.value);
  if (refusal !== null) {
    return invalidOutput(observed.ref, describeAgentOutputRefusal(refusal));
  }

  if (
    observed.value.agent === "acceptance" &&
    observation.workflow.kind === "present" &&
    observation.workflow.state.operations.includes(
      acceptanceOperation(observation.correlationId),
    )
  ) {
    return settled("The acceptance verdict was already recorded.", [
      outputPath(observation, "acceptance"),
    ]);
  }
  if (observed.value.agent !== phase) {
    return invalidOutput(
      observed.ref,
      `The ${observed.value.agent} agent addressed a run in the ${phase ?? "unselected"} phase.`,
    );
  }

  const observedMemory =
    "memory" in observed.value ? observed.value.memory : null;

  if (phase === "code" || phase === "review") {
    const assigned =
      observation.phaseAssignment.kind === "resolved"
        ? observation.phaseAssignment.value.memory
        : null;
    const current = observation.currentPhaseMemory;
    if (
      assigned === null ||
      current === null ||
      "kind" in current ||
      !sameMemory(observedMemory, assigned) ||
      !sameMemory(observedMemory, current)
    ) {
      return phaseContextStale(observed.ref);
    }
  } else if (observedMemory !== null) {
    return phaseContextStale(observed.ref);
  }

  const criteria = observation.acceptanceCriteria;
  if (
    criteria.snapshot === null &&
    (phase === "code" || phase === "review" || phase === "acceptance") &&
    criteria.bootstrapSnapshot === null
  ) {
    return criterionRefusal(
      "gate.ac_baseline_unverifiable",
      criteria.documentRef,
      "The acceptance criterion baseline cannot be verified from exact plan lineage.",
    );
  }
  if (criteria.snapshot !== null) {
    if (!criteria.readable || criteria.document.kind !== "valid") {
      return criterionRefusal(
        "gate.ac_baseline_unverifiable",
        criteria.documentRef,
        "The acceptance criterion state could not be read safely.",
      );
    }
    const latestOutcomes = new Map(
      criteria.verdicts.map(({ criterionId, outcome }) => [
        criterionId,
        outcome,
      ]),
    );
    const change = compareCriteriaSnapshot({
      phase: observed.value.agent,
      frozen: criteria.snapshot.declarations,
      current: criteria.currentDeclarations,
      latestOutcomes,
    });
    if (change.kind === "refused") {
      return criterionRefusal(
        change.reasonCode,
        criteria.documentRef,
        `Acceptance criterion ${change.criterionId} was changed without acceptance authority.`,
      );
    }
  }

  const path = outputPath(observation, observed.value.agent);
  const recorded = observation.agentOutputs.find(
    (candidate) => candidate.agent === observed.value.agent,
  );
  if (
    observed.value.agent !== "acceptance" &&
    recorded !== undefined &&
    serialize(recorded) === serialize(observed.value)
  ) {
    return settled(
      `The ${observed.value.agent} agent output was already recorded.`,
      [path],
    );
  }

  if (observed.value.agent === "acceptance") {
    return recordAcceptance(observation, observed.value, path);
  }

  const bootstrapEffects: Effect[] =
    criteria.snapshot === null &&
    criteria.bootstrapSnapshot !== null &&
    criteria.bootstrapSnapshotRef !== null &&
    criteria.bootstrapSnapshotDigest !== null
      ? [
          {
            kind: "write_file",
            path: criteria.bootstrapSnapshotRef,
            content: serializeValue(criteria.bootstrapSnapshot),
          },
        ]
      : [];
  const bootstrapRefs =
    criteria.snapshot === null &&
    criteria.bootstrapSnapshotRef !== null &&
    criteria.bootstrapSnapshotDigest !== null
      ? [
          criteria.bootstrapSnapshotRef,
          artifactDigestRef(
            criteria.bootstrapSnapshotRef,
            criteria.bootstrapSnapshotDigest,
          ),
        ]
      : [];

  return commit(
    observation,
    [
      ...bootstrapEffects,
      {
        kind: "write_file",
        path,
        content: serialize(observed.value),
      },
    ],
    `Recorded the ${observed.value.agent} agent output as ${observed.value.outcome.status}.`,
    [path, ...bootstrapRefs],
  );
}

function recordAcceptance(
  observation: Observation,
  output: Extract<ReadableAgentOutput, { readonly agent: "acceptance" }>,
  outputRef: string,
): Decision {
  const criteria = observation.acceptanceCriteria;
  if (
    !criteria.readable ||
    criteria.document.kind !== "valid" ||
    criteria.documentContent === null ||
    (criteria.snapshot === null && criteria.bootstrapSnapshot === null)
  ) {
    return criterionRefusal(
      "gate.ac_baseline_unverifiable",
      criteria.documentRef,
      "Acceptance criteria were not frozen from a valid task document.",
    );
  }
  const baselineSnapshot = criteria.snapshot ?? criteria.bootstrapSnapshot;
  const baselineSnapshotRef =
    criteria.snapshotRef ?? criteria.bootstrapSnapshotRef;
  const baselineSnapshotDigest =
    criteria.snapshotDigest ?? criteria.bootstrapSnapshotDigest;
  if (
    baselineSnapshot === null ||
    baselineSnapshotRef === null ||
    baselineSnapshotDigest === null
  ) {
    return criterionRefusal(
      "gate.ac_baseline_unverifiable",
      criteria.documentRef,
      "The acceptance criterion baseline is incomplete.",
    );
  }
  const latestOutcomes = new Map(
    criteria.verdicts.map(({ criterionId, outcome }) => [criterionId, outcome]),
  );
  const change = compareCriteriaSnapshot({
    phase: "acceptance",
    frozen: baselineSnapshot.declarations,
    current: criteria.currentDeclarations,
    latestOutcomes,
  });
  if (change.kind === "refused") {
    return criterionRefusal(
      change.reasonCode,
      criteria.documentRef,
      `Acceptance criterion ${change.criterionId} was refused.`,
    );
  }
  const snapshot =
    change.kind === "append" ? criteria.appendSnapshot : baselineSnapshot;
  const snapshotRef =
    change.kind === "append" ? criteria.appendSnapshotRef : baselineSnapshotRef;
  const snapshotDigest =
    change.kind === "append"
      ? criteria.appendSnapshotDigest
      : baselineSnapshotDigest;
  if (snapshot === null || snapshotRef === null || snapshotDigest === null) {
    return criterionRefusal(
      "gate.ac_baseline_unverifiable",
      criteria.documentRef,
      "The appended acceptance criterion snapshot could not be prepared.",
    );
  }
  const verdict = decideAcceptanceVerdict({
    declarations: criteria.currentDeclarations,
    globalVerdict: output.payload.verdict,
    criteria: output.payload.criteria,
    evidence: observation.evidence,
    invalidEvidenceIds: observation.invalidEvidenceIds,
  });
  if (verdict.kind === "refused") {
    return criterionRefusal(
      verdict.reasonCode,
      outputRef,
      `Acceptance criterion ${verdict.criterionId} was refused.`,
    );
  }
  const preparedById = new Map(
    criteria.preparedVerdicts.map((prepared) => [
      prepared.value.criterionId,
      prepared,
    ]),
  );
  if (
    preparedById.size !== verdict.criteria.length ||
    verdict.criteria.some(({ criterionId }) => !preparedById.has(criterionId))
  ) {
    return criterionRefusal(
      "gate.ac_baseline_unverifiable",
      outputRef,
      "The digest-bound acceptance verdict artifacts could not be prepared.",
    );
  }
  const preparedVerdicts = verdict.criteria.flatMap(({ criterionId }) => {
    const prepared = preparedById.get(criterionId);
    return prepared === undefined ? [] : [prepared];
  });
  const repairDecision = criteria.repairLoopDecision;
  if (repairDecision === null || repairDecision.kind === "refused") {
    return invalidOutput(
      outputRef,
      repairDecision === null
        ? "The acceptance repair-loop decision could not be prepared."
        : describeRepairLoopRefusal(repairDecision),
    );
  }
  const preparedStops = criteria.preparedRepairStops;
  if (
    (repairDecision.kind === "stopped" &&
      (preparedStops.length !== repairDecision.stops.length ||
        preparedStops.some(
          ({ value }, index) =>
            value.criterionId !== repairDecision.stops[index]?.criterionId ||
            value.attempt !== repairDecision.stops[index].attempt,
        ))) ||
    (repairDecision.kind !== "stopped" && preparedStops.length !== 0)
  ) {
    return invalidOutput(
      outputRef,
      "The repair-loop stop artifacts could not be prepared.",
    );
  }
  const verdictEffects: Effect[] = preparedVerdicts.map(({ value, ref }) => ({
    kind: "write_file" as const,
    path: ref,
    content: serializeValue(value),
  }));
  const stopEffects: Effect[] = preparedStops.map(({ value, ref }) => ({
    kind: "write_file" as const,
    path: ref,
    content: serializeValue(value),
  }));
  const snapshotNeedsWrite =
    change.kind === "append" || criteria.snapshot === null;
  const snapshotEffects: Effect[] = snapshotNeedsWrite
    ? [
        {
          kind: "write_file",
          path: snapshotRef,
          content: serializeValue(snapshot),
        },
      ]
    : [];
  const verdictRefs =
    repairDecision.kind === "stopped"
      ? preparedVerdicts.map(({ ref, digest }) =>
          artifactDigestRef(ref, digest),
        )
      : preparedVerdicts.flatMap(({ ref, digest }) => [
          ref,
          artifactDigestRef(ref, digest),
        ]);
  const stopRefs = preparedStops.map(({ ref }) => ref);
  const artifactRefs = [
    outputRef,
    criteria.documentRef,
    ...(snapshotNeedsWrite
      ? repairDecision.kind === "stopped"
        ? [artifactDigestRef(snapshotRef, snapshotDigest)]
        : [snapshotRef, artifactDigestRef(snapshotRef, snapshotDigest)]
      : []),
    ...verdictRefs,
    ...stopRefs,
  ];
  return commitAcceptance(
    observation,
    [
      ...snapshotEffects,
      ...verdictEffects,
      ...stopEffects,
      {
        kind: "write_file",
        path: criteria.documentRef,
        content: renderCriterionCheckboxes(
          criteria.documentContent,
          verdict.checkboxOutcomes,
        ),
      },
      { kind: "write_file", path: outputRef, content: serialize(output) },
    ],
    repairDecision,
    preparedStops.map(({ value, ref, digest }) => ({
      criterionId: value.criterionId,
      artifactRef: ref,
      artifactDigest: digest,
    })),
    `Recorded acceptance verdicts for ${String(verdict.criteria.length)} criteria.`,
    artifactRefs,
    [...new Set(preparedVerdicts.map(({ value }) => value.evidenceRef))],
  );
}

function describeRepairLoopRefusal(
  refusal: Extract<RepairLoopDecision, { readonly kind: "refused" }>,
): string {
  const subject =
    refusal.criterionId === undefined
      ? "the acceptance verdict"
      : `acceptance criterion ${refusal.criterionId}`;
  switch (refusal.reason) {
    case "missing-fault":
      return `A classification and diagnosis are required for ${subject}.`;
    case "unexpected-fault":
      return `A fault report is not required for ${subject}.`;
    case "invalid-fault":
      return `The fault report for ${subject} is invalid.`;
    case "active-stop":
      return `An active repair stop already exists for ${subject}.`;
    case "duplicate-criterion":
      return `The repair-loop input repeats ${subject}.`;
    case "invalid-attempt":
    case "invalid-ceiling":
    case "invalid-criterion":
      return `The repair-loop context is invalid for ${subject}.`;
  }
}

function artifactDigestRef(ref: string, digest: string): string {
  return `${ref}#sha256=${digest}`;
}

function acceptanceOperation(correlationId: string): string {
  return `sdd.acceptance.record:${correlationId}`;
}

function commitAcceptance(
  observation: Observation,
  effects: readonly Effect[],
  repairDecision: Exclude<RepairLoopDecision, { readonly kind: "refused" }>,
  stopBindings: readonly {
    readonly criterionId: string;
    readonly artifactRef: string;
    readonly artifactDigest: string;
  }[],
  summary: string,
  artifactRefs: readonly string[],
  evidenceRefs: readonly string[],
): Decision {
  if (
    observation.workflow.kind !== "present" ||
    observation.workflow.state.currentStep !== "acceptance" ||
    observation.workflow.state.policyVersion !== WORKFLOW_POLICY_VERSION ||
    observation.phaseAssignment.kind !== "resolved" ||
    observation.phaseExecution === null
  ) {
    return decisionOf(
      resultFor("trail.uso", {
        why: ["The acceptance verdict cannot be bound to the active run."],
        evidence: [],
      }),
    );
  }
  const execution = observation.phaseExecution;
  const event: CurrentEventDraft = {
    contractVersion: "1.2.0",
    stateContract: "1.2.0",
    eventId: observation.eventId,
    eventType: "decision",
    occurredAt: observation.occurredAt,
    operation: acceptanceOperation(observation.correlationId),
    policyVersion: WORKFLOW_POLICY_VERSION,
    priorRevision: observation.workflow.state.revision,
    resultingRevision: observation.workflow.state.revision + 1,
    reasonCode:
      repairDecision.kind === "passed"
        ? "run.acceptance.passed"
        : repairDecision.kind === "repair"
          ? "run.acceptance.repair_required"
          : "run.stop_loss.repeated_rejection",
    effect: "state-and-artifact",
    artifactRefs: [...artifactRefs],
    evidenceRefs: [...evidenceRefs],
    gateFailures: [],
    observedIdentity:
      execution.provenance === "host-reported"
        ? {
            host: observation.phaseAssignment.value.host,
            model: execution.model,
            effort: execution.effort,
          }
        : {
            host: observation.phaseAssignment.value.host,
            model: null,
            effort: null,
          },
    acceptanceDecision: buildAcceptanceDecisionMetadata(
      repairDecision,
      stopBindings,
    ),
  };
  return {
    result: resultFor("trail.ok", {
      summary,
      stateChanged: true,
      evidence: [
        ...artifactRefs.map((ref) => ({ kind: "artifact" as const, ref })),
        { kind: "event" as const, ref: `${runRoot(observation)}/events.jsonl` },
      ],
    }),
    plan: planOf(...effects, {
      kind: "append_event",
      feature: observation.configuration.feature,
      runId: observation.configuration.runId,
      event,
    }),
    humanStdout: null,
    payload: null,
    eventReducers: workflowReducerRegistry(observation.configuration),
    revalidatePhaseAssignmentDigest: execution.assignmentDigest,
  };
}

/**
 * Report a reply the runtime cannot route on.
 *
 * The three answers stay apart on purpose. "Nothing was emitted", "something
 * was emitted that is not a block", and "a block was emitted that is not the
 * contract" are three different things to fix, and collapsing them would make
 * the caller guess which one happened.
 */
function refuseReply(
  observed: Exclude<AgentOutputObservation, { readonly kind: "valid" }>,
): Decision {
  switch (observed.kind) {
    case "none":
      return usage(["No agent reply was supplied to record."]);
    case "unreadable":
      return usage(["The agent reply could not be read as text."]);
    case "absent":
      return invalidOutput(observed.ref, "The reply carries no machine block.");
    case "malformed":
      return invalidOutput(
        observed.ref,
        describeBlockMalformation(observed.reason),
      );
    case "invalid":
      return invalidOutput(observed.ref, describeAgentOutputFailure(observed));
  }
}

/**
 * Persisted blocks are written exactly as validated, so reading one back
 * through the same contract yields the value the decision saw.
 */
function serialize(value: ReadableAgentOutput): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function serializeValue(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function runRoot(observation: Observation): string {
  return `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}`;
}

function outputPath(observation: Observation, agent: string): string {
  return `${runRoot(observation)}/agent-output/${agent}.json`;
}

function commit(
  observation: Observation,
  effects: readonly Effect[],
  summary: string,
  artifactRefs: readonly string[],
): Decision {
  const phaseExecution =
    observation.phaseAssignment.kind === "resolved" &&
    observation.phaseExecution !== null
      ? {
          assignment: observation.phaseAssignment.value.assignment,
          host: observation.phaseAssignment.value.host,
          execution: observation.phaseExecution,
        }
      : null;
  const workflow = decideRecordFact(observation.workflow, {
    feature: observation.configuration.feature,
    runId: observation.configuration.runId,
    correlationId: observation.correlationId,
    eventId: observation.eventId,
    occurredAt: observation.occurredAt,
    expectedRevision:
      observation.workflow.kind === "present"
        ? observation.workflow.state.revision
        : 0,
    operation: "agent.record",
    artifactRefs,
    observedIdentity:
      phaseExecution === null
        ? observation.observedIdentity
        : { host: phaseExecution.host, model: null },
    ...(phaseExecution === null
      ? {}
      : {
          resolvedAssignment: phaseExecution.assignment,
          phaseExecution: phaseExecution.execution,
        }),
  });
  if (workflow.kind === "refused") return refused(workflow, observation);
  if (workflow.kind === "unchanged") {
    return settled(
      "The recording was already reflected in the run history.",
      artifactRefs,
    );
  }
  const measurement = identityMeasurementEffect(observation, workflow.event);
  if (measurement.kind === "refused") {
    return decisionOf(
      resultFor("metrics.phase_assignment_conflict", {
        why: ["The open phase measurement belongs to another assignment."],
        evidence: [
          { kind: "artifact", ref: ".brain/03-memory/task_log.jsonl" },
        ],
      }),
    );
  }
  return {
    result: resultFor("trail.ok", {
      summary,
      stateChanged: true,
      evidence: [
        ...artifactRefs.map((ref) => ({ kind: "artifact" as const, ref })),
        { kind: "event" as const, ref: `${runRoot(observation)}/events.jsonl` },
      ],
    }),
    plan: planOf(
      ...effects,
      ...(measurement.effect === null ? [] : [measurement.effect]),
      {
        kind: "append_event",
        feature: observation.configuration.feature,
        runId: observation.configuration.runId,
        event: workflow.event,
      },
    ),
    humanStdout: null,
    payload: null,
    eventReducers: workflowReducerRegistry(observation.configuration),
    ...(phaseExecution === null
      ? {}
      : {
          revalidatePhaseAssignmentDigest:
            phaseExecution.execution.assignmentDigest,
        }),
  };
}

function identityMeasurementEffect(
  observation: Observation,
  event: Extract<WorkflowDecision, { readonly kind: "recorded" }>["event"],
):
  | {
      readonly kind: "accepted";
      readonly effect: Extract<Effect, { readonly kind: "write_file" }> | null;
    }
  | { readonly kind: "refused" } {
  const phase =
    observation.workflow.kind === "present"
      ? observation.workflow.state.currentStep
      : null;
  const record = observation.measurements.records.find(
    (candidate) =>
      candidate.runId === observation.configuration.runId &&
      candidate.phase === phase &&
      candidate.status === "running",
  );
  if (record === undefined) return { kind: "accepted", effect: null };
  if (
    observation.phaseAssignment.kind !== "resolved" ||
    !samePhaseMeasurementAssignment(record.resolvedAssignment, {
      host: observation.phaseAssignment.value.host,
      role: observation.phaseAssignment.value.assignment.role,
      model: observation.phaseAssignment.value.assignment.model,
      effort: observation.phaseAssignment.value.assignment.effort,
    })
  ) {
    return { kind: "refused" };
  }
  const observed = observePhaseMeasurementIdentity({
    record,
    observedIdentity: {
      model: event.observedIdentity.model ?? record.observedIdentity.model,
      effort:
        "effort" in event.observedIdentity
          ? (event.observedIdentity.effort ?? record.observedIdentity.effort)
          : record.observedIdentity.effort,
    },
    now: event.occurredAt,
  });
  const content = renderPhaseMeasurementLog(
    upsertPhaseMeasurement(observation.measurements.records, observed),
  );
  return {
    kind: "accepted",
    effect:
      content === observation.measurements.content
        ? null
        : {
            kind: "write_file",
            path: ".brain/03-memory/task_log.jsonl",
            content,
            expected: observation.measurements.expected,
          },
  };
}

/** Why this run cannot record an agent output right now, or null when it can. */
function unusableState(observation: Observation): Decision | null {
  if (
    observation.workflow.kind === "corrupt" ||
    !observation.agentOutputsReadable
  ) {
    return decisionOf(
      resultFor("runtime.state_corrupt", {
        why: ["The recorded agent output could not be read as its contract."],
        evidence: [{ kind: "artifact", ref: ".brain/02-features" }],
      }),
    );
  }
  if (observation.workflow.kind === "absent") {
    return decisionOf(
      resultFor("blocked.context_unreadable", {
        why: ["No active run exists to record an agent output against."],
        evidence: [{ kind: "artifact", ref: ".brain/02-features/active" }],
      }),
    );
  }
  return null;
}

function settled(summary: string, refs: readonly string[]): Decision {
  return {
    result: resultFor("trail.ok", {
      summary,
      stateChanged: false,
      evidence: refs.map((ref) => ({ kind: "artifact" as const, ref })),
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function invalidOutput(ref: string, why: string): Decision {
  return decisionOf(
    resultFor("trail.output_invalido", {
      why: [why],
      evidence: [{ kind: "observation", ref }],
    }),
  );
}

function sameMemory(
  left: AgentOutputV1_2["memory"],
  right: Exclude<AgentOutputV1_2["memory"], null>,
): boolean {
  return (
    left !== null &&
    left.sha256 === right.sha256 &&
    left.lessonIds.length === right.lessonIds.length &&
    left.lessonIds.every(
      (lessonId, index) => lessonId === right.lessonIds[index],
    )
  );
}

function phaseContextStale(ref: string): Decision {
  return decisionOf(
    resultFor("memory.phase_context_stale", {
      why: [
        "The agent acknowledgement does not match the current curated-memory phase context.",
      ],
      evidence: [
        { kind: "artifact", ref: ".brain/03-memory/gotchas.md" },
        { kind: "observation", ref },
      ],
    }),
  );
}

function criterionRefusal(
  reasonCode:
    | "gate.ac_baseline_unverifiable"
    | "gate.ac_declaration_changed"
    | "gate.ac_append_forbidden"
    | "gate.ac_checkbox_forbidden"
    | "gate.ac_verdict_mismatch"
    | "gate.ac_evidence_missing"
    | "gate.ac_evidence_invalid",
  ref: string,
  why: string,
): Decision {
  return decisionOf(
    resultFor(reasonCode, {
      why: [why],
      evidence: [{ kind: "artifact", ref }],
    }),
  );
}

function usage(why: readonly string[]): Decision {
  return decisionOf(resultFor("trail.uso", { why: [...why], evidence: [] }));
}

function refused(
  workflow: Extract<WorkflowDecision, { readonly kind: "refused" }>,
  observation: Observation,
): Decision {
  return decisionOf(
    resultFor(workflow.reasonCode, {
      why: ["The run refused to record the agent output."],
      evidence:
        workflow.reasonCode === "trail.uso"
          ? []
          : [{ kind: "artifact", ref: `${runRoot(observation)}/state.json` }],
    }),
  );
}

function decisionOf(result: Result): Decision {
  return { result, plan: planOf(), humanStdout: null, payload: null };
}
