import type {
  AcceptanceCriteriaSnapshotV1,
  AcceptanceVerdictV1,
  AdapterMessageV1,
  CuratedMemoryV1,
  FeatureScopeV1,
  GuardrailsV1,
  AdapterMessageV1_1,
  EventV1_1,
  EventV1,
  EventV1_2,
  InitAnswersV1,
  InitAnswersV1_1,
  InitAnswersV1_2,
  InitAnswersV1_3,
  MigrationV1,
  MigrationV1_1,
  PhaseMeasurementV1,
  PhaseLifecycleV1,
  MemoryCaptureV1_2,
  MemoryChangeV1_2,
  MemoryMigrationV1_2,
  PreToolUseV1,
  ProjectConfigV1,
  ProjectConfigV1_1,
  ProjectConfigV1_2,
  ProjectConfigV1_3,
  ProjectConfigV1_4,
  RequirementDiscoveryV1,
  TransactionManifestV1,
  TransactionProgressV1,
} from "@kratos/contracts";
import type {
  ContractId,
  ContractRequest,
  ContractValue,
  SchemaRegistry,
  StructuralReasonCode,
  ValidationDiagnostic,
  ValidationResult,
} from "@kratos/runtime/domain/schema";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("schema registry vocabulary", () => {
  it("maps every closed contract identifier to its readable generated types", () => {
    const ids = [
      "host.adapter-message",
      "host.agent-output",
      "host.gap-proposal",
      "host.init-answers",
      "host.memory-capture",
      "host.memory-change",
      "host.memory-migration",
      "host.operation-message",
      "host.phase-lifecycle",
      "host.phase-handoff",
      "host.pre-tool-use",
      "state.approval",
      "state.curated-memory",
      "state.acceptance-criteria-snapshot",
      "state.acceptance-verdict",
      "state.event",
      "state.evidence",
      "state.feature",
      "state.feature-scope",
      "state.gap",
      "state.gates",
      "state.guardrails",
      "state.lock",
      "state.migration",
      "state.phase-measurement",
      "state.project-config",
      "state.requirement-discovery",
      "state.snapshot",
      "state.transaction-manifest",
      "state.transaction-progress",
    ] as const satisfies readonly ContractId[];
    expect(ids).toHaveLength(30);
    expectTypeOf<
      ContractValue<"host.phase-lifecycle">
    >().toEqualTypeOf<PhaseLifecycleV1>();
    expectTypeOf<
      ContractValue<"state.phase-measurement">
    >().toEqualTypeOf<PhaseMeasurementV1>();
    expectTypeOf<
      ContractValue<"state.acceptance-criteria-snapshot">
    >().toEqualTypeOf<AcceptanceCriteriaSnapshotV1>();
    expectTypeOf<
      ContractValue<"state.acceptance-verdict">
    >().toEqualTypeOf<AcceptanceVerdictV1>();
    expectTypeOf<
      ContractValue<"state.curated-memory">
    >().toEqualTypeOf<CuratedMemoryV1>();
    expectTypeOf<
      ContractValue<"state.feature-scope">
    >().toEqualTypeOf<FeatureScopeV1>();
    expectTypeOf<
      ContractValue<"state.guardrails">
    >().toEqualTypeOf<GuardrailsV1>();
    expectTypeOf<
      ContractValue<"host.pre-tool-use">
    >().toEqualTypeOf<PreToolUseV1>();
    expectTypeOf<ContractValue<"state.project-config">>().toEqualTypeOf<
      | ProjectConfigV1
      | ProjectConfigV1_1
      | ProjectConfigV1_2
      | ProjectConfigV1_3
      | ProjectConfigV1_4
    >();
    expectTypeOf<ContractValue<"state.event">>().toEqualTypeOf<
      EventV1 | EventV1_1 | EventV1_2
    >();
    expectTypeOf<ContractValue<"state.migration">>().toEqualTypeOf<
      MigrationV1 | MigrationV1_1
    >();
    expectTypeOf<ContractValue<"host.init-answers">>().toEqualTypeOf<
      InitAnswersV1 | InitAnswersV1_1 | InitAnswersV1_2 | InitAnswersV1_3
    >();
    expectTypeOf<ContractValue<"host.adapter-message">>().toEqualTypeOf<
      AdapterMessageV1 | AdapterMessageV1_1
    >();
    expectTypeOf<
      ContractValue<"host.memory-capture">
    >().toEqualTypeOf<MemoryCaptureV1_2>();
    expectTypeOf<
      ContractValue<"host.memory-change">
    >().toEqualTypeOf<MemoryChangeV1_2>();
    expectTypeOf<
      ContractValue<"host.memory-migration">
    >().toEqualTypeOf<MemoryMigrationV1_2>();
    expectTypeOf<
      ContractValue<"state.requirement-discovery">
    >().toEqualTypeOf<RequirementDiscoveryV1>();
    expectTypeOf<
      ContractValue<"state.transaction-manifest">
    >().toEqualTypeOf<TransactionManifestV1>();
    expectTypeOf<
      ContractValue<"state.transaction-progress">
    >().toEqualTypeOf<TransactionProgressV1>();
  });

  it("requires the caller to select an existing structural failure policy", () => {
    const policies = [
      "guard.config_corrupt",
      "runtime.state_corrupt",
      "trail.uso",
      "trail.output_invalido",
    ] as const satisfies readonly StructuralReasonCode[];
    expect(policies).toHaveLength(4);
  });

  it("keeps unknown input outside the typed domain until validation", () => {
    expectTypeOf<
      ContractRequest<"state.project-config">["value"]
    >().toEqualTypeOf<unknown>();
    expectTypeOf<SchemaRegistry["validate"]>().toEqualTypeOf<
      <I extends ContractId, V>(
        candidate: ContractRequest<I, V>,
      ) => ValidationResult<ContractValue<I, V>>
    >();
    expectTypeOf<ValidationDiagnostic>().toHaveProperty("pointer");
  });
});
