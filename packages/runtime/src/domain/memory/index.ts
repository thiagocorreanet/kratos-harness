import type {
  CuratedMemoryV1,
  CuratedMemoryV1_1,
  FailureCandidateV1,
  FailureCandidateV1_1,
  MemoryChangeV1_2,
  MemoryChangeV1_4,
  MemoryCurationV1_4Contract,
} from "@kratos/contracts";

import type { MemoryCurationPlan, MemoryCurationProposal } from "./curation.js";

import { canonicalizeJson } from "../schema/index.js";

export {
  MEMORY_CURATION_POLICY,
  jaccardScore,
  proposeMemoryCuration,
  scoreLessonObsolescence,
  scoreLessonSimilarity,
  tokenizeMemoryText,
  type MemoryCurationPlan,
  type MemoryCurationPolicy,
  type MemoryCurationProposal,
  type ObsolescenceScore,
  type SetComparison,
  type SimilarityScore,
} from "./curation.js";

export {
  classifyLegacyMemory,
  reduceLegacyMemoryMigration,
  STOCK_GOTCHAS_TEMPLATE,
  type LegacyMemoryClassification,
  type LegacyMemoryMigrationReduction,
} from "./migration.js";

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

/** Semantic checks schemas cannot express (derived identities and cross-links). */
export function validatesCuratedMemorySemantics(
  ledger: CuratedMemoryV1,
  sha256: (value: string) => string,
): boolean {
  const active = new Set<string>();
  for (const lesson of ledger.confirmed) {
    const expected = sha256(
      canonicalizeJson({
        title: lesson.title,
        why: sortedUnique(lesson.why),
        apply: sortedUnique(lesson.apply),
        candidateIds: sortedUnique(lesson.candidateIds),
      }),
    );
    if (lesson.lessonId !== expected || active.has(lesson.lessonId))
      return false;
    active.add(lesson.lessonId);
  }
  const archived = new Set<string>();
  for (const tombstone of ledger.archive) {
    if (active.has(tombstone.lessonId) || archived.has(tombstone.lessonId))
      return false;
    archived.add(tombstone.lessonId);
  }
  const identities = new Set([...active, ...archived]);
  for (const tombstone of ledger.archive) {
    if (
      tombstone.replacementLessonId !== null &&
      !identities.has(tombstone.replacementLessonId)
    )
      return false;
  }
  return true;
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
  if (why.length > 8 || apply.length > 8 || candidateIds.length > 256) {
    return { kind: "curation_required" };
  }
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
    !validatesCuratedMemorySemantics(
      { ...provisional, projectionDigest: projection.projectionDigest },
      sha256,
    ) ||
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
  return [...new Set(values)].sort(compareText);
}

function byLessonId(
  left: { readonly lessonId: string },
  right: { readonly lessonId: string },
): number {
  return compareText(left.lessonId, right.lessonId);
}

function compareText(left: string, right: string): number {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return a.length - b.length;
}

type CurrentCandidate = FailureCandidateV1 | FailureCandidateV1_1;
type CurrentLesson = CuratedMemoryV1_1["confirmed"][number];
type CurrentTombstone = CuratedMemoryV1_1["archive"][number];

export type MemoryChangeV1_4Reduction =
  | {
      readonly kind: "ready";
      readonly ledger: CuratedMemoryV1_1;
      readonly consumedCandidateIds: readonly string[];
    }
  | {
      readonly kind:
        | "lesson_incomplete"
        | "candidate_missing"
        | "curation_required"
        | "provenance_mismatch";
    };

