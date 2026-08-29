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
  return truncateDiagnostic(
    stripControls(stripAnsi(value))
      .replace(/\r\n?/gu, "\n")
      .replace(new RegExp(root, "gu"), "<project>")
      .replace(/\b(authorization\s*:\s*bearer\s+)[^\s]+/giu, "$1<redacted>")
      .replace(
        /\b(api[_-]?key|token|password|secret)\s*[=:]\s*[^\s]+/giu,
        "$1=<redacted>",
      ),
  );
}

const MAX_DIAGNOSTIC_BYTES = 2048;
const ansiEscape = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "gu",
);
// A temporary location alone is not enough evidence that a trailing token is
// generated. These finite terminal markers keep release/version names intact.
const temporaryNonce =
  /((?:\/tmp|\/var\/tmp)\/[^\s/]+?-(?:test|tmp|temp|run|build|cache))-(?:[0-9]{6,}|[a-f0-9]{8,}|(?=[A-Za-z0-9]{6}(?=\/|\s|$))(?=(?:[A-Za-z0-9]*[A-Za-z]){2}[A-Za-z0-9]*(?=\/|\s|$))(?=(?:[A-Za-z0-9]*\d){2}[A-Za-z0-9]*(?=\/|\s|$))[A-Za-z0-9]{6})(?=\/|\s|$)/gu;

function stripAnsi(value: string): string {
  return value.replace(ansiEscape, "");
}

function stripControls(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20;
    })
    .filter((character) => character.codePointAt(0) !== 0x7f)
    .join("");
}

function truncateDiagnostic(value: string): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const width = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + width > MAX_DIAGNOSTIC_BYTES) break;
    result += character;
    bytes += width;
  }
  return result;
}

export interface FailureObservation {
  readonly toolFamily: FailureCandidateV1["toolFamily"];
  readonly failureClass: FailureCandidateV1["failureClass"];
  readonly exitCode: number | null;
  readonly diagnostic: string;
  readonly observedAt: string;
}

type CandidateIdentity = Pick<
  FailureObservation,
  "toolFamily" | "failureClass" | "exitCode" | "diagnostic"
> & { readonly observedAt?: string };

export interface CandidateCaptureDecision {
  readonly candidate: FailureCandidateV1;
  readonly write: boolean;
}

/**
 * Produce the stable identity for a candidate without retaining a second copy
 * of its diagnostic. The persisted record stays readable by older runtimes;
 * normalization only happens while making a capture decision.
 */
export function candidateNormalizationKey(
  observation: CandidateIdentity,
  digest: (canonical: string) => string,
): string {
  return digest(
    JSON.stringify([
      observation.toolFamily,
      observation.failureClass,
      observation.exitCode,
      normalizeCandidateDiagnostic(observation.diagnostic),
    ]),
  );
}

/** Decide whether capture needs one new file from supplied, already-read v1 candidates. */
export function captureCandidate(
  observation: FailureObservation,
  existing: readonly FailureCandidateV1[],
  digest: (canonical: string) => string,
): CandidateCaptureDecision {
  const key = candidateNormalizationKey(observation, digest);
  const matched = [...existing]
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId))
    .find((candidate) => candidateNormalizationKey(candidate, digest) === key);
  if (matched !== undefined) return { candidate: matched, write: false };
  return {
    candidate: {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      candidateId: key,
      toolFamily: observation.toolFamily,
      failureClass: observation.failureClass,
      exitCode: observation.exitCode,
      diagnostic: observation.diagnostic,
      firstObservedAt: observation.observedAt,
    },
    write: true,
  };
}

function normalizeCandidateDiagnostic(value: string): string {
  return stripControls(stripAnsi(value))
    .replace(
      /\b\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)\b/gu,
      "<timestamp>",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
      "<uuid>",
    )
    .replace(temporaryNonce, "$1-<nonce>")
    .replace(
      /(^|[\s(])([^\s:()]+?\.[A-Za-z0-9]{1,10}):\d+:\d+\b/gu,
      "$1$2:<line>:<column>",
    )
    .replace(
      /\bline\s+\d+\s*,\s*column\s+\d+\b/giu,
      "line <line>, column <column>",
    )
    .replace(/\s+/gu, " ")
    .trim();
}

export function failureCandidate(
  observation: FailureObservation,
  digest: (canonical: string) => string,
): FailureCandidateV1 {
  return captureCandidate(observation, [], digest).candidate;
}
