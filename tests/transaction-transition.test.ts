import type { TransactionProgressV1 } from "@mestre-yoda/contracts";
import { assertPhaseTransition } from "@mestre-yoda/runtime/domain/transactions";
import { describe, expect, it } from "vitest";

const phases = [
  "begun",
  "prepared",
  "publishing",
  "committed",
  "aborted",
] as const satisfies readonly TransactionProgressV1["phase"][];

const legal = [
  ["begun", "prepared"],
  ["begun", "aborted"],
  ["prepared", "publishing"],
  ["prepared", "aborted"],
  ["publishing", "committed"],
] as const satisfies readonly (readonly [
  TransactionProgressV1["phase"],
  TransactionProgressV1["phase"],
])[];

describe("transaction phase transitions", () => {
  it("accepts exactly the five legal forward transitions", () => {
    for (const from of phases) {
      for (const to of phases) {
        const isLegal = legal.some(
          ([legalFrom, legalTo]) => legalFrom === from && legalTo === to,
        );

        if (isLegal) {
          expect(() => {
            assertPhaseTransition(from, to);
          }).not.toThrow();
        } else {
          expect(() => {
            assertPhaseTransition(from, to);
          }).toThrow("Illegal transaction phase transition");
        }
      }
    }
  });
});
