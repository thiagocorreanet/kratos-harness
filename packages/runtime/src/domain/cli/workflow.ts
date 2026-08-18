import { planOf, type Effect } from "../effects.js";
import { decideDone } from "../acceptance/index.js";
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
    const evidenceReadable =
      typeof evidence === "string" &&
      selectedEvidence !== undefined &&
      !observation.invalidEvidenceIds.includes(selectedEvidence.evidenceId);
    const refs = {
      artifactRefs:
        artifactReadable && typeof artifact === "string" ? [artifact] : [],
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
              ],
              allowFinalCompletion: false,
            } as const)
          : ({ kind: "resume" } as const);
    return workflowDecision(
      decideContinueWorkflow(observation.workflow, {
        feature: observation.configuration.feature,
        runId: observation.configuration.runId,
        correlationId: observation.correlationId,
        eventId: observation.eventId,
        occurredAt: observation.occurredAt,
        expectedRevision,
        observedIdentity: observation.observedIdentity,
        action,
      }),
      observation,
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
    return workflowDecision(
      decideContinueWorkflow(observation.workflow, {
        feature: observation.configuration.feature,
        runId: observation.configuration.runId,
        correlationId: observation.correlationId,
        eventId: observation.eventId,
        occurredAt: observation.occurredAt,
        expectedRevision:
          typeof expected === "string" ? Number(expected) : revision,
        observedIdentity: observation.observedIdentity,
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
  const runRoot = `.brain/02-features/${observation.configuration.feature}/runs/${observation.configuration.runId}`;
  const effects: Effect[] = [];
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
  };
}
