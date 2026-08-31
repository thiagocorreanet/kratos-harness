import { createHash } from "node:crypto";

import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  decideContinueWorkflow,
  decideRecordFact,
  decideStartWorkflow,
  workflowReducerRegistry,
  type WorkflowObservation,
  type WorkflowState,
} from "@kratos/runtime/domain/workflow";
import {
  replayEventStream,
  sealEvent,
  snapshotEventDraft,
  verifyEventStream,
} from "@kratos/runtime/domain/events";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { describe, expect, it } from "vitest";

const digest = "a".repeat(64);
const lineage = { prdDigest: digest, specDigest: "b".repeat(64) };
const identity = { host: "codex", model: "gpt-5" };
const assignment = {
  phase: "prd" as const,
  role: "planner" as const,
  model: "gpt-5",
  effort: "medium",
};
const phaseExecution = {
  assignmentDigest: digest,
  model: null,
  effort: null,
  provenance: "unknown" as const,
};
const configuration = {
  projectId: "project-01",
  feature: "workflow",
  runId: "run-01",
  lineage,
};
const services = {
  digests: {
    sha256: (value: string) => createHash("sha256").update(value).digest("hex"),
  },
  isProxy: () => false,
  isPromise: () => false,
  schemaRegistry: createSchemaRegistry(),
};

function present(overrides: Partial<WorkflowState> = {}): WorkflowObservation {
  return {
    kind: "present",
    state: {
      projectId: "project-01",
      feature: "workflow",
      runId: "run-01",
      status: "active",
      currentStep: "prd",
      revision: 1,
      lineage,
      createdAt: "2026-08-15T12:00:00.000Z",
      updatedAt: "2026-08-15T12:00:00.000Z",
      operations: ["sdd.start:start-01"],
      policyVersion: "workflow-v2",
      acceptanceAttemptCeiling: 3,
      tokenCeiling: null,
      attempts: [],
      activeRepairStops: [],
      repairStopHistory: [],
      repairResolutions: [],
      specificationRestart: null,
      retiredCriterionIds: [],
      startedFromSpec: null,
      ...overrides,
    },
  };
}

