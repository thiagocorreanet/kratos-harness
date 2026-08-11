/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await, @typescript-eslint/non-nullable-type-assertion-style, @typescript-eslint/no-unnecessary-type-assertion */

import {
  acquireClaim,
  ensureLockNamespace,
  inspectLease,
  recoverClaim,
  releaseClaim,
  type ClaimInspection,
  type LockClaimRecord,
  type LockServices,
  type ObservedLockClaim,
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
import {
  LockFailure,
  TransactionFailure,
} from "@mestre-yoda/runtime/composition";
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
const observedRecord: LockClaimRecord = {
  claimId: "claim-1",
  resource: "project" as LeaseResource,
  owner: "codex:session-01",
  leaseId: null,
  fencingToken: null,
  acquiredAt: "2026-08-11T00:00:00.000Z",
  expiresAt: "2026-08-11T00:00:30.000Z",
};
const observedClaim = {
  resource: "project" as const,
  owner: "codex:session-02",
  observed: observeClaim(observedRecord),
};

function expiredClaimStorage() {
  return lockStorage({
    files: {
      [lockPaths("project").claimRecord]: canonicalizeJson(observedRecord),
    },
  });
}

function boundLeaseFiles(
  expiresAt = "2026-08-11T00:02:00.000Z",
  resource: LeaseResource = "project",
) {
  const paths = lockPaths(resource);
  const prepared = prepareLeaseTransition(
    {
      action: "acquire",
      priorEvents: "",
      lease: {
        contractVersion: "1.0.0",
        stateContract: "1.0.0",
        resource,
        owner: "codex:session-01",
        leaseId: "lease-01",
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt,
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

function observeClaim(
  record: LockClaimRecord,
  fingerprint: Partial<
    Extract<ObservedLockClaim["fingerprint"], { kind: "file" }>
  > = {},
): ObservedLockClaim {
  const text = canonicalizeJson(record);
  return {
    ...record,
    fingerprint: {
      kind: "file",
      size: Buffer.byteLength(text),
      sha256: sha256Digests().sha256(text),
      ...fingerprint,
    },
  };
}

/** Test-equivalent of the closed sibling recovery marker namespace. */
function admissionRecoveryMarker(
  record: { readonly expiresAt: string } & Record<string, unknown>,
): string {
  const admissionRoot = lockPaths("project").admissionClaim.slice(0, -6);
  return `${admissionRoot}/.recovery-${String(Date.parse(record.expiresAt))}-${sha256Digests().sha256(
    canonicalizeJson(record),
  )}`;
}

function admissionTombstone(record: Record<string, unknown>): string {
  return `${lockPaths("project").admissionClaim}/.retired-${sha256Digests().sha256(
    canonicalizeJson(record),
  )}.json`;
}

function acquiredClaim(
  result: Awaited<ReturnType<typeof acquireClaim>>,
): ObservedLockClaim {
  if ("kind" in result) throw new Error("Expected an acquired claim");
  return result;
}

describe("durable lock claims", () => {
  it("creates only the closed namespace and an exclusive canonical claim", async () => {
    const storage = lockStorage();
    const claim = await acquireClaim(
      { resource: "run:run-01", owner: "codex:session-01", observed: null },
      services(storage),
    );
    const snapshot = storage.snapshot();

    expect(claim).toMatchObject({ claimId: "claim-2" });
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
      claimId: "claim-2",
      resource: "run:run-01",
      owner: "codex:session-01",
    });
  });

  it("assigns a fresh identity to each admission incarnation", async () => {
    const storage = lockStorage();
    const baseWrite = storage.durableFileSystem.writeSynced;
    const identities: string[] = [];
    const lockServices = withDurable(storage, {
      writeSynced: async (path, text) => {
        if (path === lockPaths("project").admissionRecord)
          identities.push((JSON.parse(text) as { claimId: string }).claimId);
        await baseWrite(path, text);
      },
    });
    const first = await acquireClaim(projectClaim, lockServices);
    await releaseClaim(
      { resource: "project", observed: acquiredClaim(first) },
      lockServices,
    );
    await acquireClaim(projectClaim, lockServices);
    expect(identities).toHaveLength(3);
    expect(new Set(identities).size).toBe(3);
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
        { resource: "project", observed: acquiredClaim(claimed) },
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

  it("propagates a release conflict during claim recovery", async () => {
    const storage = expiredClaimStorage();
    const target = lockPaths("project").claimRecord;
    const baseInspect = storage.durableFileSystem.inspect;
    let observations = 0;
    await expect(
      recoverClaim(
        observedClaim,
        withDurable(storage, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (path === target && entry.kind === "file" && ++observations >= 2)
              return { ...entry, sha256: "f".repeat(64) };
            return entry;
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "conflict" });
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
    ["non-reversible Base64URL run name", ".brain/locks/runs/AA"],
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
    const value = { ...observedRecord, ...change };
    const storage = lockStorage({
      files: { [lockPaths("project").claimRecord]: canonicalizeJson(value) },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("preserves typed durable failures and rejects malformed sibling markers", async () => {
    const fault = lockStorage();
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(fault, {
          inspect: async () => {
            throw new LockFailure("runtime.recovery_required", []);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });

    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const marker = admissionRecoveryMarker(stale);
    for (const seed of [
      { files: { [marker]: "bad" } },
      { directories: [marker, `${marker}/not-empty`] },
      {
        directories: [
          marker,
          admissionRecoveryMarker({ ...stale, claimId: "two" }),
        ],
      },
    ]) {
      await expect(
        inspectLease("project", services(lockStorage(seed))),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    }
  });

  it("rejects recovery markers that are not yet eligible", async () => {
    const pending = {
      claimId: "admission-pending",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:02:00.000Z",
    };
    for (const seed of [
      { directories: [admissionRecoveryMarker(pending)] },
      {
        files: {
          [lockPaths("project").admissionRecord]: canonicalizeJson(pending),
        },
        directories: [admissionRecoveryMarker(pending)],
      },
    ]) {
      await expect(
        inspectLease("project", services(lockStorage(seed))),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    }
  });

  it.each([
    ["active", "2026-08-11T00:02:00.000Z"],
    ["skew", "2026-08-11T00:00:59.000Z"],
  ])(
    "excludes a run claim while the project lease is %s",
    async (_name, expiresAt) => {
      const storage = lockStorage({ files: boundLeaseFiles(expiresAt) });
      await expect(
        acquireClaim(
          { resource: "run:run-01", owner: "codex:session-01", observed: null },
          services(storage),
        ),
      ).resolves.toMatchObject({
        kind: "conflict",
        conflict: { resource: "project" },
      });
    },
  );

  it("contains active-run listing failures during project family exclusion", async () => {
    const storage = lockStorage({ directories: [".brain/locks/runs"] });
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) => {
            if (path === ".brain/locks/runs") throw new Error("fault");
            return storage.durableFileSystem.list(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it.each(["inspect", "special"] as const)(
    "contains sibling marker cleanup %s failures",
    async (mode) => {
      const stale = {
        claimId: "admission-stale",
        resource: "admission" as const,
        owner: "codex:session-02",
        leaseId: null,
        fencingToken: null,
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:00:30.000Z",
      };
      const marker = admissionRecoveryMarker(stale);
      const storage = lockStorage({
        files: {
          [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
        },
        directories: [marker],
      });
      const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
      const baseInspect = storage.durableFileSystem.inspect;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            removeEmptyDirectory: async (path) => {
              if (path === marker) throw new Error("fault");
              return baseRemove(path);
            },
            inspect: async (path) =>
              path === marker
                ? mode === "inspect"
                  ? Promise.reject(new Error("fault"))
                  : { kind: "special" as const }
                : baseInspect(path),
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          mode === "special"
            ? "runtime.state_corrupt"
            : "runtime.internal_failure",
      });
    },
  );

  it.each(["lost", "replaced"] as const)(
    "never removes a changed admission record during sibling recovery: %s",
    async (mode) => {
      const stale = {
        claimId: "admission-stale",
        resource: "admission" as const,
        owner: "codex:session-02",
        leaseId: null,
        fencingToken: null,
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:00:30.000Z",
      };
      const paths = lockPaths("project");
      const marker = admissionRecoveryMarker(stale);
      const storage = lockStorage({
        files: { [paths.admissionRecord]: canonicalizeJson(stale) },
        directories: [marker],
      });
      const baseRemove = storage.durableFileSystem.removeFile;
      const baseWrite = storage.durableFileSystem.writeSynced;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            removeFile: async (path) => {
              if (path !== paths.admissionRecord) return baseRemove(path);
              await baseRemove(path);
              if (mode === "replaced")
                await baseWrite(
                  path,
                  canonicalizeJson({ ...stale, claimId: "admission-new" }),
                );
              throw new Error("race");
            },
          }),
        ),
      ).resolves.toMatchObject({ resource: "project" });
    },
  );

  it("normalizes transaction residue inspection faults", async () => {
    const storage = expiredClaimStorage();
    const baseInspect = storage.durableFileSystem.inspect;
    await expect(
      recoverClaim(observedClaim, {
        ...services(storage),
        inspectTransactions: async () => [
          {
            transactionId: "tx-terminal",
            manifestDigest: null,
            recoveryToken: "token",
            phase: "committed",
            evidenceRef: ".brain/transactions/tx-terminal/progress.json",
          },
        ],
        durableFileSystem: {
          ...storage.durableFileSystem,
          inspect: async (path) =>
            path === ".brain/transactions/tx-terminal/progress.next"
              ? Promise.reject(new Error("fault"))
              : baseInspect(path),
        },
      }),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("preserves typed directory setup and election failures", async () => {
    const setup = lockStorage();
    await expect(
      ensureLockNamespace(
        "project",
        withDurable(setup, {
          createDirectory: async () => {
            throw new LockFailure("runtime.recovery_required", []);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });

    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const election = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
      },
    });
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(election, {
          createDirectoryExclusive: async () => {
            throw new LockFailure("runtime.recovery_required", []);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
  });

  it("stops at a newly observed admission holder when election creation loses", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
      },
    });
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          createDirectoryExclusive: async () =>
            Promise.reject(new Error("lost")),
        }),
      ),
    ).resolves.toMatchObject({ kind: "conflict", claimId: "admission-stale" });
  });

  it("preserves a typed admission write failure", async () => {
    const storage = lockStorage();
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          writeSynced: async (path, text) => {
            if (path === lockPaths("project").admissionRecord)
              throw new LockFailure("runtime.recovery_required", []);
            return storage.durableFileSystem.writeSynced(path, text);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
  });

  it("uses a project scope claim as a run-family exclusion", async () => {
    const storage = lockStorage();
    await acquireClaim(projectClaim, services(storage));
    await expect(
      acquireClaim(
        { resource: "run:run-01", owner: "codex:session-02", observed: null },
        services(storage),
      ),
    ).resolves.toMatchObject({
      kind: "conflict",
      conflict: { resource: "project" },
    });
  });

  it("preserves typed marker removal failures and detects a marker that disappears with a holder", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const marker = admissionRecoveryMarker(stale);
    const typed = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
      },
      directories: [marker],
    });
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(typed, {
          removeEmptyDirectory: async (path) => {
            if (path === marker)
              throw new LockFailure("runtime.recovery_required", []);
            return typed.durableFileSystem.removeEmptyDirectory(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });

    const lost = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
      },
      directories: [marker],
    });
    const baseRead = lost.durableFileSystem.readText;
    const baseRemove = lost.durableFileSystem.removeEmptyDirectory;
    let reads = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(lost, {
          readText: async (path) => {
            if (path === lockPaths("project").admissionRecord && ++reads === 3)
              await baseRemove(marker);
            return baseRead(path);
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "conflict", claimId: "admission-stale" });
  });

  it("fails closed when the old admission fingerprint changes before recovery deletion", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
      },
      directories: [admissionRecoveryMarker(stale)],
    });
    const baseInspect = storage.durableFileSystem.inspect;
    let inspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (
              path === lockPaths("project").admissionRecord &&
              entry.kind === "file" &&
              ++inspections >= 4
            )
              return { ...entry, sha256: "f".repeat(64) };
            return entry;
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("rejects a marker whose no-follow kind changes during cleanup", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const marker = admissionRecoveryMarker(stale);
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
      },
      directories: [marker],
    });
    const baseInspect = storage.durableFileSystem.inspect;
    const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
    let markerInspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path === marker) throw new Error("fault");
            return baseRemove(path);
          },
          inspect: async (path) => {
            if (path !== marker) return baseInspect(path);
            markerInspections += 1;
            if (markerInspections >= 5) return { kind: "special" as const };
            return baseInspect(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("preserves typed namespace inspection failures and contains marker reread faults", async () => {
    const typed = lockStorage();
    await expect(
      inspectLease(
        "project",
        withDurable(typed, {
          inspect: async () => {
            throw new LockFailure("runtime.recovery_required", []);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });

    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const marker = admissionRecoveryMarker(stale);
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
      },
      directories: [marker],
    });
    const baseInspect = storage.durableFileSystem.inspect;
    const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
    let markerInspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path === marker) throw new Error("fault");
            return baseRemove(path);
          },
          inspect: async (path) => {
            if (path !== marker) return baseInspect(path);
            markerInspections += 1;
            if (markerInspections >= 5) throw new Error("reread fault");
            return baseInspect(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("resumes a crash after atomically retiring the stale admission record", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const marker = admissionRecoveryMarker(stale);
    const tombstone = admissionTombstone(stale);
    const storage = lockStorage({
      files: { [tombstone]: canonicalizeJson(stale) },
      directories: [marker],
    });
    await expect(
      acquireClaim(projectClaim, services(storage, "2026-08-11T00:00:35.000Z")),
    ).resolves.toMatchObject({ resource: "project" });
    expect(storage.snapshot().files[tombstone]).toBeUndefined();
    expect(storage.snapshot().directories).not.toContain(marker);
  });

  it("does not let delayed B delete A's replacement after atomic retirement", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const paths = lockPaths("project");
    const storage = lockStorage({
      files: { [paths.admissionRecord]: canonicalizeJson(stale) },
    });
    const baseReplace = storage.durableFileSystem.replaceFile;
    let opened!: () => void;
    const renamed = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const a = acquireClaim(
      projectClaim,
      withDurable(storage, {
        replaceFile: async (source, target) => {
          await baseReplace(source, target);
          opened();
          await paused;
        },
      }),
    );
    await renamed;
    const b = await acquireClaim(
      { ...projectClaim, owner: "codex:session-03" },
      services(storage),
    );
    expect(b).toMatchObject({ resource: "project", owner: "codex:session-03" });
    resume();
    await expect(a).rejects.toMatchObject({
      reasonCode: "runtime.recovery_required",
    });
    expect(storage.snapshot().files[paths.claimRecord]).toBeTypeOf("string");
  });

  it.each(["rename", "tombstone-delete", "parent-delete"] as const)(
    "resumes recovery after a crash at %s",
    async (boundary) => {
      const stale = {
        claimId: "admission-stale",
        resource: "admission" as const,
        owner: "codex:session-02",
        leaseId: null,
        fencingToken: null,
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:00:30.000Z",
      };
      const marker = admissionRecoveryMarker(stale);
      const tombstone = admissionTombstone(stale);
      const seed =
        boundary === "rename"
          ? {
              files: {
                [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
              },
              directories: [marker],
            }
          : boundary === "tombstone-delete"
            ? {
                files: { [tombstone]: canonicalizeJson(stale) },
                directories: [marker],
              }
            : { directories: [marker] };
      const storage = lockStorage(seed);
      await expect(
        acquireClaim(
          projectClaim,
          services(storage, "2026-08-11T00:00:35.000Z"),
        ),
      ).resolves.toMatchObject({ resource: "project" });
      expect(storage.snapshot().directories).not.toContain(marker);
    },
  );

  it("rejects a claim record bound to a different resource", async () => {
    const storage = lockStorage({
      files: {
        [lockPaths("project").claimRecord]: canonicalizeJson({
          ...observedRecord,
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
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
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
    const result = acquireClaim(projectClaim, services(storage));
    if (operation === "sync_file" || operation === "close_file") {
      await expect(result).resolves.toMatchObject({
        kind: "conflict",
        resource: "admission",
      });
      expect(
        storage.snapshot().files[lockPaths("project").admissionRecord],
      ).toBeTypeOf("string");
    } else await expect(result).rejects.toBeInstanceOf(Error);
  });

  it("maps admission cleanup inspection and read failures to internal failure", async () => {
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
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });

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
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
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
        { resource: "project", observed: acquiredClaim(claimed) },
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
        {
          resource: "project",
          observed: { ...acquiredClaim(current), claimId: "claim-old" },
        },
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
        { resource: "project", observed: acquiredClaim(claimed) },
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
        { resource: "project", observed: acquiredClaim(claimed) },
        withDurable(storage, {
          readText: async (path) => {
            if (path !== target) return baseRead(path);
            reads += 1;
            return reads >= 2 ? "{}" : baseRead(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
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

  it("classifies a valid expired lease as takeover eligible", async () => {
    const storage = lockStorage({
      files: boundLeaseFiles("2026-08-11T00:00:30.000Z"),
    });
    await expect(
      inspectLease("project", services(storage)),
    ).resolves.toMatchObject({ kind: "takeover_eligible" });
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

  it("rejects a run child whose no-follow kind changes during inspection", async () => {
    const storage = lockStorage();
    await acquireClaim(
      { resource: "run:run-01", owner: "codex:session-01", observed: null },
      services(storage),
    );
    const child = lockPaths("run:run-01").root;
    const baseInspect = storage.durableFileSystem.inspect;
    await expect(
      inspectLease(
        "run:run-01",
        withDurable(storage, {
          inspect: async (path) =>
            path === child ? { kind: "special" as const } : baseInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("normalizes a direct existing claim inspection failure", async () => {
    const storage = lockStorage();
    await acquireClaim(projectClaim, services(storage));
    const target = lockPaths("project").claimRecord;
    const baseInspect = storage.durableFileSystem.inspect;
    await expect(
      inspectLease(
        "project",
        withDurable(storage, {
          inspect: async (path) =>
            path === target
              ? Promise.reject(new Error("claim inspect"))
              : baseInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("rejects foreign run entries while creating a different run namespace", async () => {
    const storage = lockStorage();
    const baseList = storage.durableFileSystem.list;
    const baseInspect = storage.durableFileSystem.inspect;
    const foreign = lockPaths("run:run-a").root.split("/").at(-1) as string;
    await expect(
      acquireClaim(
        { resource: "run:run-b", owner: "codex:session-01", observed: null },
        withDurable(storage, {
          list: async (path) =>
            path === ".brain/locks/runs" ? [foreign] : baseList(path),
          inspect: async (path) =>
            path === `.brain/locks/runs/${foreign}`
              ? { kind: "special" as const }
              : baseInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("normalizes invalid active-run names and unknown transaction inspector failures", async () => {
    const storage = lockStorage({ directories: [".brain/locks/runs"] });
    const baseList = storage.durableFileSystem.list;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) =>
            path === ".brain/locks/runs" ? ["!!"] : baseList(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    const recovery = expiredClaimStorage();
    await expect(
      recoverClaim(observedClaim, {
        ...services(recovery),
        inspectTransactions: async () => {
          throw new Error("unknown");
        },
      }),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("allows project admission when the canonical runs directory is empty", async () => {
    const storage = lockStorage({ directories: [".brain/locks/runs"] });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toMatchObject({ resource: "project" });
  });

  it("allows project admission past an empty canonical run scope", async () => {
    const storage = lockStorage({
      directories: [lockPaths("run:run-01").root],
    });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toMatchObject({ resource: "project" });
  });

  it("returns typed admission contention for a valid existing admission holder", async () => {
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson({
          claimId: "admission",
          resource: "admission",
          owner: "codex:session-02",
          leaseId: null,
          fencingToken: null,
          acquiredAt: "2026-08-11T00:00:00.000Z",
          expiresAt: "2026-08-11T00:01:30.000Z",
        }),
      },
    });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toMatchObject({
      kind: "conflict",
      conflict: { owner: "codex:session-02" },
    });
  });

  it("recovers an expired admission at the skew boundary before acquiring", async () => {
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson({
          claimId: "admission",
          resource: "admission",
          owner: "codex:session-02",
          leaseId: null,
          fencingToken: null,
          acquiredAt: "2026-08-11T00:00:00.000Z",
          expiresAt: "2026-08-11T00:00:30.000Z",
        }),
      },
    });
    await expect(
      acquireClaim(projectClaim, services(storage, "2026-08-11T00:00:35.000Z")),
    ).resolves.toMatchObject({ resource: "project" });
  });

  it("helps a matching stale sibling marker when no remover remains", async () => {
    const admissionRecord = {
      claimId: "admission-stale",
      resource: "admission",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const paths = lockPaths("project");
    const storage = lockStorage({
      files: { [paths.admissionRecord]: canonicalizeJson(admissionRecord) },
      directories: [admissionRecoveryMarker(admissionRecord)],
    });
    await expect(
      acquireClaim(projectClaim, services(storage, "2026-08-11T00:00:35.000Z")),
    ).resolves.toMatchObject({ resource: "project" });
    expect(storage.snapshot().files[paths.admissionRecord]).toBeUndefined();
  });

  it("lets only the contender that removes the sibling marker continue", async () => {
    const paths = lockPaths("project");
    const stale = {
      claimId: "admission-stale",
      resource: "admission",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const storage = lockStorage({
      files: { [paths.admissionRecord]: canonicalizeJson(stale) },
    });
    const baseExclusive = storage.durableFileSystem.createDirectoryExclusive;
    let opened!: () => void;
    const openedMarker = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let continueA!: () => void;
    const releaseA = new Promise<void>((resolve) => {
      continueA = resolve;
    });
    let ordinal = 0;
    const lockServices = withDurable(storage, {
      createDirectoryExclusive: async (path) => {
        await baseExclusive(path);
        if (path === admissionRecoveryMarker(stale) && ++ordinal === 1) {
          opened();
          await releaseA;
        }
      },
    });
    const clock = "2026-08-11T00:00:35.000Z";
    const contenderA = acquireClaim(projectClaim, {
      ...lockServices,
      clock: fixedClock(clock),
    });
    await openedMarker;
    const contenderB = await acquireClaim(
      { ...projectClaim, owner: "codex:session-03" },
      { ...lockServices, clock: fixedClock(clock) },
    );
    expect(contenderB).toMatchObject({ resource: "project" });
    continueA();
    await expect(contenderA).rejects.toMatchObject({
      reasonCode: "runtime.recovery_required",
    });
    const winner = acquiredClaim(contenderB);
    expect(winner.claimId).not.toBe("admission-stale");
    expect(storage.snapshot().files[paths.claimRecord]).toBe(
      canonicalizeJson({
        claimId: winner.claimId,
        resource: winner.resource,
        owner: winner.owner,
        leaseId: winner.leaseId,
        fencingToken: winner.fencingToken,
        acquiredAt: winner.acquiredAt,
        expiresAt: winner.expiresAt,
      }),
    );
  });

  it("preserves a replacement installed after recovery marker election", async () => {
    const paths = lockPaths("project");
    const stale = {
      claimId: "admission-stale",
      resource: "admission",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const replacement = {
      ...stale,
      claimId: "admission-new",
      owner: "codex:session-03",
      expiresAt: "2026-08-11T00:02:00.000Z",
    };
    const storage = lockStorage({
      files: { [paths.admissionRecord]: canonicalizeJson(stale) },
    });
    const baseExclusive = storage.durableFileSystem.createDirectoryExclusive;
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseWrite = storage.durableFileSystem.writeSynced;
    const baseSync = storage.durableFileSystem.syncDirectory;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          createDirectoryExclusive: async (path) => {
            await baseExclusive(path);
            if (path === admissionRecoveryMarker(stale)) {
              await baseRemove(paths.admissionRecord);
              await baseWrite(
                paths.admissionRecord,
                canonicalizeJson(replacement),
              );
              await baseSync(paths.admissionClaim);
            }
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.snapshot().files[paths.admissionRecord]).toBe(
      canonicalizeJson(replacement),
    );
    expect(storage.snapshot().directories).toContain(
      admissionRecoveryMarker(stale),
    );
  });

  it("continues only after removing an elected marker whose record already disappeared", async () => {
    const paths = lockPaths("project");
    const stale = {
      claimId: "admission-stale",
      resource: "admission",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const storage = lockStorage({
      files: { [paths.admissionRecord]: canonicalizeJson(stale) },
    });
    const baseExclusive = storage.durableFileSystem.createDirectoryExclusive;
    const baseRemove = storage.durableFileSystem.removeFile;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          createDirectoryExclusive: async (path) => {
            await baseExclusive(path);
            await baseRemove(paths.admissionRecord);
          },
        }),
      ),
    ).resolves.toMatchObject({ resource: "project" });
  });

  it("fails recoverably when the elected recovery marker cannot be removed", async () => {
    const paths = lockPaths("project");
    const stale = {
      claimId: "admission-stale",
      resource: "admission",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const storage = lockStorage({
      files: { [paths.admissionRecord]: canonicalizeJson(stale) },
    });
    const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) =>
            path === admissionRecoveryMarker(stale)
              ? Promise.reject(new Error("marker cleanup"))
              : baseRemove(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    expect(storage.snapshot().directories).toContain(
      admissionRecoveryMarker(stale),
    );
  });

  it("fails closed for malformed admission metadata during sibling inspection", async () => {
    const paths = lockPaths("project");
    const storage = lockStorage({
      files: { [paths.admissionRecord]: "{}" },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it.each([
    ["noncanonical", '{"owner":"x"}'],
    [
      "wrong-resource",
      canonicalizeJson({
        claimId: "x",
        resource: "project",
        owner: "codex:session-01",
        leaseId: null,
        fencingToken: null,
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:00:30.000Z",
      }),
    ],
  ])("rejects %s admission claim bytes", async (_name, text) => {
    const paths = lockPaths("project");
    const storage = lockStorage({ files: { [paths.admissionRecord]: text } });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("maps a marker loser whose admission record disappears to internal failure", async () => {
    const paths = lockPaths("project");
    const stale = {
      claimId: "admission-stale",
      resource: "admission",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const storage = lockStorage({
      files: { [paths.admissionRecord]: canonicalizeJson(stale) },
    });
    const baseRemove = storage.durableFileSystem.removeFile;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          createDirectoryExclusive: async () => {
            await baseRemove(paths.admissionRecord);
            throw new Error("lost");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("maps a marker loser follow-up admission inspection fault to internal failure", async () => {
    const paths = lockPaths("project");
    const stale = {
      claimId: "admission-stale",
      resource: "admission",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const storage = lockStorage({
      files: { [paths.admissionRecord]: canonicalizeJson(stale) },
    });
    const baseInspect = storage.durableFileSystem.inspect;
    let lost = false;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          createDirectoryExclusive: async () => {
            lost = true;
            throw new Error("lost");
          },
          inspect: async (path) =>
            path === paths.admissionRecord && lost
              ? Promise.reject(new Error("fault"))
              : baseInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it.each(["directory", "symlink", "special"] as const)(
    "rejects a %s admission claim record entry",
    async (kind) => {
      const paths = lockPaths("project");
      const storage = lockStorage({
        files: {
          [paths.admissionRecord]: canonicalizeJson({
            claimId: "admission",
            resource: "admission",
            owner: "codex:session-01",
            leaseId: null,
            fencingToken: null,
            acquiredAt: "2026-08-11T00:00:00.000Z",
            expiresAt: "2026-08-11T00:01:30.000Z",
          }),
        },
      });
      const baseInspect = storage.durableFileSystem.inspect;
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            inspect: async (path) =>
              path === paths.admissionRecord ? { kind } : baseInspect(path),
          }),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it.each([
    [
      "stale-record",
      (paths: { readonly admissionRecord: string }) => paths.admissionRecord,
    ],
    [
      "claim-directory",
      (paths: { readonly admissionClaim: string }) => paths.admissionClaim,
    ],
    ["admission-parent", () => ".brain/locks/.admission"],
  ] as const)(
    "fails safely when recovery cleanup faults at %s",
    async (_name, target) => {
      const paths = lockPaths("project");
      const stale = {
        claimId: "admission-stale",
        resource: "admission",
        owner: "codex:session-02",
        leaseId: null,
        fencingToken: null,
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:00:30.000Z",
      };
      const storage = lockStorage({
        files: { [paths.admissionRecord]: canonicalizeJson(stale) },
      });
      const baseRemove = storage.durableFileSystem.removeFile;
      const baseRemoveDir = storage.durableFileSystem.removeEmptyDirectory;
      const baseSync = storage.durableFileSystem.syncDirectory;
      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeFile: async (path) =>
            path === target(paths)
              ? Promise.reject(new Error("fault"))
              : baseRemove(path),
          removeEmptyDirectory: async (path) =>
            path === target(paths)
              ? Promise.reject(new Error("fault"))
              : baseRemoveDir(path),
          syncDirectory: async (path) =>
            path === target(paths)
              ? Promise.reject(new Error("fault"))
              : baseSync(path),
        }),
      );
      if (_name === "stale-record")
        await expect(result).resolves.toMatchObject({ resource: "project" });
      else
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.recovery_required",
        });
    },
  );

  it.each(["removeFile", "syncDirectory"] as const)(
    "returns typed recovery-required when admission cleanup %s fails",
    async (failure) => {
      const storage = lockStorage();
      const baseRemove = storage.durableFileSystem.removeFile;
      const baseSync = storage.durableFileSystem.syncDirectory;
      const result = expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            removeFile: async (path) =>
              failure === "removeFile" &&
              path === lockPaths("project").admissionRecord
                ? Promise.reject(new Error("fault"))
                : baseRemove(path),
            syncDirectory: async (path) =>
              failure === "syncDirectory" &&
              path === lockPaths("project").admissionClaim
                ? Promise.reject(new Error("fault"))
                : baseSync(path),
          }),
        ),
      );
      if (failure === "syncDirectory")
        await result.resolves.toMatchObject({
          kind: "conflict",
          resource: "admission",
        });
      else await result.resolves.toMatchObject({ resource: "project" });
    },
  );

  it("rejects invalid acquire input before durable inspection", async () => {
    const storage = lockStorage();
    await expect(
      acquireClaim(
        { resource: "project", owner: "invalid", observed: null },
        withDurable(storage, {
          inspect: async () => {
            throw new Error("must not run");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("rejects an invalid observed lease guard before durable I/O", async () => {
    const storage = lockStorage();
    await expect(
      acquireClaim(
        {
          resource: "project",
          owner: "codex:session-01",
          observed: {
            resource: "run:other",
            owner: "codex:session-01",
            leaseId: "lease-01",
            fencingToken: 1,
            stateRevision: 1,
            leaseFingerprint: { kind: "missing" },
            eventsFingerprint: { kind: "missing" },
          },
        },
        withDurable(storage, {
          inspect: async () => {
            throw new Error("must not run");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it.each([
    { leaseId: "lease-01", fencingToken: null },
    { leaseId: null, fencingToken: 1 },
    { leaseId: "?", fencingToken: 1 },
  ])("rejects invalid persisted lease/token claim pairs", async (change) => {
    const storage = lockStorage({
      files: {
        [lockPaths("project").claimRecord]: canonicalizeJson({
          ...observedRecord,
          ...change,
        }),
      },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("rejects invalid release and recovery observations before I/O", async () => {
    const storage = lockStorage();
    const fail = withDurable(storage, {
      inspect: async () => {
        throw new Error("must not run");
      },
    });
    await expect(
      releaseClaim(
        {
          resource: "project",
          observed: observeClaim({ ...observedRecord, owner: "invalid" }),
        },
        fail,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    await expect(
      recoverClaim(
        {
          ...observedClaim,
          observed: observeClaim({ ...observedRecord, resource: "run:other" }),
        },
        fail,
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("normalizes requested-chain and admission reread inspection failures", async () => {
    const inspectStorage = lockStorage({ directories: [".brain/locks"] });
    const baseInspect = inspectStorage.durableFileSystem.inspect;
    await expect(
      inspectLease(
        "project",
        withDurable(inspectStorage, {
          inspect: async (path) =>
            path === lockPaths("project").root
              ? Promise.reject(new Error("fault"))
              : baseInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });

    const admission = lockStorage();
    const baseAdmissionInspect = admission.durableFileSystem.inspect;
    const baseAdmissionSync = admission.durableFileSystem.syncDirectory;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(admission, {
          syncDirectory: async (path) =>
            path === lockPaths("project").admissionClaim
              ? Promise.reject(new Error("sync"))
              : baseAdmissionSync(path),
          inspect: async (path) =>
            path === lockPaths("project").admissionRecord
              ? Promise.reject(new Error("reread"))
              : baseAdmissionInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("rejects a non-directory runs root and observes the active run holder", async () => {
    const corrupt = lockStorage({ files: { ".brain/locks/runs": "bad" } });
    await expect(
      acquireClaim(projectClaim, services(corrupt)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    const storage = lockStorage();
    await acquireClaim(
      { resource: "run:run-01", owner: "codex:session-01", observed: null },
      services(storage),
    );
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toMatchObject({
      kind: "conflict",
      conflict: { resource: "run:run-01" },
    });
  });

  it("rejects a non-file claim immediately before release and non-file events after a lease", async () => {
    const storage = lockStorage();
    const claimed = await acquireClaim(projectClaim, services(storage));
    const target = lockPaths("project").claimRecord;
    const baseInspect = storage.durableFileSystem.inspect;
    let count = 0;
    await expect(
      releaseClaim(
        { resource: "project", observed: acquiredClaim(claimed) },
        withDurable(storage, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (path === target && ++count >= 2)
              return { kind: "directory" as const };
            return entry;
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    const paths = lockPaths("project");
    const leaseOnly = lockStorage({
      files: { [paths.lease]: "{}" },
      directories: [paths.events],
    });
    await expect(
      inspectLease("project", services(leaseOnly)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
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
        [lockPaths("project").claimRecord]: canonicalizeJson(observedRecord),
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
          [lockPaths("project").claimRecord]: canonicalizeJson(observedRecord),
        },
        directories: residue === "staging" ? [`${root}/staging`] : [root],
        ...(residue === "progress.next"
          ? {
              files: {
                [lockPaths("project").claimRecord]:
                  canonicalizeJson(observedRecord),
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

  it.each([
    ["locks", ".brain/locks/unknown"],
    ["admission", ".brain/locks/.admission/unknown"],
    ["project", ".brain/locks/project/unknown"],
  ])(
    "rejects hidden unknown %s siblings during empty inspection",
    async (_name, directory) => {
      const storage = lockStorage({ directories: [directory] });
      await expect(
        inspectLease("run:missing", services(storage)),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it("returns absent for idempotent recovery with no scope claim", async () => {
    const storage = lockStorage();
    await expect(
      recoverClaim(observedClaim, services(storage)),
    ).resolves.toEqual({
      kind: "absent",
    });
  });

  it.each([
    ["a non-directory brain", { files: { ".brain": "bad" } }],
    ["a missing locks child", { directories: [".brain"] }],
    ["a non-directory locks root", { files: { ".brain/locks": "bad" } }],
    [
      "a non-directory admission root",
      { files: { ".brain/locks/.admission": "bad" } },
    ],
    [
      "a non-directory admission claim",
      { files: { ".brain/locks/.admission/claim": "bad" } },
    ],
    ["a non-directory runs root", { files: { ".brain/locks/runs": "bad" } }],
    [
      "a non-directory project root",
      { files: { ".brain/locks/project": "bad" } },
    ],
    [
      "a non-directory project claim",
      { files: { ".brain/locks/project/claim": "bad" } },
    ],
  ])("validates %s during inspection", async (_name, seed) => {
    const storage = lockStorage(seed);
    const result = inspectLease("run:missing", services(storage));
    if (_name === "a missing locks child")
      await expect(result).resolves.toMatchObject({ kind: "empty" });
    else
      await expect(result).rejects.toMatchObject({
        reasonCode: "runtime.state_corrupt",
      });
  });

  it.each([
    ["non-canonical", "MB"],
    ["undecodable to a valid run id", "AA"],
  ])("rejects %s canonical run children", async (_name, child) => {
    const storage = lockStorage({
      directories: [`.brain/locks/runs/${child}`],
    });
    await expect(
      inspectLease("run:missing", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("returns absent when recovery loses the claim before release", async () => {
    const storage = expiredClaimStorage();
    const target = lockPaths("project").claimRecord;
    const baseInspect = storage.durableFileSystem.inspect;
    let reads = 0;
    await expect(
      recoverClaim(
        observedClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (path === target && ++reads === 2) return { kind: "missing" };
            return baseInspect(path);
          },
        }),
      ),
    ).resolves.toEqual({ kind: "absent" });
  });

  it("maps direct namespace validation and inspection faults to internal failure", async () => {
    const storage = lockStorage({ directories: [".brain/locks/runs"] });
    await expect(
      ensureLockNamespace("run:bad id" as LeaseResource, services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    const target = lockPaths("run:missing").root;
    const baseInspect = storage.durableFileSystem.inspect;
    await expect(
      inspectLease(
        "run:missing",
        withDurable(storage, {
          inspect: async (path) =>
            path === target
              ? Promise.reject(new Error("fault"))
              : baseInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("rechecks canonical run children for a missing requested run scope", async () => {
    const storage = lockStorage({ directories: [".brain/locks/runs"] });
    await expect(
      inspectLease("run:missing", services(storage)),
    ).resolves.toMatchObject({ kind: "empty" });
  });

  it("maps failed expired-admission rereads to internal failure", async () => {
    const admission = {
      claimId: "admission",
      resource: "admission",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(admission),
      },
    });
    const baseRead = storage.durableFileSystem.readText;
    let reads = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          writeSynced: async () => Promise.reject(new Error("fault")),
          readText: async (path) =>
            path === lockPaths("project").admissionRecord && ++reads === 2
              ? Promise.reject(new Error("fault"))
              : baseRead(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("validates present admission claims and non-directory requested claims", async () => {
    const admission = lockStorage({
      directories: [".brain/locks/.admission/claim"],
    });
    await expect(
      inspectLease("project", services(admission)),
    ).resolves.toMatchObject({ kind: "empty" });
    const target = lockPaths("run:missing").claim;
    const malformed = lockStorage({ files: { [target]: "bad" } });
    await expect(
      inspectLease("run:missing", services(malformed)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("accepts the exact guard observed from durable lease bytes", async () => {
    const storage = lockStorage({ files: boundLeaseFiles() });
    const inspection = await inspectLease("project", services(storage));
    if (inspection.guard === null) throw new Error("Lease guard was absent");
    await expect(
      acquireClaim(
        {
          resource: "project",
          owner: "codex:session-01",
          observed: inspection.guard,
        },
        services(storage),
      ),
    ).resolves.toMatchObject({ leaseId: "lease-01", fencingToken: 1 });
  });

  it.each([
    (guard: NonNullable<ClaimInspection["guard"]>) => ({
      ...guard,
      resource: "run:other" as LeaseResource,
    }),
    (guard: NonNullable<ClaimInspection["guard"]>) => ({
      ...guard,
      owner: "codex:other",
    }),
    (guard: NonNullable<ClaimInspection["guard"]>) => ({
      ...guard,
      leaseId: "lease-other",
    }),
    (guard: NonNullable<ClaimInspection["guard"]>) => ({
      ...guard,
      fencingToken: guard.fencingToken + 1,
    }),
    (guard: NonNullable<ClaimInspection["guard"]>) => ({
      ...guard,
      stateRevision: guard.stateRevision + 1,
    }),
    (guard: NonNullable<ClaimInspection["guard"]>) => ({
      ...guard,
      leaseFingerprint: { ...guard.leaseFingerprint, sha256: "f".repeat(64) },
    }),
    (guard: NonNullable<ClaimInspection["guard"]>) => ({
      ...guard,
      eventsFingerprint: { ...guard.eventsFingerprint, size: 0 },
    }),
  ])("rejects a forged durable lease guard", async (mutate) => {
    const storage = lockStorage({ files: boundLeaseFiles() });
    const inspection = await inspectLease("project", services(storage));
    if (inspection.guard === null) throw new Error("Lease guard was absent");
    await expect(
      acquireClaim(
        {
          resource: "project",
          owner: "codex:session-01",
          observed: mutate(inspection.guard),
        },
        services(storage),
      ),
    ).resolves.toMatchObject({ kind: "conflict" });
  });

  it("rejects null observation when durable lease bytes exist", async () => {
    const storage = lockStorage({ files: boundLeaseFiles() });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toMatchObject({
      kind: "conflict",
      resource: "project",
      owner: "codex:session-01",
      expiresAt: "2026-08-11T00:02:00.000Z",
    });
  });

  it("returns typed contention without changing an existing scope claim", async () => {
    const storage = lockStorage();
    const first = acquiredClaim(
      await acquireClaim(projectClaim, services(storage)),
    );
    const before = storage.snapshot().files[lockPaths("project").claimRecord];
    await expect(
      acquireClaim(
        { ...projectClaim, owner: "codex:session-03" },
        services(storage),
      ),
    ).resolves.toMatchObject({ kind: "conflict", claimId: first.claimId });
    expect(storage.snapshot().files[lockPaths("project").claimRecord]).toBe(
      before,
    );
  });

  it("returns conflict when a scope claim appears after admission acquisition", async () => {
    const paths = lockPaths("project");
    const raced = {
      claimId: "claim-raced",
      resource: "project",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:01:30.000Z",
    };
    const storage = lockStorage();
    const baseSync = storage.durableFileSystem.syncDirectory;
    const baseWrite = storage.durableFileSystem.writeSynced;
    let injected = false;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          syncDirectory: async (path) => {
            const value = await baseSync(path);
            if (!injected && path === paths.admissionClaim) {
              injected = true;
              await baseWrite(paths.claimRecord, canonicalizeJson(raced));
            }
            return value;
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "conflict", claimId: "claim-raced" });
    expect(storage.snapshot().files[paths.claimRecord]).toBe(
      canonicalizeJson(raced),
    );
  });

  it.each(["remove", "replace"] as const)(
    "preserves admission cleanup outcome when current admission is %s",
    async (mode) => {
      const paths = lockPaths("project");
      const replacement = {
        claimId: "admission-replacement",
        resource: "admission",
        owner: "codex:session-03",
        leaseId: null,
        fencingToken: null,
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:02:00.000Z",
      };
      const storage = lockStorage();
      const baseWrite = storage.durableFileSystem.writeSynced;
      const baseRemove = storage.durableFileSystem.removeFile;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            writeSynced: async (path, text) => {
              await baseWrite(path, text);
              if (path === paths.claimRecord) {
                await baseRemove(paths.admissionRecord);
                if (mode === "replace")
                  await baseWrite(
                    paths.admissionRecord,
                    canonicalizeJson(replacement),
                  );
              }
            },
          }),
        ),
      ).resolves.toMatchObject({ resource: "project" });
      if (mode === "replace")
        expect(storage.snapshot().files[paths.admissionRecord]).toBe(
          canonicalizeJson(replacement),
        );
      else
        expect(storage.snapshot().files[paths.admissionRecord]).toBeUndefined();
    },
  );

  it("uses synthetic fallback conflict fields for a guard against an empty scope", async () => {
    const storage = lockStorage();
    await expect(
      acquireClaim(
        {
          resource: "project",
          owner: "codex:session-01",
          observed: {
            resource: "project",
            owner: "codex:session-01",
            leaseId: "lease-01",
            fencingToken: 1,
            stateRevision: 1,
            leaseFingerprint: { kind: "file", size: 1, sha256: "a".repeat(64) },
            eventsFingerprint: {
              kind: "file",
              size: 1,
              sha256: "b".repeat(64),
            },
          },
        },
        services(storage),
      ),
    ).resolves.toMatchObject({
      kind: "conflict",
      owner: "codex:session-01",
      leaseId: null,
      fencingToken: null,
    });
  });

  it("inspects a materialized admission claim layout", async () => {
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson({
          claimId: "admission",
          resource: "admission",
          owner: "codex:session-01",
          leaseId: null,
          fencingToken: null,
          acquiredAt: "2026-08-11T00:00:00.000Z",
          expiresAt: "2026-08-11T00:01:30.000Z",
        }),
      },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).resolves.toMatchObject({ kind: "empty" });
  });

  it("rejects a materialized non-directory admission claim", async () => {
    const storage = lockStorage({
      files: { ".brain/locks/.admission/claim": "bad" },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("accepts an empty canonical sibling admission recovery marker", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const storage = lockStorage({
      directories: [admissionRecoveryMarker(stale)],
    });
    await expect(
      inspectLease("project", services(storage)),
    ).resolves.toMatchObject({ kind: "empty" });
  });

  it("rejects a sibling recovery marker not bound to the old admission bytes", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
      },
      directories: [
        admissionRecoveryMarker({ ...stale, claimId: "different" }),
      ],
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("helps a deterministic sibling marker after its old admission record is already absent", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const marker = admissionRecoveryMarker(stale);
    const storage = lockStorage({ directories: [marker] });
    await expect(
      acquireClaim(projectClaim, services(storage, "2026-08-11T00:00:35.000Z")),
    ).resolves.toMatchObject({ resource: "project" });
    expect(storage.snapshot().directories).not.toContain(marker);
  });

  it.each([
    ["active", "2026-08-11T00:02:00.000Z"],
    ["skew", "2026-08-11T00:00:59.000Z"],
  ])(
    "excludes a project claim while a sibling run lease is %s",
    async (_name, expiresAt) => {
      const storage = lockStorage({
        files: boundLeaseFiles(expiresAt, "run:run-01"),
      });
      await expect(
        acquireClaim(projectClaim, services(storage)),
      ).resolves.toMatchObject({
        kind: "conflict",
        conflict: { resource: "run:run-01" },
      });
    },
  );

  it("revalidates the supplied lease guard after admission and before creating a scope claim", async () => {
    const storage = lockStorage({ files: boundLeaseFiles() });
    const observed = await inspectLease("project", services(storage));
    if (observed.guard === null) throw new Error("Lease guard was absent");
    const target = lockPaths("project").lease;
    const baseInspect = storage.durableFileSystem.inspect;
    let leaseInspections = 0;
    await expect(
      acquireClaim(
        { ...projectClaim, observed: observed.guard },
        withDurable(storage, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (
              path === target &&
              entry.kind === "file" &&
              ++leaseInspections >= 2
            )
              return { ...entry, sha256: "f".repeat(64) };
            return entry;
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "conflict" });
    expect(
      storage.snapshot().files[lockPaths("project").claimRecord],
    ).toBeUndefined();
  });

  it("accepts an admission namespace whose claim child is absent", async () => {
    const storage = lockStorage({ directories: [".brain/locks/.admission"] });
    await expect(
      inspectLease("project", services(storage)),
    ).resolves.toMatchObject({ kind: "empty" });
  });

  it.each([
    { resource: 1, leaseId: null, fencingToken: null },
    { leaseId: 1, fencingToken: 1 },
    { leaseId: "lease-01", fencingToken: "one" },
    { leaseId: "lease-01", fencingToken: -1 },
  ])("rejects malformed claim field variants", async (change) => {
    const storage = lockStorage({
      files: {
        [lockPaths("project").claimRecord]: canonicalizeJson({
          ...observedRecord,
          ...change,
        }),
      },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });
});
