import {
  acquireClaim,
  inspectLease,
  recoverClaim,
  releaseClaim,
  type LockServices,
} from "@mestre-yoda/runtime/composition";
import {
  lockPaths,
  type LeaseResource,
} from "@mestre-yoda/runtime/domain/locks";
import {
  fixedClock,
  memoryTransactionStorage,
  sequentialIds,
} from "../packages/runtime/src/infra/fake/index.js";
import { createSchemaRegistry } from "@mestre-yoda/runtime/composition/schema";
import { describe, expect, it } from "vitest";

function lockStorage(
  seed: Parameters<typeof memoryTransactionStorage>[0] = {},
) {
  return memoryTransactionStorage(seed);
}

function services(storage: ReturnType<typeof lockStorage>): LockServices {
  return {
    clock: fixedClock("2026-08-11T00:01:00.000Z"),
    ids: sequentialIds("claim"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  };
}

const projectClaim = {
  resource: "project" as const,
  owner: "codex:session-01",
  observed: null,
};
const observedClaim = {
  resource: "project" as const,
  owner: "codex:session-02",
  observed: {
    claimId: "claim-1",
    resource: "project" as LeaseResource,
    owner: "codex:session-01",
    leaseId: null,
    fencingToken: null,
    acquiredAt: "2026-08-11T00:00:00.000Z",
    expiresAt: "2026-08-11T00:00:30.000Z",
  },
};

function expiredClaimStorage() {
  return lockStorage({
    files: {
      [lockPaths("project").claimRecord]: JSON.stringify(
        observedClaim.observed,
      ),
    },
  });
}

describe("durable lock claims", () => {
  it("creates only the closed namespace and an exclusive canonical claim", async () => {
    const storage = lockStorage();
    const claim = await acquireClaim(
      { resource: "run:run-01", owner: "codex:session-01", observed: null },
      services(storage),
    );
    const snapshot = storage.snapshot();

    expect(claim).toMatchObject({ claimId: "claim-1" });
    expect(snapshot.directories).toEqual(
      expect.arrayContaining([
        ".brain/locks",
        ".brain/locks/.admission",
        ".brain/locks/.admission/claim",
        ".brain/locks/runs",
        lockPaths("run:run-01").root,
        lockPaths("run:run-01").claim,
      ]),
    );
    const claimText = snapshot.files[lockPaths("run:run-01").claimRecord];
    expect(claimText).toBeTypeOf("string");
    if (typeof claimText !== "string")
      throw new Error("Claim was not persisted");
    expect(JSON.parse(claimText)).toMatchObject({
      claimId: "claim-1",
      resource: "run:run-01",
      owner: "codex:session-01",
    });
  });

  it("does not flatten corrupt claim paths into contention", async () => {
    const storage = lockStorage({
      directories: [lockPaths("project").claimRecord],
    });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
      evidence: [{ kind: "artifact", ref: lockPaths("project").claimRecord }],
    });
  });

  it("inspects the exact claim and releases only its observed canonical record", async () => {
    const storage = lockStorage();
    const claimed = await acquireClaim(projectClaim, services(storage));
    const observed = await inspectLease("project", services(storage));

    expect(observed).toMatchObject({ kind: "empty", claim: claimed });
    await expect(
      releaseClaim(
        { resource: "project", observed: claimed },
        services(storage),
      ),
    ).resolves.toEqual({ kind: "released" });
    await expect(
      inspectLease("project", services(storage)),
    ).resolves.toMatchObject({ kind: "empty", claim: null });
  });

  it("recovers only an exact expired claim with no publishing transaction", async () => {
    const storage = expiredClaimStorage();
    await expect(
      recoverClaim(observedClaim, services(storage)),
    ).resolves.toEqual({ kind: "recovered" });
    await expect(
      recoverClaim(observedClaim, services(storage)),
    ).resolves.toEqual({ kind: "absent" });
  });
});
