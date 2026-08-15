import {
  executeManagedMutation,
  inspectManagedTransactions,
  prepareLeaseGuard,
  recoverManagedMutation,
} from "@kratos/runtime/composition";
import type { LeaseOutcome } from "@kratos/runtime/domain/locks";
import type { DurableOperation } from "@kratos/runtime/infra/fake";
import { describe, expect, it } from "vitest";

import {
  callerPlan,
  guardedFixture,
  guardedRenewal,
  type GuardedFixture,
} from "./support/lease-guard.js";
import { acquireRequest } from "./support/lock-contract.js";

const RESOURCE = "run:run-01" as const;
const DESTINATION = ".brain/runs/run-01/result.json";
const CONTENT = "first";
const campaignTimeoutMilliseconds = 120_000;

/**
 * The durable operations that change state.
 *
 * A fault on a read cannot leave a partial write behind, so injecting one
 * proves only that the read path propagates errors -- which the service tests
 * already cover. The campaign spends its budget where a crash can actually
 * tear a durable transition in half.
 */
const MUTATING: readonly DurableOperation[] = [
  "create_directory_exclusive",
  "write_file",
  "sync_file",
  "replace_file",
  "remove_file",
  "remove_empty_directory",
  "sync_directory",
];

/** The only two reasons a durable residue may report to the next worker. */
const ACTIONABLE = ["runtime.recovery_required", "runtime.state_corrupt"];

interface Boundary {
  readonly operation: DurableOperation;
  readonly timing: "before" | "after";
  readonly occurrence: number;
}

/** What the campaign scenario produced, whether or not a fault interrupted it. */
interface Attempt {
  readonly acquire: LeaseOutcome;
  readonly committed: boolean;
  readonly commitFailure: unknown;
}

/**
 * How a crashed attempt leaves the project for whoever arrives next.
 *
 * `explicit_recovery` and `repair` are terminal classifications, not failures
 * of the campaign: this subsystem recovers a stale lease only when a person
 * asks it to, and repairing state no protocol can interpret is `OBS-02` work
 * that does not exist yet. What matters is that a crash always lands in one of
 * these four, always names the artifact to act on, and never publishes half a
 * caller effect on the way.
 */
type Verdict = "published" | "unchanged" | "explicit_recovery" | "repair";

async function runScenario(subject: GuardedFixture): Promise<Attempt> {
  const acquire = await subject.locks.acquire(acquireRequest());
  if (acquire.kind !== "acquired")
    return { acquire, committed: false, commitFailure: undefined };
  subject.advance(1_000);
  try {
    const binding = await prepareLeaseGuard(
      guardedRenewal(acquire.guard),
      subject.services,
    );
    await executeManagedMutation(
      callerPlan(subject.storage, DESTINATION, CONTENT),
      { rootMode: "existing", leaseGuard: binding },
      subject.services,
    );
    return { acquire, committed: true, commitFailure: undefined };
  } catch (failure) {
    return { acquire, committed: false, commitFailure: failure };
  }
}

/** Every mutating boundary the uninterrupted scenario actually reaches. */
function enumerateBoundaries(
  calls: readonly DurableOperation[],
): readonly Boundary[] {
  const occurrences = new Map<DurableOperation, number>();
  const boundaries: Boundary[] = [];
  for (const operation of calls) {
    const occurrence = (occurrences.get(operation) ?? 0) + 1;
    occurrences.set(operation, occurrence);
    if (!MUTATING.includes(operation)) continue;
    boundaries.push({ operation, timing: "before", occurrence });
    boundaries.push({ operation, timing: "after", occurrence });
  }
  return boundaries;
}

function reasonOf(failure: unknown): string {
  return failure instanceof Error && "reasonCode" in failure
    ? String((failure as { readonly reasonCode: unknown }).reasonCode)
    : "untyped";
}

/** Drive every managed transaction the fault left behind to a terminal phase. */
async function settleTransactions(
  subject: GuardedFixture,
): Promise<string | null> {
  for (;;) {
    let summaries;
    try {
      summaries = await inspectManagedTransactions(subject.services);
    } catch (failure) {
      return reasonOf(failure);
    }
    const pending = summaries.find(
      (summary) => summary.phase !== "committed" && summary.phase !== "aborted",
    );
    if (pending === undefined) return null;
    try {
      await recoverManagedMutation(
        {
          transactionId: pending.transactionId,
          recoveryToken: pending.recoveryToken,
        },
        subject.services,
      );
    } catch (failure) {
      return reasonOf(failure);
    }
  }
}

