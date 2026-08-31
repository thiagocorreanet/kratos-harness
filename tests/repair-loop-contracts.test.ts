import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

describe("repair-loop persisted contracts", () => {
  it("accepts a bounded immutable repair-stop artifact", () => {
    const value = {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      stopId: "stop-01",
      runId: "run-01",
      criterionId: "AC-1.1.1",
      attempt: 3,
      attemptCeiling: 3,
      classification: "code",
      diagnosis: "The implementation misses the terminal transition.",
      recordedAt: "2026-08-30T12:00:00.000Z",
    };

    expect(
      createSchemaRegistry().validate({
        id: "state.repair-loop-stop" as never,
        version: "1.0.0",
        value,
        structuralReasonCode: "runtime.state_corrupt",
      }),
    ).toEqual({ kind: "valid", value });
  });

  it("rejects a whitespace-only diagnosis in repair-stop 1.1", () => {
    expect(
      createSchemaRegistry().validate({
        id: "state.repair-loop-stop" as never,
        version: "1.1.0",
        value: {
          contractVersion: "1.1.0",
          stateContract: "1.1.0",
          stopId: "stop-01",
          runId: "run-01",
          criterionId: "AC-1.1.1",
          attempt: 3,
          attemptCeiling: 3,
          classification: "code",
          diagnosis: "   ",
          recordedAt: "2026-08-30T12:00:00.000Z",
        },
        structuralReasonCode: "runtime.state_corrupt",
      }).kind,
    ).toBe("invalid");
  });

  it("keeps predecessor event schema bytes unchanged", async () => {
    const [v1, v1_1] = await Promise.all([
      readFile(new URL("schemas/state/event.v1.schema.json", root), "utf8"),
      readFile(new URL("schemas/state/event.v1.1.schema.json", root), "utf8"),
    ]);
    const sha256 = (value: string) =>
      createHash("sha256").update(value).digest("hex");

    expect(sha256(v1)).toBe(
      "83431b3a9c1615460eb6faef640671e8ae300a1c347b929c009570a177e6c80d",
    );
    expect(sha256(v1_1)).toBe(
      "856cb81c6823d8717c47fb957b4cebf9a6e16cb2c8a1a79b3d0448394ef6d57f",
    );
  });
});
