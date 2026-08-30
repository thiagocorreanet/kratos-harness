import { planOf, type Effect } from "../effects.js";
import { decideDone } from "../acceptance/index.js";
import { compareCriteriaSnapshot } from "../acceptance-criteria/index.js";
import {
  completePhaseMeasurement,
  renderPhaseMeasurementLog,
  samePhaseMeasurementAssignment,
  upsertPhaseMeasurement,
} from "../measurements/index.js";
import { resultFor } from "../result/index.js";
import {
  decideContinueWorkflow,
  decideStartWorkflow,
  workflowReducerRegistry,
  type WorkflowDecision,
} from "../workflow/index.js";

import { observingCommand } from "./observed.js";
import type { CommandObservation, CommandSpec, Decision } from "./spec.js";

type Observation = Extract<CommandObservation, { readonly kind: "workflow" }>;

const SHARED_FLAGS: CommandSpec["flags"] = [
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
];

function currentPhaseExecution(observation: Observation) {
  return observation.phaseAssignment.kind === "resolved" &&
    observation.phaseExecution !== null
    ? {
        assignment: observation.phaseAssignment.value.assignment,
        host: observation.phaseAssignment.value.host,
        execution: observation.phaseExecution,
      }
    : null;
}

export const startCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["start"],
    summary: "Start or idempotently resume the active feature run.",
    flags: [
      ...SHARED_FLAGS,
      {
        name: "--run-id",
        kind: "value",
        valueLabel: "<id>",
        summary: "Use this run identifier when creating a run.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (_invocation, observation) =>
    workflowDecision(
      decideStartWorkflow(observation.workflow, {
        ...observation.configuration,
        correlationId: observation.correlationId,
        eventId: observation.eventId,
        occurredAt: observation.occurredAt,
        objectiveActive: observation.objectiveActive,
        worktreeClean: observation.worktreeClean,
        observedIdentity: observation.observedIdentity,
      }),
      observation,
    ),
);

export const continueCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["continue"],
    summary: "Resume or advance the active run from persisted state.",
    flags: [
      ...SHARED_FLAGS,
      {
        name: "--artifact",
        kind: "value",
        valueLabel: "<ref>",
        summary: "Bind a completed phase artifact to the transition.",
      },
      {
        name: "--complete",
        kind: "boolean",
        summary: "Request completion of the current phase.",
      },
      {
        name: "--evidence",
        kind: "value",
        valueLabel: "<ref>",
        summary: "Bind evidence to the transition.",
      },
      {
        name: "--expected-revision",
        kind: "value",
        valueLabel: "<number>",
        summary: "Refuse unless the run is at this exact revision.",
      },
      {
        name: "--gate-failure",
        kind: "value",
        valueLabel: "<gate-id>",
        summary: "Record a gate that rejected the proposed transition.",
      },
      {
        name: "--reject",
        kind: "boolean",
        summary: "Reject the proposed transition and block the run.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => {
    const revision =
      observation.workflow.kind === "present"
        ? observation.workflow.state.revision
        : 0;
    const expected = invocation.flags.get("--expected-revision");
    const expectedRevision =
      typeof expected === "string" ? Number(expected) : revision;
    const artifact = invocation.flags.get("--artifact");
    const evidence = invocation.flags.get("--evidence");
    const gate = invocation.flags.get("--gate-failure");
    const selectedEvidence =
      typeof evidence === "string"
        ? observation.evidence.find(({ ref }) => ref === evidence)
        : undefined;
    const artifactReadable =
      typeof artifact === "string" &&
      observation.referencedFiles.some(({ ref }) => ref === artifact);
    const completingPlan =
      invocation.flags.get("--complete") === true &&
      observation.workflow.kind === "present" &&
      observation.workflow.state.currentStep === "plan";
    const criteria = observation.acceptanceCriteria;
    const criteriaSnapshotRef = criteria.initialSnapshotRef;
    const criteriaSnapshot =
      completingPlan &&
      artifact === criteria.documentRef &&
      artifactReadable &&
      criteria.readable &&
      criteria.document.kind === "valid" &&
      criteria.initialSnapshot !== null &&
      criteriaSnapshotRef !== null &&
      criteria.initialSnapshotDigest !== null &&
      criteria.currentDeclarations.every(({ checked }) => !checked)
        ? criteria.initialSnapshot
        : null;
    if (completingPlan && criteriaSnapshot === null) {
      return invalidCriteriaDocument(observation);
    }
    const phase =
      observation.workflow.kind === "present"
        ? observation.workflow.state.currentStep
        : null;
    const enforcingFrozenCriteria = phase === "code" || phase === "review";
    const baseline = criteria.snapshot ?? criteria.bootstrapSnapshot;
    if (enforcingFrozenCriteria && baseline === null) {
      return criteriaPolicyRefusal(
        observation,
        "gate.ac_baseline_unverifiable",
        "The frozen acceptance criterion baseline cannot be verified.",
      );
    }
    if (enforcingFrozenCriteria && baseline !== null) {
      const latestOutcomes = new Map(
        criteria.verdicts.map(({ criterionId, outcome }) => [
          criterionId,
          outcome,
        ]),
      );
      const change = compareCriteriaSnapshot({
        phase,
        frozen: baseline.declarations,
        current: criteria.currentDeclarations,
        latestOutcomes,
      });
      if (change.kind === "refused") {
        return criteriaPolicyRefusal(
          observation,
          change.reasonCode,
          `Acceptance criterion ${change.criterionId} changed outside acceptance.`,
        );
      }
    }
    const bootstrapRef =
      enforcingFrozenCriteria && criteria.snapshot === null
        ? criteria.bootstrapSnapshotRef
        : null;
    const bootstrapDigest =
      enforcingFrozenCriteria && criteria.snapshot === null
        ? criteria.bootstrapSnapshotDigest
        : null;
    const criteriaArtifactRefs = [
      ...(criteriaSnapshotRef !== null &&
      criteriaSnapshot !== null &&
      criteria.initialSnapshotDigest !== null
        ? [
            criteriaSnapshotRef,
            artifactDigestRef(
              criteriaSnapshotRef,
              criteria.initialSnapshotDigest,
            ),
          ]
        : []),
      ...(bootstrapRef !== null && bootstrapDigest !== null
        ? [bootstrapRef, artifactDigestRef(bootstrapRef, bootstrapDigest)]
        : []),
    ];
    const evidenceReadable =
      typeof evidence === "string" &&
      selectedEvidence !== undefined &&
      !observation.invalidEvidenceIds.includes(selectedEvidence.evidenceId);
    const refs = {
      artifactRefs: [
        ...(artifactReadable && typeof artifact === "string" ? [artifact] : []),
        ...criteriaArtifactRefs,
      ],
      evidenceRefs:
        evidenceReadable && typeof evidence === "string" ? [evidence] : [],
    };
    const action =
      invocation.flags.get("--reject") === true
        ? ({ kind: "reject", ...refs } as const)
        : invocation.flags.get("--complete") === true
          ? ({
              kind: "complete-phase",
              ...refs,
              gateFailures: [
                ...(observation.gateDecision.outcome === "block"
                  ? observation.gateDecision.failures.map(
                      ({ gateId }) => gateId,
                    )
                  : []),
                ...(typeof gate === "string" ? [gate] : []),
                ...(typeof artifact === "string" && !artifactReadable
                  ? ["artifact-unreadable"]
                  : []),
                ...(typeof evidence === "string" && !evidenceReadable
                  ? ["evidence-invalid"]
                  : []),
                ...(completingPlan && criteriaSnapshot === null
                  ? ["acceptance-criteria-invalid"]
                  : []),
              ],
              allowFinalCompletion: false,
            } as const)
          : ({ kind: "resume" } as const);
    const phaseExecution = currentPhaseExecution(observation);
    return workflowDecision(
      decideContinueWorkflow(observation.workflow, {
        feature: observation.configuration.feature,
        runId: observation.configuration.runId,
        correlationId: observation.correlationId,
        eventId: observation.eventId,
        occurredAt: observation.occurredAt,
        expectedRevision,
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
        action,
      }),
      observation,
      [
        ...(criteriaSnapshot === null || criteriaSnapshotRef === null
          ? []
          : ([
              {
                kind: "write_file",
                path: criteriaSnapshotRef,
                content: `${JSON.stringify(criteriaSnapshot, null, 2)}\n`,
              },
            ] as const)),
        ...(bootstrapRef === null || criteria.bootstrapSnapshot === null
          ? []
          : [
              {
                kind: "write_file" as const,
                path: bootstrapRef,
                content: `${JSON.stringify(criteria.bootstrapSnapshot, null, 2)}\n`,
              },
            ]),
      ],
    );
  },
);

export const doneCommand: CommandSpec = observingCommand(
  "workflow",
  {
    path: ["done"],
    summary: "Complete final acceptance with bound approval and evidence.",
    flags: [
      ...SHARED_FLAGS,
      {
        name: "--artifact",
        kind: "value",
        valueLabel: "<ref>",
        summary: "Bind the final summary artifact to acceptance.",
      },
      {
        name: "--evidence",
        kind: "value",
        valueLabel: "<ref>",
        summary: "Bind verified acceptance evidence to completion.",
      },
      {
        name: "--expected-revision",
        kind: "value",
        valueLabel: "<number>",
        summary: "Refuse unless the run is at this exact revision.",
      },
    ],
    positionals: { min: 0, max: 0 },
    jsonContract: "result@1.0.0",
  },
  (invocation, observation) => {
    const revision =
      observation.workflow.kind === "present"
        ? observation.workflow.state.revision
        : 0;
    const expected = invocation.flags.get("--expected-revision");
    const artifact = invocation.flags.get("--artifact");
    const evidence = invocation.flags.get("--evidence");
    const finalApproval = observation.approvals.find(
      (approval) =>
        approval.gate === "final-acceptance" &&
        approval.runId === observation.configuration.runId &&
        approval.prdDigest === observation.observedLineage.prdDigest &&
        approval.specDigest === observation.observedLineage.specDigest &&
        approval.policyVersion === "workflow-v1" &&
        approval.challenge === observation.approvalChallenge &&
        approval.decision === "approved" &&
        Date.parse(approval.decidedAt) <= Date.parse(observation.occurredAt) &&
        Date.parse(approval.expiresAt) >= Date.parse(observation.occurredAt),
    );
    const selectedEvidence =
      typeof evidence === "string"
        ? observation.evidence.find(({ ref }) => ref === evidence)
        : undefined;
    const artifactReadable =
      typeof artifact === "string" &&
      observation.referencedFiles.some(({ ref }) => ref === artifact);
    const evidenceReadable =
      typeof evidence === "string" &&
      selectedEvidence !== undefined &&
      !observation.invalidEvidenceIds.includes(selectedEvidence.evidenceId);
    const accepted =
      finalApproval !== undefined &&
      observation.gateDecision.failures.every(
        ({ gateId }) => gateId === "final-acceptance",
      ) &&
      observation.approvalChallenge !== null;
    const artifactObservation = observation.referencedFiles.find(
      ({ ref }) => ref === artifact,
    );
    const lineage =
      artifactObservation === undefined
        ? []
        : [
            {
              contractVersion: "1.0.0" as const,
              artifactId: `artifact:${artifactObservation.sha256.slice(0, 24)}`,
              artifactRef: artifactObservation.ref,
              artifactDigest: artifactObservation.sha256,
              parentDigests: [
                observation.observedLineage.prdDigest,
                observation.observedLineage.specDigest,
              ],
              runId: observation.configuration.runId,
              phase: "acceptance",
              policyMode: observation.policyMode,
              policyVersion: "workflow-v1",
              producerCommand: `sdd.continue:${observation.correlationId}`,
              commit: observation.gitCommit,
              evidenceRefs: typeof evidence === "string" ? [evidence] : [],
              observedIdentity: {
                ...observation.observedIdentity,
                provenance: observation.identityProvenance,
              },
            },
          ];
    const readiness = decideDone({
      runId: observation.configuration.runId,
      allStepsComplete:
        observation.workflow.kind === "present" &&
        observation.workflow.state.currentStep === "acceptance",
      gates: observation.gateDecision,
      approval: accepted ? finalApproval : null,
      evidence: selectedEvidence === undefined ? [] : [selectedEvidence],
      invalidEvidenceIds: observation.invalidEvidenceIds,
      lineage,
    });
    const phaseExecution = currentPhaseExecution(observation);
    return workflowDecision(
      decideContinueWorkflow(observation.workflow, {
        feature: observation.configuration.feature,
        runId: observation.configuration.runId,
        correlationId: observation.correlationId,
        eventId: observation.eventId,
        occurredAt: observation.occurredAt,
        expectedRevision:
          typeof expected === "string" ? Number(expected) : revision,
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
        action: {
          kind: "complete-phase",
          artifactRefs:
            artifactReadable && typeof artifact === "string" ? [artifact] : [],
          evidenceRefs:
            evidenceReadable && typeof evidence === "string" ? [evidence] : [],
          gateFailures:
            readiness.kind === "accepted" &&
            artifactReadable &&
            evidenceReadable
              ? []
              : ["gate.aceitacao_final"],
          allowFinalCompletion: true,
        },
      }),
      observation,
    );
  },
);

function workflowDecision(
  workflow: WorkflowDecision,
  observation: Observation,
  authorizedEffects: readonly Effect[] = [],
): Decision {
  if (workflow.kind === "refused") {
    const evidence =
      workflow.reasonCode === "trail.uso" ||
      workflow.reasonCode === "trail.worktree_dirty"
        ? []
        : [
            {
              kind: "artifact" as const,
              ref: `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}`,
            },
          ];
    return {
      result: resultFor(workflow.reasonCode, {
        why: [
          "The persisted run preconditions did not authorize this operation.",
        ],
        evidence,
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  if (workflow.kind === "unchanged") {
    return {
      result: resultFor(
        workflow.reason === "already-completed"
          ? "done.all_steps"
          : "run.resuming",
        { summary: "The workflow operation was already reflected in state." },
      ),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  const measurementEffect = completionMeasurementEffect(workflow, observation);
  if (measurementEffect.kind === "refused") {
    return {
      result: resultFor(measurementEffect.reasonCode, {
        why: [measurementEffect.why],
        evidence: [
          { kind: "artifact", ref: ".brain/03-memory/task_log.jsonl" },
        ],
      }),
      plan: planOf(),
      humanStdout: null,
      payload: null,
    };
  }
  const runRoot = `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}`;
  const effects: Effect[] = [
    ...authorizedEffects,
    ...(measurementEffect.effect === null ? [] : [measurementEffect.effect]),
  ];
  let lineageRef: string | null = null;
  if (workflow.transition === "started") {
    effects.push({
      kind: "write_file",
      path: `.brain/02-features/${observation.configuration.feature}/active-run`,
      content: `${observation.configuration.runId}\n`,
    });
  }
  effects.push({
    kind: "append_event",
    feature: observation.configuration.feature,
    runId: observation.configuration.runId,
    event: workflow.event,
  });
  const artifact = observation.referencedFiles.find(({ ref }) =>
    workflow.event.artifactRefs.includes(ref),
  );
  if (
    artifact !== undefined &&
    (workflow.transition === "accepted" || workflow.transition === "completed")
  ) {
    const lineagePath = `${runRoot}/lineage/${workflow.event.eventId}.json`;
    lineageRef = lineagePath;
    effects.push({
      kind: "write_file",
      path: lineagePath,
      content: `${JSON.stringify(
        {
          contractVersion: "1.0.0",
          artifactId: `artifact:${artifact.sha256.slice(0, 24)}`,
          artifactRef: artifact.ref,
          artifactDigest: artifact.sha256,
          parentDigests: [
            observation.observedLineage.prdDigest,
            observation.observedLineage.specDigest,
          ].filter((digest, index, values) => values.indexOf(digest) === index),
          runId: observation.configuration.runId,
          phase:
            observation.workflow.kind === "present"
              ? (observation.workflow.state.currentStep ?? "acceptance")
              : "acceptance",
          policyMode: observation.policyMode,
          policyVersion: workflow.event.policyVersion,
          producerCommand: workflow.event.operation,
          commit: observation.gitCommit,
          evidenceRefs: workflow.event.evidenceRefs,
          observedIdentity: {
            ...observation.observedIdentity,
            provenance: observation.identityProvenance,
          },
        },
        null,
        2,
      )}\n`,
    });
  }
  return {
    result: resultFor("trail.ok", {
      summary: `Workflow transition ${workflow.transition} was recorded.`,
      why:
        workflow.transition === "rejected"
          ? (workflow.why ?? [
              "The workflow transition was rejected by its persisted conditions.",
            ])
          : [],
      stateChanged: true,
      evidence: [
        { kind: "event", ref: `${runRoot}/events.jsonl` },
        { kind: "artifact", ref: `${runRoot}/state.json` },
        ...(lineageRef === null
          ? []
          : [{ kind: "artifact" as const, ref: lineageRef }]),
      ],
    }),
    plan: planOf(...effects),
    humanStdout: null,
    payload: null,
    eventReducers: workflowReducerRegistry(observation.configuration),
    ...(workflow.event.resolvedAssignment === undefined ||
    observation.phaseAssignment.kind !== "resolved"
      ? {}
      : {
          revalidatePhaseAssignmentDigest:
            observation.phaseAssignment.value.assignmentDigest,
        }),
  };
}

function completionMeasurementEffect(
  workflow: Extract<WorkflowDecision, { readonly kind: "recorded" }>,
  observation: Observation,
):
  | {
      readonly kind: "accepted";
      readonly effect: Extract<Effect, { readonly kind: "write_file" }> | null;
    }
  | {
      readonly kind: "refused";
      readonly reasonCode:
        "metrics.phase_not_started" | "metrics.phase_assignment_conflict";
      readonly why: string;
    } {
  if (
    workflow.transition !== "accepted" &&
    workflow.transition !== "completed"
  ) {
    return { kind: "accepted", effect: null };
  }
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
  if (record === undefined) {
    return {
      kind: "refused",
      reasonCode: "metrics.phase_not_started",
      why: "The accepted transition has no matching running phase measurement.",
    };
  }
  if (
    observation.phaseAssignment.kind !== "resolved" ||
    !samePhaseMeasurementAssignment(record.resolvedAssignment, {
      host: observation.phaseAssignment.value.host,
      role: observation.phaseAssignment.value.assignment.role,
      model: observation.phaseAssignment.value.assignment.model,
      effort: observation.phaseAssignment.value.assignment.effort,
    })
  ) {
    return {
      kind: "refused",
      reasonCode: "metrics.phase_assignment_conflict",
      why: "The running phase measurement belongs to another assignment.",
    };
  }
  const eventIdentity = workflow.event.observedIdentity;
  const completed = completePhaseMeasurement({
    record,
    totalGrossTokens: record.baselineGrossTokens + record.grossTokens,
    now: workflow.event.occurredAt,
    observedIdentity: {
      model: eventIdentity.model ?? record.observedIdentity.model,
      effort:
        "effort" in eventIdentity
          ? (eventIdentity.effort ?? record.observedIdentity.effort)
          : record.observedIdentity.effort,
    },
  });
  const content = renderPhaseMeasurementLog(
    upsertPhaseMeasurement(observation.measurements.records, completed),
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

function invalidCriteriaDocument(observation: Observation): Decision {
  const document = observation.acceptanceCriteria.document;
  const reasonCode =
    document.kind === "missing"
      ? "gate.ac_document_missing"
      : document.kind === "duplicate"
        ? "gate.ac_identifier_duplicate"
        : "gate.ac_identifier_malformed";
  const detail =
    document.kind === "duplicate"
      ? `Duplicate acceptance criterion identifier: ${document.criterionId}.`
      : document.kind === "malformed"
        ? `Malformed acceptance criterion declaration at line ${String(document.line)}.`
        : "The task document contains no identified acceptance criteria.";
  return {
    result: resultFor(reasonCode, {
      why: [detail],
      evidence: [
        { kind: "artifact", ref: observation.acceptanceCriteria.documentRef },
      ],
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function criteriaPolicyRefusal(
  observation: Observation,
  reasonCode:
    | "gate.ac_baseline_unverifiable"
    | "gate.ac_declaration_changed"
    | "gate.ac_append_forbidden"
    | "gate.ac_checkbox_forbidden",
  detail: string,
): Decision {
  return {
    result: resultFor(reasonCode, {
      why: [detail],
      evidence: [
        { kind: "artifact", ref: observation.acceptanceCriteria.documentRef },
      ],
    }),
    plan: planOf(),
    humanStdout: null,
    payload: null,
  };
}

function artifactDigestRef(ref: string, digest: string): string {
  return `${ref}#sha256=${digest}`;
}
