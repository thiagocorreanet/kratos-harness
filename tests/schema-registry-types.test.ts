import type { ProjectConfigV1 } from "@mestre-yoda/contracts";
import type {
  ContractId,
  ContractRequest,
  ContractValue,
  SchemaRegistry,
  StructuralReasonCode,
  ValidationDiagnostic,
  ValidationResult,
} from "@mestre-yoda/runtime/domain/schema";
import { describe, expect, expectTypeOf, it } from "vitest";

describe("schema registry vocabulary", () => {
  it("maps every closed contract identifier to one generated type", () => {
    const ids = [
      "host.adapter-message",
      "state.approval",
      "state.event",
      "state.evidence",
      "state.lock",
      "state.migration",
      "state.project-config",
      "state.snapshot",
    ] as const satisfies readonly ContractId[];
    expect(ids).toHaveLength(8);
    expectTypeOf<
      ContractValue<"state.project-config">
    >().toEqualTypeOf<ProjectConfigV1>();
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
    const request: ContractRequest<"state.project-config"> = {
      id: "state.project-config",
      version: "1.0.0",
      value: { untrusted: true },
      structuralReasonCode: "guard.config_corrupt",
    };
    expectTypeOf<typeof request>().toEqualTypeOf<
      ContractRequest<"state.project-config">
    >();
    expectTypeOf<SchemaRegistry["validate"]>().toEqualTypeOf<
      <I extends ContractId>(
        candidate: ContractRequest<I>,
      ) => ValidationResult<ContractValue<I>>
    >();
    expectTypeOf<ValidationDiagnostic>().toHaveProperty("pointer");
  });
});
