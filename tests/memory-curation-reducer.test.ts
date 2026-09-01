import { createHash } from "node:crypto";

import type {
  CuratedMemoryV1_1,
  FailureCandidateV1_1,
  MemoryChangeV1_4,
  MemoryCurationV1_4,
} from "@kratos/contracts";
import { describe, expect, it } from "vitest";

import {
  applyMemoryCuration,
  reduceMemoryChangeV1_4,
  type MemoryCurationPlan,
} from "@kratos/runtime/domain/memory";

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const candidateId = "c".repeat(64);

function ledger(): CuratedMemoryV1_1 {
  return {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    revision: 1,
    projectionDigest: "0".repeat(64),
    updatedAt: "2026-01-01T00:00:00Z",
    confirmed: [
      {
        lessonId: "a".repeat(64),
        title: "Keep the exact fix",
        why: ["The compiler cache can be stale"],
        apply: ["Remove the compiler cache"],
        candidateIds: [candidateId],
        reviewer: "alice",
        confirmedAt: "2026-01-01T00:00:00Z",
        technology: "typescript",
        failureKind: "nonzero_exit",
        dependency: { kind: "path", path: "tsconfig.json" },
        observationCount: 3,
        firstObservedAt: "2025-01-01T00:00:00Z",
        lastObservedAt: "2025-06-01T00:00:00Z",
      },
      {
        lessonId: "b".repeat(64),
        title: "Clear stale cache",
        why: ["Cached compiler state causes failures"],
        apply: ["Remove the compiler cache"],
        candidateIds: ["d".repeat(64)],
        reviewer: "bob",
        confirmedAt: "2026-01-02T00:00:00Z",
        technology: "typescript",
        failureKind: "nonzero_exit",
        dependency: { kind: "path", path: "tsconfig.json" },
        observationCount: 5,
        firstObservedAt: "2024-01-01T00:00:00Z",
        lastObservedAt: "2025-07-01T00:00:00Z",
      },
    ],
    archive: [],
  };
}

function candidate(count = 2): FailureCandidateV1_1 {
  return {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    candidateId,
    toolFamily: "shell",
    failureClass: "nonzero_exit",
    exitCode: 1,
    diagnostic: "cache failed",
    observationCount: count,
    firstObservedAt: "2024-12-01T00:00:00Z",
    lastObservedAt: "2026-08-01T00:00:00Z",
  };
}

