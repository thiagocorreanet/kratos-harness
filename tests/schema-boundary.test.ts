import {
  prepareContract,
  type SchemaRegistry,
} from "@mestre-yoda/runtime/domain/schema";
import { describe, expect, it } from "vitest";

describe("contract boundary preparation", () => {
  it("validates before producing canonical text", () => {
    const calls: string[] = [];
    const value = { contractVersion: "1.0.0", stateContract: "1.0.0" };
    const registry: SchemaRegistry = {
      validate: () => {
        calls.push("validate");
        return { kind: "valid", value } as never;
      },
    };

    const result = prepareContract(registry, {
      id: "state.snapshot",
      version: "1.0.0",
      value,
      structuralReasonCode: "runtime.state_corrupt",
    });

    expect(calls).toEqual(["validate"]);
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.canonical).toEqual(expect.any(String));
    }
  });

  it("returns validation diagnostics without serializing rejected input", () => {
    const rejected = { cyclic: null as unknown };
    rejected.cyclic = rejected;
    const diagnostics = [
      {
        contract: "state.snapshot" as const,
        version: "1.0.0",
        pointer: "",
        keyword: "type",
        reasonCode: "runtime.state_corrupt",
        recovery: "recover",
      },
    ];
    const registry: SchemaRegistry = {
      validate: () => ({ kind: "invalid", diagnostics }),
    };

    expect(
      prepareContract(registry, {
        id: "state.snapshot",
        version: "1.0.0",
        value: rejected,
        structuralReasonCode: "runtime.state_corrupt",
      }),
    ).toEqual({ kind: "invalid", diagnostics });
  });
});
