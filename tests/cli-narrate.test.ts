import { describe, expect, it } from "vitest";
import type {
  NarrationV1,
  PhaseHandoffV1_1,
  ReadableEvent,
} from "@kratos/contracts";
import {
  DEFAULT_REGISTRY,
  dispatch,
  parseInvocation,
  type CommandObservation,
  type Invocation,
} from "@kratos/runtime/domain/cli";
import type { GateDecision } from "@kratos/runtime/domain/gates";
import type { WorkflowState } from "@kratos/runtime/domain/workflow";

const sampleHandoff: PhaseHandoffV1_1 = {
  contractVersion: "1.1.0",
  hostContract: "1.1.0",
  feature: "narration-feature",
  runId: "run-sample",
  revision: 2,
  phase: "code",
  host: "claude",
  assignment: {
    phase: "code",
    role: "implementer",
    model: "claude-3-5-sonnet",
    effort: "standard",
  },
  assignmentDigest: "0".repeat(64),
  objectiveDigest: "0".repeat(64),
  status: "active",
  gateOutcome: "pass",
  blockers: [],
  openGaps: 0,
  nextAction: "continue",
};

const sampleGateDecision: GateDecision = {
  outcome: "pass",
  primary: null,
  failures: [],
  mode: "enforce",
  criteria: [],
};

const sampleWorkflowState: WorkflowState = {
  projectId: "project-01",
  feature: "narration-feature",
  runId: "run-sample",
  status: "active",
  currentStep: "code",
  revision: 2,
  lineage: { prdDigest: "a", specDigest: "b" },
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:15:00.000Z",
  operations: [],
};

function createSampleObservation(
  events: readonly ReadableEvent[],
): Extract<CommandObservation, { readonly kind: "workflow" }> {
  return {
    kind: "workflow",
    workflow: {
      kind: "present",
      state: sampleWorkflowState,
    },
    configuration: {
      projectId: "project-01",
      feature: "narration-feature",
      runId: "run-sample",
      lineage: { prdDigest: "a", specDigest: "b" },
    },
    observedLineage: { prdDigest: "a", specDigest: "b" },
    phaseAssignment: {
      kind: "resolved",
      value: sampleHandoff,
    },
    phaseExecution: null,
    correlationId: "corr-1",
    eventId: "evt-1",
    occurredAt: "2026-08-29T12:00:00.000Z",
    objectiveActive: true,
    objectiveDigest: "obj-1",
    worktreeClean: true,
    gitCommit: "abc1234",
    observedIdentity: { host: "cli", model: null },
    identityProvenance: "user-declared",
    approvals: [],
    approvalChallenge: null,
    approvalsReadable: true,
    evidence: [],
    invalidEvidenceIds: [],
    evidenceReadable: true,
    gaps: [],
    gapsReadable: true,
    gapProposal: { kind: "absent" },
    agentOutput: { kind: "none" },
    agentOutputs: [],
    agentOutputsReadable: true,
    acceptanceCriteria: {
      readable: true,
      documentRef: "",
      documentContent: null,
      documentDigest: null,
      document: { kind: "missing" },
      currentDeclarations: [],
      snapshot: null,
      snapshotRef: null,
      snapshotDigest: null,
      verdicts: [],
      appendSnapshot: null,
      appendSnapshotRef: null,
      appendSnapshotDigest: null,
      bootstrapSnapshot: null,
      bootstrapSnapshotRef: null,
      bootstrapSnapshotDigest: null,
      baselineRequired: false,
      initialSnapshot: null,
      initialSnapshotRef: null,
      initialSnapshotDigest: null,
      preparedVerdicts: [],
    },
    gateFacts: {
      readable: true,
      stopLoss: { tripped: false, exhausted: false },
      openGaps: 0,
      partitionRequired: false,
      partitionApproved: false,
    },
    openGaps: 0,
    specApproved: true,
    referencedFiles: [],
    gateDecision: sampleGateDecision,
    policyMode: "enforce",
    tokenBudget: null,
    events,
    persistedSnapshot: null,
    replayedSnapshot: null,
    integrityAudit: null,
    repairPlan: null,
    evidenceBundle: null,
    dashboardHtml: null,
  };
}

