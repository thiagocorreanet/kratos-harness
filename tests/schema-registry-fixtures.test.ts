import manifest from "../packages/contracts/catalogs/contract-families.v1.json" with { type: "json" };
import versionCases from "../fixtures/contracts/v1/version-cases.json" with { type: "json" };
import adapterMessage from "../fixtures/contracts/v1/adapter-message.json" with { type: "json" };
import adapterMessageV1_1 from "../fixtures/contracts/v1.1/adapter-message.json" with { type: "json" };
import agentOutput from "../fixtures/contracts/v1/agent-output.json" with { type: "json" };
import agentOutputV1_2 from "../fixtures/contracts/v1.2/agent-output.json" with { type: "json" };
import gapProposal from "../fixtures/contracts/v1/gap-proposal.json" with { type: "json" };
import hookObservation from "../fixtures/contracts/v1/hook-observation.json" with { type: "json" };
import initAnswers from "../fixtures/contracts/v1/init-answers.json" with { type: "json" };
import initAnswersV1_1 from "../fixtures/contracts/v1.1/init-answers.json" with { type: "json" };
import initAnswersV1_2 from "../fixtures/contracts/v1.2/init-answers.json" with { type: "json" };
import initAnswersV1_3 from "../fixtures/contracts/v1.3/init-answers.json" with { type: "json" };
import operationApproval from "../fixtures/contracts/v1/operation-approval.json" with { type: "json" };
import acceptanceCriteriaSnapshot from "../fixtures/contracts/v1/acceptance-criteria-snapshot.json" with { type: "json" };
import acceptanceVerdict from "../fixtures/contracts/v1/acceptance-verdict.json" with { type: "json" };
import approval from "../fixtures/contracts/v1/approval.json" with { type: "json" };
import event from "../fixtures/contracts/v1/event.json" with { type: "json" };
import eventV1_1 from "../fixtures/contracts/v1.1/event.json" with { type: "json" };
import evidence from "../fixtures/contracts/v1/evidence.json" with { type: "json" };
import failureCandidate from "../fixtures/contracts/v1/failure-candidate.json" with { type: "json" };
import curatedMemory from "../fixtures/contracts/v1/curated-memory.json" with { type: "json" };
import feature from "../fixtures/contracts/v1/feature.json" with { type: "json" };
import featureScope from "../fixtures/contracts/v1/feature-scope.json" with { type: "json" };
import gap from "../fixtures/contracts/v1/gap.json" with { type: "json" };
import gates from "../fixtures/contracts/v1/gates.json" with { type: "json" };
import guardrails from "../fixtures/contracts/v1/guardrails.json" with { type: "json" };
import lock from "../fixtures/contracts/v1/lock.json" with { type: "json" };
import migration from "../fixtures/contracts/v1/migration.json" with { type: "json" };
import migrationV1_1 from "../fixtures/contracts/v1.1/migration.json" with { type: "json" };
import phaseHandoffV1_1 from "../fixtures/contracts/v1.1/phase-handoff.json" with { type: "json" };
import phaseHandoffV1_2 from "../fixtures/contracts/v1.2/phase-handoff.json" with { type: "json" };
import memoryCapture from "../fixtures/contracts/v1.2/memory-capture.json" with { type: "json" };
import memoryChangePromote from "../fixtures/contracts/v1.2/memory-change-promote.json" with { type: "json" };
import memoryChangeMerge from "../fixtures/contracts/v1.2/memory-change-merge.json" with { type: "json" };
import memoryChangeArchive from "../fixtures/contracts/v1.2/memory-change-archive.json" with { type: "json" };
import memoryMigration from "../fixtures/contracts/v1.2/memory-migration.json" with { type: "json" };
import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import projectConfigV1_1 from "../fixtures/contracts/v1.1/project-config.json" with { type: "json" };
import projectConfigV1_2 from "../fixtures/contracts/v1.2/project-config.json" with { type: "json" };
import projectConfigV1_3 from "../fixtures/contracts/v1.3/project-config.json" with { type: "json" };
import preToolUse from "../fixtures/contracts/v1/pre-tool-use.json" with { type: "json" };
import requirementDiscovery from "../fixtures/contracts/v1/requirement-discovery.json" with { type: "json" };
import runUsage from "../fixtures/contracts/v1/run-usage.json" with { type: "json" };
import sessionTelemetry from "../fixtures/contracts/v1/session-telemetry.json" with { type: "json" };
import snapshot from "../fixtures/contracts/v1/snapshot.json" with { type: "json" };
import transactionManifest from "../fixtures/contracts/v1/transaction-manifest.json" with { type: "json" };
import transactionProgress from "../fixtures/contracts/v1/transaction-progress.json" with { type: "json" };
import type {
  ContractId,
  StructuralReasonCode,
} from "@kratos/runtime/domain/schema";
import { ajvSchemaRegistry } from "@kratos/runtime/infra/schema";
import { describe, expect, it } from "vitest";