describe("workflow start and continuation", () => {
  it("feeds a real start decision through current draft snapshotting", () => {
    const decision = decideStartWorkflow(
      { kind: "absent", operations: [] },
      {
        ...configuration,
        correlationId: "start-current",
        eventId: "event-start-current",
        occurredAt: "2026-08-15T12:00:00.000Z",
        objectiveActive: true,
        worktreeClean: true,
        observedIdentity: identity,
      },
    );
    if (decision.kind !== "recorded") throw new Error("start refused");

    expect(snapshotEventDraft(decision.event, () => false)).toMatchObject({
      contractVersion: "1.2.0",
      stateContract: "1.2.0",
      observedIdentity: { host: "codex", model: "gpt-5", effort: null },
    });
    expect(decision.event).not.toHaveProperty("resolvedAssignment");
  });

  it("feeds accepted and phase-output decisions through current sealing", () => {
    const continuedRequest = {
      feature: "workflow",
      runId: "run-01",
      correlationId: "continue-current",
      eventId: "event-continue-current",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      observedIdentity: identity,
      resolvedAssignment: assignment,
      phaseExecution,
      action: {
        kind: "complete-phase" as const,
        artifactRefs: [".brain/02-features/workflow/00-prd.md"],
        evidenceRefs: [".brain/evidence/prd.json"],
        gateFailures: [],
        allowFinalCompletion: false,
      },
    };
    const continued = decideContinueWorkflow(present(), continuedRequest);
    if (continued.kind !== "recorded") throw new Error("continue refused");
    expect(
      sealEvent(continued.event, { revision: 1, hash: digest }, services),
    ).toMatchObject({
      stateContract: "1.2.0",
      resolvedAssignment: assignment,
    });

    const recorded = decideRecordFact(present(), {
      feature: "workflow",
      runId: "run-01",
      correlationId: "agent-current",
      eventId: "event-agent-current",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      operation: "agent.record",
      artifactRefs: [".brain/agent-output/prd.json"],
      observedIdentity: identity,
      resolvedAssignment: assignment,
      phaseExecution,
    });
    if (recorded.kind !== "recorded") throw new Error("record refused");
    expect(snapshotEventDraft(recorded.event, () => false)).toMatchObject({
      stateContract: "1.2.0",
      resolvedAssignment: assignment,
    });
  });

  it("constructs phase event identity from the execution observation", () => {
    const decision = decideRecordFact(present(), {
      feature: "workflow",
      runId: "run-01",
      correlationId: "agent-runtime-owned",
      eventId: "event-agent-runtime-owned",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      operation: "agent.record",
      artifactRefs: [".brain/agent-output/prd.json"],
      observedIdentity: { host: "codex", model: "user-declared-model" },
      resolvedAssignment: assignment,
      phaseExecution: {
        assignmentDigest: digest,
        model: null,
        effort: null,
        provenance: "unknown",
      },
    });

    expect(decision).toMatchObject({
      kind: "recorded",
      event: {
        resolvedAssignment: assignment,
        observedIdentity: { host: "codex", model: null, effort: null },
      },
    });
  });

  it("refuses runtime-invalid provenance before recording a phase fact", () => {
    const runtimeInput: unknown = {
      assignmentDigest: digest,
      model: "gpt-5",
      effort: "medium",
      provenance: "runtime-invalid",
    };

    const decision = decideRecordFact(present(), {
      feature: "workflow",
      runId: "run-01",
      correlationId: "agent-invalid-provenance",
      eventId: "event-agent-invalid-provenance",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      operation: "agent.record",
      artifactRefs: [".brain/agent-output/prd.json"],
      observedIdentity: { host: "codex", model: "user-declared-model" },
      resolvedAssignment: assignment,
      phaseExecution: runtimeInput as typeof phaseExecution,
    });

    expect(decision).toEqual({ kind: "refused", reasonCode: "trail.uso" });
    expect(decision).not.toHaveProperty("event");
    expect(JSON.stringify(decision)).not.toContain("user-declared-model");
  });

  it("refuses runtime-invalid provenance before recording a phase transition", () => {
    const runtimeInput: unknown = {
      assignmentDigest: digest,
      model: "gpt-5",
      effort: "medium",
      provenance: "runtime-invalid",
    };

    const decision = decideContinueWorkflow(present(), {
      feature: "workflow",
      runId: "run-01",
      correlationId: "continue-invalid-provenance",
      eventId: "event-continue-invalid-provenance",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      observedIdentity: { host: "codex", model: "user-declared-model" },
      resolvedAssignment: assignment,
      phaseExecution: runtimeInput as typeof phaseExecution,
      action: {
        kind: "complete-phase",
        artifactRefs: [".brain/02-features/workflow/00-prd.md"],
        evidenceRefs: [".brain/evidence/prd.json"],
        gateFailures: [],
        allowFinalCompletion: false,
      },
    });

    expect(decision).toEqual({ kind: "refused", reasonCode: "trail.uso" });
    expect(decision).not.toHaveProperty("event");
    expect(JSON.stringify(decision)).not.toContain("user-declared-model");
  });

  it("normalizes every unknown execution field for a phase transition", () => {
    const decision = decideContinueWorkflow(present(), {
      feature: "workflow",
      runId: "run-01",
      correlationId: "continue-unknown-execution",
      eventId: "event-continue-unknown-execution",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      observedIdentity: { host: "codex", model: "user-declared-model" },
      resolvedAssignment: assignment,
      phaseExecution: {
        assignmentDigest: digest,
        model: "gpt-5",
        effort: "medium",
        provenance: "unknown",
      },
      action: {
        kind: "complete-phase",
        artifactRefs: [".brain/02-features/workflow/00-prd.md"],
        evidenceRefs: [".brain/evidence/prd.json"],
        gateFailures: [],
        allowFinalCompletion: false,
      },
    });

    expect(decision).toMatchObject({
      kind: "recorded",
      event: {
        observedIdentity: { host: "codex", model: null, effort: null },
      },
    });
  });

  it("keeps validated nullable host execution fields on phase events", () => {
    const fact = decideRecordFact(present(), {
      feature: "workflow",
      runId: "run-01",
      correlationId: "agent-host-execution",
      eventId: "event-agent-host-execution",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      operation: "agent.record",
      artifactRefs: [".brain/agent-output/prd.json"],
      observedIdentity: { host: "codex", model: "user-declared-model" },
      resolvedAssignment: assignment,
      phaseExecution: {
        assignmentDigest: digest,
        model: "gpt-5",
        effort: null,
        provenance: "host-reported",
      },
    });
    const transition = decideContinueWorkflow(present(), {
      feature: "workflow",
      runId: "run-01",
      correlationId: "continue-host-execution",
      eventId: "event-continue-host-execution",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      observedIdentity: { host: "codex", model: "user-declared-model" },
      resolvedAssignment: assignment,
      phaseExecution: {
        assignmentDigest: digest,
        model: null,
        effort: "medium",
        provenance: "host-reported",
      },
      action: {
        kind: "complete-phase",
        artifactRefs: [".brain/02-features/workflow/00-prd.md"],
        evidenceRefs: [".brain/evidence/prd.json"],
        gateFailures: [],
        allowFinalCompletion: false,
      },
    });

    expect(fact).toMatchObject({
      kind: "recorded",
      event: {
        observedIdentity: { host: "codex", model: "gpt-5", effort: null },
      },
    });
    expect(transition).toMatchObject({
      kind: "recorded",
      event: {
        observedIdentity: { host: "codex", model: null, effort: "medium" },
      },
    });
  });

  it("fails closed when an accepted transition or phase output lacks assignment", () => {
    const continued = decideContinueWorkflow(present(), {
      feature: "workflow",
      runId: "run-01",
      correlationId: "continue-unassigned",
      eventId: "event-continue-unassigned",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      observedIdentity: identity,
      action: {
        kind: "complete-phase",
        artifactRefs: [".brain/02-features/workflow/00-prd.md"],
        evidenceRefs: [".brain/evidence/prd.json"],
        gateFailures: [],
        allowFinalCompletion: false,
      },
    });
    const recorded = decideRecordFact(present(), {
      feature: "workflow",
      runId: "run-01",
      correlationId: "agent-unassigned",
      eventId: "event-agent-unassigned",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      operation: "agent.record",
      artifactRefs: [".brain/agent-output/prd.json"],
      observedIdentity: identity,
    });

    expect(continued).toEqual({
      kind: "refused",
      reasonCode: "trail.uso",
    });
    expect(recorded).toEqual({
      kind: "refused",
      reasonCode: "trail.uso",
    });
  });

  it.each(["gaps.record", "gates.record"] as const)(
    "feeds a real %s fact through current sealing without assignment",
    (operation) => {
      const decision = decideRecordFact(present(), {
        feature: "workflow",
        runId: "run-01",
        correlationId: `${operation}-current`,
        eventId: `${operation}-event-current`,
        occurredAt: "2026-08-15T12:01:00.000Z",
        expectedRevision: 1,
        operation,
        artifactRefs: [`.brain/${operation}.json`],
        observedIdentity: identity,
      });
      if (decision.kind !== "recorded") throw new Error("fact refused");

      expect(snapshotEventDraft(decision.event, () => false)).toMatchObject({
        stateContract: "1.2.0",
        observedIdentity: { host: "codex", model: "gpt-5", effort: null },
      });
      expect(decision.event).not.toHaveProperty("resolvedAssignment");
    },
  );

  it("starts an absent run with a deterministic first transition", () => {
    const decision = decideStartWorkflow(
      { kind: "absent", operations: [] },
      {
        ...configuration,
        correlationId: "start-01",
        eventId: "event-01",
        occurredAt: "2026-08-15T12:00:00.000Z",
        objectiveActive: true,
        worktreeClean: true,
        observedIdentity: identity,
      },
    );

    expect(decision.kind).toBe("recorded");
    if (decision.kind !== "recorded") return;
    expect(decision.transition).toBe("started");
    expect(decision.event).toMatchObject({
      operation: "sdd.start:start-01",
      policyVersion: "workflow-v2",
      priorRevision: 0,
      resultingRevision: 1,
      reasonCode: "run.started",
    });
  });

  it("makes a repeated correlation id an exact no-op", () => {
    expect(
      decideStartWorkflow(present(), {
        ...configuration,
        correlationId: "start-01",
        eventId: "event-retry",
        occurredAt: "2026-08-15T12:01:00.000Z",
        objectiveActive: true,
        worktreeClean: true,
        observedIdentity: identity,
      }),
    ).toEqual({ kind: "unchanged", reason: "duplicate" });
  });

  it("persists one explicit limit-freezing upgrade for a legacy run", () => {
    const legacy = present({
      policyVersion: "workflow-v1",
      acceptanceAttemptCeiling: null,
      tokenCeiling: null,
    });
    const upgraded = decideStartWorkflow(legacy, {
      ...configuration,
      correlationId: "resume-legacy",
      eventId: "event-resume-legacy",
      occurredAt: "2026-08-15T12:01:00.000Z",
      objectiveActive: true,
      worktreeClean: true,
      observedIdentity: identity,
      acceptanceAttemptCeiling: 5,
      tokenCeiling: 4096,
    });
    expect(upgraded).toMatchObject({
      kind: "recorded",
      transition: "upgraded",
      event: {
        stateContract: "1.4.0",
        reasonCode: "run.policy_upgraded",
        priorRevision: 1,
        resultingRevision: 2,
        runLimits: { acceptanceAttemptCeiling: 5, tokenCeiling: 4096 },
      },
    });
  });

  it("still refuses a legacy continuation or fact before the upgrade boundary", () => {
    const legacy = present({
      policyVersion: "workflow-v1",
      acceptanceAttemptCeiling: null,
      tokenCeiling: null,
    });
    expect(
      decideContinueWorkflow(legacy, {
        feature: "workflow",
        runId: "run-01",
        correlationId: "continue-legacy",
        eventId: "event-continue-legacy",
        occurredAt: "2026-08-15T12:01:00.000Z",
        expectedRevision: 1,
        observedIdentity: identity,
        action: { kind: "resume" },
      }),
    ).toEqual({ kind: "refused", reasonCode: "trail.uso" });
    expect(
      decideRecordFact(legacy, {
        feature: "workflow",
        runId: "run-01",
        correlationId: "fact-legacy",
        eventId: "event-fact-legacy",
        occurredAt: "2026-08-15T12:01:00.000Z",
        expectedRevision: 1,
        operation: "gaps.record",
        artifactRefs: [".brain/gaps/gap-legacy.json"],
        observedIdentity: identity,
      }),
    ).toEqual({ kind: "refused", reasonCode: "trail.uso" });
  });

  it("rejects stale continuations without producing an event", () => {
    expect(
      decideContinueWorkflow(present(), {
        feature: "workflow",
        runId: "run-01",
        correlationId: "continue-01",
        eventId: "event-02",
        occurredAt: "2026-08-15T12:01:00.000Z",
        expectedRevision: 0,
        observedIdentity: identity,
        action: {
          kind: "complete-phase",
          artifactRefs: [".brain/02-features/workflow/00-prd.md"],
          evidenceRefs: [".brain/evidence/prd.json"],
          gateFailures: [],
          allowFinalCompletion: false,
        },
      }),
    ).toEqual({
      kind: "refused",
      reasonCode: "runtime.revision_conflict",
    });
  });

  it("records a rejected transition when evidence or a gate is missing", () => {
    const decision = decideContinueWorkflow(present(), {
      feature: "workflow",
      runId: "run-01",
      correlationId: "continue-01",
      eventId: "event-02",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      observedIdentity: identity,
      action: {
        kind: "complete-phase",
        artifactRefs: [],
        evidenceRefs: [],
        gateFailures: ["gate.prd_ausente"],
        allowFinalCompletion: false,
      },
    });

    expect(decision).toMatchObject({
      kind: "recorded",
      transition: "rejected",
      why: ["gate.prd_ausente", "artifact-missing", "evidence-missing"],
      event: { reasonCode: "run.transition.rejected" },
    });
  });

  it.each([
    { stopState: "active repair stop", action: "resume" },
    { stopState: "active repair stop", action: "advance" },
    { stopState: "active repair stop", action: "complete" },
    { stopState: "specification restart", action: "resume" },
    { stopState: "specification restart", action: "advance" },
    { stopState: "specification restart", action: "complete" },
  ] as const)(
    "refuses $action while a $stopState blocks the run",
    ({ stopState, action }) => {
      const final = action === "complete";
      const blocked =
        stopState === "active repair stop"
          ? present({
              status: "blocked",
              currentStep: final ? "acceptance" : "prd",
              activeRepairStops: [
                {
                  criterionId: "AC-1.1.1",
                  attempt: 3,
                  classification: "code",
                  artifactRef: ".brain/stops/AC-1.1.1.json",
                  artifactDigest: digest,
                },
              ],
            })
          : present({
              status: "blocked",
              currentStep: final ? "acceptance" : "prd",
              specificationRestart: {
                criterionId: "AC-1.1.1",
                nextRunId: "run-02",
                restartTicketRef: ".brain/restarts/run-02.json",
                restartTicketDigest: digest,
              },
            });
      expect(
        decideContinueWorkflow(blocked, {
          feature: "workflow",
          runId: "run-01",
          correlationId: `blocked-${action}`,
          eventId: `event-blocked-${action}`,
          occurredAt: "2026-08-15T12:01:00.000Z",
          expectedRevision: 1,
          observedIdentity: identity,
          ...(action === "resume"
            ? { action: { kind: "resume" as const } }
            : {
                resolvedAssignment: final
                  ? {
                      ...assignment,
                      phase: "acceptance" as const,
                      role: "judge" as const,
                    }
                  : assignment,
                phaseExecution,
                action: {
                  kind: "complete-phase" as const,
                  artifactRefs: [".brain/artifact.md"],
                  evidenceRefs: [".brain/evidence.json"],
                  gateFailures: [],
                  allowFinalCompletion: final,
                },
              }),
        }),
      ).toEqual({
        kind: "refused",
        reasonCode: "blocked.stop_loss_rejections",
      });
    },
  );

  it("replays accepted transitions into a contract-valid snapshot", () => {
    const started = decideStartWorkflow(
      { kind: "absent", operations: [] },
      {
        ...configuration,
        correlationId: "start-01",
        eventId: "event-01",
        occurredAt: "2026-08-15T12:00:00.000Z",
        objectiveActive: true,
        worktreeClean: true,
        observedIdentity: identity,
      },
    );
    if (started.kind !== "recorded") throw new Error("start refused");
    const first = sealEvent(
      started.event,
      { revision: 0, hash: null },
      services,
    );
    const observed = present();
    const continued = decideContinueWorkflow(observed, {
      feature: "workflow",
      runId: "run-01",
      correlationId: "continue-01",
      eventId: "event-02",
      occurredAt: "2026-08-15T12:01:00.000Z",
      expectedRevision: 1,
      observedIdentity: identity,
      resolvedAssignment: assignment,
      phaseExecution,
      action: {
        kind: "complete-phase",
        artifactRefs: [".brain/02-features/workflow/00-prd.md"],
        evidenceRefs: [".brain/evidence/prd.json"],
        gateFailures: [],
        allowFinalCompletion: false,
      },
    });
    if (continued.kind !== "recorded") throw new Error("continue refused");
    const second = sealEvent(
      continued.event,
      { revision: 1, hash: first.eventHash },
      services,
    );
    const stream = `${canonicalizeJson(first)}\n${canonicalizeJson(second)}\n`;
    const replay = replayEventStream(
      verifyEventStream(stream, services),
      workflowReducerRegistry(configuration),
      services,
    );

    expect(replay.state).toMatchObject({
      status: "active",
      currentStep: "spec",
      revision: 2,
      operations: ["sdd.start:start-01", "sdd.continue:continue-01"],
    });
    expect(replay.snapshot).toMatchObject({
      projectId: "project-01",
      runId: "run-01",
      status: "active",
      currentStep: "spec",
      eventCursor: 2,
      policyVersion: "workflow-v2",
    });
  });

  it("completes only from the final acceptance phase", () => {
    const decision = decideContinueWorkflow(
      present({ currentStep: "acceptance", revision: 6 }),
      {
        feature: "workflow",
        runId: "run-01",
        correlationId: "accept-01",
        eventId: "event-07",
        occurredAt: "2026-08-15T12:06:00.000Z",
        expectedRevision: 6,
        observedIdentity: identity,
        resolvedAssignment: {
          ...assignment,
          phase: "acceptance",
          role: "judge",
        },
        phaseExecution,
        action: {
          kind: "complete-phase",
          artifactRefs: [".brain/02-features/workflow/03-summa.md"],
          evidenceRefs: [".brain/evidence/acceptance.json"],
          gateFailures: [],
          allowFinalCompletion: true,
        },
      },
    );

    expect(decision).toMatchObject({
      kind: "recorded",
      transition: "completed",
      event: { reasonCode: "run.completed" },
    });
  });
});