export function reduceMemoryChangeV1_4(
  ledger: CuratedMemoryV1_1,
  candidates: readonly CurrentCandidate[],
  proposal: MemoryChangeV1_4,
  now: string,
  sha256: (value: string) => string,
): MemoryChangeV1_4Reduction {
  if (proposal.reviewer.trim().length === 0)
    return { kind: "lesson_incomplete" };
  if (proposal.operation === "promote") {
    const selected = selectCandidates(candidates, proposal.candidateIds);
    if (selected === null) return { kind: "candidate_missing" };
    if (!nonempty(proposal.why) || !nonempty(proposal.apply))
      return { kind: "lesson_incomplete" };
    const facts = observationFacts(selected);
    const lesson: CurrentLesson = {
      ...lessonFor(
        proposal.title,
        sortedUnique(proposal.why),
        sortedUnique(proposal.apply),
        sortedUnique(proposal.candidateIds),
        proposal.reviewer,
        now,
        sha256,
      ),
      technology: proposal.technology,
      failureKind: proposal.failureKind,
      dependency: proposal.dependency,
      ...facts,
    };
    return completeCurrent(
      ledger,
      [...ledger.confirmed, lesson],
      ledger.archive,
      proposal.candidateIds,
      now,
      sha256,
    );
  }
  if (proposal.operation === "reinforce") {
    const lesson = ledger.confirmed.find(
      ({ lessonId }) => lessonId === proposal.lessonId,
    );
    const selected = selectCandidates(candidates, proposal.candidateIds);
    if (lesson === undefined || selected === null)
      return { kind: "candidate_missing" };
    if (proposal.candidateIds.some((id) => !lesson.candidateIds.includes(id)))
      return { kind: "provenance_mismatch" };
    const facts = observationFacts(selected);
    const reinforced: CurrentLesson = {
      ...lesson,
      reviewer: proposal.reviewer,
      observationCount: lesson.observationCount + facts.observationCount,
      firstObservedAt: minText(lesson.firstObservedAt, facts.firstObservedAt),
      lastObservedAt: maxText(lesson.lastObservedAt, facts.lastObservedAt),
    };
    return completeCurrent(
      ledger,
      ledger.confirmed.map((value) =>
        value.lessonId === lesson.lessonId ? reinforced : value,
      ),
      ledger.archive,
      proposal.candidateIds,
      now,
      sha256,
    );
  }
  if (proposal.operation === "merge") {
    const source = lessonsByIds(ledger, proposal.lessonIds);
    if (source === null) return { kind: "candidate_missing" };
    return mergeCurrent(
      ledger,
      source,
      proposal.reviewer,
      now,
      sha256,
      proposal.title,
      null,
    );
  }
  const lesson = ledger.confirmed.find(
    ({ lessonId }) => lessonId === proposal.lessonId,
  );
  if (lesson === undefined) return { kind: "candidate_missing" };
  const tombstone = currentTombstone(
    lesson,
    proposal.reviewer,
    now,
    proposal.reason,
    null,
    null,
  );
  return completeCurrent(
    ledger,
    ledger.confirmed.filter(({ lessonId }) => lessonId !== lesson.lessonId),
    [...ledger.archive, tombstone],
    [],
    now,
    sha256,
  );
}

export type MemoryCurationReduction =
  | {
      readonly kind: "ready";
      readonly ledger: CuratedMemoryV1_1;
      readonly approvedProposalIds: readonly string[];
    }
  | {
      readonly kind:
        | "approval_stale"
        | "approval_incomplete"
        | "approval_duplicate"
        | "approval_unknown"
        | "approval_overlap"
        | "candidate_missing"
        | "curation_required";
    };