/** Whether the lease reads cleanly once the transactions have settled. */
async function readLease(subject: GuardedFixture): Promise<string | null> {
  try {
    const observation = await subject.locks.inspect(RESOURCE);
    expect([
      "empty",
      "active",
      "released",
      "skew",
      "takeover_eligible",
    ]).toContain(observation.kind);
    return null;
  } catch (failure) {
    return reasonOf(failure);
  }
}

function evidenceOf(attempt: Attempt): readonly string[] {
  const failure = attempt.commitFailure;
  const fromCommit =
    failure instanceof Error && "evidence" in failure
      ? (failure as { readonly evidence: readonly { readonly ref: string }[] })
          .evidence
      : [];
  const fromAcquire =
    "evidence" in attempt.acquire ? attempt.acquire.evidence : [];
  return [...fromAcquire, ...fromCommit.map((entry) => entry.ref)];
}

describe("lock fault campaign", () => {
  it("reaches a stable set of mutating durable boundaries", async () => {
    const subject = guardedFixture();
    const attempt = await runScenario(subject);

    expect(attempt.committed).toBe(true);
    const boundaries = enumerateBoundaries(subject.storage.calls());
    // The count is pinned so a change in the durable protocol has to be
    // acknowledged here rather than silently shrinking the campaign.
    expect(boundaries).toHaveLength(328);
    expect(new Set(boundaries.map((entry) => entry.operation))).toEqual(
      new Set(MUTATING),
    );
  });

  it(
    "publishes nothing partial and always names what to act on",
    async () => {
      const baseline = guardedFixture();
      await runScenario(baseline);
      const boundaries = enumerateBoundaries(baseline.storage.calls());
      const tally: Record<Verdict | "inert", number> = {
        inert: 0,
        published: 0,
        unchanged: 0,
        explicit_recovery: 0,
        repair: 0,
      };

      for (const boundary of boundaries) {
        const label = `${boundary.operation}:${boundary.timing}:${String(boundary.occurrence)}`;
        const subject = guardedFixture();
        subject.storage.fail(boundary);

        const attempt = await runScenario(subject);
        // An `after` fault cannot fire on a call whose own effect throws first.
        // The lock protocol probes durably -- trying to remove a directory a
        // sibling may still be publishing into, for instance -- and swallows
        // the natural failure, so such a boundary is unreachable by
        // construction rather than untested.
        const hits = subject.storage.failureHits();
        if (hits.length === 0) {
          tally.inert += 1;
          expect(attempt.committed, label).toBe(true);
          continue;
        }
        expect(hits, label).toEqual([boundary]);

        // A caller effect is whole or absent. A half-written destination would
        // mean the transaction published something it could not stand behind.
        // The converse does not hold: a fault after the final replacement
        // leaves the effect durable while the attempt still reports a residue,
        // which is the difference between publishing and acknowledging.
        const published = subject.storage.snapshot().files[DESTINATION];
        expect(published === undefined || published === CONTENT, label).toBe(
          true,
        );
        if (attempt.committed) expect(published, label).toBe(CONTENT);

        // Every failure names durable state a person can act on: the
        // transaction that stalled, or the lock whose claim outlived its owner.
        for (const ref of evidenceOf(attempt)) {
          expect(ref, label).toMatch(/^\.brain\/(transactions|locks)\//u);
        }

        const settled = await settleTransactions(subject);
        const lease = settled ?? (await readLease(subject));
        if (lease === null) {
          // Recovery either rolled the caller effect forward or undid it; both
          // are whole outcomes, and which one happened is what the tally names.
          const durable = subject.storage.snapshot().files[DESTINATION];
          expect(durable === undefined || durable === CONTENT, label).toBe(
            true,
          );
          tally[durable === undefined ? "unchanged" : "published"] += 1;
          continue;
        }
        expect(ACTIONABLE, label).toContain(lease);
        tally[
          lease === "runtime.recovery_required" ? "explicit_recovery" : "repair"
        ] += 1;
      }

      // Pinned so that a protocol change moving boundaries between these
      // classes has to be acknowledged rather than passing unnoticed. Ten of
      // the 328 crashes need a person: eight ask for the explicit recovery this
      // subsystem already offers, and two leave claim bytes no protocol can
      // interpret, which is the repair `OBS-02` exists to build. Those two are
      // `write_file:before:2` and `remove_empty_directory:before:8`.
      //
      // `RUN-07a` moved two boundaries out of `repair` and into `unchanged`:
      // both stranded state that a concurrent publisher had already removed,
      // which the protocol used to read as uninterpretable claim bytes and now
      // recovers from. Nothing moved the other way, and neither `published` nor
      // `explicit_recovery` changed.
      expect(tally).toEqual({
        inert: 2,
        published: 74,
        unchanged: 242,
        explicit_recovery: 8,
        repair: 2,
      });
    },
    campaignTimeoutMilliseconds,
  );
});
