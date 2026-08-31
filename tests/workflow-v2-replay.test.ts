import { createHash } from "node:crypto";

import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  EventIntegrityError,
  replayEventStream,
  sealEvent,
  verifyEventStream,
} from "@kratos/runtime/domain/events";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import {
  WORKFLOW_POLICY_VERSION,
  decideContinueWorkflow,
  decideStartWorkflow,
  reduceWorkflow,
  reduceWorkflowV1,
  workflowSeed,
  workflowReducerRegistry,
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

function startDecision() {
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
  if (decision.kind !== "recorded") throw new Error("start refused");
  return decision.event;
}

function stoppedDecision(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    contractVersion: "1.2.0",
    stateContract: "1.2.0",
    eventId: "event-acceptance-v2",
    eventType: "decision",
    occurredAt: "2026-08-30T12:01:00.000Z",
    operation: "sdd.acceptance.record:acceptance-v2",
    policyVersion: WORKFLOW_POLICY_VERSION,
    priorRevision: 1,
    resultingRevision: 2,
    reasonCode: "run.stop_loss.repeated_rejection",
    effect: "state-and-artifact",
    artifactRefs: [".brain/runs/run-01/repair-stops/AC-1.1.1.json"],
    evidenceRefs: [],
    gateFailures: [],
    observedIdentity: { host: "codex", model: "gpt-5", effort: "medium" },
    acceptanceDecision: {
      outcome: "stopped",
      attempts: [{ criterionId: "AC-1.1.1", attempt: 5 }],
      repairStops: [
        {
          criterionId: "AC-1.1.1",
          attempt: 5,
          classification: "code",
          artifactRef: ".brain/runs/run-01/repair-stops/AC-1.1.1.json",
          artifactDigest: "d".repeat(64),
        },
      ],
    },
    ...overrides,
  };
}

