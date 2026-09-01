import type { CuratedMemoryV1_1 } from "@kratos/contracts";

import { canonicalizeJson } from "../schema/index.js";

type Lesson = CuratedMemoryV1_1["confirmed"][number];

export interface MemoryCurationPolicy {
  readonly policyVersion: "memory-curation/1.0.0";
  readonly similarityThreshold: number;
  readonly obsolescenceThreshold: number;
  readonly weights: {
    readonly text: 25;
    readonly fix: 45;
    readonly technology: 15;
    readonly failureKind: 15;
    readonly age: 50;
    readonly rarity: 20;
    readonly dependencyAbsent: 30;
  };
}

export const MEMORY_CURATION_POLICY: MemoryCurationPolicy = Object.freeze({
  policyVersion: "memory-curation/1.0.0",
  similarityThreshold: 7500,
  obsolescenceThreshold: 7000,
  weights: Object.freeze({
    text: 25,
    fix: 45,
    technology: 15,
    failureKind: 15,
    age: 50,
    rarity: 20,
    dependencyAbsent: 30,
  }),
});

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "by",
  "for",
  "from",
  "has",
  "have",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "when",
  "with",
]);

export interface SetComparison {
  readonly score: number;
  readonly intersection: readonly string[];
  readonly union: readonly string[];
}

export interface SimilarityScore {
  readonly score: number;
  readonly components: {
    readonly text: number;
    readonly fix: number;
    readonly technology: number;
    readonly failureKind: number;
  };
  readonly textEvidence: SetComparison;
  readonly fixEvidence: SetComparison;
}

export type ObsolescenceScore =
  | { readonly kind: "invalid_as_of" }
  | {
      readonly kind: "scored";
      readonly score: number;
      readonly ageDays: number;
      readonly components: {
        readonly age: number;
        readonly rarity: number;
        readonly dependencyAbsent: number;
      };
    };

export type MemoryCurationProposal =
  | {
      readonly proposalId: string;
      readonly type: "merge";
      readonly score: number;
      readonly lessonIds: readonly [string, string];
      readonly components: SimilarityScore["components"];
      readonly textEvidence: Pick<SetComparison, "intersection" | "union">;
      readonly fixEvidence: Pick<SetComparison, "intersection" | "union">;
    }
  | {
      readonly proposalId: string;
      readonly type: "archive" | "delete";
      readonly score: number;
      readonly lessonIds: readonly [string];
      readonly components: Extract<
        ObsolescenceScore,
        { readonly kind: "scored" }
      >["components"];
    };

export interface MemoryCurationPlan {
  readonly contractVersion: "1.4.0";
  readonly hostContract: "1.4.0";
  readonly kind: "plan";
  readonly policyVersion: "memory-curation/1.0.0";
  readonly asOf: string;
  readonly ledgerDigest: string;
  readonly proposals: readonly MemoryCurationProposal[];
  readonly planDigest: string;
}

export function tokenizeMemoryText(value: string): string[] {
  const normalized = value.normalize("NFKC").toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return sortedUnique(tokens.filter((token) => !STOPWORDS.has(token)));
}

export function jaccardScore(
  left: readonly string[],
  right: readonly string[],
): SetComparison {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = sortedUnique([...leftSet, ...rightSet]);
  const intersection = [...leftSet]
    .filter((token) => rightSet.has(token))
    .sort(compareText);
  return {
    score:
      union.length === 0
        ? 0
        : Math.floor((10000 * intersection.length) / union.length),
    intersection,
    union,
  };
}

export function scoreLessonSimilarity(
  left: Lesson,
  right: Lesson,
  policy: MemoryCurationPolicy = MEMORY_CURATION_POLICY,
): SimilarityScore {
  const textEvidence = jaccardScore(
    tokenizeMemoryText([left.title, ...left.why].join(" ")),
    tokenizeMemoryText([right.title, ...right.why].join(" ")),
  );
  const fixEvidence = jaccardScore(
    tokenizeMemoryText(left.apply.join(" ")),
    tokenizeMemoryText(right.apply.join(" ")),
  );
  const components = {
    text: textEvidence.score,
    fix: fixEvidence.score,
    technology: left.technology === right.technology ? 10000 : 0,
    failureKind: left.failureKind === right.failureKind ? 10000 : 0,
  } as const;
  const { weights } = policy;
  return {
    score: Math.floor(
      (weights.text * components.text +
        weights.fix * components.fix +
        weights.technology * components.technology +
        weights.failureKind * components.failureKind) /
        100,
    ),
    components,
    textEvidence,
    fixEvidence,
  };
}

