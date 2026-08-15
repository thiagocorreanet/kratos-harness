export type JudgeVerdict = "pass" | "fail" | "unavailable";

export interface JudgeObservation {
  readonly judgeId: string;
  readonly independenceKey: string;
  readonly artifactDigest: string;
  readonly criteriaDigest: string;
  readonly rubricVersion: string;
  readonly verdict: JudgeVerdict;
  readonly timedOut: boolean;
  readonly observedAt: string;
}

export type DualJudgeDecision =
  | {
      readonly kind: "candidate";
      readonly verdict: Exclude<JudgeVerdict, "unavailable">;
      readonly artifactDigest: string;
      readonly criteriaDigest: string;
      readonly evidence: readonly JudgeObservation[];
    }
  | {
      readonly kind: "human-review";
      readonly reason:
        | "judge.disagreement"
        | "judge.insufficient"
        | "judge.not_independent"
        | "judge.stale_content"
        | "judge.unavailable";
      readonly evidence: readonly JudgeObservation[];
    };

/** Produces evidence only; callers retain all mutation authority. */
export function evaluateIndependentJudges(
  expected: {
    readonly artifactDigest: string;
    readonly criteriaDigest: string;
    readonly rubricVersion: string;
  },
  observations: readonly JudgeObservation[],
): DualJudgeDecision {
  const evidence = [...observations].sort((left, right) =>
    left.judgeId.localeCompare(right.judgeId, "en-US"),
  );
  if (evidence.length !== 2) {
    return { kind: "human-review", reason: "judge.insufficient", evidence };
  }
  const [first, second] = evidence;
  if (first === undefined || second === undefined) {
    return { kind: "human-review", reason: "judge.insufficient", evidence };
  }
  if (
    first.judgeId === second.judgeId ||
    first.independenceKey === second.independenceKey
  ) {
    return {
      kind: "human-review",
      reason: "judge.not_independent",
      evidence,
    };
  }
  if (
    evidence.some(
      (item) =>
        item.artifactDigest !== expected.artifactDigest ||
        item.criteriaDigest !== expected.criteriaDigest ||
        item.rubricVersion !== expected.rubricVersion,
    )
  ) {
    return {
      kind: "human-review",
      reason: "judge.stale_content",
      evidence,
    };
  }
  if (evidence.some((item) => item.timedOut || item.verdict === "unavailable")) {
    return { kind: "human-review", reason: "judge.unavailable", evidence };
  }
  if (first.verdict !== second.verdict) {
    return { kind: "human-review", reason: "judge.disagreement", evidence };
  }
  return {
    kind: "candidate",
    verdict: first.verdict as Exclude<JudgeVerdict, "unavailable">,
    artifactDigest: expected.artifactDigest,
    criteriaDigest: expected.criteriaDigest,
    evidence,
  };
}
