import type { AgentOutputV1, AgentOutputV1_2 } from "@kratos/contracts";

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
  decideRecordFact,
  workflowReducerRegistry,
  type WorkflowDecision,
} from "../workflow/index.js";

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
    missingMemoryAcknowledgement(observed.value)
  ) {
    return phaseContextStale(observed.ref);
  }
  if (observed.kind !== "valid") return refuseReply(observed);

  const refusal = checkAgentOutput(observed.value);
  if (refusal !== null) {
    return invalidOutput(observed.ref, describeAgentOutputRefusal(refusal));
  }

  if (observed.value.agent !== phase) {
    return invalidOutput(
      observed.ref,
      `The ${observed.value.agent} agent addressed a run in the ${phase ?? "unselected"} phase.`,
    );
  }

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
      !sameMemory(observed.value.memory, assigned) ||
      !sameMemory(observed.value.memory, current)
    ) {
      return phaseContextStale(observed.ref);
    }
  } else if (observed.value.memory !== null) {
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
      phase,
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
  output: Extract<AgentOutputV1_2, { readonly agent: "acceptance" }>,
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
  const verdictEffects: Effect[] = preparedVerdicts.map(({ value, ref }) => ({
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
  const verdictRefs = preparedVerdicts.flatMap(({ ref, digest }) => [
    ref,
    artifactDigestRef(ref, digest),
  ]);
  return commit(
    observation,
    [
      ...snapshotEffects,
      ...verdictEffects,
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
    `Recorded acceptance verdicts for ${String(verdict.criteria.length)} criteria.`,
    [
      outputRef,
      criteria.documentRef,
      ...(snapshotNeedsWrite
        ? [snapshotRef, artifactDigestRef(snapshotRef, snapshotDigest)]
        : []),
      ...verdictRefs,
    ],
  );
}

function artifactDigestRef(ref: string, digest: string): string {
  return `${ref}#sha256=${digest}`;
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
function serialize(value: AgentOutputV1 | AgentOutputV1_2): string {
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
      event: workflow.event,
    }),
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

/**
 * Classify only the dedicated acknowledgement omission before schema refusal.
 * Other malformed blocks stay ordinary contract failures, so an agent cannot
 * hide an unrelated invalid document behind this more specific policy result.
 */
function missingMemoryAcknowledgement(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "memory");
  return (
    descriptor === undefined ||
    ("value" in descriptor && descriptor.value === null)
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
