import {
  prepareLeaseGuard,
  executeManagedMutation,
  inspectManagedTransactions,
  recoverManagedMutation,
} from "@mestre-yoda/runtime/composition";
import { lockPaths } from "@mestre-yoda/runtime/domain/locks";
import { describe, expect, it } from "vitest";

import {
  callCount,
  callerPlan,
  guardedFixture,
  guardedRenewal,
  overwrite,
  takenOverArtifacts,
  type GuardedFixture,
} from "./support/lease-guard.js";
import { acquireRequest } from "./support/lock-contract.js";

const paths = lockPaths("run:run-01");
const destination = ".brain/runs/run-01/result.json";

/**
 * A guarded transaction interrupted at a chosen durable replacement, leaving
 * exactly the residue a crashed worker leaves: progress on disk, staged
 * payloads intact, and nothing published beyond that point.
 *
 * The fault is aimed relative to the calls the lease acquisition already made,
 * so lock-service changes cannot silently move the crash somewhere else.
 */
async function crashed(replacementsIntoTransaction: number) {
  const subject = guardedFixture();
  const held = await subject.locks.acquire(acquireRequest());
  if (held.kind !== "acquired") throw new Error("Expected an acquired lease");
  const binding = await prepareLeaseGuard(
    guardedRenewal(held.guard),
    subject.services,
  );

  subject.storage.fail({
    operation: "replace_file",
    timing: "before",
    occurrence:
      callCount(subject.storage, "replace_file") + replacementsIntoTransaction,
  });
  await expect(
    executeManagedMutation(
      callerPlan(subject.storage),
      { rootMode: "existing", leaseGuard: binding },
      subject.services,
    ),
  ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });

  // The lease acquisition left its own committed transaction behind, so the
  // pending one is whichever still needs recovery.
  const summary = (await inspectManagedTransactions(subject.services)).find(
    (candidate) =>
      candidate.phase !== "committed" && candidate.phase !== "aborted",
  );
  if (summary === undefined) throw new Error("Expected a pending transaction");
  return { subject, summary };
}

/** Replace the durable lock artifacts with a legitimately newer owner's. */
async function installNewerOwner(subject: GuardedFixture): Promise<void> {
  const taken = await takenOverArtifacts();
  await overwrite(subject.storage, paths.events, taken.events);
  await overwrite(subject.storage, paths.lease, taken.lease);
}

describe("protected transaction fencing recovery", () => {
  it("refuses to publish once a newer fencing token owns the lock", async () => {
    // The crash lands on the first destination publication: progress says
    // publishing, yet not one operation of the plan is durable.
    const { subject, summary } = await crashed(4);
    expect(summary.phase).toBe("publishing");
    await installNewerOwner(subject);

    await expect(
      recoverManagedMutation(
        {
          transactionId: summary.transactionId,
          recoveryToken: summary.recoveryToken,
        },
        subject.services,
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.lease_conflict",
      evidence: [{ kind: "artifact", ref: paths.events }],
    });

    expect(subject.storage.snapshot().files).not.toHaveProperty(destination);
  });

  it("rolls a crashed guarded transaction forward while the guard still holds", async () => {
    const { subject, summary } = await crashed(4);

    const receipt = await recoverManagedMutation(
      {
        transactionId: summary.transactionId,
        recoveryToken: summary.recoveryToken,
      },
      subject.services,
    );

    expect(receipt.phase).toBe("committed");
    const files = subject.storage.snapshot().files;
    expect(files[destination]).toBe("first");
    // Rolling forward republishes the renewal the caller's writes were fenced
    // by, so the lock trail records the transition that authorized them.
    expect(files[paths.events]).toContain("lock.renew.");
  });

  it("still aborts a prepared transaction, which needs no authority to undo", async () => {
    // Authorizing publication is itself a durable replacement, so crashing one
    // step earlier leaves a transaction that recovery can only abort.
    const { subject, summary } = await crashed(3);
    expect(summary.phase).toBe("prepared");

    const receipt = await recoverManagedMutation(
      {
        transactionId: summary.transactionId,
        recoveryToken: summary.recoveryToken,
      },
      subject.services,
    );

    expect(receipt.phase).toBe("aborted");
    expect(subject.storage.snapshot().files).not.toHaveProperty(destination);
  });
});
