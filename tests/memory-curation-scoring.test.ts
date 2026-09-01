import { createHash } from "node:crypto";

import type { CuratedMemoryV1_1 } from "@kratos/contracts";
import {
  MEMORY_CURATION_POLICY,
  jaccardScore,
  proposeMemoryCuration,
  scoreLessonObsolescence,
  scoreLessonSimilarity,
  tokenizeMemoryText,
} from "@kratos/runtime/domain/memory";
import { describe, expect, it } from "vitest";

type Lesson = CuratedMemoryV1_1["confirmed"][number];

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

function lesson(marker: string, values: Partial<Lesson> = {}): Lesson {
  return {
    lessonId: marker.repeat(64),
    title: "lesson",
    why: ["cause"],
    apply: ["fix"],
    candidateIds: [marker.repeat(64)],
    reviewer: "reviewer",
    confirmedAt: "2025-01-01T00:00:00Z",
    technology: "node",
    failureKind: "nonzero_exit",
    dependency: { kind: "none" },
    observationCount: 1,
    firstObservedAt: "2025-01-01T00:00:00Z",
    lastObservedAt: "2025-01-01T00:00:00Z",
    ...values,
  };
}

function words(prefix: string, first: number, last: number): string {
  return Array.from(
    { length: last - first + 1 },
    (_, index) => `${prefix}${String(first + index)}`,
  ).join(" ");
}

describe("memory curation scoring policy", () => {
  it("tokenizes with the published normalization and stopword set", () => {
    expect(
      tokenizeMemoryText("The café CAFE\u0301 builds in Node.js and node-js."),
    ).toEqual(["builds", "café", "js", "node"]);
  });

  it("reports a hand-computable Jaccard set comparison", () => {
    expect(jaccardScore(["a", "b"], ["b", "c"])).toEqual({
      score: 3333,
      intersection: ["b"],
      union: ["a", "b", "c"],
    });
    expect(jaccardScore([], [])).toEqual({
      score: 0,
      intersection: [],
      union: [],
    });
  });

  it("places hand-computed pairs immediately above and below the threshold", () => {
    const commonFix = words("fix", 1, 10);
    const above = scoreLessonSimilarity(
      lesson("a", {
        title: `${words("common", 1, 4)} ${words("left", 1, 8)}`,
        why: ["the"],
        apply: [`${commonFix} fix11`],
      }),
      lesson("b", {
        title: `${words("common", 1, 4)} ${words("right", 1, 8)}`,
        why: ["the"],
        apply: [commonFix],
      }),
    );
    const below = scoreLessonSimilarity(
      lesson("a", {
        title: `${words("shared", 1, 3)} ${words("left", 1, 8)}`,
        why: ["the"],
        apply: [`${commonFix} fix11`],
      }),
      lesson("b", {
        title: `${words("shared", 1, 3)} ${words("right", 1, 9)}`,
        why: ["the"],
        apply: [commonFix],
      }),
    );

    expect(above).toMatchObject({
      score: 7590,
      components: {
        text: 2000,
        fix: 9090,
        technology: 10000,
        failureKind: 10000,
      },
    });
    expect(below).toMatchObject({
      score: 7465,
      components: {
        text: 1500,
        fix: 9090,
        technology: 10000,
        failureKind: 10000,
      },
    });
    expect(above.score).toBeGreaterThanOrEqual(
      MEMORY_CURATION_POLICY.similarityThreshold,
    );
    expect(below.score).toBeLessThan(
      MEMORY_CURATION_POLICY.similarityThreshold,
    );
  });

  it.each([
    ["present one-off", "2025-09-01T00:00:00Z", 1, true, 7000],
    ["absent one-off", "2026-04-08T00:00:00Z", 1, false, 7000],
    ["absent frequent", "2025-11-13T00:00:00Z", 100, false, 7020],
  ])(
    "scores the %s published age landmark",
    (_name, lastObservedAt, observationCount, dependencyPresent, expected) => {
      expect(
        scoreLessonObsolescence(
          lesson("a", { lastObservedAt, observationCount }),
          "2026-09-01",
          dependencyPresent,
        ),
      ).toMatchObject({ kind: "scored", score: expected });
    },
  );

  it("refuses an evaluation date before the last observation", () => {
    expect(
      scoreLessonObsolescence(
        lesson("a", { lastObservedAt: "2026-09-02T00:00:00Z" }),
        "2026-09-01",
        true,
      ),
    ).toEqual({ kind: "invalid_as_of" });
  });

  it("produces byte-stable ordered proposals and monotonic thresholds", () => {
    const duplicateA = lesson("a", {
      title: "generated input missing",
      why: ["build needs generated input"],
      apply: ["generate input before build"],
      observationCount: 3,
      lastObservedAt: "2026-08-01T00:00:00Z",
    });
    const duplicateB = lesson("b", {
      title: "missing generated input",
      why: ["generated input required by build"],
      apply: ["generate input before build"],
      observationCount: 2,
      lastObservedAt: "2026-08-02T00:00:00Z",
    });
    const stale = lesson("c", {
      title: "old dependency",
      why: ["old tool fails"],
      apply: ["remove old tool"],
      technology: "legacy-tool",
      dependency: { kind: "path", path: "legacy.config" },
      lastObservedAt: "2025-01-01T00:00:00Z",
    });
    const ledger: CuratedMemoryV1_1 = {
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      revision: 3,
      projectionDigest: "d".repeat(64),
      updatedAt: "2026-08-02T00:00:00Z",
      confirmed: [stale, duplicateB, duplicateA],
      archive: [],
    };
    const input = {
      ledger,
      asOf: "2026-09-01",
      dependencyPresence: new Map([["legacy.config", false]]),
      digest,
    };

    const first = proposeMemoryCuration(input);
    const second = proposeMemoryCuration(input);
    expect(second).toEqual(first);
    expect(first.proposals.map(({ type }) => type)).toEqual([
      "delete",
      "merge",
    ]);
    expect(first.planDigest).toMatch(/^[a-f0-9]{64}$/u);

    const raised = proposeMemoryCuration({
      ...input,
      policy: {
        ...MEMORY_CURATION_POLICY,
        similarityThreshold: 10000,
        obsolescenceThreshold: 10000,
      },
    });
    const lowered = proposeMemoryCuration({
      ...input,
      policy: {
        ...MEMORY_CURATION_POLICY,
        similarityThreshold: 0,
        obsolescenceThreshold: 0,
      },
    });
    const defaults = new Set(
      first.proposals.map(({ proposalId }) => proposalId),
    );
    expect(
      raised.proposals.every(({ proposalId }) => defaults.has(proposalId)),
    ).toBe(true);
    const broad = new Set(
      lowered.proposals.map(({ proposalId }) => proposalId),
    );
    expect([...defaults].every((proposalId) => broad.has(proposalId))).toBe(
      true,
    );
  });
});
