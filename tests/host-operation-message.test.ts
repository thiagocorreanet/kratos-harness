import approval from "../fixtures/contracts/v1/operation-approval.json" with { type: "json" };
import cancellation from "../fixtures/contracts/v1/operation-cancellation.json" with { type: "json" };
import error from "../fixtures/contracts/v1/operation-error.json" with { type: "json" };
import hook from "../fixtures/contracts/v1/operation-hook.json" with { type: "json" };
import timeout from "../fixtures/contracts/v1/operation-timeout.json" with { type: "json" };
import type { HostOperationMessageV1 } from "@kratos/contracts";
import {
  classifyDelivery,
  mutationNeedsRecovery,
  requiredCapability,
} from "@kratos/runtime/domain/host";
import { ajvSchemaRegistry } from "@kratos/runtime/infra/schema";
import { describe, expect, it } from "vitest";

const fixtures = [approval, hook, timeout, cancellation, error] as const;
const registry = ajvSchemaRegistry();

function message(value: unknown): HostOperationMessageV1 {
  return value as HostOperationMessageV1;
}

describe("host operation message contract", () => {
  it.each(fixtures)("accepts every committed lifecycle fixture", (fixture) => {
    expect(
      registry.validate({
        id: "host.operation-message",
        version: "1.0.0",
        value: fixture,
        structuralReasonCode: "trail.output_invalido",
      }),
    ).toEqual({ kind: "valid", value: fixture });
  });

  it("rejects unknown fields", () => {
    const candidate = { ...approval, unexpected: true };
    const result = registry.validate({
      id: "host.operation-message",
      version: "1.0.0",
      value: candidate,
      structuralReasonCode: "trail.output_invalido",
    });
    expect(result.kind).toBe("invalid");
  });

  it("requires a transaction reference for an interrupted partial mutation", () => {
    const candidate = structuredClone(timeout);
    candidate.payload.mutation.transactionRef = null;
    const result = registry.validate({
      id: "host.operation-message",
      version: "1.0.0",
      value: candidate,
      structuralReasonCode: "trail.output_invalido",
    });
    expect(result.kind).toBe("invalid");
  });

  it("accepts one ordered delivery and treats its retry as idempotent", () => {
    const first = classifyDelivery(null, message(approval));
    expect(first).toMatchObject({ kind: "accepted", stateChanged: true });
    const duplicate = classifyDelivery(first.cursor, message(approval));
    expect(duplicate).toEqual({
      kind: "duplicate",
      stateChanged: false,
      cursor: first.cursor,
    });
  });

  it("refuses a gap, stale delivery, changed correlation, and changed operation", () => {
    const first = classifyDelivery(null, message(approval));
    if (first.kind !== "accepted") throw new Error("Expected first delivery");

    expect(
      classifyDelivery(first.cursor, message({ ...hook, sequence: 2 })),
    ).toMatchObject({ kind: "rejected", reason: "out_of_order" });
    expect(
      classifyDelivery(first.cursor, message({ ...hook, sequence: 0 })),
    ).toMatchObject({ kind: "rejected", reason: "out_of_order" });
    expect(
      classifyDelivery(
        first.cursor,
        message({ ...hook, correlationId: "correlation-02" }),
      ),
    ).toMatchObject({ kind: "rejected", reason: "correlation_mismatch" });
    expect(
      classifyDelivery(
        first.cursor,
        message({ ...hook, operationId: "operation-02" }),
      ),
    ).toMatchObject({ kind: "rejected", reason: "operation_mismatch" });
  });

  it("declares one explicit required capability per message kind", () => {
    expect(fixtures.map((fixture) => requiredCapability(message(fixture)))).toEqual([
      "interaction.approval",
      "lifecycle.hook",
      "lifecycle.timeout",
      "lifecycle.cancellation",
      "lifecycle.error",
    ]);
  });

  it("reports interrupted mutations that require recovery", () => {
    expect(mutationNeedsRecovery(message(timeout))).toBe(true);
    expect(mutationNeedsRecovery(message(error))).toBe(true);
    expect(mutationNeedsRecovery(message(cancellation))).toBe(false);
    expect(mutationNeedsRecovery(message(approval))).toBe(false);
  });
});
