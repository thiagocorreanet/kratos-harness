import { relaySelectedPhase } from "@kratos/adapters";
import { REASON_CATALOG, type CurrentPhaseHandoff } from "@kratos/contracts";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { evaluateGates } from "@kratos/runtime/domain/gates";
import { PHASE_AGENT_PROMPTS } from "@kratos/runtime/domain/phase-agents";
import { describe, expect, it } from "vitest";

import { claudeCatalog, codexCatalog } from "./support/model-routing.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function acceptanceOutput(faults: readonly unknown[]) {
  return {
    contractVersion: "1.1.0",
    hostContract: "1.1.0",
    agent: "acceptance",
    outcome: {
      status: "completed",
      next: "finish",
      questions: [],
      blockers: [],
    },
    artifacts: [],
    changedFiles: [],
    payload: {
      verdict: "rejected",
      criteria: [
        {
          criterionId: "AC-1.1.1",
          outcome: "failed",
          evidenceRef: "evidence/acceptance.json",
        },
      ],
      faults,
    },
  };
}

function handoff(host: "claude" | "codex"): CurrentPhaseHandoff {
  return {
    contractVersion: "1.3.0",
    hostContract: "1.3.0",
    feature: "repair-loop",
    runId: "run-01",
    revision: 7,
    phase: "acceptance",
    host,
    assignment: {
      phase: "acceptance",
      role: "judge",
      model: "judge-canonical",
      effort: "high",
    },
    assignmentDigest: SHA_A,
    objectiveDigest: SHA_B,
    status: "active",
    gateOutcome: "pass",
    blockers: [],
    openGaps: 0,
    nextAction: "Evaluate the current acceptance criteria.",
    acceptance: {
      attemptCeiling: 3,
      attempts: [
        { criterionId: "AC-1.1.1", attempt: 2 },
        { criterionId: "AC-1.1.E1", attempt: 1 },
      ],
      faultsRequiredFor: ["AC-1.1.1"],
      faults: [],
    },
    memory: null,
  };
}

