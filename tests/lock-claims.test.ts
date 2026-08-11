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
import { canonicalizeJson } from "@mestre-yoda/runtime/domain/schema";
import { prepareLeaseTransition } from "@mestre-yoda/runtime/domain/locks";
import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import { types } from "node:util";
import { TransactionFailure } from "@mestre-yoda/runtime/composition";
import type { DurableFileSystem } from "@mestre-yoda/runtime/ports";
import { describe, expect, it } from "vitest";

function lockStorage(
  seed: Parameters<typeof memoryTransactionStorage>[0] = {},
) {
  return memoryTransactionStorage(seed);
}

function services(
  storage: ReturnType<typeof lockStorage>,
  now = "2026-08-11T00:01:00.000Z",
): LockServices {
  return {
    clock: fixedClock(now),
    ids: sequentialIds("claim"),
    digests: storage.digests,
    durableFileSystem: storage.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  };
}

function withDurable(
  storage: ReturnType<typeof lockStorage>,
  change: Partial<DurableFileSystem>,
): LockServices {
  return {
    ...services(storage),
    durableFileSystem: { ...storage.durableFileSystem, ...change },
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
      [lockPaths("project").claimRecord]: canonicalizeJson(
        observedClaim.observed,
      ),
    },
  });
}

function boundLeaseFiles() {
  const paths = lockPaths("project");
  const prepared = prepareLeaseTransition(
    {
      action: "acquire",
      priorEvents: "",
      lease: {
        contractVersion: "1.0.0",
        stateContract: "1.0.0",
        resource: "project",
        owner: "codex:session-01",
        leaseId: "lease-01",
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:02:00.000Z",
        fencingToken: 1,
        stateRevision: 1,
      },
      leaseRef: paths.lease,
      eventId: "event-01",
      occurredAt: "2026-08-11T00:00:00.000Z",
      observedIdentity: { host: "codex", model: null },
    },
    {
      digests: sha256Digests(),
      schemaRegistry: createSchemaRegistry(),
      isProxy: types.isProxy,
      isPromise: types.isPromise,
    },
  );
  return {
    [paths.lease]: prepared.leaseText,
    [paths.events]: prepared.eventsText,
  };
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

  it("keeps inspection read-only when the lock namespace is absent", async () => {
    const storage = lockStorage();
    await expect(
      inspectLease("project", services(storage)),
    ).resolves.toMatchObject({
      kind: "empty",
      claim: null,
    });
    expect(storage.snapshot()).toEqual({ directories: [], files: {} });
  });

  it("does not recover a claim until its expiry plus skew allowance", async () => {
    const storage = expiredClaimStorage();
    await expect(
      recoverClaim(
        observedClaim,
        services(storage, "2026-08-11T00:00:31.000Z"),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("recovers exactly at the expiry plus skew boundary", async () => {
    const storage = expiredClaimStorage();
    await expect(
      recoverClaim(
        observedClaim,
        services(storage, "2026-08-11T00:00:35.000Z"),
      ),
    ).resolves.toEqual({ kind: "recovered" });
  });

  it("admits multiple canonical run directories", async () => {
    const storage = lockStorage();
    await acquireClaim(
      { resource: "run:run-01", owner: "codex:session-01", observed: null },
      services(storage),
    );
    await expect(
      acquireClaim(
        { resource: "run:run-02", owner: "codex:session-02", observed: null },
        services(storage),
      ),
    ).resolves.toMatchObject({ resource: "run:run-02" });
  });

  it("returns a typed conflict for an existing claim in the same scope", async () => {
    const storage = lockStorage();
    await acquireClaim(projectClaim, services(storage));
    await expect(
      acquireClaim(
        { resource: "project", owner: "codex:session-02", observed: null },
        services(storage),
      ),
    ).resolves.toMatchObject({
      kind: "conflict",
      conflict: {
        resource: "project",
        owner: "codex:session-01",
        retryable: true,
      },
    });
  });

  it("enforces project/run admission while leaving independent runs available", async () => {
    const storage = lockStorage();
    await acquireClaim(
      { resource: "run:run-a", owner: "codex:session-01", observed: null },
      services(storage),
    );
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toMatchObject({
      kind: "conflict",
      conflict: { resource: "run:run-a" },
    });
    await expect(
      acquireClaim(
        { resource: "run:run-b", owner: "codex:session-02", observed: null },
        services(storage),
      ),
    ).resolves.toMatchObject({ resource: "run:run-b" });
  });

  it("rejects unknown namespace children and synthetic symlink observations", async () => {
    const unknown = lockStorage({ directories: [".brain/locks/unknown"] });
    await expect(
      acquireClaim(projectClaim, services(unknown)),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });

    const storage = lockStorage();
    const baseInspect = storage.durableFileSystem.inspect;
    await expect(
      inspectLease(
        "project",
        withDurable(storage, {
          inspect: async (path) =>
            path === ".brain"
              ? { kind: "symlink" as const }
              : baseInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("rejects file namespace roots and canonical run aliases during admission", async () => {
    const root = lockStorage();
    const baseInspect = root.durableFileSystem.inspect;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(root, {
          inspect: async (path) =>
            path === ".brain"
              ? { kind: "special" as const }
              : baseInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });

    const aliases = lockStorage({ directories: [".brain/locks/runs/YQ=="] });
    await expect(
      acquireClaim(projectClaim, services(aliases)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it.each([
    ["invalid Base64URL run name", ".brain/locks/runs/!!"],
    ["noncanonical Base64URL run name", ".brain/locks/runs/YQ=="],
  ])("rejects %s", async (_name, directory) => {
    const storage = lockStorage({ directories: [directory] });
    await expect(
      inspectLease("run:run-01", services(storage)),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it.each([
    { claimId: "?" },
    { resource: "admission" },
    { owner: "invalid" },
    { leaseId: 1 },
    { fencingToken: 1.5 },
  ])("rejects malformed claim field variants", async (change) => {
    const value = { ...observedClaim.observed, ...change };
    const storage = lockStorage({
      files: { [lockPaths("project").claimRecord]: canonicalizeJson(value) },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("rejects a claim record bound to a different resource", async () => {
    const storage = lockStorage({
      files: {
        [lockPaths("project").claimRecord]: canonicalizeJson({
          ...observedClaim.observed,
          resource: "run:run-01",
        }),
      },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("rejects a post-write digest mismatch and returns a safely inspected race winner", async () => {
    const mismatch = lockStorage();
    const target = lockPaths("project").claimRecord;
    const baseInspect = mismatch.durableFileSystem.inspect;
    let inspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(mismatch, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (path === target && entry.kind === "file" && ++inspections >= 1)
              return { ...entry, sha256: "e".repeat(64) };
            return entry;
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });

    const winner = lockStorage();
    const baseWrite = winner.durableFileSystem.writeSynced;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(winner, {
          writeSynced: async (path, text) => {
            await baseWrite(path, text);
            if (path === target) throw new Error("raced");
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "conflict" });
  });

  it.each([
    "not-json",
    "[]",
    '{"claimId":"bad"}',
    '{"acquiredAt":"2026-08-11T00:00:00Z","claimId":"claim-1","expiresAt":"2026-08-11T00:00:30.000Z","fencingToken":null,"leaseId":null,"owner":"codex:session-01","resource":"project"}',
    '{"acquiredAt":"2026-08-11T00:00:00.000Z","claimId":"claim-1","expiresAt":"2026-08-11T00:00:30.000Z","fencingToken":-1,"leaseId":null,"owner":"codex:session-01","resource":"project"}',
  ])("rejects malformed or non-canonical claim bytes: %s", async (content) => {
    const storage = lockStorage({
      files: { [lockPaths("project").claimRecord]: content },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it("normalizes durable inspection and write failures without deleting state", async () => {
    const storage = lockStorage();
    await expect(
      inspectLease(
        "project",
        withDurable(storage, {
          inspect: async () => {
            throw new Error("fault");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });

    const writeStorage = lockStorage();
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(writeStorage, {
          writeSynced: async () => {
            throw new Error("fault");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
  });

  it.each([
    "inspect",
    "create_directory",
    "sync_directory",
    "list",
    "open_file",
    "write_file",
    "sync_file",
    "close_file",
  ] as const)("contains a first %s durable failure", async (operation) => {
    const storage = lockStorage();
    storage.fail({ operation, timing: "before", occurrence: 1 });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).rejects.toBeInstanceOf(Error);
  });

  it("contains admission cleanup inspection and read failures", async () => {
    const inspectionStorage = lockStorage();
    const baseInspect = inspectionStorage.durableFileSystem.inspect;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(inspectionStorage, {
          inspect: async (path) =>
            path === lockPaths("project").admissionRecord
              ? Promise.reject(new Error("cleanup inspect"))
              : baseInspect(path),
        }),
      ),
    ).resolves.toMatchObject({ resource: "project" });

    const readStorage = lockStorage();
    const baseRead = readStorage.durableFileSystem.readText;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(readStorage, {
          readText: async (path) =>
            path === lockPaths("project").admissionRecord
              ? Promise.reject(new Error("cleanup read"))
              : baseRead(path),
        }),
      ),
    ).resolves.toMatchObject({ resource: "project" });
  });

  it("contains a write race whose winner cannot be safely reread", async () => {
    const storage = lockStorage();
    const baseWrite = storage.durableFileSystem.writeSynced;
    const baseRead = storage.durableFileSystem.readText;
    const target = lockPaths("project").claimRecord;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          writeSynced: async (path, content) => {
            await baseWrite(path, content);
            if (path === target) throw new Error("raced");
          },
          readText: async (path) =>
            path === target
              ? Promise.reject(new Error("raced read"))
              : baseRead(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("does not delete a claim when its durable removal fails", async () => {
    const storage = lockStorage();
    const claimed = await acquireClaim(projectClaim, services(storage));
    const baseRemove = storage.durableFileSystem.removeFile;
    await expect(
      releaseClaim(
        { resource: "project", observed: claimed },
        withDurable(storage, {
          removeFile: async (path) => {
            if (path === lockPaths("project").claimRecord)
              throw new Error("remove fault");
            return baseRemove(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("reports absent and stale release observations without deleting a newer claim", async () => {
    const empty = lockStorage();
    await expect(
      releaseClaim(
        { resource: "project", observed: observedClaim.observed },
        services(empty),
      ),
    ).resolves.toEqual({ kind: "absent" });
    const storage = lockStorage();
    const current = await acquireClaim(projectClaim, services(storage));
    await expect(
      releaseClaim(
        { resource: "project", observed: { ...current, claimId: "claim-old" } },
        services(storage),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(
      storage.snapshot().files[lockPaths("project").claimRecord],
    ).toBeTypeOf("string");
  });

  it("returns conflict and preserves the claim if its fingerprint changes before delete", async () => {
    const storage = lockStorage();
    const claimed = await acquireClaim(projectClaim, services(storage));
    const target = lockPaths("project").claimRecord;
    const baseInspect = storage.durableFileSystem.inspect;
    let targetInspections = 0;
    await expect(
      releaseClaim(
        { resource: "project", observed: claimed },
        withDurable(storage, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (path !== target || entry.kind !== "file") return entry;
            targetInspections += 1;
            return targetInspections >= 2
              ? { ...entry, sha256: "f".repeat(64) }
              : entry;
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "conflict" });
    expect(storage.snapshot().files[target]).toBeTypeOf("string");
  });

  it("does not delete a claim if its canonical bytes change before delete", async () => {
    const storage = lockStorage();
    const claimed = await acquireClaim(projectClaim, services(storage));
    const target = lockPaths("project").claimRecord;
    const baseRead = storage.durableFileSystem.readText;
    let reads = 0;
    await expect(
      releaseClaim(
        { resource: "project", observed: claimed },
        withDurable(storage, {
          readText: async (path) => {
            if (path !== target) return baseRead(path);
            reads += 1;
            return reads >= 2 ? "{}" : baseRead(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    expect(storage.snapshot().files[target]).toBeTypeOf("string");
  });

  it.each([
    ["lease", lockPaths("project").lease],
    ["events", lockPaths("project").events],
  ])("rejects a non-file %s lease artifact", async (_name, path) => {
    const storage = lockStorage({ directories: [path] });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it("returns a bound active lease observation and rejects a corrupt binding", async () => {
    const storage = lockStorage({ files: boundLeaseFiles() });
    await expect(
      inspectLease("project", services(storage)),
    ).resolves.toMatchObject({
      kind: "active",
      guard: { leaseId: "lease-01", fencingToken: 1 },
    });
    const corrupt = lockStorage({
      files: {
        ...boundLeaseFiles(),
        [lockPaths("project").events]: "not-json\n",
      },
    });
    await expect(
      inspectLease("project", services(corrupt)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("inspects a fully materialized run namespace and normalizes its listing failure", async () => {
    const storage = lockStorage();
    await acquireClaim(
      { resource: "run:run-01", owner: "codex:session-01", observed: null },
      services(storage),
    );
    await expect(
      inspectLease("run:run-01", services(storage)),
    ).resolves.toMatchObject({ kind: "empty" });
    const baseList = storage.durableFileSystem.list;
    await expect(
      inspectLease(
        "run:run-01",
        withDurable(storage, {
          list: async (path) =>
            path === ".brain/locks/runs"
              ? Promise.reject(new Error("list"))
              : baseList(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("normalizes direct claim and lease metadata inspection failures", async () => {
    const storage = lockStorage({ files: boundLeaseFiles() });
    const target = lockPaths("project").events;
    const baseInspect = storage.durableFileSystem.inspect;
    await expect(
      inspectLease(
        "project",
        withDurable(storage, {
          inspect: async (path) =>
            path === target
              ? Promise.reject(new Error("inspect"))
              : baseInspect(path),
        }),
      ),
    ).rejects.toBeInstanceOf(Error);
  });

  it("normalizes lease binding read failures", async () => {
    const storage = lockStorage({ files: boundLeaseFiles() });
    const baseRead = storage.durableFileSystem.readText;
    await expect(
      inspectLease(
        "project",
        withDurable(storage, {
          readText: async (path) =>
            path === lockPaths("project").events
              ? Promise.reject(new Error("event read"))
              : baseRead(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("rejects invalid caller scope before claim creation", async () => {
    const storage = lockStorage();
    await expect(
      acquireClaim(
        {
          resource: "run:../bad" as never,
          owner: "codex:session-01",
          observed: null,
        },
        services(storage),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    expect(storage.snapshot()).toEqual({ files: {}, directories: [] });
  });

  it("rejects invalid owner after namespace validation", async () => {
    const storage = lockStorage();
    await expect(
      acquireClaim(
        { resource: "project", owner: "invalid", observed: null },
        services(storage),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("treats a post-write non-file claim observation as corruption", async () => {
    const storage = lockStorage();
    const target = lockPaths("project").claimRecord;
    const baseInspect = storage.durableFileSystem.inspect;
    let seen = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (path === target && ++seen >= 1)
              return { kind: "directory" as const };
            return entry;
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("refuses recovery when transaction inspection finds an invalid marker", async () => {
    const storage = lockStorage({
      files: {
        [lockPaths("project").claimRecord]: canonicalizeJson(
          observedClaim.observed,
        ),
      },
      directories: [".brain/transactions/transaction-01"],
    });
    await expect(
      recoverClaim(observedClaim, services(storage)),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it.each(["runtime.recovery_required", "runtime.state_corrupt"] as const)(
    "maps transaction inspection %s failures",
    async (reasonCode) => {
      const storage = expiredClaimStorage();
      const lockServices: LockServices = {
        ...services(storage),
        inspectTransactions: async () => {
          throw new TransactionFailure(reasonCode, []);
        },
      };
      await expect(
        recoverClaim(observedClaim, lockServices),
      ).rejects.toMatchObject({ reasonCode });
    },
  );

  it.each(["prepared", "publishing"] as const)(
    "does not recover while a %s transaction is incomplete",
    async (phase) => {
      const storage = expiredClaimStorage();
      const lockServices: LockServices = {
        ...services(storage),
        inspectTransactions: async () => [
          {
            transactionId: "tx-01",
            manifestDigest: null,
            recoveryToken: "token",
            phase,
            evidenceRef: ".brain/transactions/tx-01/progress.json",
          },
        ],
      };
      await expect(
        recoverClaim(observedClaim, lockServices),
      ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
      expect(
        storage.snapshot().files[lockPaths("project").claimRecord],
      ).toBeTypeOf("string");
    },
  );

  it.each(["progress.next", "staging"] as const)(
    "does not recover across terminal transaction %s residue",
    async (residue) => {
      const root = ".brain/transactions/tx-terminal";
      const storage = lockStorage({
        files: {
          [lockPaths("project").claimRecord]: canonicalizeJson(
            observedClaim.observed,
          ),
        },
        directories: residue === "staging" ? [`${root}/staging`] : [root],
        ...(residue === "progress.next"
          ? {
              files: {
                [lockPaths("project").claimRecord]: canonicalizeJson(
                  observedClaim.observed,
                ),
                [`${root}/progress.next`]: "residue",
              },
            }
          : {}),
      });
      const lockServices: LockServices = {
        ...services(storage),
        inspectTransactions: async () => [
          {
            transactionId: "tx-terminal",
            manifestDigest: null,
            recoveryToken: "token",
            phase: "committed",
            evidenceRef: `${root}/progress.json`,
          },
        ],
      };
      await expect(
        recoverClaim(observedClaim, lockServices),
      ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    },
  );
});