describe("kratos narrate command", () => {
  it("parses kratos narrate with --root and --json flags", () => {
    const parsed = parseInvocation(
      ["narrate", "--root", ".", "--json"],
      DEFAULT_REGISTRY,
    );
    expect(parsed.kind).toBe("invocation");
    if (parsed.kind === "invocation") {
      expect(parsed.invocation.command.path).toEqual(["narrate"]);
    }
  });

  it("parses kratos narrate with --as-of and --run-id flags", () => {
    const parsed = parseInvocation(
      [
        "narrate",
        "--root",
        ".",
        "--as-of",
        "2026-08-29T12:00:00.000Z",
        "--run-id",
        "run-custom-123",
      ],
      DEFAULT_REGISTRY,
    );
    expect(parsed.kind).toBe("invocation");
    if (parsed.kind === "invocation") {
      expect(parsed.invocation.command.path).toEqual(["narrate"]);
      expect(parsed.invocation.flags.get("--as-of")).toBe(
        "2026-08-29T12:00:00.000Z",
      );
      expect(parsed.invocation.flags.get("--run-id")).toBe("run-custom-123");
    }
  });

  const sampleEvents: readonly ReadableEvent[] = [
    {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "evt-01",
      eventType: "transition",
      occurredAt: "2026-08-29T10:00:00.000Z",
      operation: "spec",
      policyVersion: "workflow-v1",
      priorRevision: 1,
      resultingRevision: 2,
      reasonCode: "workflow.phase_completed",
      effect: "state",
      artifactRefs: [],
      evidenceRefs: [],
      observedIdentity: { host: "cli", model: null, effort: null },
      previousHash: null,
      eventHash: "a".repeat(64),
    },
    {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "evt-02",
      eventType: "decision",
      occurredAt: "2026-08-29T10:05:00.000Z",
      operation: "code",
      policyVersion: "workflow-v1",
      priorRevision: 2,
      resultingRevision: 2,
      reasonCode: "gate.aprovacao_spec",
      effect: "none",
      artifactRefs: [],
      evidenceRefs: ["evidence/approval.json"],
      observedIdentity: { host: "cli", model: null, effort: null },
      previousHash: "a".repeat(64),
      eventHash: "b".repeat(64),
    },
    {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "evt-03",
      eventType: "decision",
      occurredAt: "2026-08-29T10:10:00.000Z",
      operation: "code",
      policyVersion: "workflow-v1",
      priorRevision: 2,
      resultingRevision: 2,
      reasonCode: "guard.outside_allow",
      effect: "none",
      artifactRefs: [],
      evidenceRefs: ["evidence/violation.json"],
      observedIdentity: { host: "cli", model: null, effort: null },
      previousHash: "b".repeat(64),
      eventHash: "c".repeat(64),
    },
    {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "evt-04",
      eventType: "operation",
      occurredAt: "2026-08-29T10:15:00.000Z",
      operation: "code",
      policyVersion: "workflow-v1",
      priorRevision: 2,
      resultingRevision: 3,
      reasonCode: "workflow.phase_started",
      effect: "state",
      artifactRefs: [],
      evidenceRefs: [],
      observedIdentity: { host: "cli", model: null, effort: null },
      previousHash: "c".repeat(64),
      eventHash: "d".repeat(64),
    },
    {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "evt-05",
      eventType: "recovery",
      occurredAt: "2026-08-29T10:16:00.000Z",
      operation: "code",
      policyVersion: "workflow-v1",
      priorRevision: 3,
      resultingRevision: 3,
      reasonCode: "brain_migration_pending",
      effect: "none",
      artifactRefs: [],
      evidenceRefs: [],
      observedIdentity: { host: "cli", model: null, effort: null },
      previousHash: "d".repeat(64),
      eventHash: "e".repeat(64),
    },
    {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      eventId: "evt-06",
      eventType: "decision",
      occurredAt: "2026-08-29T10:17:00.000Z",
      operation: "code",
      policyVersion: "workflow-v1",
      priorRevision: 3,
      resultingRevision: 3,
      reasonCode: "warn.threshold",
      effect: "none",
      artifactRefs: [],
      evidenceRefs: [],
      observedIdentity: { host: "cli", model: null, effort: null },
      previousHash: "e".repeat(64),
      eventHash: "f".repeat(64),
    },
  ];

  it("renders plain text beats without ANSI codes", () => {
    const parsed = parseInvocation(["narrate"], DEFAULT_REGISTRY);
    expect(parsed.kind).toBe("invocation");
    if (parsed.kind !== "invocation") return;

    const invocation: Invocation = {
      ...parsed.invocation,
      observation: createSampleObservation(sampleEvents),
    };

    const decision = dispatch(invocation);
    expect(decision.result.exitCode).toBe(0);
    expect(decision.result.reasonCode).toBe("runtime.orientation_ok");
    expect(decision.humanStdout).not.toBeNull();
    const stdout = decision.humanStdout ?? "";

    expect(stdout).toContain(
      "[MILESTONE] phase:spec: Encountered reason workflow.phase_completed.",
    );
    expect(stdout).toContain(
      "[WAIT] phase:code: The run is waiting for explicit approval of the current specification lineage. (evidence: evidence/approval.json)",
    );
    expect(stdout).toContain(
      "[STOP] phase:code: The requested write is outside every configured allow rule. (evidence: evidence/violation.json)",
    );
    expect(stdout).toContain(
      "[WORK] phase:code: Encountered reason workflow.phase_started.",
    );
    expect(stdout).toContain(
      "[RESUME] phase:code: The project still requires the explicit Brain-layout migration.",
    );
    expect(stdout).toContain(
      "[WARN] phase:code: Encountered reason warn.threshold.",
    );
    // Plain text formatting must not rely on ANSI color codes
    expect(stdout.includes("\u001b")).toBe(false);
  });

  it("renders structured JSON when --json flag is provided", () => {
    const parsed = parseInvocation(["narrate", "--json"], DEFAULT_REGISTRY);
    expect(parsed.kind).toBe("invocation");
    if (parsed.kind !== "invocation") return;

    const invocation: Invocation = {
      ...parsed.invocation,
      observation: createSampleObservation(sampleEvents),
    };

    const decision = dispatch(invocation);
    expect(decision.result.exitCode).toBe(0);
    expect(decision.payload).toBeDefined();
    const payload = decision.payload as NarrationV1;
    expect(payload.contractVersion).toBe("1.0.0");
    expect(payload.runId).toBe("run-sample");
    expect(payload.beats).toHaveLength(6);
    expect(decision.humanStdout).toBe(`${JSON.stringify(payload, null, 2)}\n`);
  });

  it("handles --as-of flag for clock-derived progress in text and json mode", () => {
    const inProgressEvents = sampleEvents.slice(0, 4);
    const parsedText = parseInvocation(
      ["narrate", "--as-of", "2026-08-29T10:17:30.000Z"],
      DEFAULT_REGISTRY,
    );
    expect(parsedText.kind).toBe("invocation");
    if (parsedText.kind !== "invocation") return;

    const textInvocation: Invocation = {
      ...parsedText.invocation,
      observation: createSampleObservation(inProgressEvents),
    };

    const textDecision = dispatch(textInvocation);
    expect(textDecision.humanStdout).toContain(
      "[IN PROGRESS] code (elapsed: 150s) [clock-derived]",
    );

    const parsedJson = parseInvocation(
      ["narrate", "--json", "--as-of", "2026-08-29T10:17:30.000Z"],
      DEFAULT_REGISTRY,
    );
    expect(parsedJson.kind).toBe("invocation");
    if (parsedJson.kind !== "invocation") return;

    const jsonInvocation: Invocation = {
      ...parsedJson.invocation,
      observation: createSampleObservation(inProgressEvents),
    };

    const jsonDecision = dispatch(jsonInvocation);
    const payload = jsonDecision.payload as NarrationV1;
    expect(payload.pendingProgress).toEqual({
      kind: "in_progress",
      eventId: "evt-04",
      operation: "code",
      elapsedMs: 150000,
      startedAt: "2026-08-29T10:15:00.000Z",
      asOf: "2026-08-29T10:17:30.000Z",
    });
  });

  it("ensures non-interference: produces empty plan and stateChanged=false", () => {
    const parsed = parseInvocation(["narrate"], DEFAULT_REGISTRY);
    expect(parsed.kind).toBe("invocation");
    if (parsed.kind !== "invocation") return;

    const invocation: Invocation = {
      ...parsed.invocation,
      observation: createSampleObservation(sampleEvents),
    };

    const decision = dispatch(invocation);
    expect(decision.plan.effects).toHaveLength(0);
    expect(decision.result.stateChanged).toBe(false);
  });

  it("returns trail.sem_run when workflow is absent", () => {
    const parsed = parseInvocation(["narrate"], DEFAULT_REGISTRY);
    expect(parsed.kind).toBe("invocation");
    if (parsed.kind !== "invocation") return;

    const observation = createSampleObservation([]);
    const absentObservation: Extract<
      CommandObservation,
      { readonly kind: "workflow" }
    > = {
      ...observation,
      workflow: { kind: "absent", operations: [] },
    };

    const decision = dispatch({
      ...parsed.invocation,
      observation: absentObservation,
    });
    expect(decision.result.reasonCode).toBe("trail.sem_run");
    expect(decision.humanStdout).toBeNull();
  });

  it("returns runtime.state_corrupt when workflow is corrupt", () => {
    const parsed = parseInvocation(["narrate"], DEFAULT_REGISTRY);
    expect(parsed.kind).toBe("invocation");
    if (parsed.kind !== "invocation") return;

    const observation = createSampleObservation([]);
    const corruptObservation: Extract<
      CommandObservation,
      { readonly kind: "workflow" }
    > = {
      ...observation,
      workflow: { kind: "corrupt" },
    };

    const decision = dispatch({
      ...parsed.invocation,
      observation: corruptObservation,
    });
    expect(decision.result.reasonCode).toBe("runtime.state_corrupt");
    expect(decision.humanStdout).toBeNull();
  });
});
