import {
  GATE_IDS,
  aggregateGateFailures,
  resolveGateModes,
  type GateFailure,
  type GateId,
  type GateMode,
} from "@kratos/runtime/domain/gates";
import { describe, expect, it } from "vitest";

const MODES = ["shadow", "warn", "enforce"] as const;
const OUTCOME = { shadow: "pass", warn: "warn", enforce: "block" } as const;

function failed(gateId: GateId, priority: number, mode: GateMode): GateFailure {
  return {
    gateId,
    reasonCode:
      gateId === "spec-approved" ? "gate.aprovacao_spec" : "gate.gaps_abertos",
    priority,
    mode,
    evidenceRefs: [`.brain/${gateId}`],
    detail: null,
  };
}

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length === 0) return [[]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (remaining) => [item, ...remaining],
    ),
  );
}

describe("per-gate policy modes", () => {
  it("resolves a total immutable table from the project default and overrides", () => {
    const overrides = { "gaps-closed": "shadow" } as const;
    const resolved = resolveGateModes("strict", overrides);
    expect(Object.keys(resolved)).toEqual(GATE_IDS);
    expect(resolved["spec-approved"]).toBe("enforce");
    expect(resolved["gaps-closed"]).toBe("shadow");
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(overrides).toEqual({ "gaps-closed": "shadow" });
  });

  it.each(GATE_IDS)(
    "applies the %s override over the standard default without changing other gates",
    (overriddenGate) => {
      const resolved = resolveGateModes("standard", {
        [overriddenGate]: "enforce",
      });
      for (const gateId of GATE_IDS) {
        expect(resolved[gateId]).toBe(
          gateId === overriddenGate ? "enforce" : "warn",
        );
      }
    },
  );

  it.each(
    MODES.flatMap((left) => MODES.map((right) => [left, right] as const)),
  )("aggregates %s and %s by the most severe outcome", (left, right) => {
    const decision = aggregateGateFailures([
      failed("spec-approved", 40, left),
      failed("gaps-closed", 50, right),
    ]);
    const expected = [OUTCOME[left], OUTCOME[right]].includes("block")
      ? "block"
      : [OUTCOME[left], OUTCOME[right]].includes("warn")
        ? "warn"
        : "pass";
    expect(decision.outcome).toBe(expected);
  });

  it("selects an enforce failure as primary over a lower-priority shadow failure", () => {
    const decision = aggregateGateFailures([
      failed("spec-approved", 10, "shadow"),
      failed("final-acceptance", 80, "enforce"),
    ]);
    expect(decision.outcome).toBe("block");
    expect(decision.primary?.gateId).toBe("final-acceptance");
  });

  it("orders equal-outcome failures by priority", () => {
    const decision = aggregateGateFailures([
      failed("final-acceptance", 80, "warn"),
      failed("spec-approved", 40, "warn"),
    ]);
    expect(decision.failures.map(({ gateId }) => gateId)).toEqual([
      "spec-approved",
      "final-acceptance",
    ]);
  });

  it("uses gate ID as the final stable tie-break across permutations", () => {
    const failures = [
      failed("spec-approved", 40, "warn"),
      failed("gaps-closed", 40, "warn"),
    ];
    const expected = JSON.stringify(aggregateGateFailures(failures));
    for (const permutation of permutations(failures)) {
      const decision = aggregateGateFailures(permutation);
      expect(JSON.stringify(decision)).toBe(expected);
      expect(decision.primary?.gateId).toBe("gaps-closed");
    }
  });

  it("aggregates every permutation into the same canonical JSON", () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const failures = [
        failed("spec-approved", 40, MODES[seed % 3] ?? "shadow"),
        failed("gaps-closed", 50, MODES[(seed + 1) % 3] ?? "warn"),
        failed("final-acceptance", 80, MODES[(seed + 2) % 3] ?? "enforce"),
      ];
      const expected = JSON.stringify(aggregateGateFailures(failures));
      for (const permutation of permutations(failures)) {
        expect(
          JSON.stringify(aggregateGateFailures(permutation)),
          `seed=${String(seed)}`,
        ).toBe(expected);
      }
    }
  });
});
