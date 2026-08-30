/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/no-unnecessary-template-expression, @typescript-eslint/restrict-template-expressions */
import type { CuratedMemoryV1 } from "@kratos/contracts";
import { describe, expect, it } from "vitest";

import {
  projectCuratedMemory,
  reduceMemoryChange,
  renderCuratedMemory,
  validatesCuratedMemorySemantics,
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

  it("refuses promotion at the exact 24 active-lesson boundary", () => {
    const confirmed = Array.from({ length: 24 }, (_, index) => ({
      lessonId: `${String(index).padStart(64, "0")}`,
      title: `Lesson ${String(index)}`,
      why: ["cause"],
      apply: ["action"],
      candidateIds: ["a".repeat(64)],
      reviewer: "reviewer",
      confirmedAt: "2026-08-29T00:00:00Z",
    }));
    expect(
      reduceMemoryChange(
        { ...EMPTY, confirmed },
        {
          contractVersion: "1.2.0",
          hostContract: "1.2.0",
          operation: "promote",
          reviewer: "reviewer",
          candidateIds: ["b".repeat(64)],
          title: "Next",
          why: ["cause"],
          apply: ["action"],
        },
        "2026-08-29T00:00:00Z",
        (value) => value.padEnd(64, "0").slice(0, 64),
      ),
    ).toEqual({ kind: "curation_required" });
  });

  it("keeps exact merge unions and refuses schema-overflow unions", () => {
    const make = (id: string, count: number) => ({
      lessonId: id.repeat(64),
      title: id,
      why: Array.from(
        { length: count },
        (_, index) => `${id}-why-${String(index)}`,
      ),
      apply: Array.from(
        { length: count },
        (_, index) => `${id}-apply-${String(index)}`,
      ),
      candidateIds: Array.from(
        { length: count },
        (_, index) => `${String(index).padStart(64, "0")}`,
      ),
      reviewer: "reviewer",
      confirmedAt: "2026-08-29T00:00:00Z",
    });
    const proposal = {
      contractVersion: "1.2.0" as const,
      hostContract: "1.2.0" as const,
      operation: "merge" as const,
      reviewer: "reviewer",
      lessonIds: ["a".repeat(64), "b".repeat(64)],
      title: "Merged",
    };
    expect(
      reduceMemoryChange(
        { ...EMPTY, confirmed: [make("a", 4), make("b", 4)] },
        proposal,
        "2026-08-29T00:00:00Z",
        (value) => value.padEnd(64, "0").slice(0, 64),
      ).kind,
    ).toBe("ready");
    expect(
      reduceMemoryChange(
        { ...EMPTY, confirmed: [make("a", 5), make("b", 5)] },
        proposal,
        "2026-08-29T00:00:00Z",
        (value) => value.padEnd(64, "0").slice(0, 64),
      ),
    ).toEqual({ kind: "curation_required" });
  });

  it("uses deterministic UTF-8 ordering regardless of source order", () => {
    const proposal = {
      contractVersion: "1.2.0" as const,
      hostContract: "1.2.0" as const,
      operation: "promote" as const,
      reviewer: "reviewer",
      candidateIds: ["b".repeat(64), "a".repeat(64)],
      title: "é",
      why: ["e\u0301", "é"],
      apply: ["z", "a"],
    };
    const one = reduceMemoryChange(
      EMPTY,
      proposal,
      "2026-08-29T00:00:00Z",
      (value) => `x${value.length}`.padEnd(64, "0"),
    );
    const two = reduceMemoryChange(
      EMPTY,
      {
        ...proposal,
        candidateIds: [...proposal.candidateIds].reverse(),
        why: [...proposal.why].reverse(),
        apply: [...proposal.apply].reverse(),
      },
      "2026-08-29T00:00:00Z",
      (value) => `x${value.length}`.padEnd(64, "0"),
    );
    expect(one).toEqual(two);
  });

  it("rejects arbitrary, duplicate, and dangling persisted semantic identities", () => {
    const digest = (value: string) => `x${value.length}`.padEnd(64, "0");
    const ready = reduceMemoryChange(
      EMPTY,
      {
        contractVersion: "1.2.0",
        hostContract: "1.2.0",
        operation: "promote",
        reviewer: "reviewer",
        candidateIds: ["a".repeat(64)],
        title: "Title",
        why: ["cause"],
        apply: ["action"],
      },
      "2026-08-29T00:00:00Z",
      digest,
    );
    if (ready.kind !== "ready") throw new Error("expected ready");
    expect(validatesCuratedMemorySemantics(ready.ledger, digest)).toBe(true);
    expect(
      validatesCuratedMemorySemantics(
        {
          ...ready.ledger,
          confirmed: [
            { ...ready.ledger.confirmed[0]!, lessonId: "z".repeat(64) },
          ],
        },
        digest,
      ),
    ).toBe(false);
    expect(
      validatesCuratedMemorySemantics(
        {
          ...ready.ledger,
          confirmed: [...ready.ledger.confirmed, ready.ledger.confirmed[0]!],
        },
        digest,
      ),
    ).toBe(false);
    expect(
      validatesCuratedMemorySemantics(
        {
          ...ready.ledger,
          archive: [
            {
              lessonId: "b".repeat(64),
              title: "Old",
              candidateIds: ["a".repeat(64)],
              reviewer: "reviewer",
              archivedAt: "2026-08-29T00:00:00Z",
              reason: "old",
              replacementLessonId: "c".repeat(64),
            },
          ],
        },
        digest,
      ),
    ).toBe(false);
  });

  it("keeps the newest 48 archive tombstones in append order", () => {
    const archive = Array.from({ length: 48 }, (_, index) => ({
      lessonId: `${String(index).padStart(64, "0")}`,
      title: `Old ${String(index)}`,
      candidateIds: ["a".repeat(64)],
      reviewer: "reviewer",
      archivedAt: "2026-08-29T00:00:00Z",
      reason: "old",
      replacementLessonId: null,
    }));
    const lesson = {
      lessonId: "z".repeat(64),
      title: "Current",
      why: ["why"],
      apply: ["apply"],
      candidateIds: ["b".repeat(64)],
      reviewer: "reviewer",
      confirmedAt: "2026-08-29T00:00:00Z",
    };
    const outcome = reduceMemoryChange(
      { ...EMPTY, confirmed: [lesson], archive },
      {
        contractVersion: "1.2.0",
        hostContract: "1.2.0",
        operation: "archive",
        reviewer: "reviewer",
        lessonId: lesson.lessonId,
        reason: "obsolete",
      },
      "2026-08-29T00:00:00Z",
      (value) => `x${String(value.length)}`.padEnd(64, "0"),
    );
    if (outcome.kind !== "ready") throw new Error("expected ready");
    expect(outcome.ledger.archive).toHaveLength(48);
    expect(outcome.ledger.archive[0]?.lessonId).toBe(
      `${String(1).padStart(64, "0")}`,
    );
    expect(outcome.ledger.archive[47]?.lessonId).toBe("z".repeat(64));
  });

  it("accepts exactly 48KiB rendered UTF-8 and refuses one byte more", () => {
    const digest = (value: string) =>
      `x${String(value.length)}`.padEnd(64, "0");
    const proposal = {
      contractVersion: "1.2.0" as const,
      hostContract: "1.2.0" as const,
      operation: "promote" as const,
      reviewer: "reviewer",
      candidateIds: ["z".repeat(64)],
      title: "Boundary",
      why: ["why"],
      apply: ["apply"],
    };
    const ledgerFor = (extra: number): CuratedMemoryV1 => {
      let remaining = extra;
      const fields = Array.from({ length: 23 * 16 }, () => {
        const amount = Math.min(511, remaining);
        remaining -= amount;
        return `x${"x".repeat(amount)}`;
      });
      let cursor = 0;
      return {
        ...EMPTY,
        confirmed: Array.from({ length: 23 }, (_, index) => ({
          lessonId: `${String(index).padStart(64, "0")}`,
          title: `L${String(index)}`,
          why: Array.from({ length: 8 }, () => fields[cursor++] ?? "x"),
          apply: Array.from({ length: 8 }, () => fields[cursor++] ?? "x"),
          candidateIds: ["a".repeat(64)],
          reviewer: "reviewer",
          confirmedAt: "2026-08-29T00:00:00Z",
        })),
      };
    };
    const baseline = reduceMemoryChange(
      ledgerFor(0),
      proposal,
      "2026-08-29T00:00:00Z",
      digest,
    );
    if (baseline.kind !== "ready") throw new Error("expected baseline");
    const baseBytes = Buffer.byteLength(
      renderCuratedMemory(baseline.ledger),
      "utf8",
    );
    const accepted = reduceMemoryChange(
      ledgerFor(48 * 1024 - baseBytes),
      proposal,
      "2026-08-29T00:00:00Z",
      digest,
    );
    if (accepted.kind !== "ready") throw new Error("expected exact boundary");
    expect(
      Buffer.byteLength(renderCuratedMemory(accepted.ledger), "utf8"),
    ).toBe(48 * 1024);
    expect(
      reduceMemoryChange(
        ledgerFor(48 * 1024 - baseBytes + 1),
        proposal,
        "2026-08-29T00:00:00Z",
        digest,
      ),
    ).toEqual({ kind: "curation_required" });
  });

  it("keeps chained replacement links valid through merge and archive", () => {
    const digest = (value: string) => value;
    const promote = (
      ledger: CuratedMemoryV1,
      title: string,
      candidate: string,
    ) => {
      const outcome = reduceMemoryChange(
        ledger,
        {
          contractVersion: "1.2.0",
          hostContract: "1.2.0",
          operation: "promote",
          reviewer: "reviewer",
          candidateIds: [candidate.repeat(64)],
          title,
          why: [title],
          apply: [title],
        },
        "2026-08-29T00:00:00Z",
        digest,
      );
      if (outcome.kind !== "ready") throw new Error("expected promotion");
      return outcome.ledger;
    };
    const a = promote(EMPTY, "A", "a");
    const b = promote(a, "B", "b");
    const merge = (
      ledger: CuratedMemoryV1,
      lessonIds: string[],
      title: string,
    ) => {
      const outcome = reduceMemoryChange(
        ledger,
        {
          contractVersion: "1.2.0",
          hostContract: "1.2.0",
          operation: "merge",
          reviewer: "reviewer",
          lessonIds,
          title,
        },
        "2026-08-29T00:00:00Z",
        digest,
      );
      if (outcome.kind !== "ready") throw new Error("expected merge");
      return outcome.ledger;
    };
    const r = merge(
      b,
      b.confirmed.map(({ lessonId }) => lessonId),
      "R",
    );
    const s = promote(r, "S", "s");
    const t = merge(
      s,
      s.confirmed.map(({ lessonId }) => lessonId),
      "T",
    );
    expect(validatesCuratedMemorySemantics(t, digest)).toBe(true);
    const archived = reduceMemoryChange(
      t,
      {
        contractVersion: "1.2.0",
        hostContract: "1.2.0",
        operation: "archive",
        reviewer: "reviewer",
        lessonId: t.confirmed[0]!.lessonId,
        reason: "obsolete",
      },
      "2026-08-29T00:00:00Z",
      digest,
    );
    if (archived.kind !== "ready") throw new Error("expected archive");
    expect(validatesCuratedMemorySemantics(archived.ledger, digest)).toBe(true);
  });
});
