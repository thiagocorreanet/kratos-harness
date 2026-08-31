import { GATE_IDS, type GateId, type GateMode } from "./model.js";
import type {
  GateAggregation,
  GateFailure,
  GateModes,
  GateOutcome,
  ProjectPolicyMode,
} from "./model.js";

const SEVERITY: Readonly<Record<GateOutcome, number>> = {
  block: 0,
  warn: 1,
  pass: 2,
};

export function outcomeForMode(mode: GateMode): GateOutcome {
  return mode === "enforce" ? "block" : mode === "warn" ? "warn" : "pass";
}

export function resolveGateModes(
  policyMode: ProjectPolicyMode,
  overrides: Readonly<Partial<Record<GateId, GateMode>>>,
): GateModes {
  const inherited = policyMode === "strict" ? "enforce" : "warn";
  return Object.freeze(
    Object.fromEntries(GATE_IDS.map((id) => [id, overrides[id] ?? inherited])),
  ) as GateModes;
}

export function approvalModeFor(
  target: string,
  defaultMode: GateMode,
  gateModes: GateModes,
): GateMode {
  if (target === "spec") return gateModes["spec-approved"];
  if (target === "final-acceptance") return gateModes["final-acceptance"];
  return Object.hasOwn(gateModes, target)
    ? gateModes[target as GateId]
    : defaultMode;
}

export function compareGateFailures(
  left: GateFailure,
  right: GateFailure,
): number {
  return (
    SEVERITY[outcomeForMode(left.mode)] -
      SEVERITY[outcomeForMode(right.mode)] ||
    left.priority - right.priority ||
    left.gateId.localeCompare(right.gateId, "en-US")
  );
}

export function aggregateGateFailures(
  input: readonly GateFailure[],
): GateAggregation {
  const failures = Object.freeze(
    [...input]
      .sort(compareGateFailures)
      .map((failure) => Object.freeze({ ...failure })),
  );
  return Object.freeze({
    outcome:
      failures[0] === undefined ? "pass" : outcomeForMode(failures[0].mode),
    primary: failures[0] ?? null,
    failures,
  });
}