describe("repair-loop host contracts", () => {
  it("accepts bounded fault diagnoses only in agent-output 1.1", () => {
    const registry = createSchemaRegistry();
    const valid = registry.validate({
      id: "host.agent-output",
      version: "1.1.0",
      value: acceptanceOutput([
        {
          criterionId: "AC-1.1.1",
          classification: "code",
          diagnosis: "The implementation returns the wrong status.",
        },
      ]),
      structuralReasonCode: "trail.output_invalido",
    });
    const invalid = registry.validate({
      id: "host.agent-output",
      version: "1.1.0",
      value: acceptanceOutput([
        {
          criterionId: "AC-1.1.1",
          classification: "environment",
          diagnosis: "Not a supported classification.",
        },
      ]),
      structuralReasonCode: "trail.output_invalido",
    });

    expect(valid.kind).toBe("valid");
    expect(invalid.kind).toBe("invalid");
  });

  it("rejects whitespace-only diagnoses in current host contracts", () => {
    const registry = createSchemaRegistry();
    const output = {
      ...acceptanceOutput([
        {
          criterionId: "AC-1.1.1",
          classification: "code",
          diagnosis: "   ",
        },
      ]),
      contractVersion: "1.2.0",
      hostContract: "1.2.0",
    };
    expect(
      registry.validate({
        id: "host.agent-output",
        version: "1.2.0",
        value: output,
        structuralReasonCode: "trail.output_invalido",
      }).kind,
    ).toBe("invalid");

    const currentHandoff = handoff("codex");
    expect(
      registry.validate({
        id: "host.phase-handoff",
        version: "1.3.0",
        value: {
          ...currentHandoff,
          acceptance: {
            ...currentHandoff.acceptance,
            faults: [
              {
                criterionId: "AC-1.1.1",
                attempt: 3,
                classification: "code",
                diagnosis: "   ",
                artifactRef: ".brain/stops/AC-1.1.1.json",
                artifactDigest: SHA_A,
              },
            ],
          },
        },
        structuralReasonCode: "trail.output_invalido",
      }).kind,
    ).toBe("invalid");
  });

  it("validates ordered attempt and fault context in phase-handoff 1.3", () => {
    const registry = createSchemaRegistry();
    expect(
      registry.validate({
        id: "host.phase-handoff",
        version: "1.3.0",
        value: handoff("codex"),
        structuralReasonCode: "trail.output_invalido",
      }).kind,
    ).toBe("valid");
  });

  it("aggregates every repeated rejection before independent token and flag stops", () => {
    const decision = evaluateGates({
      mode: "enforce",
      phase: "acceptance",
      contextReadable: true,
      stopLoss: {
        tripped: true,
        exhausted: true,
        repeatedRejections: [
          {
            criterionId: "AC-1.1.1",
            attempt: 3,
            classification: "code",
            artifactRef: "repair-stops/AC-1.1.1.json",
          },
          {
            criterionId: "AC-1.1.E1",
            attempt: 3,
            classification: "specification",
            artifactRef: "repair-stops/AC-1.1.E1.json",
          },
        ],
      },
      prdDigest: null,
      prdDocument: { kind: "complete" },
      specDigest: null,
      approvals: [],
      openGaps: 0,
      partitionRequired: false,
      partitionApproved: true,
      finalAcceptance: true,
      acceptanceCriteria: [],
    });

    expect(
      decision.failures
        .filter(({ gateId }) => gateId === "stop-loss")
        .map(({ reasonCode, evidenceRefs }) => ({ reasonCode, evidenceRefs })),
    ).toEqual([
      {
        reasonCode: "blocked.stop_loss_rejections",
        evidenceRefs: ["repair-stops/AC-1.1.1.json"],
      },
      {
        reasonCode: "blocked.stop_loss_rejections",
        evidenceRefs: ["repair-stops/AC-1.1.E1.json"],
      },
      {
        reasonCode: "blocked.stop_loss_budget",
        evidenceRefs: [".brain/03-memory/task_metrics.md"],
      },
      {
        reasonCode: "blocked.stop_loss_flag",
        evidenceRefs: [".brain/03-memory/task_metrics.md"],
      },
    ]);
    expect(
      REASON_CATALOG.some(
        ({ code }) => code === "blocked.stop_loss_rejections",
      ),
    ).toBe(true);
  });

  it("tells the evaluator to relay runtime fault requirements without deciding them", () => {
    const evaluator = PHASE_AGENT_PROMPTS.find(
      ({ id }) => id === "implementation-evaluator",
    );
    expect(evaluator?.instructions).toContain("faultsRequiredFor");
    expect(evaluator?.instructions).toContain(
      "The runtime decides which fault reports are required",
    );
    expect(evaluator?.instructions).not.toContain("attempt + 1");
  });

  it.each([
    ["claude-code", "claude", claudeCatalog()],
    ["codex", "codex", codexCatalog()],
  ] as const)(
    "relays the same runtime handoff and agent-output contract through %s",
    async (host, configurationHost, modelRouting) => {
      const runtimeHandoff = handoff(configurationHost);
      const launches: unknown[] = [];
      const records: unknown[] = [];
      const result = await relaySelectedPhase(host, {
        modelRouting,
        messageId: "message-01",
        correlationId: "correlation-01",
        runtime: {
          handoff: () =>
            Promise.resolve({
              kind: "ready" as const,
              handoff: runtimeHandoff,
            }),
          record: (message) => {
            records.push(message);
            return Promise.resolve({ stdout: "{}\n", stderr: "", exitCode: 0 });
          },
        },
        launcher: {
          exactSelection: { model: true, effort: true },
          launch: (request) => {
            launches.push(request);
            return Promise.resolve({
              payload: { ref: "agent-reply.md", sha256: SHA_A },
              observedIdentity: {
                model: "judge-canonical",
                effort: "high",
              },
            });
          },
        },
      });

      expect(result.kind).toBe("recorded");
      expect(launches).toEqual([
        {
          phase: "acceptance",
          role: "judge",
          model: "judge-canonical",
          effort: "high",
          handoff: runtimeHandoff,
          memory: null,
        },
      ]);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        payloadContract: "host.agent-output@1.3.0",
      });
    },
  );
});
