import { RUN_PHASES, type RunPhase } from "../workflow/index.js";

import type { PhaseMeasurement } from "./index.js";

export interface IntegerDistribution {
  readonly min: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly max: number | null;
}

export interface PhaseDistribution {
  readonly completed: number;
  readonly interrupted: number;
  readonly completedSources: readonly string[];
  readonly tokens: IntegerDistribution;
  readonly durationMs: IntegerDistribution;
  readonly recommendedTokens: number | null;
  readonly calibration: {
    readonly required: number;
    readonly observed: number;
  };
}

export interface PhaseDistributions {
  readonly calibrationMinimum: number;
  readonly phases: Readonly<Record<RunPhase, PhaseDistribution>>;
}

export interface TaskMetricsReport extends PhaseDistributions {
  readonly generatedAt: string;
  readonly sourceLogSha256: string;
}

/** Select a percentile using nearest rank over ascending integer values. */
export function nearestRank(values: readonly number[], ratio: number): number {
  if (
    values.length === 0 ||
    !Number.isFinite(ratio) ||
    ratio <= 0 ||
    ratio > 1 ||
    values.some((value) => !Number.isSafeInteger(value) || value < 0)
  ) {
    throw new Error("Nearest-rank input is invalid");
  }
  const ascending = [...values].sort((left, right) => left - right);
  const index = Math.ceil(ratio * ascending.length) - 1;
  const selected = ascending[index];
  if (selected === undefined) throw new Error("Nearest rank is unavailable");
  return selected;
}

export function derivePhaseDistributions(
  records: readonly PhaseMeasurement[],
  calibrationMinimum: number,
): PhaseDistributions {
  if (!Number.isSafeInteger(calibrationMinimum) || calibrationMinimum < 1) {
    throw new Error("Calibration minimum is invalid");
  }
  const phases = Object.fromEntries(
    RUN_PHASES.map((phase) => [
      phase,
      distributionFor(records, phase, calibrationMinimum),
    ]),
  ) as Record<RunPhase, PhaseDistribution>;
  return { calibrationMinimum, phases };
}

function distributionFor(
  records: readonly PhaseMeasurement[],
  phase: RunPhase,
  calibrationMinimum: number,
): PhaseDistribution {
  const selected = records.filter((record) => record.phase === phase);
  const completed = selected.filter((record) => record.status === "completed");
  const tokens = completed.map(({ grossTokens }) => grossTokens);
  const durations = completed.map(({ durationMs }) => durationMs);
  return {
    completed: completed.length,
    interrupted: selected.filter(({ status }) => status === "interrupted")
      .length,
    completedSources: [
      ...new Set(completed.map(({ feature, runId }) => `${feature}/${runId}`)),
    ].sort((left, right) => left.localeCompare(right, "en-US")),
    tokens: integerDistribution(tokens),
    durationMs: integerDistribution(durations),
    recommendedTokens:
      tokens.length < calibrationMinimum ? null : nearestRank(tokens, 0.95),
    calibration: { required: calibrationMinimum, observed: completed.length },
  };
}

function integerDistribution(values: readonly number[]): IntegerDistribution {
  if (values.length === 0) {
    return { min: null, p50: null, p95: null, max: null };
  }
  return {
    min: nearestRank(values, 1 / values.length),
    p50: nearestRank(values, 0.5),
    p95: nearestRank(values, 0.95),
    max: nearestRank(values, 1),
  };
}

export function renderTaskMetrics(report: TaskMetricsReport): string {
  const rows = RUN_PHASES.map((phase) => {
    const distribution = report.phases[phase];
    const recommendation =
      distribution.recommendedTokens === null
        ? `Unavailable (${String(distribution.calibration.observed)}/${String(distribution.calibration.required)}; metrics.calibration_insufficient)`
        : String(distribution.recommendedTokens);
    return [
      phase,
      String(distribution.completed),
      String(distribution.interrupted),
      distribution.completedSources.length === 0
        ? "none"
        : distribution.completedSources.join(", "),
      rendered(distribution.tokens.min),
      rendered(distribution.tokens.p50),
      rendered(distribution.tokens.p95),
      rendered(distribution.tokens.max),
      rendered(distribution.durationMs.min),
      rendered(distribution.durationMs.p50),
      rendered(distribution.durationMs.p95),
      rendered(distribution.durationMs.max),
      recommendation,
    ];
  }).map((cells) => `| ${cells.join(" | ")} |`);
  return [
    "# Task metrics",
    "",
    `Generated at: ${report.generatedAt}`,
    `Raw-log SHA-256: ${report.sourceLogSha256}`,
    `Calibration policy: nearest-rank p95, minimum ${String(report.calibrationMinimum)} completed samples per phase.`,
    "",
    "| Phase | Completed | Interrupted | Completed sources | token min | token p50 | token p95 | token max | duration-ms min | duration-ms p50 | duration-ms p95 | duration-ms max | Recommended tokens |",
    "| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
}

function rendered(value: number | null): string {
  return value === null ? "n/a" : String(value);
}
