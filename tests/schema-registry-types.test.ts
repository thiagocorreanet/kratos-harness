import type {
  ProjectConfigV1,
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
  it("maps every closed contract identifier to one generated type", () => {
    const ids = [
      "host.adapter-message",
      "host.agent-output",
      "host.gap-proposal",
      "host.init-answers",
      "host.operation-message",
      "state.approval",
      "state.event",
      "state.evidence",
      "state.feature",
      "state.gap",
      "state.gates",
      "state.lock",
      "state.migration",
      "state.project-config",
      "state.requirement-discovery",
      "state.snapshot",
      "state.transaction-manifest",
      "state.transaction-progress",
    ] as const satisfies readonly ContractId[];
    expect(ids).toHaveLength(18);
    expectTypeOf<
      ContractValue<"state.project-config">
    >().toEqualTypeOf<ProjectConfigV1>();
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
      <I extends ContractId>(
        candidate: ContractRequest<I>,
      ) => ValidationResult<ContractValue<I>>
    >();
    expectTypeOf<ValidationDiagnostic>().toHaveProperty("pointer");
  });
});