export function applyMemoryCuration(
  ledger: CuratedMemoryV1_1,
  plan: MemoryCurationPlan,
  approval: MemoryCurationV1_4Contract.Approval,
  now: string,
  sha256: (value: string) => string,
): MemoryCurationReduction {
  if (approval.planDigest !== plan.planDigest)
    return { kind: "approval_stale" };
  const proposalIds = new Set(
    plan.proposals.map(({ proposalId }) => proposalId),
  );
  const decisions = new Map<string, "approve" | "reject">();
  for (const decision of approval.decisions) {
    if (decisions.has(decision.proposalId))
      return { kind: "approval_duplicate" };
    if (!proposalIds.has(decision.proposalId))
      return { kind: "approval_unknown" };
    decisions.set(decision.proposalId, decision.decision);
  }
  if (decisions.size !== plan.proposals.length)
    return { kind: "approval_incomplete" };
  const approved = plan.proposals.filter(
    ({ proposalId }) => decisions.get(proposalId) === "approve",
  );
  const occupied = new Set<string>();
  for (const proposal of approved) {
    for (const lessonId of proposal.lessonIds) {
      if (occupied.has(lessonId)) return { kind: "approval_overlap" };
      occupied.add(lessonId);
    }
  }
  let confirmed = [...ledger.confirmed];
  let archive = [...ledger.archive];
  for (const proposal of approved) {
    const source = lessonsByIds({ ...ledger, confirmed }, proposal.lessonIds);
    if (source === null) return { kind: "candidate_missing" };
    if (proposal.type === "merge") {
      const reduced = mergeCurrent(
        { ...ledger, confirmed, archive },
        source,
        approval.reviewer,
        now,
        sha256,
        null,
        proposal,
      );
      if (reduced.kind !== "ready") return reduced;
      confirmed = [...reduced.ledger.confirmed];
      archive = [...reduced.ledger.archive];
      continue;
    }
    const lesson = source[0];
    if (lesson === undefined) return { kind: "candidate_missing" };
    confirmed = confirmed.filter(
      ({ lessonId }) => lessonId !== lesson.lessonId,
    );
    if (proposal.type === "archive") {
      archive.push(
        currentTombstone(
          lesson,
          approval.reviewer,
          now,
          `Obsolete under ${plan.policyVersion}.`,
          null,
          proposal,
        ),
      );
    }
  }
  const completed = completeCurrent(
    ledger,
    confirmed,
    archive,
    [],
    now,
    sha256,
  );
  return completed.kind === "ready"
    ? {
        kind: "ready",
        ledger: completed.ledger,
        approvedProposalIds: approved.map(({ proposalId }) => proposalId),
      }
    : completed;
}

function mergeCurrent(
  ledger: CuratedMemoryV1_1,
  source: readonly CurrentLesson[],
  reviewer: string,
  now: string,
  sha256: (value: string) => string,
  explicitTitle: string | null,
  evidenceProposal: Extract<
    MemoryCurationProposal,
    { readonly type: "merge" }
  > | null,
): MemoryChangeV1_4Reduction {
  const canonical = [...source].sort((left, right) =>
    right.observationCount !== left.observationCount
      ? right.observationCount - left.observationCount
      : byLessonId(left, right),
  )[0];
  if (canonical === undefined) return { kind: "candidate_missing" };
  const why = sortedUnique(source.flatMap((lesson) => lesson.why));
  const apply = sortedUnique(source.flatMap((lesson) => lesson.apply));
  const candidateIds = sortedUnique(
    source.flatMap((lesson) => lesson.candidateIds),
  );
  if (why.length > 8 || apply.length > 8 || candidateIds.length > 256)
    return { kind: "curation_required" };
  const title = explicitTitle ?? canonical.title;
  const replacement: CurrentLesson = {
    ...lessonFor(title, why, apply, candidateIds, reviewer, now, sha256),
    technology: canonical.technology,
    failureKind: canonical.failureKind,
    dependency: canonical.dependency,
    observationCount: source.reduce(
      (sum, lesson) => sum + lesson.observationCount,
      0,
    ),
    firstObservedAt: source
      .map(({ firstObservedAt }) => firstObservedAt)
      .reduce(minText),
    lastObservedAt: source
      .map(({ lastObservedAt }) => lastObservedAt)
      .reduce(maxText),
  };
  const sourceIds = new Set(source.map(({ lessonId }) => lessonId));
  const tombstones = source.map((lesson) =>
    currentTombstone(
      lesson,
      reviewer,
      now,
      "Merged into replacement lesson.",
      replacement.lessonId,
      evidenceProposal === null ? null : null,
    ),
  );
  return completeCurrent(
    ledger,
    [
      ...ledger.confirmed.filter(({ lessonId }) => !sourceIds.has(lessonId)),
      replacement,
    ],
    [...ledger.archive, ...tombstones],
    [],
    now,
    sha256,
  );
}

