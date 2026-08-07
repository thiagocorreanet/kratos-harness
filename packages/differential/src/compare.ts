import { createHash } from "node:crypto";

import type {
  DifferentialObservation,
  DifferentialReport,
  DifferentialScenario,
  Mismatch,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function safeSummary(value: unknown, pointer: string): unknown {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "string") {
    if (pointer.endsWith("/sha256") && /^[a-f0-9]{64}$/u.test(value)) {
      return value;
    }
    return {
      type: "string",
      bytes: Buffer.byteLength(value),
      sha256: createHash("sha256").update(value).digest("hex"),
    };
  }
  if (
    isRecord(value) &&
    typeof value.bytes === "number" &&
    typeof value.sha256 === "string"
  ) {
    return { bytes: value.bytes, sha256: value.sha256 };
  }
  return { type: Array.isArray(value) ? "array" : typeof value };
}

function mismatchKind(
  pointer: string,
  expected: unknown,
  actual: unknown,
  candidate: DifferentialObservation,
): Mismatch["kind"] {
  if (pointer === "/process/outcome" && actual === "timeout") return "timeout";
  if (pointer === "/process/outcome" && actual === "signal") return "crash";
  if (
    pointer.startsWith("/filesystem/mutations/") &&
    (candidate.process.outcome !== "exit" || candidate.process.exitCode !== 0)
  ) {
    return "partial_mutation";
  }
  if (expected === undefined) return "unexpected";
  if (actual === undefined) return "missing";
  if (
    (Array.isArray(expected) !== Array.isArray(actual) &&
      (Array.isArray(expected) || Array.isArray(actual))) ||
    typeof expected !== typeof actual
  ) {
    return "type";
  }
  return "value";
}

function collect(
  expected: unknown,
  actual: unknown,
  pointer: string,
  side: "oracle" | "candidate",
  scenario: DifferentialScenario,
  observation: DifferentialObservation,
  output: Mismatch[],
): void {
  if (Object.is(expected, actual)) return;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      collect(
        expected[index],
        actual[index],
        `${pointer}/${String(index)}`,
        side,
        scenario,
        observation,
        output,
      );
    }
    return;
  }
  if (isRecord(expected) && isRecord(actual)) {
    const keys = [
      ...new Set([...Object.keys(expected), ...Object.keys(actual)]),
    ].sort();
    for (const key of keys) {
      collect(
        expected[key],
        actual[key],
        `${pointer}/${escapePointer(key)}`,
        side,
        scenario,
        observation,
        output,
      );
    }
    return;
  }
  output.push({
    pointer: `/${side}${pointer}`,
    kind: mismatchKind(pointer, expected, actual, observation),
    scenarioId: scenario.id,
    parityContractIds: scenario.parityContractIds,
    oracle: safeSummary(expected, pointer),
    candidate: safeSummary(actual, pointer),
  });
}

export function compareGolden(
  side: "oracle" | "candidate",
  scenario: DifferentialScenario,
  actual: DifferentialObservation,
): readonly Mismatch[] {
  const mismatches: Mismatch[] = [];
  collect(scenario.expected, actual, "", side, scenario, actual, mismatches);
  return mismatches;
}

export function compareObservations(
  scenario: DifferentialScenario,
  oracle: DifferentialObservation,
  candidate: DifferentialObservation,
): DifferentialReport {
  const mismatches = [
    ...compareGolden("oracle", scenario, oracle),
    ...compareGolden("candidate", scenario, candidate),
  ].sort((left, right) =>
    `${left.pointer}\u0000${left.kind}`.localeCompare(
      `${right.pointer}\u0000${right.kind}`,
      "en-US",
    ),
  );
  return {
    scenarioId: scenario.id,
    parityContractIds: scenario.parityContractIds,
    equal: mismatches.length === 0,
    mismatches,
    normalization: scenario.normalization,
  };
}
