import { createHash } from "node:crypto";

import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  replayEventStream,
  sealEvent,
  verifyEventStream,
} from "@kratos/runtime/domain/events";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import {
  WORKFLOW_POLICY_VERSION,
  decideContinueWorkflow,
  decideResolveRepairStop,
  decideStartWorkflow,
  reduceWorkflow,
  workflowReducerRegistry,
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
const services = {
  digests: {
    sha256: (value: string) => createHash("sha256").update(value).digest("hex"),
  },
  isProxy: () => false,
  isPromise: () => false,
  schemaRegistry: createSchemaRegistry(),
};

function blockedState(): WorkflowState {
  return {
    ...workflowSeed(configuration),
    status: "blocked",
    currentStep: "acceptance",
    revision: 2,
    createdAt: "2026-08-30T12:00:00.000Z",
    updatedAt: "2026-08-30T12:01:00.000Z",
    policyVersion: WORKFLOW_POLICY_VERSION,
    acceptanceAttemptCeiling: 3,
    tokenCeiling: 4096,
    attempts: [
      { criterionId: "AC-1.1.1", attempt: 3 },
      { criterionId: "AC-1.1.2", attempt: 3 },
    ],
    activeRepairStops: [
      {
        criterionId: "AC-1.1.1",
        attempt: 3,
        classification: "code",
        artifactRef: ".brain/runs/run-01/stops/AC-1.1.1.json",
        artifactDigest: "c".repeat(64),
      },
      {
        criterionId: "AC-1.1.2",
        attempt: 3,
        classification: "code",
        artifactRef: ".brain/runs/run-01/stops/AC-1.1.2.json",
        artifactDigest: "d".repeat(64),
      },
    ],
  };
}

function resolve(
  state: WorkflowState,
  criterionId: string,
  correlationId: string,
  occurredAt = "2026-08-30T12:02:00.000Z",
) {
  return decideResolveRepairStop(
    { kind: "present", state },
    {
      feature: state.feature,
      runId: state.runId,
      criterionId,
      correlationId,
      eventId: `event-${correlationId}`,
      occurredAt,
      expectedRevision: state.revision,
      resolvedBy: "human-01",
      observation:
        "The implementation was corrected and independently verified.",
      observedIdentity: { host: "cli", model: null },
      resolutionRef: `.brain/resolutions/${correlationId}.json`,
      resolutionDigest: "e".repeat(64),
      nextRunId: null,
      restartTicketRef: null,
      restartTicketDigest: null,
    },
  );
}

describe("repair resolution reducer", () => {
  it("selectively resets code attempts and releases only after every code stop", () => {
    const first = resolve(blockedState(), "AC-1.1.1", "resolve-one");
    expect(first.kind).toBe("recorded");
    if (first.kind !== "recorded") return;

    const stillBlocked = reduceWorkflow(blockedState(), first.event);
    expect(stillBlocked).toMatchObject({
      status: "blocked",
      currentStep: "acceptance",
      tokenCeiling: 4096,
      attempts: [{ criterionId: "AC-1.1.2", attempt: 3 }],
      activeRepairStops: [expect.objectContaining({ criterionId: "AC-1.1.2" })],
    });

    const second = resolve(stillBlocked, "AC-1.1.2", "resolve-two");
    expect(second.kind).toBe("recorded");
    if (second.kind !== "recorded") return;
    expect(reduceWorkflow(stillBlocked, second.event)).toMatchObject({
      status: "active",
      currentStep: "code",
      tokenCeiling: 4096,
      attempts: [],
      activeRepairStops: [],
    });
  });

  it("refuses plain resume while a repeated-rejection stop is active", () => {
    const state = blockedState();
    expect(
      decideStartWorkflow(
        { kind: "present", state },
        {
          ...configuration,
          correlationId: "plain-start",
          eventId: "event-plain-start",
          occurredAt: "2026-08-30T12:03:00.000Z",
          objectiveActive: true,
          worktreeClean: true,
          observedIdentity: { host: "cli", model: null },
        },
      ),
    ).toEqual({ kind: "refused", reasonCode: "blocked.stop_loss_rejections" });
    expect(
      decideContinueWorkflow(
        { kind: "present", state },
        {
          feature: state.feature,
          runId: state.runId,
          correlationId: "plain-continue",
          eventId: "event-plain-continue",
          occurredAt: "2026-08-30T12:03:00.000Z",
          expectedRevision: state.revision,
          observedIdentity: { host: "cli", model: null },
          action: { kind: "resume" },
        },
      ),
    ).toEqual({ kind: "refused", reasonCode: "blocked.stop_loss_rejections" });
  });

  it("seals a specification restart and starts a fresh run at spec with fresh limits", () => {
    const firstStop = blockedState().activeRepairStops[0];
    if (firstStop === undefined) throw new Error("missing repair stop");
    const source = {
      ...blockedState(),
      activeRepairStops: [
        {
          ...firstStop,
          classification: "specification" as const,
        },
      ],
    };
    const resolution = decideResolveRepairStop(
      { kind: "present", state: source },
      {
        feature: source.feature,
        runId: source.runId,
        criterionId: "AC-1.1.1",
        correlationId: "restart-spec",
        eventId: "event-restart-spec",
        occurredAt: "2026-08-30T12:04:00.000Z",
        expectedRevision: source.revision,
        resolvedBy: "human-01",
        observation:
          "The criterion contradicts the approved design and must be replaced.",
        observedIdentity: { host: "cli", model: null },
        resolutionRef: ".brain/resolutions/restart-spec.json",
        resolutionDigest: "e".repeat(64),
        nextRunId: "run-02",
        restartTicketRef: ".brain/restarts/run-02.json",
        restartTicketDigest: "f".repeat(64),
      },
    );
    expect(resolution.kind).toBe("recorded");
    if (resolution.kind !== "recorded") return;
    const historical = reduceWorkflow(source, resolution.event);
    expect(historical).toMatchObject({
      status: "blocked",
      currentStep: "acceptance",
      tokenCeiling: 4096,
      attempts: source.attempts,
      activeRepairStops: [],
      specificationRestart: {
        criterionId: "AC-1.1.1",
        nextRunId: "run-02",
      },
    });

    const restart = decideStartWorkflow(
      { kind: "absent", operations: [] },
      {
        ...configuration,
        runId: "run-02",
        correlationId: "restart-spec",
        eventId: "event-run-02",
        occurredAt: "2026-08-30T12:04:00.000Z",
        objectiveActive: true,
        worktreeClean: true,
        observedIdentity: { host: "cli", model: null },
        acceptanceAttemptCeiling: 5,
        tokenCeiling: 8192,
        startFromSpec: {
          sourceRunId: "run-01",
          restartTicketRef: ".brain/restarts/run-02.json",
          restartTicketDigest: "f".repeat(64),
          retiredCriterionIds: ["AC-1.1.1"],
        },
      },
    );
    expect(restart.kind).toBe("recorded");
    if (restart.kind !== "recorded") return;
    const fresh = reduceWorkflow(
      workflowSeed({ ...configuration, runId: "run-02" }),
      restart.event,
    );
    expect(fresh).toMatchObject({
      status: "active",
      currentStep: "spec",
      acceptanceAttemptCeiling: 5,
      tokenCeiling: 8192,
      attempts: [],
      activeRepairStops: [],
      retiredCriterionIds: ["AC-1.1.1"],
      startedFromSpec: { sourceRunId: "run-01" },
    });
  });

  it("refuses specification resolution until every code stop is resolved", () => {
    const [codeStop, secondCodeStop] = blockedState().activeRepairStops;
    if (codeStop === undefined || secondCodeStop === undefined) {
      throw new Error("missing repair stops");
    }
    const source = {
      ...blockedState(),
      activeRepairStops: [
        codeStop,
        { ...secondCodeStop, classification: "specification" as const },
      ],
    };
    const specificationFirst = decideResolveRepairStop(
      { kind: "present", state: source },
      {
        feature: source.feature,
        runId: source.runId,
        criterionId: secondCodeStop.criterionId,
        correlationId: "specification-first",
        eventId: "event-specification-first",
        occurredAt: "2026-08-30T12:04:00.000Z",
        expectedRevision: source.revision,
        resolvedBy: "human-01",
        observation: "The criterion must be replaced in a fresh specification.",
        observedIdentity: { host: "cli", model: null },
        resolutionRef: ".brain/resolutions/specification-first.json",
        resolutionDigest: "e".repeat(64),
        nextRunId: "run-02",
        restartTicketRef: ".brain/restarts/run-02.json",
        restartTicketDigest: "f".repeat(64),
      },
    );
    expect(specificationFirst).toEqual({
      kind: "refused",
      reasonCode: "blocked.stop_loss_rejections",
    });

    const codeFirst = resolve(source, codeStop.criterionId, "code-first");
    if (codeFirst.kind !== "recorded")
      throw new Error("code resolution refused");
    const remaining = reduceWorkflow(source, codeFirst.event);
    const specificationLast = decideResolveRepairStop(
      { kind: "present", state: remaining },
      {
        feature: remaining.feature,
        runId: remaining.runId,
        criterionId: secondCodeStop.criterionId,
        correlationId: "specification-last",
        eventId: "event-specification-last",
        occurredAt: "2026-08-30T12:05:00.000Z",
        expectedRevision: remaining.revision,
        resolvedBy: "human-01",
        observation: "The criterion must be replaced in a fresh specification.",
        observedIdentity: { host: "cli", model: null },
        resolutionRef: ".brain/resolutions/specification-last.json",
        resolutionDigest: "e".repeat(64),
        nextRunId: "run-02",
        restartTicketRef: ".brain/restarts/run-02.json",
        restartTicketDigest: "f".repeat(64),
      },
    );
    expect(specificationLast).toMatchObject({
      kind: "recorded",
      transition: "resolved",
    });
    if (specificationLast.kind !== "recorded") return;
    expect(() =>
      reduceWorkflow(source, {
        ...specificationLast.event,
        priorRevision: source.revision,
        resultingRevision: source.revision + 1,
      }),
    ).toThrow("Repair resolution is inconsistent");
  });

  it("replays the same selective code resolution state", () => {
    const startedDecision = decideStartWorkflow(
      { kind: "absent", operations: [] },
      {
        ...configuration,
        correlationId: "start",
        eventId: "event-start",
        occurredAt: "2026-08-30T12:00:00.000Z",
        objectiveActive: true,
        worktreeClean: true,
        observedIdentity: { host: "cli", model: null },
        acceptanceAttemptCeiling: 1,
        tokenCeiling: 4096,
      },
    );
    if (startedDecision.kind !== "recorded") throw new Error("start refused");
    const sealed = [
      sealEvent(startedDecision.event, { revision: 0, hash: null }, services),
    ];
    const phases = ["prd", "spec", "plan", "code", "review"] as const;
    for (const [index, phase] of phases.entries()) {
      const prior = sealed.at(-1);
      if (prior === undefined) throw new Error("missing prior event");
      sealed.push(
        sealEvent(
          {
            contractVersion: "1.2.0",
            stateContract: "1.2.0",
            eventId: `event-complete-${phase}`,
            eventType: "transition",
            occurredAt: `2026-08-30T12:0${String(index + 1)}:00.000Z`,
            operation: `sdd.continue:complete-${phase}`,
            policyVersion: WORKFLOW_POLICY_VERSION,
            priorRevision: index + 1,
            resultingRevision: index + 2,
            reasonCode: "run.transition.accepted",
            effect: "state",
            artifactRefs: [`artifacts/${phase}.md`],
            evidenceRefs: [`evidence/${phase}.json`],
            observedIdentity: {
              host: "cli",
              model: "model-01",
              effort: "medium",
            },
            resolvedAssignment: {
              phase,
              role:
                phase === "code"
                  ? "implementer"
                  : phase === "review"
                    ? "judge"
                    : "planner",
              model: "model-01",
              effort: "medium",
            },
          },
          { revision: index + 1, hash: prior.eventHash },
          services,
        ),
      );
    }
    const priorStop = sealed.at(-1);
    if (priorStop === undefined) throw new Error("missing prior stop event");
    const stopDraft = {
      contractVersion: "1.2.0",
      stateContract: "1.2.0",
      eventId: "event-stop",
      eventType: "decision",
      occurredAt: "2026-08-30T12:06:00.000Z",
      operation: "sdd.acceptance.record:stop",
      policyVersion: WORKFLOW_POLICY_VERSION,
      priorRevision: 6,
      resultingRevision: 7,
      reasonCode: "run.stop_loss.repeated_rejection",
      effect: "state-and-artifact",
      artifactRefs: [".brain/runs/run-01/stops/AC-1.1.1.json"],
      evidenceRefs: [],
      observedIdentity: { host: "cli", model: null, effort: null },
      acceptanceDecision: {
        outcome: "stopped",
        attempts: [{ criterionId: "AC-1.1.1", attempt: 1 }],
        repairStops: [
          {
            criterionId: "AC-1.1.1",
            attempt: 1,
            classification: "code",
            artifactRef: ".brain/runs/run-01/stops/AC-1.1.1.json",
            artifactDigest: "c".repeat(64),
          },
        ],
      },
    } as const;
    const second = sealEvent(
      stopDraft as never,
      { revision: 6, hash: priorStop.eventHash },
      services,
    );
    sealed.push(second);
    const stopped = replayEventStream(
      verifyEventStream(
        sealed.map((event) => canonicalizeJson(event)).join("\n") + "\n",
        services,
      ),
      workflowReducerRegistry(configuration),
      services,
    ).state;
    const resolution = resolve(
      stopped,
      "AC-1.1.1",
      "replay-resolution",
      "2026-08-30T12:07:00.000Z",
    );
    if (resolution.kind !== "recorded") throw new Error("resolution refused");
    const third = sealEvent(
      resolution.event,
      { revision: 7, hash: second.eventHash },
      services,
    );
    sealed.push(third);
    const replay = replayEventStream(
      verifyEventStream(
        sealed.map((event) => canonicalizeJson(event)).join("\n") + "\n",
        services,
      ),
      workflowReducerRegistry(configuration),
      services,
    );

    expect(replay.state).toEqual(reduceWorkflow(stopped, resolution.event));
    expect(replay.state).toMatchObject({
      status: "active",
      currentStep: "code",
      attempts: [],
      repairStopHistory: [expect.objectContaining({ criterionId: "AC-1.1.1" })],
      tokenCeiling: 4096,
    });
  });
});