function completeCurrent(
  prior: CuratedMemoryV1_1,
  confirmed: readonly CurrentLesson[],
  archive: readonly CurrentTombstone[],
  consumedCandidateIds: readonly string[],
  now: string,
  sha256: (value: string) => string,
): MemoryChangeV1_4Reduction {
  if (confirmed.length > CURATED_MEMORY_CONFIRMED_MAX)
    return { kind: "curation_required" };
  const provisional: CuratedMemoryV1_1 = {
    ...prior,
    revision: prior.revision + 1,
    updatedAt: now,
    confirmed: [...confirmed].sort(byLessonId),
    archive: [...archive].slice(-CURATED_MEMORY_ARCHIVE_MAX),
  };
  const projection = projectCuratedMemory(
    provisional as unknown as CuratedMemoryV1,
    sha256,
  );
  return {
    kind: "ready",
    ledger: { ...provisional, projectionDigest: projection.projectionDigest },
    consumedCandidateIds: sortedUnique(consumedCandidateIds),
  };
}

function lessonsByIds(
  ledger: Pick<CuratedMemoryV1_1, "confirmed">,
  ids: readonly string[],
): CurrentLesson[] | null {
  const wanted = new Set(ids);
  const source = ledger.confirmed.filter(({ lessonId }) =>
    wanted.has(lessonId),
  );
  return wanted.size === ids.length && source.length === wanted.size
    ? source
    : null;
}

function selectCandidates(
  candidates: readonly CurrentCandidate[],
  ids: readonly string[],
): CurrentCandidate[] | null {
  const wanted = new Set(ids);
  const selected = candidates.filter(({ candidateId }) =>
    wanted.has(candidateId),
  );
  return wanted.size === ids.length && selected.length === wanted.size
    ? selected
    : null;
}

function observationFacts(candidates: readonly CurrentCandidate[]): {
  readonly observationCount: number;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
} {
  return {
    observationCount: candidates.reduce(
      (sum, candidate) =>
        sum +
        (candidate.contractVersion === "1.1.0"
          ? candidate.observationCount
          : 1),
      0,
    ),
    firstObservedAt: candidates
      .map(({ firstObservedAt }) => firstObservedAt)
      .reduce(minText),
    lastObservedAt: candidates
      .map((candidate) =>
        candidate.contractVersion === "1.1.0"
          ? candidate.lastObservedAt
          : candidate.firstObservedAt,
      )
      .reduce(maxText),
  };
}

function currentTombstone(
  lesson: CurrentLesson,
  reviewer: string,
  archivedAt: string,
  reason: string,
  replacementLessonId: string | null,
  evidenceProposal: Extract<
    MemoryCurationProposal,
    { readonly type: "archive" | "delete" }
  > | null,
): Extract<CurrentTombstone, { readonly curationEvidence: unknown }> {
  return {
    lessonId: lesson.lessonId,
    title: lesson.title,
    candidateIds: [...lesson.candidateIds],
    reviewer,
    archivedAt,
    reason,
    replacementLessonId,
    technology: lesson.technology,
    failureKind: lesson.failureKind,
    dependency: lesson.dependency,
    observationCount: lesson.observationCount,
    firstObservedAt: lesson.firstObservedAt,
    lastObservedAt: lesson.lastObservedAt,
    curationEvidence:
      evidenceProposal === null
        ? null
        : {
            policyVersion: "memory-curation/1.0.0",
            proposalId: evidenceProposal.proposalId,
            score: evidenceProposal.score,
            components: evidenceProposal.components,
          },
  };
}

function minText(left: string, right: string): string {
  return left < right ? left : right;
}

function maxText(left: string, right: string): string {
  return left > right ? left : right;
}