export function scoreLessonObsolescence(
  lesson: Lesson,
  asOf: string,
  dependencyPresent: boolean,
  policy: MemoryCurationPolicy = MEMORY_CURATION_POLICY,
): ObsolescenceScore {
  const asOfTime = parseDate(asOf);
  const observedTime = Date.parse(lesson.lastObservedAt);
  if (asOfTime === null || !Number.isFinite(observedTime)) {
    return { kind: "invalid_as_of" };
  }
  const ageDays = Math.floor((asOfTime - observedTime) / 86_400_000);
  if (ageDays < 0) return { kind: "invalid_as_of" };
  const components = {
    age: Math.min(10000, Math.floor((10000 * ageDays) / 365)),
    rarity: Math.floor(10000 / lesson.observationCount),
    dependencyAbsent: dependencyPresent ? 0 : 10000,
  } as const;
  const { weights } = policy;
  return {
    kind: "scored",
    score: Math.floor(
      (weights.age * components.age +
        weights.rarity * components.rarity +
        weights.dependencyAbsent * components.dependencyAbsent) /
        100,
    ),
    ageDays,
    components,
  };
}

export function proposeMemoryCuration(input: {
  readonly ledger: CuratedMemoryV1_1;
  readonly asOf: string;
  readonly dependencyPresence: ReadonlyMap<string, boolean>;
  readonly digest: (value: string) => string;
  readonly policy?: MemoryCurationPolicy;
}): MemoryCurationPlan {
  const policy = input.policy ?? MEMORY_CURATION_POLICY;
  const lessons = [...input.ledger.confirmed].sort((left, right) =>
    compareText(left.lessonId, right.lessonId),
  );
  const proposals: MemoryCurationProposal[] = [];

  for (let leftIndex = 0; leftIndex < lessons.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < lessons.length;
      rightIndex += 1
    ) {
      const left = lessons[leftIndex];
      const right = lessons[rightIndex];
      if (left === undefined || right === undefined) continue;
      const scored = scoreLessonSimilarity(left, right, policy);
      if (scored.score < policy.similarityThreshold) continue;
      const lessonIds = [left.lessonId, right.lessonId] as const;
      const base = {
        type: "merge" as const,
        score: scored.score,
        lessonIds,
        components: scored.components,
        textEvidence: evidence(scored.textEvidence),
        fixEvidence: evidence(scored.fixEvidence),
      };
      proposals.push({
        proposalId: input.digest(
          canonicalizeJson({
            policyVersion: policy.policyVersion,
            asOf: input.asOf,
            ...base,
          }),
        ),
        ...base,
      });
    }
  }

  for (const current of lessons) {
    const dependencyPresent =
      current.dependency.kind === "none"
        ? true
        : (input.dependencyPresence.get(current.dependency.path) ?? false);
    const scored = scoreLessonObsolescence(
      current,
      input.asOf,
      dependencyPresent,
      policy,
    );
    if (scored.kind === "invalid_as_of") {
      throw new RangeError("The curation date precedes a lesson observation.");
    }
    if (scored.score < policy.obsolescenceThreshold) continue;
    const base = {
      type:
        current.observationCount === 1
          ? ("delete" as const)
          : ("archive" as const),
      score: scored.score,
      lessonIds: [current.lessonId] as const,
      components: scored.components,
    };
    proposals.push({
      proposalId: input.digest(
        canonicalizeJson({
          policyVersion: policy.policyVersion,
          asOf: input.asOf,
          ...base,
        }),
      ),
      ...base,
    });
  }

  proposals.sort(compareProposals);
  const withoutDigest = {
    contractVersion: "1.4.0" as const,
    hostContract: "1.4.0" as const,
    kind: "plan" as const,
    policyVersion: policy.policyVersion,
    asOf: input.asOf,
    ledgerDigest: input.digest(canonicalizeJson(input.ledger)),
    proposals,
  };
  return {
    ...withoutDigest,
    planDigest: input.digest(canonicalizeJson(withoutDigest)),
  };
}

function evidence(
  comparison: SetComparison,
): Pick<SetComparison, "intersection" | "union"> {
  return {
    intersection: comparison.intersection,
    union: comparison.union,
  };
}

function compareProposals(
  left: MemoryCurationProposal,
  right: MemoryCurationProposal,
): number {
  if (left.score !== right.score) return right.score - left.score;
  const rank = { merge: 0, archive: 1, delete: 2 } as const;
  const byType = rank[left.type] - rank[right.type];
  if (byType !== 0) return byType;
  const leftIds = left.lessonIds.join("\u0000");
  const rightIds = right.lessonIds.join("\u0000");
  return compareText(leftIds, rightIds);
}

function parseDate(value: string): number | null {
  if (!/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u.test(value)) {
    return null;
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : null;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
