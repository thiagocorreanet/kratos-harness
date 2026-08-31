import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import {
  buildRepairResolution,
  buildRepairRestartTicket,
} from "@kratos/runtime/domain/repair-loop";
import { describe, expect, it } from "vitest";

const registry = createSchemaRegistry();

describe("repair resolution persisted contracts", () => {
  it("builds a bounded human resolution artifact", () => {
    const value = buildRepairResolution({
      resolutionId: "resolution-01",
      runId: "run-01",
      criterionId: "AC-1.1.1",
      classification: "code",
      stopRef: ".brain/runs/run-01/stops/AC-1.1.1.json",
      stopDigest: "a".repeat(64),
      resolvedBy: "human-01",
      observation:
        "The implementation was corrected and independently verified.",
      resolvedAt: "2026-08-30T12:02:00.000Z",
      nextRunId: null,
    });

    expect(
      registry.validate({
        id: "state.repair-resolution" as never,
        version: "1.1.0",
        value,
        structuralReasonCode: "runtime.state_corrupt",
      }),
    ).toMatchObject({ kind: "valid", value });
    expect(
      registry.validate({
        id: "state.repair-resolution" as never,
        version: "1.1.0",
        value: { ...value, observation: "   " },
        structuralReasonCode: "runtime.state_corrupt",
      }).kind,
    ).toBe("invalid");
  });

  it("binds a specification restart to its resolution and retires the defective criterion", () => {
    const value = buildRepairRestartTicket({
      ticketId: "restart-01",
      sourceRunId: "run-01",
      nextRunId: "run-02",
      resolutionRef: ".brain/runs/run-01/resolutions/resolution-01.json",
      resolutionDigest: "b".repeat(64),
      retiredCriterionIds: ["AC-1.1.1"],
      createdAt: "2026-08-30T12:02:00.000Z",
    });

    expect(
      registry.validate({
        id: "state.repair-restart" as never,
        version: "1.0.0",
        value,
        structuralReasonCode: "runtime.state_corrupt",
      }),
    ).toMatchObject({ kind: "valid", value });
  });

  it("rejects an empty, whitespace-only, or control-character observation", () => {
    for (const observation of ["", "   ", "line one\nline two"]) {
      expect(() =>
        buildRepairResolution({
          resolutionId: "resolution-01",
          runId: "run-01",
          criterionId: "AC-1.1.1",
          classification: "code",
          stopRef: ".brain/runs/run-01/stops/AC-1.1.1.json",
          stopDigest: "a".repeat(64),
          resolvedBy: "human-01",
          observation,
          resolvedAt: "2026-08-30T12:02:00.000Z",
          nextRunId: null,
        }),
      ).toThrow();
    }
  });
});
