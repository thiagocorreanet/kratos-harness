import type { TransactionProgressV1 } from "@kratos/contracts";

const legalTransitions = new Set<string>([
  "begun:prepared",
  "begun:aborted",
  "prepared:publishing",
  "prepared:aborted",
  "publishing:committed",
]);

export function assertPhaseTransition(
  from: TransactionProgressV1["phase"],
  to: TransactionProgressV1["phase"],
): void {
  if (!legalTransitions.has(`${from}:${to}`)) {
    throw new Error("Illegal transaction phase transition");
  }
}
