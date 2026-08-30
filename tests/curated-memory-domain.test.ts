import type { CuratedMemoryV1 } from "@kratos/contracts";
import { describe, expect, it } from "vitest";

import {
  projectCuratedMemory,
  reduceMemoryChange,
  renderCuratedMemory,
} from "@kratos/runtime/domain/memory";

const EMPTY: CuratedMemoryV1 = {
  contractVersion: "1.0.0",
  stateContract: "1.0.0",
  revision: 0,
  projectionDigest:
    "09b049b364f55134c3b4942b653a7b677f7775fb67de8321064e6237da852e83",
  updatedAt: "1970-01-01T00:00:00Z",
  confirmed: [],
  archive: [],
};

describe("curated memory domain", () => {
  it("renders the empty projection as the initialization golden bytes", () => {
    expect(renderCuratedMemory(EMPTY)).toBe(
      "# Gotchas\n\n## Confirmed lessons\n\nNo confirmed lessons.\n\n## Archived lessons\n\nNo archived lessons.\n",
    );
  });

  it("renders confirmed and archived records in stable identity order", () => {
    expect(
      renderCuratedMemory({
        ...EMPTY,
        confirmed: [
          {
            lessonId: "b".repeat(64),
            title: "Beta",
            why: ["second cause"],
            apply: ["second action"],
            candidateIds: ["c".repeat(64)],
            reviewer: "reviewer-b",
            confirmedAt: "2026-08-29T12:00:00Z",
          },
          {
            lessonId: "a".repeat(64),
            title: "Alpha",
            why: ["first cause"],
            apply: ["first action"],
            candidateIds: ["d".repeat(64)],
            reviewer: "reviewer-a",
            confirmedAt: "2026-08-29T11:00:00Z",
          },
        ],
        archive: [
          {
            lessonId: "f".repeat(64),
            title: "Forgotten",
            candidateIds: ["d".repeat(64)],
            reviewer: "reviewer-a",
            archivedAt: "2026-08-29T13:00:00Z",
            reason: "obsolete",
            replacementLessonId: null,
          },
        ],
      }),
    ).toBe(
      "# Gotchas\n\n## Confirmed lessons\n\n### Alpha\n\n- Lesson: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n- Why: first cause\n- Apply: first action\n- Candidates: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\n- Reviewed by: reviewer-a at 2026-08-29T11:00:00Z\n\n### Beta\n\n- Lesson: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n- Why: second cause\n- Apply: second action\n- Candidates: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\n- Reviewed by: reviewer-b at 2026-08-29T12:00:00Z\n\n## Archived lessons\n\n### Forgotten\n\n- Lesson: ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff\n- Candidates: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\n- Archived by: reviewer-a at 2026-08-29T13:00:00Z\n- Reason: obsolete\n- Replaced by: none\n",
    );
  });

  it("merges every source reason, application rule, and candidate provenance exactly once", () => {
    const outcome = reduceMemoryChange(
      {
        ...EMPTY,
        confirmed: [
          {
            lessonId: "a".repeat(64),
            title: "One",
            why: ["shared", "one"],
            apply: ["shared", "one"],
            candidateIds: ["c".repeat(64)],
            reviewer: "reviewer",
            confirmedAt: "2026-08-29T10:00:00Z",
          },
          {
            lessonId: "b".repeat(64),
            title: "Two",
            why: ["two", "shared"],
            apply: ["two", "shared"],
            candidateIds: ["c".repeat(64), "d".repeat(64)],
            reviewer: "reviewer",
            confirmedAt: "2026-08-29T11:00:00Z",
          },
        ],
      },
      {
        contractVersion: "1.2.0",
        hostContract: "1.2.0",
        operation: "merge",
        reviewer: "curator",
        lessonIds: ["b".repeat(64), "a".repeat(64)],
        title: "Combined",
      },
      "2026-08-29T14:00:00Z",
      (value) => `digest:${value}`,
    );

    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.ledger.confirmed[0]).toMatchObject({
      title: "Combined",
      why: ["one", "shared", "two"],
      apply: ["one", "shared", "two"],
      candidateIds: ["c".repeat(64), "d".repeat(64)],
    });
    expect(outcome.ledger.archive.map(({ lessonId }) => lessonId)).toEqual([
      "a".repeat(64),
      "b".repeat(64),
    ]);
    expect(
      outcome.ledger.archive.every(
        ({ replacementLessonId }) =>
          replacementLessonId?.startsWith("digest:") === true,
      ),
    ).toBe(true);
  });

  it("computes and validates the projection digest from rendered bytes", () => {
    const projected = projectCuratedMemory(EMPTY, (text) =>
      text === renderCuratedMemory(EMPTY) ? "digest" : "unexpected",
    );
    expect(projected.projectionDigest).toBe("digest");
  });
});
