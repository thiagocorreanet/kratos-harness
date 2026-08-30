import type { CuratedMemoryV1, MemoryMigrationV1_2 } from "@kratos/contracts";

import { canonicalizeJson } from "../schema/index.js";

import {
  CURATED_MEMORY_RENDERED_MAX_BYTES,
  projectCuratedMemory,
} from "./index.js";

/** The only legacy document that is semantically equivalent to an empty ledger. */
export const STOCK_GOTCHAS_TEMPLATE =
  "# Gotchas\n\n## Confirmed lessons\n\nNo confirmed lessons.\n\n## Archived lessons\n\nNo archived lessons.\n";

const TEMPLATE_LINES = new Set(
  STOCK_GOTCHAS_TEMPLATE.split("\n").filter((line) => line.length !== 0),
);

export type LegacyMemoryClassification =
  "adopted" | "safely_adoptable" | "migration_required" | "corrupt";

/**
 * Classify only declared state shapes and exact template bytes.  In
 * particular, this deliberately does not infer lessons from Markdown.
 */
export function classifyLegacyMemory(input: {
  readonly ledger: "present" | "missing" | "other";
  readonly gotchas: string | null;
}): LegacyMemoryClassification {
  if (input.ledger === "present") return "adopted";
  if (input.ledger !== "missing" || input.gotchas === null) return "corrupt";
  return input.gotchas === STOCK_GOTCHAS_TEMPLATE
    ? "safely_adoptable"
    : "migration_required";
}

export type LegacyMemoryMigrationReduction =
  | { readonly kind: "ready"; readonly ledger: CuratedMemoryV1 }
  | { readonly kind: "invalid_mapping" };

/**
 * Build an empty-ledger replacement from a closed, line-addressed mapping.
 * No Markdown syntax is examined: only caller supplied ranges determine the
 * source material assigned to each lesson.
 */
export function reduceLegacyMemoryMigration(
  source: string,
  proposal: MemoryMigrationV1_2,
  now: string,
  sha256: (value: string) => string,
): LegacyMemoryMigrationReduction {
  if (proposal.sourceDigest !== sha256(source))
    return { kind: "invalid_mapping" };
  const lines = exactLines(source);
  const covered = new Uint8Array(lines.length);
  let previousEnd = 0;
  const confirmed: CuratedMemoryV1["confirmed"] = [];

  for (const lesson of proposal.lessons) {
    const ranges = lesson.sourceRanges;
    let sourceBytes = "";
    for (const range of ranges) {
      if (
        !Number.isSafeInteger(range.startLine) ||
        !Number.isSafeInteger(range.endLine) ||
        range.startLine < 1 ||
        range.endLine < range.startLine ||
        range.endLine > lines.length ||
        range.startLine <= previousEnd
      ) {
        return { kind: "invalid_mapping" };
      }
      previousEnd = range.endLine;
      for (let line = range.startLine - 1; line < range.endLine; line += 1) {
        if (covered[line] !== 0) return { kind: "invalid_mapping" };
        covered[line] = 1;
        sourceBytes += lines[line] ?? "";
      }
    }
    const candidateId = sha256(
      canonicalizeJson({
        sourceDigest: proposal.sourceDigest,
        sourceRanges: ranges,
        sourceBytes,
      }),
    );
    const why = sortedUnique(lesson.why);
    const apply = sortedUnique(lesson.apply);
    const candidateIds = [candidateId];
    confirmed.push({
      lessonId: sha256(
        canonicalizeJson({ title: lesson.title, why, apply, candidateIds }),
      ),
      title: lesson.title,
      why,
      apply,
      candidateIds,
      reviewer: proposal.reviewer,
      confirmedAt: now,
    });
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = withoutLineEnding(lines[index] ?? "");
    if (line.trim().length === 0 || TEMPLATE_LINES.has(line)) continue;
    if (covered[index] !== 1) return { kind: "invalid_mapping" };
  }
  const base: CuratedMemoryV1 = {
    contractVersion: "1.0.0",
    stateContract: "1.0.0",
    revision: 1,
    projectionDigest: "",
    updatedAt: now,
    confirmed: [...confirmed].sort((left, right) =>
      left.lessonId < right.lessonId
        ? -1
        : left.lessonId > right.lessonId
          ? 1
          : 0,
    ),
    archive: [],
  };
  const projection = projectCuratedMemory(base, sha256);
  if (
    new TextEncoder().encode(projection.content).byteLength >
    CURATED_MEMORY_RENDERED_MAX_BYTES
  )
    return { kind: "invalid_mapping" };
  return {
    kind: "ready",
    ledger: { ...base, projectionDigest: projection.projectionDigest },
  };
}

function exactLines(source: string): readonly string[] {
  if (source.length === 0) return [""];
  const lines: string[] = [];
  let start = 0;
  for (
    let index = source.indexOf("\n");
    index !== -1;
    index = source.indexOf("\n", start)
  ) {
    lines.push(source.slice(start, index + 1));
    start = index + 1;
  }
  if (start < source.length) lines.push(source.slice(start));
  return lines;
}

function withoutLineEnding(line: string): string {
  return line.endsWith("\n") ? line.slice(0, -1) : line;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}
