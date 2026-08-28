import type { FailureCandidateV1, RunUsageV1 } from "@kratos/contracts";

export interface UsageSample {
  readonly sessionId: string;
  readonly cumulativeGrossTokens: number | null;
  readonly budget: number | null;
  readonly now: string;
}

export interface StopLossState {
  readonly tripped: boolean;
  readonly exhausted: boolean;
}

export interface UsageSampleResult {
  readonly usage: RunUsageV1;
  readonly stopLoss: StopLossState;
}

export function initialRunUsage(runId: string, now: string): RunUsageV1 {
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    runId,
    totalGrossTokens: 0,
    epoch: { number: 1, baselineGrossTokens: 0, exhaustedAt: null },
    sessions: [],
    measurementFaultAt: null,
    updatedAt: now,
  };
}

export function recordUsageSample(
  current: RunUsageV1,
  sample: UsageSample,
): UsageSampleResult {
  if (sample.cumulativeGrossTokens === null) {
    if (sample.budget === null || current.measurementFaultAt !== null) {
      return result(current, sample.budget);
    }
    const usage: RunUsageV1 = {
      ...current,
      measurementFaultAt: sample.now,
      updatedAt: sample.now,
    };
    return result(usage, sample.budget);
  }

  const previous = current.sessions.find(
    ({ sessionId }) => sessionId === sample.sessionId,
  );
  const accepted = Math.max(
    previous?.cumulativeGrossTokens ?? 0,
    sample.cumulativeGrossTokens,
  );
  const delta = accepted - (previous?.cumulativeGrossTokens ?? 0);
  if (delta === 0) return result(current, sample.budget);

  const totalGrossTokens = current.totalGrossTokens + delta;
  const exhausted =
    current.epoch.exhaustedAt !== null ||
    (sample.budget !== null &&
      totalGrossTokens - current.epoch.baselineGrossTokens >= sample.budget);
  const sessions = [
    ...current.sessions.filter(
      ({ sessionId }) => sessionId !== sample.sessionId,
    ),
    { sessionId: sample.sessionId, cumulativeGrossTokens: accepted },
  ].sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const usage: RunUsageV1 = {
    ...current,
    totalGrossTokens,
    epoch: {
      ...current.epoch,
      exhaustedAt: current.epoch.exhaustedAt ?? (exhausted ? sample.now : null),
    },
    sessions,
    updatedAt: sample.now,
  };
  return result(usage, sample.budget);
}

function result(usage: RunUsageV1, budget: number | null): UsageSampleResult {
  return {
    usage,
    stopLoss: {
      tripped: usage.measurementFaultAt !== null,
      exhausted:
        usage.epoch.exhaustedAt !== null ||
        (budget !== null &&
          usage.totalGrossTokens - usage.epoch.baselineGrossTokens >= budget),
    },
  };
}

export function unlockStopLoss(current: RunUsageV1, now: string): RunUsageV1 {
  return {
    ...current,
    epoch: {
      number: current.epoch.number + 1,
      baselineGrossTokens: current.totalGrossTokens,
      exhaustedAt: null,
    },
    measurementFaultAt: null,
    updatedAt: now,
  };
}

export function sanitizeDiagnostic(value: string, projectRoot: string): string {
  const root = projectRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(new RegExp(root, "gu"), "<project>")
    .replace(/\b(authorization\s*:\s*bearer\s+)[^\s]+/giu, "$1<redacted>")
    .replace(
      /\b(api[_-]?key|token|password|secret)\s*[=:]\s*[^\s]+/giu,
      "$1=<redacted>",
    )
    .slice(0, 2048);
}

export interface FailureObservation {
  readonly toolFamily: FailureCandidateV1["toolFamily"];
  readonly failureClass: FailureCandidateV1["failureClass"];
  readonly exitCode: number | null;
  readonly diagnostic: string;
  readonly observedAt: string;
}

export function failureCandidate(
  observation: FailureObservation,
  digest: (canonical: string) => string,
): FailureCandidateV1 {
  const canonical = JSON.stringify([
    observation.toolFamily,
    observation.failureClass,
    observation.exitCode,
    observation.diagnostic,
  ]);
  return {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    candidateId: digest(canonical),
    toolFamily: observation.toolFamily,
    failureClass: observation.failureClass,
    exitCode: observation.exitCode,
    diagnostic: observation.diagnostic,
    firstObservedAt: observation.observedAt,
  };
}
