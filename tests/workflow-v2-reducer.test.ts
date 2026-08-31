import {
  LEGACY_WORKFLOW_POLICY_VERSION,
  WORKFLOW_POLICY_VERSION,
  decideStartWorkflow,
  reduceWorkflow,
  reduceWorkflowV1,
  workflowSeed,
  type WorkflowState,
} from "@kratos/runtime/domain/workflow";
import { describe, expect, it } from "vitest";

const lineage = {
  prdDigest: "a".repeat(64),
  specDigest: "b".repeat(64),
};
const configuration = {
  projectId: "project-01",
  feature: "repair-loop",
  runId: "run-01",
  lineage,
};

function event(
  priorRevision: number,
  reasonCode: string,
  metadata: object = {},
) {
  return {
    contractVersion: "1.2.0",
    stateContract: "1.2.0",
    eventId: `event-${String(priorRevision + 1)}`,
    eventType: "decision",
    occurredAt: `2026-08-30T12:0${String(priorRevision)}:00.000Z`,
    operation: `sdd.acceptance.record:attempt-${String(priorRevision + 1)}`,
    policyVersion: WORKFLOW_POLICY_VERSION,
    priorRevision,
    resultingRevision: priorRevision + 1,
    reasonCode,
    effect: "state-and-artifact",
    artifactRefs: [],
    evidenceRefs: [],
    observedIdentity: { host: "codex", model: "gpt-5", effort: "medium" },
    previousHash: null,
    eventHash: "c".repeat(64),
    ...metadata,
  } as never;
}