describe("workflow-v2 persisted replay", () => {
  it("seals and replays run-frozen limits from the v1.2 event", () => {
    const started = sealEvent(
      startDecision(),
      { revision: 0, hash: null },
      services,
    );
    const replay = replayEventStream(
      verifyEventStream(`${canonicalizeJson(started)}\n`, services),
      workflowReducerRegistry(configuration),
      services,
    );

    expect(started).toMatchObject({
      stateContract: "1.2.0",
      policyVersion: "workflow-v2",
      runLimits: { acceptanceAttemptCeiling: 5, tokenCeiling: 4096 },
    });
    expect(replay.state).toMatchObject({
      acceptanceAttemptCeiling: 5,
      tokenCeiling: 4096,
      attempts: [],
      activeRepairStops: [],
    });
  });

  it("seals closed acceptance metadata without embedding diagnoses", () => {
    const first = sealEvent(
      startDecision(),
      { revision: 0, hash: null },
      services,
    );
    const decision = stoppedDecision();

    const sealed = sealEvent(
      decision,
      { revision: 1, hash: first.eventHash },
      services,
    );

    expect(sealed).toMatchObject({
      acceptanceDecision: decision.acceptanceDecision,
    });
    expect(JSON.stringify(sealed)).not.toContain("diagnosis");
  });

  it("refuses to seal Task 4 repair-resolution metadata", () => {
    expect(() =>
      sealEvent(
        {
          contractVersion: "1.2.0",
          stateContract: "1.2.0",
          eventId: "event-resolution-v2",
          eventType: "recovery",
          occurredAt: "2026-08-30T12:02:00.000Z",
          operation: "sdd.repair.resolve:resolution-v2",
          policyVersion: WORKFLOW_POLICY_VERSION,
          priorRevision: 2,
          resultingRevision: 3,
          reasonCode: "run.repair_stop.resolved",
          effect: "state",
          artifactRefs: [],
          evidenceRefs: [],
          observedIdentity: {
            host: "codex",
            model: "gpt-5",
            effort: "medium",
          },
          repairResolution: {
            criterionId: "AC-1.1.1",
            classification: "code",
            resolvedBy: "human-01",
            observation: "The implementation was corrected and reverified.",
            nextRunId: null,
          },
        },
        { revision: 2, hash: "a".repeat(64) },
        services,
      ),
    ).toThrow(EventIntegrityError);
  });

  it.each([
    {
      label: "passed outcome carrying a failed attempt",
      overrides: {
        reasonCode: "run.acceptance.passed",
        artifactRefs: [".brain/runs/run-01/acceptance/verdict.json"],
        acceptanceDecision: {
          outcome: "passed",
          attempts: [{ criterionId: "AC-1.1.1", attempt: 5 }],
          repairStops: [],
        },
      },
    },
    {
      label: "repair outcome without a failed attempt",
      overrides: {
        reasonCode: "run.acceptance.repair_required",
        artifactRefs: [".brain/runs/run-01/acceptance/verdict.json"],
        acceptanceDecision: {
          outcome: "repair",
          attempts: [],
          repairStops: [],
        },
      },
    },
    {
      label: "stop artifact reference absent from the event",
      overrides: { artifactRefs: [] },
    },
    {
      label: "duplicate attempt criterion",
      overrides: {
        acceptanceDecision: {
          outcome: "stopped",
          attempts: [
            { criterionId: "AC-1.1.1", attempt: 4 },
            { criterionId: "AC-1.1.1", attempt: 5 },
          ],
          repairStops: [
            {
              criterionId: "AC-1.1.1",
              attempt: 5,
              classification: "code",
              artifactRef: ".brain/runs/run-01/repair-stops/AC-1.1.1.json",
              artifactDigest: "d".repeat(64),
            },
          ],
        },
      },
    },
    {
      label: "stop attempt different from its criterion attempt",
      overrides: {
        acceptanceDecision: {
          outcome: "stopped",
          attempts: [{ criterionId: "AC-1.1.1", attempt: 5 }],
          repairStops: [
            {
              criterionId: "AC-1.1.1",
              attempt: 4,
              classification: "code",
              artifactRef: ".brain/runs/run-01/repair-stops/AC-1.1.1.json",
              artifactDigest: "d".repeat(64),
            },
          ],
        },
      },
    },
    {
      label: "duplicate stop criterion",
      overrides: {
        artifactRefs: [
          ".brain/runs/run-01/repair-stops/AC-1.1.1.json",
          ".brain/runs/run-01/repair-stops/AC-1.1.1-copy.json",
        ],
        acceptanceDecision: {
          outcome: "stopped",
          attempts: [{ criterionId: "AC-1.1.1", attempt: 5 }],
          repairStops: [
            {
              criterionId: "AC-1.1.1",
              attempt: 5,
              classification: "code",
              artifactRef: ".brain/runs/run-01/repair-stops/AC-1.1.1.json",
              artifactDigest: "d".repeat(64),
            },
            {
              criterionId: "AC-1.1.1",
              attempt: 5,
              classification: "specification",
              artifactRef: ".brain/runs/run-01/repair-stops/AC-1.1.1-copy.json",
              artifactDigest: "e".repeat(64),
            },
          ],
        },
      },
    },
  ])("refuses to seal an acceptance event with $label", ({ overrides }) => {
    expect(() =>
      sealEvent(
        stoppedDecision(overrides) as never,
        {
          revision: 1,
          hash: "a".repeat(64),
        },
        services,
      ),
    ).toThrow(EventIntegrityError);
  });

  it("rejects mixed workflow-v1/v2 history without frozen limits", () => {
    const legacyUnsigned = {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "event-legacy",
      eventType: "transition",
      occurredAt: "2026-08-30T12:00:00.000Z",
      operation: "sdd.start:legacy",
      policyVersion: "workflow-v1",
      priorRevision: 0,
      resultingRevision: 1,
      reasonCode: "run.started",
      effect: "state",
      artifactRefs: [] as string[],
      evidenceRefs: [] as string[],
      observedIdentity: { host: "codex", model: "gpt-5", effort: null },
      previousHash: null,
    };
    const legacy = {
      ...legacyUnsigned,
      eventHash: services.digests.sha256(canonicalizeJson(legacyUnsigned)),
    };
    const resumedDraft = {
      ...startDecision(),
      eventId: "event-v2-resume",
      operation: "sdd.start:v2-resume",
      priorRevision: 1,
      resultingRevision: 2,
      reasonCode: "run.resumed",
      runLimits: undefined,
    };
    delete (resumedDraft as { runLimits?: unknown }).runLimits;
    const resumed = sealEvent(
      resumedDraft,
      { revision: 1, hash: legacy.eventHash },
      services,
    );
    expect(() =>
      replayEventStream(
        verifyEventStream(
          `${canonicalizeJson(legacy)}\n${canonicalizeJson(resumed)}\n`,
          services,
        ),
        workflowReducerRegistry(configuration),
        services,
      ),
    ).toThrow(EventIntegrityError);
  });

  it("replays a persisted legacy upgrade before deterministic v2 continuation", () => {
    const legacyUnsigned = {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "event-legacy-upgrade-source",
      eventType: "transition",
      occurredAt: "2026-08-30T12:00:00.000Z",
      operation: "sdd.start:legacy-upgrade-source",
      policyVersion: "workflow-v1",
      priorRevision: 0,
      resultingRevision: 1,
      reasonCode: "run.started",
      effect: "state",
      artifactRefs: [] as string[],
      evidenceRefs: [] as string[],
      observedIdentity: { host: "codex", model: "gpt-5", effort: null },
      previousHash: null,
    } as const;
    const legacy = {
      ...legacyUnsigned,
      eventHash: services.digests.sha256(canonicalizeJson(legacyUnsigned)),
    };
    const legacyState = reduceWorkflowV1(workflowSeed(configuration), legacy);
    const upgrade = decideStartWorkflow(
      { kind: "present", state: legacyState },
      {
        ...configuration,
        correlationId: "upgrade-boundary",
        eventId: "event-upgrade-boundary",
        occurredAt: "2026-08-30T12:01:00.000Z",
        objectiveActive: true,
        worktreeClean: true,
        observedIdentity: { host: "codex", model: "gpt-5" },
        acceptanceAttemptCeiling: 5,
        tokenCeiling: 4096,
      },
    );
    if (upgrade.kind !== "recorded") throw new Error("upgrade refused");
    const upgradedState = reduceWorkflow(legacyState, upgrade.event);
    const continuation = decideContinueWorkflow(
      { kind: "present", state: upgradedState },
      {
        feature: configuration.feature,
        runId: configuration.runId,
        correlationId: "continue-after-upgrade",
        eventId: "event-continue-after-upgrade",
        occurredAt: "2026-08-30T12:02:00.000Z",
        expectedRevision: 2,
        observedIdentity: { host: "codex", model: "gpt-5" },
        action: { kind: "resume" },
      },
    );
    if (continuation.kind !== "recorded") {
      throw new Error("continuation refused");
    }
    const direct = reduceWorkflow(upgradedState, continuation.event);

    const sealedUpgrade = sealEvent(
      upgrade.event as never,
      { revision: 1, hash: legacy.eventHash },
      services,
    );
    const sealedContinuation = sealEvent(
      continuation.event,
      { revision: 2, hash: sealedUpgrade.eventHash },
      services,
    );
    const replay = replayEventStream(
      verifyEventStream(
        `${canonicalizeJson(legacy)}\n${canonicalizeJson(sealedUpgrade)}\n${canonicalizeJson(sealedContinuation)}\n`,
        services,
      ),
      workflowReducerRegistry(configuration),
      services,
    );

    expect(replay.state).toEqual(direct);
    expect(replay.state).toMatchObject({
      policyVersion: "workflow-v2",
      acceptanceAttemptCeiling: 5,
      tokenCeiling: 4096,
      attempts: [],
      activeRepairStops: [],
      revision: 3,
    });
  });
});