describe("memory curation reductions", () => {
  it("promotes structured metadata and sums candidate observation facts", () => {
    const empty = ledger();
    empty.confirmed = [];
    const second = {
      ...candidate(4),
      candidateId: "d".repeat(64),
      firstObservedAt: "2024-01-01T00:00:00Z",
      lastObservedAt: "2026-08-15T00:00:00Z",
    };
    const outcome = reduceMemoryChangeV1_4(
      empty,
      [candidate(2), second],
      {
        contractVersion: "1.4.0",
        hostContract: "1.4.0",
        operation: "promote",
        reviewer: "curator",
        candidateIds: [candidateId, second.candidateId],
        title: "Clear compiler cache",
        why: ["Compiler state can be stale"],
        apply: ["Clear compiler cache"],
        technology: "typescript",
        failureKind: "nonzero_exit",
        dependency: { kind: "path", path: "tsconfig.json" },
      },
      "2026-09-01T00:00:00Z",
      digest,
    );
    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.ledger.confirmed[0]).toMatchObject({
      technology: "typescript",
      failureKind: "nonzero_exit",
      dependency: { kind: "path", path: "tsconfig.json" },
      observationCount: 6,
      firstObservedAt: "2024-01-01T00:00:00Z",
      lastObservedAt: "2026-08-15T00:00:00Z",
    });
  });

  it("reinforces only same-provenance observations and preserves lesson identity", () => {
    const proposal: MemoryChangeV1_4 = {
      contractVersion: "1.4.0",
      hostContract: "1.4.0",
      operation: "reinforce",
      reviewer: "curator",
      lessonId: "a".repeat(64),
      candidateIds: [candidateId],
    };
    const outcome = reduceMemoryChangeV1_4(
      ledger(),
      [candidate()],
      proposal,
      "2026-09-01T00:00:00Z",
      digest,
    );
    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.ledger.confirmed[0]).toMatchObject({
      lessonId: "a".repeat(64),
      title: "Keep the exact fix",
      observationCount: 5,
      firstObservedAt: "2024-12-01T00:00:00Z",
      lastObservedAt: "2026-08-01T00:00:00Z",
    });
    expect(outcome.consumedCandidateIds).toEqual([candidateId]);

    expect(
      reduceMemoryChangeV1_4(
        ledger(),
        [{ ...candidate(), candidateId: "e".repeat(64) }],
        { ...proposal, candidateIds: ["e".repeat(64)] },
        "2026-09-01T00:00:00Z",
        digest,
      ),
    ).toEqual({ kind: "provenance_mismatch" });
  });

  it("merges without losing either meaning and sums observation counts", () => {
    const plan: MemoryCurationPlan = {
      contractVersion: "1.4.0",
      hostContract: "1.4.0",
      kind: "plan",
      policyVersion: "memory-curation/1.0.0",
      asOf: "2026-09-01",
      ledgerDigest: digest("ledger"),
      proposals: [
        {
          proposalId: "f".repeat(64),
          type: "merge",
          score: 9000,
          lessonIds: ["a".repeat(64), "b".repeat(64)],
          components: {
            text: 6000,
            fix: 10000,
            technology: 10000,
            failureKind: 10000,
          },
          textEvidence: { intersection: ["compiler"], union: ["compiler"] },
          fixEvidence: { intersection: ["cache"], union: ["cache"] },
        },
      ],
      planDigest: "9".repeat(64),
    };
    const approval: Extract<MemoryCurationV1_4, { kind: "approval" }> = {
      contractVersion: "1.4.0",
      hostContract: "1.4.0",
      kind: "approval",
      reviewer: "curator",
      planDigest: plan.planDigest,
      decisions: [{ proposalId: "f".repeat(64), decision: "approve" }],
    };
    const outcome = applyMemoryCuration(
      ledger(),
      plan,
      approval,
      "2026-09-01T00:00:00Z",
      digest,
    );
    expect(outcome.kind).toBe("ready");
    if (outcome.kind !== "ready") return;
    expect(outcome.ledger.confirmed).toHaveLength(1);
    expect(outcome.ledger.confirmed[0]).toMatchObject({
      title: "Clear stale cache",
      observationCount: 8,
      firstObservedAt: "2024-01-01T00:00:00Z",
      lastObservedAt: "2025-07-01T00:00:00Z",
      technology: "typescript",
    });
    expect(outcome.ledger.confirmed[0]?.why).toEqual([
      "Cached compiler state causes failures",
      "The compiler cache can be stale",
    ]);
    expect(outcome.ledger.archive).toHaveLength(2);
  });

  it("requires exactly one decision per proposal and rejects approved overlap", () => {
    const basePlan: MemoryCurationPlan = {
      contractVersion: "1.4.0",
      hostContract: "1.4.0",
      kind: "plan",
      policyVersion: "memory-curation/1.0.0",
      asOf: "2026-09-01",
      ledgerDigest: digest("ledger"),
      proposals: [
        {
          proposalId: "1".repeat(64),
          type: "archive",
          score: 8000,
          lessonIds: ["a".repeat(64)],
          components: { age: 9000, rarity: 3333, dependencyAbsent: 10000 },
        },
        {
          proposalId: "2".repeat(64),
          type: "delete",
          score: 7000,
          lessonIds: ["a".repeat(64)],
          components: { age: 8000, rarity: 10000, dependencyAbsent: 10000 },
        },
      ],
      planDigest: "3".repeat(64),
    };
    const approval = (
      decisions: Extract<MemoryCurationV1_4, { kind: "approval" }>["decisions"],
    ) => ({
      contractVersion: "1.4.0" as const,
      hostContract: "1.4.0" as const,
      kind: "approval" as const,
      reviewer: "curator",
      planDigest: basePlan.planDigest,
      decisions,
    });
    expect(
      applyMemoryCuration(
        ledger(),
        basePlan,
        approval([{ proposalId: "1".repeat(64), decision: "approve" }]),
        "2026-09-01T00:00:00Z",
        digest,
      ),
    ).toEqual({ kind: "approval_incomplete" });
    expect(
      applyMemoryCuration(
        ledger(),
        basePlan,
        approval([
          { proposalId: "1".repeat(64), decision: "approve" },
          { proposalId: "2".repeat(64), decision: "approve" },
        ]),
        "2026-09-01T00:00:00Z",
        digest,
      ),
    ).toEqual({ kind: "approval_overlap" });
  });

  it("archives history with evidence and deletes one-off noise without a tombstone", () => {
    const run = (type: "archive" | "delete", lessonId: string) => {
      const plan: MemoryCurationPlan = {
        contractVersion: "1.4.0",
        hostContract: "1.4.0",
        kind: "plan",
        policyVersion: "memory-curation/1.0.0",
        asOf: "2026-09-01",
        ledgerDigest: digest("ledger"),
        proposals: [
          {
            proposalId: "4".repeat(64),
            type,
            score: 8123,
            lessonIds: [lessonId],
            components: { age: 9000, rarity: 3333, dependencyAbsent: 10000 },
          },
        ],
        planDigest: "5".repeat(64),
      };
      return applyMemoryCuration(
        ledger(),
        plan,
        {
          contractVersion: "1.4.0",
          hostContract: "1.4.0",
          kind: "approval",
          reviewer: "curator",
          planDigest: plan.planDigest,
          decisions: [{ proposalId: "4".repeat(64), decision: "approve" }],
        },
        "2026-09-01T00:00:00Z",
        digest,
      );
    };
    const archived = run("archive", "a".repeat(64));
    expect(archived.kind).toBe("ready");
    if (archived.kind === "ready") {
      expect(archived.ledger.archive.at(-1)).toMatchObject({
        archivedAt: "2026-09-01T00:00:00Z",
        reason: "Obsolete under memory-curation/1.0.0.",
        curationEvidence: { score: 8123, proposalId: "4".repeat(64) },
      });
    }
    const oneOff = ledger();
    oneOff.confirmed[0] = { ...oneOff.confirmed[0]!, observationCount: 1 };
    const deleted = applyMemoryCuration(
      oneOff,
      {
        contractVersion: "1.4.0",
        hostContract: "1.4.0",
        kind: "plan",
        policyVersion: "memory-curation/1.0.0",
        asOf: "2026-09-01",
        ledgerDigest: digest("ledger"),
        proposals: [
          {
            proposalId: "6".repeat(64),
            type: "delete",
            score: 8000,
            lessonIds: ["a".repeat(64)],
            components: { age: 9000, rarity: 10000, dependencyAbsent: 10000 },
          },
        ],
        planDigest: "7".repeat(64),
      },
      {
        contractVersion: "1.4.0",
        hostContract: "1.4.0",
        kind: "approval",
        reviewer: "curator",
        planDigest: "7".repeat(64),
        decisions: [{ proposalId: "6".repeat(64), decision: "approve" }],
      },
      "2026-09-01T00:00:00Z",
      digest,
    );
    expect(deleted.kind).toBe("ready");
    if (deleted.kind === "ready") expect(deleted.ledger.archive).toEqual([]);
  });
});