describe("workflow-v2 repair-loop reducer", () => {
  it("freezes the resolved attempt and objective token ceilings at start", () => {
    const decision = decideStartWorkflow(
      { kind: "absent", operations: [] },
      {
        ...configuration,
        correlationId: "start-v2",
        eventId: "event-start-v2",
        occurredAt: "2026-08-30T12:00:00.000Z",
        objectiveActive: true,
        worktreeClean: true,
        observedIdentity: { host: "codex", model: "gpt-5" },
        acceptanceAttemptCeiling: 5,
        tokenCeiling: 4096,
      },
    );

    expect(decision).toMatchObject({
      kind: "recorded",
      transition: "started",
      event: {
        contractVersion: "1.2.0",
        stateContract: "1.2.0",
        policyVersion: "workflow-v2",
        runLimits: {
          acceptanceAttemptCeiling: 5,
          tokenCeiling: 4096,
        },
      },
    });
  });

  it("returns a below-ceiling acceptance rejection to code", () => {
    const started = reduceWorkflow(
      workflowSeed(configuration),
      event(0, "run.started", {
        eventType: "transition",
        effect: "state",
        operation: "sdd.start:start-v2",
        runLimits: { acceptanceAttemptCeiling: 3, tokenCeiling: null },
      }),
    );
    const accepting = {
      ...started,
      currentStep: "acceptance" as const,
    };

    const repaired = reduceWorkflow(
      accepting,
      event(1, "run.acceptance.repair_required", {
        acceptanceDecision: {
          outcome: "repair",
          attempts: [{ criterionId: "AC-1.1.1", attempt: 1 }],
          repairStops: [],
        },
      }),
    );

    expect(repaired).toMatchObject({
      status: "active",
      currentStep: "code",
      attempts: [{ criterionId: "AC-1.1.1", attempt: 1 }],
      activeRepairStops: [],
      acceptanceAttemptCeiling: 3,
      tokenCeiling: null,
    });
  });

  it("blocks with every simultaneously tripping stop in event order", () => {
    const accepting = {
      ...workflowSeed(configuration),
      status: "active" as const,
      currentStep: "acceptance" as const,
      revision: 2,
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:01:00.000Z",
      acceptanceAttemptCeiling: 3,
      tokenCeiling: 4096,
      attempts: [
        { criterionId: "AC-1.1.1", attempt: 2 },
        { criterionId: "AC-1.1.2", attempt: 2 },
      ],
    };
    const stopped = reduceWorkflow(
      accepting,
      event(2, "run.stop_loss.repeated_rejection", {
        artifactRefs: [
          ".brain/runs/run-01/repair-stops/AC-1.1.2.json",
          ".brain/runs/run-01/repair-stops/AC-1.1.1.json",
        ],
        acceptanceDecision: {
          outcome: "stopped",
          attempts: [
            { criterionId: "AC-1.1.2", attempt: 3 },
            { criterionId: "AC-1.1.1", attempt: 3 },
          ],
          repairStops: [
            {
              criterionId: "AC-1.1.2",
              attempt: 3,
              classification: "code",
              artifactRef: ".brain/runs/run-01/repair-stops/AC-1.1.2.json",
              artifactDigest: "d".repeat(64),
            },
            {
              criterionId: "AC-1.1.1",
              attempt: 3,
              classification: "specification",
              artifactRef: ".brain/runs/run-01/repair-stops/AC-1.1.1.json",
              artifactDigest: "e".repeat(64),
            },
          ],
        },
      }),
    );

    expect(stopped.status).toBe("blocked");
    expect(stopped.currentStep).toBe("acceptance");
    expect(stopped.attempts).toEqual([
      { criterionId: "AC-1.1.2", attempt: 3 },
      { criterionId: "AC-1.1.1", attempt: 3 },
    ]);
    expect(
      stopped.activeRepairStops.map(({ criterionId }) => criterionId),
    ).toEqual(["AC-1.1.2", "AC-1.1.1"]);
  });

  it("does not reset attempts on accepted outcomes or plain resume", () => {
    const accepting = {
      ...workflowSeed(configuration),
      status: "active" as const,
      currentStep: "acceptance" as const,
      revision: 2,
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:01:00.000Z",
      acceptanceAttemptCeiling: 3,
      tokenCeiling: null,
      attempts: [{ criterionId: "AC-1.1.1", attempt: 2 }],
    };
    const passed = reduceWorkflow(
      accepting,
      event(2, "run.acceptance.passed", {
        acceptanceDecision: {
          outcome: "passed",
          attempts: [],
          repairStops: [],
        },
      }),
    );
    const resumed = reduceWorkflow(
      passed,
      event(3, "run.resumed", {
        eventType: "transition",
        effect: "state",
        operation: "sdd.start:resume-v2",
      }),
    );

    expect(passed.attempts).toEqual(accepting.attempts);
    expect(resumed.attempts).toEqual(accepting.attempts);
  });

  it.each([
    { stopState: "active repair stop", reasonCode: "run.resumed" },
    {
      stopState: "active repair stop",
      reasonCode: "run.transition.accepted",
    },
    { stopState: "active repair stop", reasonCode: "run.completed" },
    { stopState: "specification restart", reasonCode: "run.resumed" },
    {
      stopState: "specification restart",
      reasonCode: "run.transition.accepted",
    },
    { stopState: "specification restart", reasonCode: "run.completed" },
  ] as const)(
    "rejects forged $reasonCode while a $stopState blocks the run",
    ({ stopState, reasonCode }) => {
      const completing = reasonCode === "run.completed";
      const blocked: WorkflowState = {
        ...workflowSeed(configuration),
        status: "blocked" as const,
        currentStep: completing ? ("acceptance" as const) : ("prd" as const),
        revision: 2,
        createdAt: "2026-08-30T12:00:00.000Z",
        updatedAt: "2026-08-30T12:01:00.000Z",
        policyVersion: WORKFLOW_POLICY_VERSION,
        acceptanceAttemptCeiling: 3,
        ...(stopState === "active repair stop"
          ? {
              activeRepairStops: [
                {
                  criterionId: "AC-1.1.1",
                  attempt: 3,
                  classification: "code" as const,
                  artifactRef: ".brain/stops/AC-1.1.1.json",
                  artifactDigest: "d".repeat(64),
                },
              ],
            }
          : {
              specificationRestart: {
                criterionId: "AC-1.1.1",
                nextRunId: "run-02",
                restartTicketRef: ".brain/restarts/run-02.json",
                restartTicketDigest: "e".repeat(64),
              },
            }),
      };
      expect(() =>
        reduceWorkflow(
          blocked,
          event(2, reasonCode, {
            eventType: "transition",
            effect: "state",
            operation: "sdd.continue:forged-stop-bypass",
          }),
        ),
      ).toThrow("Run is blocked by repair stop");
    },
  );

  it.each([
    {
      label: "non-incrementing attempt",
      reasonCode: "run.acceptance.repair_required",
      acceptanceDecision: {
        outcome: "repair",
        attempts: [{ criterionId: "AC-1.1.1", attempt: 2 }],
        repairStops: [],
      },
      artifactRefs: [],
    },
    {
      label: "repair outcome at the ceiling",
      reasonCode: "run.acceptance.repair_required",
      acceptanceDecision: {
        outcome: "repair",
        attempts: [{ criterionId: "AC-1.1.1", attempt: 3 }],
        repairStops: [],
      },
      artifactRefs: [],
    },
    {
      label: "incomplete simultaneous stop set",
      reasonCode: "run.stop_loss.repeated_rejection",
      acceptanceDecision: {
        outcome: "stopped",
        attempts: [
          { criterionId: "AC-1.1.1", attempt: 3 },
          { criterionId: "AC-1.1.2", attempt: 3 },
        ],
        repairStops: [
          {
            criterionId: "AC-1.1.1",
            attempt: 3,
            classification: "code",
            artifactRef: ".brain/stops/AC-1.1.1.json",
            artifactDigest: "d".repeat(64),
          },
        ],
      },
      artifactRefs: [".brain/stops/AC-1.1.1.json"],
    },
    {
      label: "stop order that differs from attempt order",
      reasonCode: "run.stop_loss.repeated_rejection",
      acceptanceDecision: {
        outcome: "stopped",
        attempts: [
          { criterionId: "AC-1.1.1", attempt: 3 },
          { criterionId: "AC-1.1.2", attempt: 3 },
        ],
        repairStops: [
          {
            criterionId: "AC-1.1.2",
            attempt: 3,
            classification: "code",
            artifactRef: ".brain/stops/AC-1.1.2.json",
            artifactDigest: "e".repeat(64),
          },
          {
            criterionId: "AC-1.1.1",
            attempt: 3,
            classification: "code",
            artifactRef: ".brain/stops/AC-1.1.1.json",
            artifactDigest: "d".repeat(64),
          },
        ],
      },
      artifactRefs: [
        ".brain/stops/AC-1.1.1.json",
        ".brain/stops/AC-1.1.2.json",
      ],
    },
  ])("rejects a $label instead of replaying it", (subject) => {
    const accepting = {
      ...workflowSeed(configuration),
      status: "active" as const,
      currentStep: "acceptance" as const,
      revision: 2,
      createdAt: "2026-08-30T12:00:00.000Z",
      updatedAt: "2026-08-30T12:02:00.000Z",
      acceptanceAttemptCeiling: 3,
      tokenCeiling: null,
      attempts: [
        { criterionId: "AC-1.1.1", attempt: 2 },
        { criterionId: "AC-1.1.2", attempt: 2 },
      ],
    };
    expect(() =>
      reduceWorkflow(
        accepting,
        event(2, subject.reasonCode, {
          artifactRefs: subject.artifactRefs,
          acceptanceDecision: subject.acceptanceDecision,
        }),
      ),
    ).toThrow("Acceptance decision is inconsistent");
  });

  it("rejects a workflow-v2 continuation of a legacy run without frozen limits", () => {
    const legacy = reduceWorkflowV1(
      workflowSeed(configuration),
      event(0, "run.started", {
        contractVersion: "1.1.0",
        stateContract: "1.1.0",
        eventType: "transition",
        effect: "state",
        operation: "sdd.start:legacy",
        policyVersion: LEGACY_WORKFLOW_POLICY_VERSION,
      }),
    );
    expect(() =>
      reduceWorkflow(
        legacy,
        event(1, "run.resumed", {
          eventType: "transition",
          effect: "state",
          operation: "sdd.start:v2-resume",
        }),
      ),
    ).toThrow("Workflow limits are missing");
  });
});
