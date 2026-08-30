import type { CuratedMemoryV1, MemoryChangeV1_2 } from "@kratos/contracts";

import { canonicalizeJson } from "../schema/index.js";

export const CURATED_MEMORY_RENDERED_MAX_BYTES = 48 * 1024;
export const CURATED_MEMORY_CONFIRMED_MAX = 24;
export const CURATED_MEMORY_ARCHIVE_MAX = 48;

type Lesson = CuratedMemoryV1["confirmed"][number];
type Tombstone = CuratedMemoryV1["archive"][number];

export interface CuratedMemoryProjection {
  readonly content: string;
  readonly projectionDigest: string;
}

export type CuratedMemoryValidation =
  { readonly kind: "valid" } | { readonly kind: "projection_drift" };

export type MemoryChangeReduction =
  | {
      readonly kind: "ready";
      readonly ledger: CuratedMemoryV1;
      readonly consumedCandidateIds: readonly string[];
    }
  | {
      readonly kind:
        "lesson_incomplete" | "candidate_missing" | "curation_required";
    };

/** Render the human projection without embedding its self-referential digest. */
export function renderCuratedMemory(ledger: CuratedMemoryV1): string {
  const lines = ["# Gotchas", "", "## Confirmed lessons", ""];
  const confirmed = [...ledger.confirmed].sort(byLessonId);
  if (confirmed.length === 0) lines.push("No confirmed lessons.");
  else {
    for (const [index, lesson] of confirmed.entries()) {
      if (index !== 0) lines.push("");
      renderLesson(lines, lesson);
    }
  }
  lines.push("", "## Archived lessons", "");
  const archive = [...ledger.archive].sort(byLessonId);
  if (archive.length === 0) lines.push("No archived lessons.");
  else {
    for (const [index, tombstone] of archive.entries()) {
      if (index !== 0) lines.push("");
      renderTombstone(lines, tombstone);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function projectCuratedMemory(
  ledger: CuratedMemoryV1,
  sha256: (value: string) => string,
): CuratedMemoryProjection {
  const content = renderCuratedMemory(ledger);
  return { content, projectionDigest: sha256(content) };
}

export function validateCuratedMemoryProjection(
  ledger: CuratedMemoryV1,
  projection: string,
  sha256: (value: string) => string,
): CuratedMemoryValidation {
  const expected = projectCuratedMemory(ledger, sha256);
  return projection === expected.content &&
    ledger.projectionDigest === expected.projectionDigest
    ? { kind: "valid" }
    : { kind: "projection_drift" };
}

/**
 * Reduce a closed curation proposal into its next authoritative ledger.
 * Candidate availability is observed by composition; this reducer retains no
 * filesystem capability and therefore cannot promote automatically.
 */
export function reduceMemoryChange(
  ledger: CuratedMemoryV1,
  proposal: MemoryChangeV1_2,
  now: string,
  sha256: (value: string) => string,
): MemoryChangeReduction {
  switch (proposal.operation) {
    case "promote":
      return promote(ledger, proposal, now, sha256);
    case "merge":
      return merge(ledger, proposal, now, sha256);
    case "archive":
      return archive(ledger, proposal, now, sha256);
  }
}

function promote(
  ledger: CuratedMemoryV1,
  proposal: Extract<MemoryChangeV1_2, { readonly operation: "promote" }>,
  now: string,
  sha256: (value: string) => string,
): MemoryChangeReduction {
  if (
    proposal.title.trim().length === 0 ||
    proposal.reviewer.trim().length === 0 ||
    !nonempty(proposal.why) ||
    !nonempty(proposal.apply) ||
    !nonempty(proposal.candidateIds)
  ) {
    return { kind: "lesson_incomplete" };
  }
  const candidateIds = sortedUnique(proposal.candidateIds);
  const lesson = lessonFor(
    proposal.title,
    sortedUnique(proposal.why),
    sortedUnique(proposal.apply),
    candidateIds,
    proposal.reviewer,
    now,
    sha256,
  );
  return complete(
    ledger,
    { confirmed: [...ledger.confirmed, lesson], archive: ledger.archive },
    candidateIds,
    now,
    sha256,
  );
}

function merge(
  ledger: CuratedMemoryV1,
  proposal: Extract<MemoryChangeV1_2, { readonly operation: "merge" }>,
  now: string,
  sha256: (value: string) => string,
): MemoryChangeReduction {
  if (
    proposal.title.trim().length === 0 ||
    proposal.reviewer.trim().length === 0
  ) {
    return { kind: "lesson_incomplete" };
  }
  const wanted = new Set(proposal.lessonIds);
  const source = ledger.confirmed.filter(({ lessonId }) =>
    wanted.has(lessonId),
  );
  if (wanted.size < 2 || source.length !== wanted.size)
    return { kind: "candidate_missing" };
  const why = sortedUnique(source.flatMap((lesson) => lesson.why));
  const apply = sortedUnique(source.flatMap((lesson) => lesson.apply));
  const candidateIds = sortedUnique(
    source.flatMap((lesson) => lesson.candidateIds),
  );
  const replacement = lessonFor(
    proposal.title,
    why,
    apply,
    candidateIds,
    proposal.reviewer,
    now,
    sha256,
  );
  const tombstones = source
    .sort(byLessonId)
    .map((lesson) =>
      tombstoneFor(
        lesson,
        proposal.reviewer,
        now,
        "Merged into replacement lesson.",
        replacement.lessonId,
      ),
    );
  return complete(
    ledger,
    {
      confirmed: [
        ...ledger.confirmed.filter(({ lessonId }) => !wanted.has(lessonId)),
        replacement,
      ],
      archive: [...ledger.archive, ...tombstones].slice(
        -CURATED_MEMORY_ARCHIVE_MAX,
      ),
    },
    [],
    now,
    sha256,
  );
}

function archive(
  ledger: CuratedMemoryV1,
  proposal: Extract<MemoryChangeV1_2, { readonly operation: "archive" }>,
  now: string,
  sha256: (value: string) => string,
): MemoryChangeReduction {
  if (
    proposal.reviewer.trim().length === 0 ||
    proposal.reason.trim().length === 0
  ) {
    return { kind: "lesson_incomplete" };
  }
  const lesson = ledger.confirmed.find(
    ({ lessonId }) => lessonId === proposal.lessonId,
  );
  if (lesson === undefined) return { kind: "candidate_missing" };
  return complete(
    ledger,
    {
      confirmed: ledger.confirmed.filter(
        ({ lessonId }) => lessonId !== lesson.lessonId,
      ),
      archive: [
        ...ledger.archive,
        tombstoneFor(lesson, proposal.reviewer, now, proposal.reason, null),
      ].slice(-CURATED_MEMORY_ARCHIVE_MAX),
    },
    [],
    now,
    sha256,
  );
}

function complete(
  prior: CuratedMemoryV1,
  next: Pick<CuratedMemoryV1, "confirmed" | "archive">,
  consumedCandidateIds: readonly string[],
  updatedAt: string,
  sha256: (value: string) => string,
): MemoryChangeReduction {
  if (next.confirmed.length > CURATED_MEMORY_CONFIRMED_MAX) {
    return { kind: "curation_required" };
  }
  const provisional: CuratedMemoryV1 = {
    ...prior,
    revision: prior.revision + 1,
    updatedAt,
    confirmed: [...next.confirmed].sort(byLessonId),
    archive: [...next.archive],
  };
  const projection = projectCuratedMemory(provisional, sha256);
  if (
    new TextEncoder().encode(projection.content).byteLength >
    CURATED_MEMORY_RENDERED_MAX_BYTES
  ) {
    return { kind: "curation_required" };
  }
  return {
    kind: "ready",
    ledger: { ...provisional, projectionDigest: projection.projectionDigest },
    consumedCandidateIds: [...consumedCandidateIds],
  };
}

function lessonFor(
  title: string,
  why: readonly string[],
  apply: readonly string[],
  candidateIds: readonly string[],
  reviewer: string,
  confirmedAt: string,
  sha256: (value: string) => string,
): Lesson {
  const lessonId = sha256(
    canonicalizeJson({ title, why, apply, candidateIds }),
  );
  return {
    lessonId,
    title,
    why: [...why],
    apply: [...apply],
    candidateIds: [...candidateIds],
    reviewer,
    confirmedAt,
  };
}

function tombstoneFor(
  lesson: Lesson,
  reviewer: string,
  archivedAt: string,
  reason: string,
  replacementLessonId: string | null,
): Tombstone {
  return {
    lessonId: lesson.lessonId,
    title: lesson.title,
    candidateIds: [...lesson.candidateIds],
    reviewer,
    archivedAt,
    reason,
    replacementLessonId,
  };
}

function renderLesson(lines: string[], lesson: Lesson): void {
  lines.push(`### ${lesson.title}`, "", `- Lesson: ${lesson.lessonId}`);
  for (const why of lesson.why) lines.push(`- Why: ${why}`);
  for (const apply of lesson.apply) lines.push(`- Apply: ${apply}`);
  lines.push(`- Candidates: ${[...lesson.candidateIds].sort().join(", ")}`);
  lines.push(`- Reviewed by: ${lesson.reviewer} at ${lesson.confirmedAt}`);
}

function renderTombstone(lines: string[], tombstone: Tombstone): void {
  lines.push(`### ${tombstone.title}`, "", `- Lesson: ${tombstone.lessonId}`);
  lines.push(`- Candidates: ${[...tombstone.candidateIds].sort().join(", ")}`);
  lines.push(`- Archived by: ${tombstone.reviewer} at ${tombstone.archivedAt}`);
  lines.push(`- Reason: ${tombstone.reason}`);
  lines.push(`- Replaced by: ${tombstone.replacementLessonId ?? "none"}`);
}

function nonempty(values: readonly string[]): boolean {
  return (
    values.length !== 0 && values.every((value) => value.trim().length !== 0)
  );
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
}

function byLessonId(
  left: { readonly lessonId: string },
  right: { readonly lessonId: string },
): number {
  return left.lessonId.localeCompare(right.lessonId, "en-US");
}
