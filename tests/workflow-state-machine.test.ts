import { createHash } from "node:crypto";

import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  decideContinueWorkflow,
  decideStartWorkflow,
  workflowReducerRegistry,
  type WorkflowObservation,
  type WorkflowState,
} from "@kratos/runtime/domain/workflow";
import {
  replayEventStream,
  sealEvent,
  verifyEventStream,
} from "@kratos/runtime/domain/events";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { describe, expect, it } from "vitest";

const digest = "a".repeat(64);
const lineage = { prdDigest: digest, specDigest: "b".repeat(64) };
const identity = { host: "codex", model: "gpt-5" };
const configuration = {
  projectId: "project-01",
  feature: "workflow",
  runId: "run-01",
  lineage,
};
const services = {
  digests: {
    sha256: (value: string) =>
      createHash("sha256").update(value).digest("hex"),
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
      ...overrides,
    },
  };
}

describe("workflow start and continuation", () => {
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
      policyVersion: "workflow-v1",
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
      event: { reasonCode: "run.transition.rejected" },
    });
  });

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
    const first = sealEvent(started.event, { revision: 0, hash: null }, services);
    const observed = present();
    const continued = decideContinueWorkflow(observed, {
      feature: "workflow",
      runId: "run-01",
      correlationId: "continue-01",
      eventId: "event-02",
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
      policyVersion: "workflow-v1",
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