const beat = {
  contractVersion: "1.0.0" as const,
  beatId: "beat-evt-001",
  kind: "work" as const,
  subject: "phase:prd",
  sentence: "Encountered reason workflow.phase_started.",
  reasonCode: "workflow.phase_started",
  occurredAt: "2026-08-29T10:00:00.000Z",
  eventId: "evt-001",
  revision: 1,
  facts: {},
  evidenceRefs: [],
};

const narration = {
  contractVersion: "1.0.0" as const,
  runId: "sample-run-001",
  generatedAt: "2026-08-29T10:20:00.000Z",
  beats: [beat],
  pendingProgress: null,
};

interface FixtureCase {
  readonly id: ContractId;
  readonly version: "1.0.0" | "1.1.0" | "1.2.0" | "1.3.0";
  readonly versionField: "stateContract" | "hostContract" | "contractVersion";
  readonly requiredField: string;
  readonly structuralReasonCode: StructuralReasonCode;
  readonly fixture: object;
  readonly invalidVersionReason:
    "contract.state_version_invalid" | "contract.host_version_invalid";
  readonly unsupportedVersionReason:
    "contract.state_version_unsupported" | "contract.host_version_unsupported";
}

const fixtures = [
  {
    id: "host.adapter-message",
    version: "1.0.0",
    versionField: "hostContract",
    requiredField: "messageId",
    structuralReasonCode: "trail.output_invalido",
    fixture: adapterMessage,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.adapter-message",
    version: "1.1.0",
    versionField: "hostContract",
    requiredField: "messageId",
    structuralReasonCode: "trail.output_invalido",
    fixture: adapterMessageV1_1,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.agent-output",
    version: "1.0.0",
    versionField: "hostContract",
    requiredField: "payload",
    structuralReasonCode: "trail.output_invalido",
    fixture: agentOutput,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.agent-output",
    version: "1.2.0",
    versionField: "hostContract",
    requiredField: "memory",
    structuralReasonCode: "trail.output_invalido",
    fixture: agentOutputV1_2,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.gap-proposal",
    version: "1.0.0",
    versionField: "hostContract",
    requiredField: "gaps",
    structuralReasonCode: "trail.uso",
    fixture: gapProposal,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.hook-observation",
    version: "1.0.0",
    versionField: "hostContract",
    requiredField: "kind",
    structuralReasonCode: "trail.output_invalido",
    fixture: hookObservation,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.init-answers",
    version: "1.0.0",
    versionField: "hostContract",
    requiredField: "hosts",
    structuralReasonCode: "trail.output_invalido",
    fixture: initAnswers,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.init-answers",
    version: "1.1.0",
    versionField: "hostContract",
    requiredField: "hosts",
    structuralReasonCode: "trail.output_invalido",
    fixture: initAnswersV1_1,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.init-answers",
    version: "1.2.0",
    versionField: "hostContract",
    requiredField: "hosts",
    structuralReasonCode: "trail.output_invalido",
    fixture: initAnswersV1_2,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.init-answers",
    version: "1.3.0",
    versionField: "hostContract",
    requiredField: "hosts",
    structuralReasonCode: "trail.output_invalido",
    fixture: initAnswersV1_3,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.phase-handoff",
    version: "1.1.0",
    versionField: "hostContract",
    requiredField: "runId",
    structuralReasonCode: "trail.output_invalido",
    fixture: phaseHandoffV1_1,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.phase-handoff",
    version: "1.2.0",
    versionField: "hostContract",
    requiredField: "memory",
    structuralReasonCode: "trail.output_invalido",
    fixture: phaseHandoffV1_2,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.operation-message",
    version: "1.0.0",
    versionField: "hostContract",
    requiredField: "messageId",
    structuralReasonCode: "trail.output_invalido",
    fixture: operationApproval,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.pre-tool-use",
    version: "1.0.0",
    versionField: "hostContract",
    requiredField: "operation",
    structuralReasonCode: "guard.target_uninspectable",
    fixture: preToolUse,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "state.acceptance-criteria-snapshot",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "declarations",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: acceptanceCriteriaSnapshot,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.acceptance-verdict",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "criterionId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: acceptanceVerdict,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.approval",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "approvalId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: approval,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.beat",
    version: "1.0.0",
    versionField: "contractVersion",
    requiredField: "beatId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: beat,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.event",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "eventId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: event,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.event",
    version: "1.1.0",
    versionField: "stateContract",
    requiredField: "eventId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: eventV1_1,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.evidence",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "evidenceId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: evidence,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.failure-candidate",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "candidateId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: failureCandidate,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.curated-memory",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "confirmed",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: curatedMemory,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "host.memory-capture",
    version: "1.2.0",
    versionField: "hostContract",
    requiredField: "observation",
    structuralReasonCode: "trail.output_invalido",
    fixture: memoryCapture,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.memory-change",
    version: "1.2.0",
    versionField: "hostContract",
    requiredField: "operation",
    structuralReasonCode: "trail.output_invalido",
    fixture: memoryChangePromote,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "host.memory-migration",
    version: "1.2.0",
    versionField: "hostContract",
    requiredField: "lessons",
    structuralReasonCode: "trail.output_invalido",
    fixture: memoryMigration,
    invalidVersionReason: "contract.host_version_invalid",
    unsupportedVersionReason: "contract.host_version_unsupported",
  },
  {
    id: "state.feature",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "feature",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: feature,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.feature-scope",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "allow",
    structuralReasonCode: "guard.scope_corrupt",
    fixture: featureScope,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.gap",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "gapId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: gap,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.gates",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "openGaps",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: gates,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.guardrails",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "managedPaths",
    structuralReasonCode: "guard.guardrails_corrupt",
    fixture: guardrails,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.lock",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "resource",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: lock,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.migration",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "migrationId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: migration,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.migration",
    version: "1.1.0",
    versionField: "stateContract",
    requiredField: "migrationId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: migrationV1_1,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.narration",
    version: "1.0.0",
    versionField: "contractVersion",
    requiredField: "beats",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: narration,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.project-config",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "language",
    structuralReasonCode: "guard.config_corrupt",
    fixture: projectConfig,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.project-config",
    version: "1.1.0",
    versionField: "stateContract",
    requiredField: "language",
    structuralReasonCode: "guard.config_corrupt",
    fixture: projectConfigV1_1,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.project-config",
    version: "1.2.0",
    versionField: "stateContract",
    requiredField: "language",
    structuralReasonCode: "guard.config_corrupt",
    fixture: projectConfigV1_2,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.project-config",
    version: "1.3.0",
    versionField: "stateContract",
    requiredField: "projectProfile",
    structuralReasonCode: "guard.config_corrupt",
    fixture: projectConfigV1_3,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.requirement-discovery",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "classification",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: requirementDiscovery,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.run-usage",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "runId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: runUsage,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.session-telemetry",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "sessionId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: sessionTelemetry,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.snapshot",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "projectId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: snapshot,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.transaction-manifest",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "transactionId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: transactionManifest,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
  {
    id: "state.transaction-progress",
    version: "1.0.0",
    versionField: "stateContract",
    requiredField: "transactionId",
    structuralReasonCode: "runtime.state_corrupt",
    fixture: transactionProgress,
    invalidVersionReason: "contract.state_version_invalid",
    unsupportedVersionReason: "contract.state_version_unsupported",
  },
] as const satisfies readonly FixtureCase[];

const registry = ajvSchemaRegistry();
const registryVersionCases = versionCases.filter(
  ({ family }) => family !== "plugin",
);
const memoryChangeProposals = [
  memoryChangePromote,
  memoryChangeMerge,
  memoryChangeArchive,
] as const;

function mutableFixture(fixture: object): Record<string, unknown> {
  return structuredClone(fixture) as Record<string, unknown>;
}

function expectInvalidWithReason(
  fixture: FixtureCase,
  version: unknown,
  value: unknown,
  reasonCode: string,
): void {
  const result = registry.validate({
    id: fixture.id,
    version,
    value,
    structuralReasonCode: fixture.structuralReasonCode,
  });
  expect(result.kind).toBe("invalid");
  if (result.kind === "valid") return;
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(new Set(result.diagnostics.map((item) => item.reasonCode))).toEqual(
    new Set([reasonCode]),
  );
}

describe("compiled schema registry fixtures", () => {
  it.each([["model-x", { model: "model-x", effort: "medium" }]])(
    "accepts equivalent model assignment forms",
    (simple, object) => {
      const validate = (planner: unknown) =>
        registry.validate({
          id: "state.project-config",
          version: "1.1.0",
          structuralReasonCode: "guard.config_corrupt",
          value: {
            ...projectConfigV1_1,
            modelRoles: {
              ...projectConfigV1_1.modelRoles,
              codex: {
                ...projectConfigV1_1.modelRoles.codex,
                planner,
              },
            },
          },
        });
      expect(validate(simple).kind).toBe("valid");
      expect(validate(object).kind).toBe("valid");
    },
  );

  it("routes every published non-plugin version case through the registry", () => {
    expect(registryVersionCases.map(({ name }) => name)).toEqual(
      versionCases
        .filter(({ family }) => family !== "plugin")
        .map(({ name }) => name),
    );
  });

  it("covers every manifest schema exactly once", () => {
    const pairs = (items: readonly { id: string; version: string }[]) =>
      items.map(({ id, version }) => `${id}@${version}`).sort();
    expect(pairs(fixtures)).toEqual(pairs(manifest.schemas));
  });

  it.each(fixtures)("accepts the committed $id fixture", (fixture) => {
    const result = registry.validate({
      id: fixture.id,
      version: fixture.version,
      value: fixture.fixture,
      structuralReasonCode: fixture.structuralReasonCode,
    });
    expect(result).toEqual({ kind: "valid", value: fixture.fixture });
    if (result.kind === "valid") expect(result.value).toBe(fixture.fixture);
  });

  it.each(memoryChangeProposals)(
    "accepts every closed memory-change proposal operation",
    (proposal) => {
      expect(
        registry.validate({
          id: "host.memory-change",
          version: "1.2.0",
          value: proposal,
          structuralReasonCode: "trail.output_invalido",
        }),
      ).toEqual({ kind: "valid", value: proposal });
    },
  );

  it.each(fixtures)("rejects missing $id family versions first", (fixture) => {
    const candidate = mutableFixture(fixture.fixture);
    expect(Reflect.deleteProperty(candidate, fixture.versionField)).toBe(true);
    const result = registry.validate({
      id: fixture.id,
      version: undefined,
      value: candidate,
      structuralReasonCode: fixture.structuralReasonCode,
    });
    expect(result).toMatchObject({
      kind: "invalid",
      diagnostics: [
        {
          version: null,
          pointer: "",
          reasonCode: fixture.invalidVersionReason,
        },
      ],
    });
  });

  it.each(fixtures)("rejects future $id family versions first", (fixture) => {
    const candidate = mutableFixture(fixture.fixture);
    candidate[fixture.versionField] = "2.0.0";
    const result = registry.validate({
      id: fixture.id,
      version: "2.0.0",
      value: candidate,
      structuralReasonCode: fixture.structuralReasonCode,
    });
    expect(result).toMatchObject({
      kind: "invalid",
      diagnostics: [
        {
          version: "2.0.0",
          pointer: "",
          reasonCode: fixture.unsupportedVersionReason,
        },
      ],
    });
  });

  it.each(fixtures)(
    "rejects the family-applicable previous $id version first",
    (fixture) => {
      const candidate = mutableFixture(fixture.fixture);
      candidate[fixture.versionField] = "0.9.0";
      const result = registry.validate({
        id: fixture.id,
        version: "0.9.0",
        value: candidate,
        structuralReasonCode: fixture.structuralReasonCode,
      });
      expect(result).toMatchObject({
        kind: "invalid",
        diagnostics: [
          {
            version: "0.9.0",
            pointer: "",
            reasonCode: fixture.unsupportedVersionReason,
          },
        ],
      });
    },
  );

  it.each(registryVersionCases)(
    "classifies the published $name case through the registry",
    (versionCase) => {
      // Selected by family rather than by position: indexing assumed exactly
      // one host fixture, and adding a second silently pointed the state cases
      // at a host contract.
      const fixture = fixtures.find(
        ({ version, versionField }) =>
          (versionCase.family === "host"
            ? versionField === "hostContract"
            : versionField === "stateContract") &&
          (versionCase.classification !== "current" ||
            version === versionCase.value),
      );
      if (fixture === undefined) throw new Error("No fixture for the family");
      const result = registry.validate({
        id: fixture.id,
        version: versionCase.value,
        value: null,
        structuralReasonCode: fixture.structuralReasonCode,
      });

      if (versionCase.classification === "current") {
        expect(result.kind).toBe("invalid");
        if (result.kind === "valid") return;
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(
          result.diagnostics.every(
            ({ keyword, reasonCode, version }) =>
              keyword !== "version" &&
              reasonCode === fixture.structuralReasonCode &&
              version === versionCase.value,
          ),
        ).toBe(true);
        return;
      }

      const migrationOnly = versionCase.classification === "migration_required";
      expect(result).toMatchObject({
        kind: "invalid",
        diagnostics: [
          {
            version:
              versionCase.name === "state previous"
                ? "0.9.0"
                : versionCase.classification === "invalid" || migrationOnly
                  ? null
                  : versionCase.value,
            pointer: "",
            keyword: "version",
            reasonCode: migrationOnly
              ? "contract.state_version_unsupported"
              : versionCase.reasonCode,
          },
        ],
      });
      if (migrationOnly) {
        expect(result).toMatchObject({
          diagnostics: [
            {
              recovery:
                "Create and authorize an explicit migration plan for the persisted project state.",
            },
          ],
        });
      }
    },
  );

  it.each(fixtures)("rejects an unexpected $id root property", (fixture) => {
    expectInvalidWithReason(
      fixture,
      fixture.version,
      { ...mutableFixture(fixture.fixture), unexpected: true },
      fixture.structuralReasonCode,
    );
  });

  it.each(fixtures)("rejects a null $id required field", (fixture) => {
    const candidate = mutableFixture(fixture.fixture);
    candidate[fixture.requiredField] = null;
    expectInvalidWithReason(
      fixture,
      fixture.version,
      candidate,
      fixture.structuralReasonCode,
    );
  });

  it("accepts an adapter response containing an embedded universal result", () => {
    const response = {
      ...structuredClone(adapterMessage),
      messageType: "response",
      payloadContract: "result@1.0.0",
      payload: {
        contractVersion: "1.0.0",
        status: "success",
        exitCode: 0,
        reasonCode: "ok",
        summary: "Operation completed successfully.",
        why: [],
        evidence: [],
        stateChanged: false,
        retryable: false,
        recovery: null,
      },
    };
    const result = registry.validate({
      id: "host.adapter-message",
      version: "1.0.0",
      value: response,
      structuralReasonCode: "trail.output_invalido",
    });
    expect(result).toEqual({ kind: "valid", value: response });
    if (result.kind === "valid") expect(result.value).toBe(response);
  });
});
