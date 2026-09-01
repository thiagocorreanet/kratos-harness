import { createHash } from "node:crypto";

import type { CuratedMemoryV1, MemoryMigrationV1_4 } from "@kratos/contracts";

import {
  classifyLegacyMemory,
  reduceLegacyMemoryMigration,
  upgradeCuratedMemoryV1,
} from "@kratos/runtime/domain/memory";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { describe, expect, it } from "vitest";

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const STOCK =
  "# Gotchas\n\n## Confirmed lessons\n\nNo confirmed lessons.\n\n## Archived lessons\n\nNo archived lessons.\n";
const LEGACY =
  "# Gotchas\n\n## Confirmed lessons\n\n- Run codegen before tests.\n";

const proposal = (source: string) => ({
  contractVersion: "1.2.0" as const,
  hostContract: "1.2.0" as const,
  sourceDigest: sha256(source),
  reviewer: "reviewer",
  lessons: [
    {
      title: "Run codegen before tests",
      why: ["Generated inputs are required."],
      apply: ["Run codegen before the test suite."],
      sourceRanges: [{ startLine: 5, endLine: 5 }],
    },
  ],
});

describe("lossless legacy memory migration", () => {
  it("upgrades every active v1 lesson with explicit metadata and derived lower bounds", () => {
    const source: CuratedMemoryV1 = {
      contractVersion: "1.0.0",
      stateContract: "1.0.0",
      revision: 2,
      projectionDigest: "0".repeat(64),
      updatedAt: "2026-01-01T00:00:00Z",
      confirmed: [
        {
          lessonId: "a".repeat(64),
          title: "Cache",
          why: ["Stale cache"],
          apply: ["Clear cache"],
          candidateIds: ["b".repeat(64), "c".repeat(64)],
          reviewer: "alice",
          confirmedAt: "2026-01-01T00:00:00Z",
        },
      ],
      archive: [
        {
          lessonId: "d".repeat(64),
          title: "Old",
          candidateIds: ["e".repeat(64)],
          reviewer: "alice",
          archivedAt: "2026-02-01T00:00:00Z",
          reason: "historical",
          replacementLessonId: null,
        },
      ],
    };
    const bytes = `${JSON.stringify(source, null, 2)}\n`;
    const proposal: MemoryMigrationV1_4 = {
      contractVersion: "1.4.0",
      hostContract: "1.4.0",
      sourceDigest: sha256(bytes),
      reviewer: "curator",
      lessons: [
        {
          lessonId: "a".repeat(64),
          technology: "typescript",
          failureKind: "nonzero_exit",
          dependency: { kind: "path", path: "tsconfig.json" },
        },
      ],
    };
    const outcome = upgradeCuratedMemoryV1(
      bytes,
      source,
      proposal,
      "2026-09-01T00:00:00Z",
      sha256,
    );
    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.ledger).toMatchObject({
      contractVersion: "1.1.0",
      stateContract: "1.1.0",
      revision: 3,
      confirmed: [
        {
          observationCount: 2,
          firstObservedAt: "2026-01-01T00:00:00Z",
          lastObservedAt: "2026-01-01T00:00:00Z",
          technology: "typescript",
        },
      ],
      archive: [{ reason: "historical", archivedAt: "2026-02-01T00:00:00Z" }],
    });
    expect(
      upgradeCuratedMemoryV1(
        bytes,
        source,
        { ...proposal, lessons: [] },
        "2026-09-01T00:00:00Z",
        sha256,
      ),
    ).toEqual({ kind: "invalid_mapping" });
  });
  it("classifies structured state, the exact stock template, and custom legacy bytes without parsing Markdown", () => {
    expect(classifyLegacyMemory({ ledger: "present", gotchas: STOCK })).toBe(
      "adopted",
    );
    expect(classifyLegacyMemory({ ledger: "missing", gotchas: STOCK })).toBe(
      "safely_adoptable",
    );
    expect(classifyLegacyMemory({ ledger: "missing", gotchas: LEGACY })).toBe(
      "migration_required",
    );
  });

  it("creates deterministic provenance from every explicitly covered legacy byte range", () => {
    const result = reduceLegacyMemoryMigration(
      LEGACY,
      proposal(LEGACY),
      "2026-08-29T12:00:00.000Z",
      sha256,
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(result.ledger.confirmed[0]?.candidateIds).toEqual([
      sha256(
        canonicalizeJson({
          sourceDigest: sha256(LEGACY),
          sourceRanges: [{ startLine: 5, endLine: 5 }],
          sourceBytes: "- Run codegen before tests.\n",
        }),
      ),
    ]);
  });

  it.each([
    [
      "overlapping ranges",
      [
        { startLine: 5, endLine: 5 },
        { startLine: 5, endLine: 5 },
      ],
    ],
    ["uncovered custom content", []],
  ])("refuses %s", (_name, sourceRanges) => {
    const mapping = proposal(LEGACY);
    const [firstLesson] = mapping.lessons;
    if (firstLesson === undefined) throw new Error("fixture has no lesson");
    const result = reduceLegacyMemoryMigration(
      LEGACY,
      { ...mapping, lessons: [{ ...firstLesson, sourceRanges }] },
      "2026-08-29T12:00:00.000Z",
      sha256,
    );
    expect(result.kind).toBe("invalid_mapping");
  });

  it("refuses a mapping when its declared source digest has changed", () => {
    const mapping = proposal(LEGACY);
    const result = reduceLegacyMemoryMigration(
      `${LEGACY}changed\n`,
      mapping,
      "2026-08-29T12:00:00.000Z",
      sha256,
    );
    expect(result.kind).toBe("invalid_mapping");
  });
});
