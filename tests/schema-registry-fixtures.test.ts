import manifest from "../packages/contracts/catalogs/contract-families.v1.json" with { type: "json" };
import versionCases from "../fixtures/contracts/v1/version-cases.json" with { type: "json" };
import adapterMessage from "../fixtures/contracts/v1/adapter-message.json" with { type: "json" };
import agentOutput from "../fixtures/contracts/v1/agent-output.json" with { type: "json" };
import gapProposal from "../fixtures/contracts/v1/gap-proposal.json" with { type: "json" };
import initAnswers from "../fixtures/contracts/v1/init-answers.json" with { type: "json" };
import operationApproval from "../fixtures/contracts/v1/operation-approval.json" with { type: "json" };
import approval from "../fixtures/contracts/v1/approval.json" with { type: "json" };
import event from "../fixtures/contracts/v1/event.json" with { type: "json" };
import evidence from "../fixtures/contracts/v1/evidence.json" with { type: "json" };
import feature from "../fixtures/contracts/v1/feature.json" with { type: "json" };
import gap from "../fixtures/contracts/v1/gap.json" with { type: "json" };
import gates from "../fixtures/contracts/v1/gates.json" with { type: "json" };
import lock from "../fixtures/contracts/v1/lock.json" with { type: "json" };
import migration from "../fixtures/contracts/v1/migration.json" with { type: "json" };
import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import requirementDiscovery from "../fixtures/contracts/v1/requirement-discovery.json" with { type: "json" };
import snapshot from "../fixtures/contracts/v1/snapshot.json" with { type: "json" };
import transactionManifest from "../fixtures/contracts/v1/transaction-manifest.json" with { type: "json" };
import transactionProgress from "../fixtures/contracts/v1/transaction-progress.json" with { type: "json" };
import type {
  ContractId,
  StructuralReasonCode,
} from "@kratos/runtime/domain/schema";
import { ajvSchemaRegistry } from "@kratos/runtime/infra/schema";
import { describe, expect, it } from "vitest";

interface FixtureCase {
  readonly id: ContractId;
  readonly version: "1.0.0";
  readonly versionField: "stateContract" | "hostContract";
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
  it("routes every published non-plugin version case through the registry", () => {
    expect(registryVersionCases.map(({ name }) => name)).toEqual(
      versionCases
        .filter(({ family }) => family !== "plugin")
        .map(({ name }) => name),
    );
  });

  it("covers every manifest schema exactly once", () => {
    expect(fixtures.map(({ id, version }) => ({ id, version }))).toEqual(
      manifest.schemas.map(({ id, version }) => ({ id, version })),
    );
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
      const fixture = fixtures.find(({ versionField }) =>
        versionCase.family === "host"
          ? versionField === "hostContract"
          : versionField === "stateContract",
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
              version === fixture.version,
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
