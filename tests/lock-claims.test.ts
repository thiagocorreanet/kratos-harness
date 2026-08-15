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
} from "@kratos/runtime/composition";
import {
  lockPaths,
  type LeaseResource,
} from "@kratos/runtime/domain/locks";
import {
  fixedClock,
  memoryTransactionStorage,
  sequentialIds,
} from "../packages/runtime/src/infra/fake/index.js";
import { createSchemaRegistry } from "@kratos/runtime/composition/schema";
import { canonicalizeJson } from "@kratos/runtime/domain/schema";
import { prepareLeaseTransition } from "@kratos/runtime/domain/locks";
import { sha256Digests } from "../packages/runtime/src/infra/digests.js";
import { types } from "node:util";
import {
  LockFailure,
  TransactionFailure,
} from "@kratos/runtime/composition";
import type { DurableFileSystem } from "@kratos/runtime/ports";
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
      [publishedScopeRecord(observedRecord)]: canonicalizeJson(observedRecord),
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
function admissionRecoveryMarker(record: {
  readonly expiresAt: string;
  readonly claimId?: string;
}): string {
  const admissionRoot = lockPaths("project").admissionClaim.slice(0, -6);
  return `${admissionRoot}/.recovery-${String(Date.parse(record.expiresAt))}-${sha256Digests().sha256(
    canonicalizeJson(record),
  )}`;
}

function admissionTombstone(record: object): string {
  const digest = sha256Digests().sha256(canonicalizeJson(record));
  return `${lockPaths("project").admissionClaim}/.claim-${digest}/.retired-${digest}.json`;
}

function admissionCleanupMarker(record: LockClaimRecord): string {
  const generation = parentDirectory(publishedAdmissionRecord(record));
  return `${generation}/.cleanup-${sha256Digests().sha256(canonicalizeJson(record))}`;
}

function publishedAdmissionRecord(record: object): string {
  const digest = sha256Digests().sha256(canonicalizeJson(record));
  return `${lockPaths("project").admissionClaim}/.claim-${digest}/claim.json`;
}

function candidateAdmissionRecord(record: LockClaimRecord): string {
  const digest = sha256Digests().sha256(canonicalizeJson(record));
  const root = lockPaths("project").admissionClaim.slice(0, -6);
  return `${root}/.candidate-${String(Date.parse(record.expiresAt))}-${digest}/.claim-${digest}/claim.json`;
}

function quarantinedAdmissionRecord(record: LockClaimRecord): string {
  return candidateAdmissionRecord(record).replace(
    "/.candidate-",
    "/.quarantine-",
  );
}

function candidateScopeRecord(record: LockClaimRecord): string {
  const digest = sha256Digests().sha256(canonicalizeJson(record));
  const paths = lockPaths(record.resource as LeaseResource);
  const expiresAt = String(Date.parse(record.expiresAt));
  return `${paths.root}/.candidate-${expiresAt}-${digest}/.claim-${expiresAt}-${digest}/claim.json`;
}

function quarantinedScopeRecord(record: LockClaimRecord): string {
  return candidateScopeRecord(record).replace("/.candidate-", "/.quarantine-");
}

function publishedScopeRecord(record: LockClaimRecord): string {
  const persisted: LockClaimRecord = {
    claimId: record.claimId,
    resource: record.resource,
    owner: record.owner,
    leaseId: record.leaseId,
    fencingToken: record.fencingToken,
    acquiredAt: record.acquiredAt,
    expiresAt: record.expiresAt,
  };
  const digest = sha256Digests().sha256(canonicalizeJson(persisted));
  const paths = lockPaths(record.resource as LeaseResource);
  const expiresAt = String(Date.parse(record.expiresAt));
  return `${paths.claim}/.claim-${expiresAt}-${digest}/claim.json`;
}

function scopeRecoveryMarker(record: LockClaimRecord): string {
  const persisted: LockClaimRecord = {
    claimId: record.claimId,
    resource: record.resource,
    owner: record.owner,
    leaseId: record.leaseId,
    fencingToken: record.fencingToken,
    acquiredAt: record.acquiredAt,
    expiresAt: record.expiresAt,
  };
  const digest = sha256Digests().sha256(canonicalizeJson(persisted));
  return `${parentDirectory(publishedScopeRecord(record))}/.cleanup-${digest}`;
}

function parentDirectory(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

function isAdmissionRecordPath(path: string): boolean {
  return (
    path.startsWith(
      `${lockPaths("project").admissionClaim.slice(0, -6)}/.candidate-`,
    ) && path.endsWith("/claim.json")
  );
}

function isPublishedAdmissionRecordPath(path: string): boolean {
  return (
    path.startsWith(`${lockPaths("project").admissionClaim}/.claim-`) &&
    path.endsWith("/claim.json")
  );
}

function isScopeRecordPath(path: string): boolean {
  return (
    (path.startsWith(".brain/locks/project/") ||
      path.startsWith(".brain/locks/runs/")) &&
    /\/(?:claim|\.candidate-[0-9]+-[a-f0-9]{64}|\.quarantine-[0-9]+-[a-f0-9]{64})\/\.claim-[0-9]+-[a-f0-9]{64}\/claim\.json$/u.test(
      path,
    )
  );
}

function acquiredClaim(
  result: Awaited<ReturnType<typeof acquireClaim>>,
): ObservedLockClaim {
  if ("kind" in result) throw new Error("Expected an acquired claim");
  return result;
}

async function scopeRecoveryFixture(resource: LeaseResource) {
  const storage = lockStorage();
  const claim = acquiredClaim(
    await acquireClaim(
      { resource, owner: "codex:session-01", observed: null },
      services(storage),
    ),
  );
  const marker = scopeRecoveryMarker(claim);
  await storage.durableFileSystem.createDirectoryExclusive(marker);
  return {
    storage,
    claim,
    marker,
    record: publishedScopeRecord(claim),
    generation: parentDirectory(publishedScopeRecord(claim)),
    parent: lockPaths(resource).claim,
    root: lockPaths(resource).root,
  };
}

describe("durable lock claims", () => {
  it("publishes a scope claim as one closed generation instead of a reusable record", async () => {
    const storage = lockStorage();

    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toMatchObject({
      resource: "project",
    });

    const snapshot = storage.snapshot();
    expect(snapshot.files[lockPaths("project").claimRecord]).toBeUndefined();
    expect(snapshot.directories).toContainEqual(
      expect.stringMatching(
        /^\.brain\/locks\/project\/claim\/\.claim-[0-9]{1,13}-[a-f0-9]{64}$/u,
      ),
    );
  });

  it.each(["project", "run:run-01"] as const)(
    "reclaims an expired interrupted %s scope candidate before publication",
    async (resource) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `scope-candidate-${resource}`,
        resource,
      };
      const path = candidateScopeRecord(stale);
      const storage = lockStorage({
        files: { [path]: canonicalizeJson(stale) },
      });

      await expect(
        acquireClaim(
          { resource, owner: "codex:session-03", observed: null },
          services(storage, "2026-08-11T00:01:00.000Z"),
        ),
      ).resolves.toMatchObject({ resource });
      expect(storage.snapshot().files[path]).toBeUndefined();
    },
  );

  it("resumes cleanup from a quarantined expired scope candidate", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "scope-quarantine",
    };
    const candidate = candidateScopeRecord(stale);
    const quarantine = candidate.replace("/.candidate-", "/.quarantine-");
    const storage = lockStorage({
      files: { [quarantine]: canonicalizeJson(stale) },
    });

    await expect(
      acquireClaim(
        { ...projectClaim, owner: "codex:session-03" },
        services(storage, "2026-08-11T00:01:00.000Z"),
      ),
    ).resolves.toMatchObject({ resource: "project" });
    expect(storage.snapshot().files[quarantine]).toBeUndefined();
  });

  it("resumes an expired admission candidate already quarantined by a crash", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-quarantine-restart",
      resource: "admission",
    };
    const quarantine = quarantinedAdmissionRecord(stale);
    const storage = lockStorage({
      files: { [quarantine]: canonicalizeJson(stale) },
    });

    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toMatchObject({ resource: "project" });
    expect(storage.snapshot().files[quarantine]).toBeUndefined();
  });

  it("does not let a delayed old scope release remove a replacement generation", async () => {
    const storage = lockStorage();
    const lockServices = services(storage);
    const old = acquiredClaim(await acquireClaim(projectClaim, lockServices));
    const oldRecord = publishedScopeRecord(old);
    const oldGeneration = parentDirectory(oldRecord);
    const parent = lockPaths("project").claim;
    const replacement: LockClaimRecord = {
      ...observedRecord,
      claimId: "claim-replacement",
      owner: "codex:session-03",
      expiresAt: "2026-08-11T00:02:00.000Z",
    };
    const replacementRecord = publishedScopeRecord(replacement);
    const replacementGeneration = parentDirectory(replacementRecord);
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    const baseCreate = storage.durableFileSystem.createDirectoryExclusive;
    const baseWrite = storage.durableFileSystem.writeSynced;
    let opened!: () => void;
    const reachedDelete = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let resume!: () => void;
    const resumeDelete = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const delayed = releaseClaim(
      { resource: "project", observed: old },
      withDurable(storage, {
        removeFile: async (path) => {
          if (path !== oldRecord) return baseRemove(path);
          opened();
          await resumeDelete;
          return baseRemove(path);
        },
      }),
    );
    await reachedDelete;

    await baseRemove(oldRecord);
    await baseRemoveDirectory(scopeRecoveryMarker(old));
    await baseRemoveDirectory(oldGeneration);
    await baseRemoveDirectory(parent);
    await baseCreate(parent);
    await baseCreate(replacementGeneration);
    await baseWrite(replacementRecord, canonicalizeJson(replacement));
    resume();

    await expect(delayed).rejects.toMatchObject({
      reasonCode: "runtime.internal_failure",
    });
    expect(storage.snapshot().files[replacementRecord]).toBe(
      canonicalizeJson(replacement),
    );
  });

  it("does not publish a cleanup marker after its exact scope generation vanished", async () => {
    const storage = lockStorage();
    const old = acquiredClaim(
      await acquireClaim(projectClaim, services(storage)),
    );
    const oldRecord = publishedScopeRecord(old);
    const oldGeneration = parentDirectory(oldRecord);
    const parent = parentDirectory(oldGeneration);
    const replacement: LockClaimRecord = {
      ...old,
      claimId: "claim-replacement",
      owner: "codex:session-03",
      expiresAt: "2026-08-11T00:02:00.000Z",
    };
    const replacementRecord = publishedScopeRecord(replacement);
    const replacementGeneration = parentDirectory(replacementRecord);
    const marker = scopeRecoveryMarker(old);
    const baseCreate = storage.durableFileSystem.createDirectoryExclusive;
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    const baseWrite = storage.durableFileSystem.writeSynced;
    let opened!: () => void;
    const reachedMarker = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let resume!: () => void;
    const releaseMarker = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const delayed = releaseClaim(
      { resource: "project", observed: old },
      withDurable(storage, {
        createDirectoryExclusive: async (path) => {
          if (path !== marker) return baseCreate(path);
          opened();
          await releaseMarker;
          return baseCreate(path);
        },
      }),
    );
    await reachedMarker;
    await baseRemove(oldRecord);
    await baseRemoveDirectory(oldGeneration);
    await baseRemoveDirectory(parent);
    await baseCreate(parent);
    await baseCreate(replacementGeneration);
    await baseWrite(replacementRecord, canonicalizeJson(replacement));
    resume();

    await expect(delayed).rejects.toMatchObject({
      reasonCode: "runtime.internal_failure",
    });
    expect(storage.snapshot().directories).not.toContain(marker);
    expect(storage.snapshot().directories).not.toContain(
      `${lockPaths("project").root}/.recovery-${String(Date.parse(old.expiresAt))}`,
    );
    expect(storage.snapshot().files[replacementRecord]).toBe(
      canonicalizeJson(replacement),
    );
  });

  it("does not report another generation's scope cleanup as this request's success", async () => {
    const storage = lockStorage();
    const first = acquiredClaim(
      await acquireClaim(projectClaim, services(storage)),
    );
    const firstMarker = scopeRecoveryMarker(first);
    await storage.durableFileSystem.createDirectoryExclusive(firstMarker);
    const other: ObservedLockClaim = {
      ...first,
      claimId: "claim-other-generation",
      fingerprint: first.fingerprint,
    };

    await expect(
      releaseClaim({ resource: "project", observed: other }, services(storage)),
    ).resolves.toEqual({ kind: "absent" });

    const second = acquiredClaim(
      await acquireClaim(projectClaim, services(storage)),
    );
    await storage.durableFileSystem.createDirectoryExclusive(
      scopeRecoveryMarker(second),
    );
    await expect(
      recoverClaim(
        { resource: "project", owner: second.owner, observed: other },
        services(storage),
      ),
    ).resolves.toEqual({ kind: "absent" });
  });

  it("recovers a scope release interrupted after deleting its record", async () => {
    const storage = lockStorage();
    const old = acquiredClaim(
      await acquireClaim(projectClaim, services(storage)),
    );
    const record = publishedScopeRecord(old);
    const marker = scopeRecoveryMarker(old);
    const baseRemove = storage.durableFileSystem.removeFile;

    await expect(
      releaseClaim(
        { resource: "project", observed: old },
        withDurable(storage, {
          removeFile: async (path) => {
            if (path !== record) return baseRemove(path);
            await baseRemove(path);
            throw new Error("crash after scope record delete");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    expect(storage.snapshot().directories).toContain(marker);
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({
      reasonCode: "runtime.recovery_required",
    });

    await expect(
      acquireClaim(
        { ...projectClaim, owner: "codex:session-03" },
        services(storage),
      ),
    ).resolves.toMatchObject({ resource: "project" });
    expect(storage.snapshot().directories).not.toContain(marker);
  });

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
        ".brain/locks/runs",
        lockPaths("run:run-01").root,
        lockPaths("run:run-01").claim,
      ]),
    );
    const claimText = snapshot.files[publishedScopeRecord(claim)];
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
        if (isAdmissionRecordPath(path))
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

  it.each([
    ".candidate-0-" + "a".repeat(64),
    ".candidate-zero-" + "a".repeat(64),
    ".candidate-123-not-a-digest",
    ".candidate-123-" + "A".repeat(64),
  ])("rejects malformed admission candidate %s", async (name) => {
    const root = lockPaths("project").admissionClaim.slice(0, -6);
    await expect(
      inspectLease(
        "project",
        services(lockStorage({ directories: [`${root}/${name}`] })),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it.each(["raw", "typed"] as const)(
    "normalizes %s candidate namespace listing failure",
    async (mode) => {
      const root = lockPaths("project").admissionClaim.slice(0, -6);
      const storage = lockStorage({ directories: [root] });
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            list: async (path) => {
              if (path !== root) return storage.durableFileSystem.list(path);
              if (mode === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              throw new Error("candidate list");
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          mode === "typed"
            ? "runtime.recovery_required"
            : "runtime.internal_failure",
      });
    },
  );

  it.each(["missing", "directory", "special", "typed"] as const)(
    "contains legacy admission-parent cleanup when reread as %s",
    async (outcome) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `legacy-cleanup-${outcome}`,
        resource: "admission",
      };
      const admissionRecord = lockPaths("project").admissionRecord;
      const admissionParent = lockPaths("project").admissionClaim;
      const storage = lockStorage({
        files: { [admissionRecord]: canonicalizeJson(stale) },
        directories: [admissionRecoveryMarker(stale)],
      });
      const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
      const baseInspect = storage.durableFileSystem.inspect;
      let parentRemovals = 0;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            removeEmptyDirectory: async (path) => {
              if (path !== admissionParent || ++parentRemovals !== 1)
                return baseRemove(path);
              if (outcome === "missing") {
                await baseRemove(path);
                throw new Error("lost legacy parent");
              }
              throw outcome === "typed"
                ? new LockFailure("runtime.recovery_required", [])
                : new Error("legacy parent cleanup");
            },
            inspect: async (path) => {
              if (path !== admissionParent || outcome === "missing")
                return baseInspect(path);
              if (outcome === "special") return { kind: "special" };
              return baseInspect(path);
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          outcome === "special"
            ? "runtime.state_corrupt"
            : outcome === "directory"
              ? "runtime.internal_failure"
              : "runtime.recovery_required",
      });
    },
  );

  it("reclaims an expired complete candidate without treating it as a holder", async () => {
    const stale: LockClaimRecord = {
      claimId: "candidate-stale",
      resource: "admission",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const path = candidateAdmissionRecord(stale);
    const storage = lockStorage({ files: { [path]: canonicalizeJson(stale) } });
    await expect(
      acquireClaim(projectClaim, services(storage, "2026-08-11T00:02:00.000Z")),
    ).resolves.toMatchObject({ resource: "project" });
    expect(storage.snapshot().files[path]).toBeUndefined();
  });

  it.each(["file-root", "wrong-child", "bad-content"] as const)(
    "rejects a %s candidate layout",
    async (mode) => {
      const candidate: LockClaimRecord = {
        claimId: "candidate-invalid",
        resource: "admission",
        owner: "codex:session-02",
        leaseId: null,
        fencingToken: null,
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:00:30.000Z",
      };
      const recordPath = candidateAdmissionRecord(candidate);
      const root = parentDirectory(parentDirectory(recordPath));
      const seed =
        mode === "file-root"
          ? { files: { [root]: "bad" } }
          : mode === "wrong-child"
            ? { files: { [`${root}/unexpected`]: "bad" } }
            : { files: { [recordPath]: "{}" } };
      await expect(
        inspectLease("project", services(lockStorage(seed))),
      ).rejects.toMatchObject({
        reasonCode: "runtime.state_corrupt",
      });
    },
  );

  it.each(["generation-child", "mixed-layout"] as const)(
    "rejects malformed published generation %s",
    async (mode) => {
      const record: LockClaimRecord = {
        claimId: "generation-invalid",
        resource: "admission",
        owner: "codex:session-02",
        leaseId: null,
        fencingToken: null,
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:00:30.000Z",
      };
      const path = publishedAdmissionRecord(record);
      const generation = parentDirectory(path);
      const seed =
        mode === "generation-child"
          ? { files: { [`${generation}/unexpected`]: "bad" } }
          : {
              files: {
                [path]: canonicalizeJson(record),
                [`${lockPaths("project").admissionClaim}/claim.json`]:
                  canonicalizeJson(record),
              },
            };
      await expect(
        inspectLease("project", services(lockStorage(seed))),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it("reclaims an expired candidate interrupted before its record write", async () => {
    const candidate: LockClaimRecord = {
      claimId: "candidate-partial",
      resource: "admission",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const recordPath = candidateAdmissionRecord(candidate);
    const root = parentDirectory(parentDirectory(recordPath));
    const storage = lockStorage({
      directories: [root, parentDirectory(recordPath)],
    });
    await expect(
      acquireClaim(projectClaim, services(storage, "2026-08-11T00:02:00.000Z")),
    ).resolves.toMatchObject({ resource: "project" });
    expect(storage.snapshot().directories).not.toContain(root);
  });

  it.each(["record-kind", "generation-kind", "lost-during-cleanup"] as const)(
    "contains expired candidate cleanup %s races",
    async (mode) => {
      const candidate: LockClaimRecord = {
        claimId: `candidate-${mode}`,
        resource: "admission",
        owner: "codex:session-02",
        leaseId: null,
        fencingToken: null,
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:00:30.000Z",
      };
      const recordPath = candidateAdmissionRecord(candidate);
      const generation = parentDirectory(recordPath);
      const root = parentDirectory(generation);
      const storage = lockStorage({
        files: { [recordPath]: canonicalizeJson(candidate) },
      });
      const baseInspect = storage.durableFileSystem.inspect;
      const baseRemove = storage.durableFileSystem.removeFile;
      const baseRemoveDirectory =
        storage.durableFileSystem.removeEmptyDirectory;
      let recordInspections = 0;
      let generationInspections = 0;
      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (
              path === recordPath &&
              ++recordInspections >= 2 &&
              mode === "record-kind"
            )
              return { kind: "special" };
            if (
              path === generation &&
              ++generationInspections >= 2 &&
              mode === "generation-kind"
            )
              return { kind: "special" };
            return baseInspect(path);
          },
          removeFile: async (path) => {
            if (mode !== "lost-during-cleanup" || path !== recordPath)
              return baseRemove(path);
            await baseRemove(path);
            await baseRemoveDirectory(generation);
            await baseRemoveDirectory(root);
            throw new Error("lost candidate");
          },
        }),
      );
      if (mode === "lost-during-cleanup")
        await expect(result).resolves.toMatchObject({ resource: "project" });
      else
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.state_corrupt",
        });
    },
  );

  it("does not flatten corrupt claim paths into contention", async () => {
    const storage = lockStorage({
      files: { [lockPaths("project").claim]: "not-a-directory" },
    });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
      evidence: [{ kind: "artifact", ref: lockPaths("project").claim }],
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
    const target = publishedScopeRecord(observedRecord);
    const baseInspect = storage.durableFileSystem.inspect;
    let observations = 0;
    await expect(
      recoverClaim(
        observedClaim,
        withDurable(storage, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (path === target && entry.kind === "file" && ++observations >= 6)
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
      files: {
        [publishedScopeRecord(observedRecord)]: canonicalizeJson(value),
      },
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

  it("rejects an unpaired recovery marker that is not yet eligible", async () => {
    const pending = {
      claimId: "admission-pending",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:02:00.000Z",
    };
    await expect(
      inspectLease(
        "project",
        services(
          lockStorage({ directories: [admissionRecoveryMarker(pending)] }),
        ),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });

    // A marker matching a live admission holder is an interrupted normal
    // retirement, not an ineligible stale-election marker.
    await expect(
      acquireClaim(
        projectClaim,
        services(
          lockStorage({
            files: {
              [lockPaths("project").admissionRecord]: canonicalizeJson(pending),
            },
            directories: [admissionRecoveryMarker(pending)],
          }),
        ),
      ),
    ).resolves.toMatchObject({ resource: "project" });
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
      let staleRemovals = 0;
      const result = expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            removeFile: async (path) => {
              if (path !== paths.admissionRecord || ++staleRemovals !== 1)
                return baseRemove(path);
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
      );
      if (mode === "replaced")
        await result.rejects.toMatchObject({
          reasonCode: "runtime.state_corrupt",
        });
      else await result.resolves.toMatchObject({ resource: "project" });
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
        [publishedAdmissionRecord(stale)]: canonicalizeJson(stale),
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
            if (isAdmissionRecordPath(path))
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
        [publishedAdmissionRecord(stale)]: canonicalizeJson(stale),
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
              isPublishedAdmissionRecordPath(path) &&
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
        [publishedAdmissionRecord(stale)]: canonicalizeJson(stale),
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
        [publishedAdmissionRecord(stale)]: canonicalizeJson(stale),
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

  it("retires a stale admission claim through an exclusive hard link", async () => {
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
        [publishedAdmissionRecord(stale)]: canonicalizeJson(stale),
      },
      directories: [marker],
    });
    const baseLink = storage.durableFileSystem.linkFileExclusive;
    let links = 0;

    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          linkFileExclusive: async (source, target) => {
            links += 1;
            return baseLink(source, target);
          },
        }),
      ),
    ).resolves.toMatchObject({ resource: "project" });

    expect(links).toBe(2);
  });

  it("publishes each admission in a generation-specific claim directory", async () => {
    const storage = lockStorage();
    const baseLink = storage.durableFileSystem.linkFileExclusive;
    let opened!: () => void;
    const linked = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const pending = acquireClaim(
      projectClaim,
      withDurable(storage, {
        linkFileExclusive: async (source, target) => {
          opened();
          await paused;
          return baseLink(source, target);
        },
      }),
    );
    await linked;
    expect(storage.snapshot().directories).toContainEqual(
      expect.stringMatching(
        /^\.brain\/locks\/\.admission\/claim\/\.claim-[a-f0-9]{64}$/u,
      ),
    );
    expect(
      storage.snapshot().files[lockPaths("project").admissionRecord],
    ).toBeUndefined();
    resume();
    await expect(pending).resolves.toMatchObject({ resource: "project" });
  });

  it("admits only one contender through an empty claim-parent race", async () => {
    const storage = lockStorage();
    const baseRename = storage.durableFileSystem.renameDirectoryExclusive;
    let opened!: () => void;
    const parentCreated = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    let publications = 0;
    const a = acquireClaim(
      projectClaim,
      withDurable(storage, {
        renameDirectoryExclusive: async (source, target) => {
          if (
            target === lockPaths("project").admissionClaim &&
            ++publications === 1
          ) {
            opened();
            await paused;
          }
          return baseRename(source, target);
        },
      }),
    );
    await parentCreated;
    const baseWrite = storage.durableFileSystem.writeSynced;
    let entered!: () => void;
    const operationEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let releaseOperation!: () => void;
    const operationPaused = new Promise<void>((resolve) => {
      releaseOperation = resolve;
    });
    const b = acquireClaim(
      { ...projectClaim, owner: "codex:session-03" },
      withDurable(storage, {
        writeSynced: async (path, text) => {
          await baseWrite(path, text);
          if (isScopeRecordPath(path)) {
            entered();
            await operationPaused;
          }
        },
      }),
    );
    await operationEntered;
    resume();
    const aResult = await a;
    releaseOperation();
    const results = [aResult, await b];
    expect(results.filter((result) => !("kind" in result))).toHaveLength(1);
  });

  it.each(["typed", "raw", "special"] as const)(
    "contains %s admission tombstone inspection faults",
    async (fault) => {
      const storage = lockStorage({
        directories: [lockPaths("project").admissionClaim],
      });
      const baseInspect = storage.durableFileSystem.inspect;
      let inspections = 0;
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            inspect: async (path) => {
              if (path !== lockPaths("project").admissionClaim)
                return baseInspect(path);
              if (++inspections !== 2) return baseInspect(path);
              if (fault === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              if (fault === "raw") throw new Error("inspect fault");
              return { kind: "special" };
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          fault === "typed"
            ? "runtime.recovery_required"
            : fault === "special"
              ? "runtime.state_corrupt"
              : "runtime.internal_failure",
      });
    },
  );

  it("rejects a mismatched source and tombstone while acquiring", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const replacement = { ...stale, claimId: "admission-replacement" };
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
        [admissionTombstone(replacement)]: canonicalizeJson(replacement),
      },
    });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).rejects.toMatchObject({
      reasonCode: "runtime.state_corrupt",
    });
  });

  it("resumes when a failed hard link has already removed the old source", async () => {
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
    const baseLink = storage.durableFileSystem.linkFileExclusive;
    const baseRemove = storage.durableFileSystem.removeFile;
    let links = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          linkFileExclusive: async (source, target) => {
            if (++links !== 1) return baseLink(source, target);
            await baseLink(source, target);
            await baseRemove(source);
            throw new Error("post-link fault");
          },
        }),
      ),
    ).resolves.toMatchObject({ resource: "project" });
  });

  it.each(["recovery", "cleanup"] as const)(
    "contains a vanished %s hard-link tombstone",
    async (phase) => {
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
      const storage = lockStorage(
        phase === "recovery"
          ? {
              files: {
                [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
              },
              directories: [marker],
            }
          : {},
      );
      const baseLink = storage.durableFileSystem.linkFileExclusive;
      const baseRemove = storage.durableFileSystem.removeFile;
      let links = 0;
      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          linkFileExclusive: async (source, target) => {
            if (++links !== 1) return baseLink(source, target);
            await baseLink(source, target);
            await baseRemove(target);
          },
        }),
      );
      if (phase === "recovery")
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.state_corrupt",
        });
      else await expect(result).resolves.toMatchObject({ resource: "project" });
    },
  );

  it("preserves a typed source-delete failure after recovery linking", async () => {
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
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeFile: async (path) => {
            if (path === lockPaths("project").admissionRecord)
              throw new LockFailure("runtime.recovery_required", []);
            return storage.durableFileSystem.removeFile(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
  });

  it("does not let delayed B delete A's replacement after hard-link retirement", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const staleRecord = publishedAdmissionRecord(stale);
    const storage = lockStorage({
      files: { [staleRecord]: canonicalizeJson(stale) },
    });
    const baseLink = storage.durableFileSystem.linkFileExclusive;
    let opened!: () => void;
    const linked = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let resume!: () => void;
    const paused = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const b = acquireClaim(
      { ...projectClaim, owner: "codex:session-03" },
      withDurable(storage, {
        linkFileExclusive: async (source, target) => {
          opened();
          await paused;
          return baseLink(source, target);
        },
      }),
    );
    await linked;
    const a = await acquireClaim(projectClaim, services(storage));
    expect(a).toMatchObject({ resource: "project", owner: "codex:session-01" });
    resume();
    await expect(b).rejects.toMatchObject({
      reasonCode: "runtime.recovery_required",
    });
    expect(
      storage.snapshot().files[publishedScopeRecord(acquiredClaim(a))],
    ).toBeTypeOf("string");
  });

  it.each(["link", "tombstone-delete", "parent-delete"] as const)(
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
        boundary === "link"
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

  it.each([
    ["generation", "raw"],
    ["generation", "typed"],
    ["generation", "lost"],
    ["parent", "raw"],
    ["parent", "lost"],
    ["marker", "raw"],
    ["marker", "lost"],
  ] as const)(
    "contains recovery %s removal %s outcomes",
    async (stage, outcome) => {
      const stale: LockClaimRecord = {
        claimId: "admission-boundary",
        resource: "admission",
        owner: "codex:session-02",
        leaseId: null,
        fencingToken: null,
        acquiredAt: "2026-08-11T00:00:00.000Z",
        expiresAt: "2026-08-11T00:00:30.000Z",
      };
      const record = publishedAdmissionRecord(stale);
      const generation = parentDirectory(record);
      const parent = lockPaths("project").admissionClaim;
      const marker = admissionRecoveryMarker(stale);
      const tombstone = admissionTombstone(stale);
      const storage = lockStorage({
        files: { [tombstone]: canonicalizeJson(stale) },
        directories: [marker],
      });
      const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            const matches =
              (stage === "generation" && path === generation) ||
              (stage === "parent" && path === parent) ||
              (stage === "marker" && path === marker);
            if (!matches) return baseRemove(path);
            if (outcome === "typed")
              throw new LockFailure("runtime.recovery_required", []);
            if (outcome === "lost") await baseRemove(path);
            throw new Error("boundary fault");
          },
        }),
      );
      await expect(result).rejects.toMatchObject({
        reasonCode:
          outcome === "typed"
            ? "runtime.recovery_required"
            : outcome === "raw" && stage !== "parent"
              ? "runtime.internal_failure"
              : "runtime.recovery_required",
      });
      if (outcome === "lost")
        expect(storage.snapshot().directories).not.toContain(
          stage === "generation"
            ? generation
            : stage === "parent"
              ? parent
              : marker,
        );
      else
        expect(storage.snapshot().directories).toContain(
          stage === "generation"
            ? generation
            : stage === "parent"
              ? parent
              : marker,
        );
    },
  );

  it.each([
    [
      "leading-zero marker epoch",
      {
        directories: [
          ".brain/locks/.admission/.recovery-0178640643000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        ],
      },
    ],
    [
      "multiple tombstones",
      {
        files: {
          [".brain/locks/.admission/claim/.retired-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"]:
            canonicalizeJson({
              claimId: "admission-stale",
              resource: "admission",
              owner: "codex:session-02",
              leaseId: null,
              fencingToken: null,
              acquiredAt: "2026-08-11T00:00:00.000Z",
              expiresAt: "2026-08-11T00:00:30.000Z",
            }),
          [".brain/locks/.admission/claim/.retired-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.json"]:
            canonicalizeJson({
              claimId: "admission-stale",
              resource: "admission",
              owner: "codex:session-02",
              leaseId: null,
              fencingToken: null,
              acquiredAt: "2026-08-11T00:00:00.000Z",
              expiresAt: "2026-08-11T00:00:30.000Z",
            }),
        },
      },
    ],
  ] as const)("rejects malformed retire state: %s", async (_name, seed) => {
    await expect(
      acquireClaim(projectClaim, services(lockStorage(seed))),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("contains malformed admission children and a second tombstone listing fault", async () => {
    const malformed = lockStorage({
      files: { ".brain/locks/.admission/claim/unexpected": "bad" },
    });
    await expect(
      acquireClaim(projectClaim, services(malformed)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });

    const typed = lockStorage();
    const typedList = typed.durableFileSystem.list;
    let typedLists = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(typed, {
          list: async (path) => {
            if (
              path === lockPaths("project").admissionClaim &&
              ++typedLists === 2
            )
              throw new LockFailure("runtime.recovery_required", []);
            return typedList(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });

    const storage = lockStorage();
    const baseList = storage.durableFileSystem.list;
    let lists = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) => {
            if (path === lockPaths("project").admissionClaim) ++lists;
            if (path === lockPaths("project").admissionClaim && lists === 1)
              throw new Error("tombstone list fault");
            return baseList(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    expect(lists).toBe(1);
  });

  it.each(["list", "inspect", "read"] as const)(
    "normalizes raw tombstone %s failures",
    async (fault) => {
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
      const baseList = storage.durableFileSystem.list;
      const baseInspect = storage.durableFileSystem.inspect;
      const baseRead = storage.durableFileSystem.readText;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            list: async (path) =>
              fault === "list" && path === lockPaths("project").admissionClaim
                ? Promise.reject(new Error("fault"))
                : baseList(path),
            inspect: async (path) =>
              fault === "inspect" && path === tombstone
                ? Promise.reject(new Error("fault"))
                : baseInspect(path),
            readText: async (path) =>
              fault === "read" && path === tombstone
                ? Promise.reject(new Error("fault"))
                : baseRead(path),
          }),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    },
  );

  it("rejects non-file and non-canonical tombstones before recovery", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const tombstone = admissionTombstone(stale);
    for (const seed of [
      { directories: [tombstone] },
      { files: { [tombstone]: "{}" } },
      { files: { [tombstone]: "not json" } },
    ]) {
      await expect(
        acquireClaim(projectClaim, services(lockStorage(seed))),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    }
  });

  it("contains recovery retirement races without deleting another record", async () => {
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

    const prior = lockStorage({
      files: {
        [publishedAdmissionRecord(stale)]: canonicalizeJson(stale),
      },
      directories: [marker],
    });
    const baseInspect = prior.durableFileSystem.inspect;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(prior, {
          inspect: async (path) =>
            path === tombstone
              ? { kind: "file", size: 1, sha256: "a".repeat(64) }
              : baseInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });

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
          linkFileExclusive: async () => {
            throw new LockFailure("runtime.recovery_required", []);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
  });

  it("contains a recovery parent-delete fault and source/tombstone overlap race", async () => {
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
    const parentFault = lockStorage({
      directories: [marker, lockPaths("project").admissionClaim],
    });
    const baseRemoveDirectory =
      parentFault.durableFileSystem.removeEmptyDirectory;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(parentFault, {
          removeEmptyDirectory: async (path) => {
            if (path === lockPaths("project").admissionClaim)
              throw new Error("parent delete fault");
            return baseRemoveDirectory(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });

    const overlap = lockStorage({
      files: {
        [publishedAdmissionRecord(stale)]: canonicalizeJson(stale),
      },
    });
    const baseCreate = overlap.durableFileSystem.createDirectoryExclusive;
    const baseWrite = overlap.durableFileSystem.writeSynced;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(overlap, {
          createDirectoryExclusive: async (path) => {
            await baseCreate(path);
            await baseWrite(
              tombstone,
              canonicalizeJson({ ...stale, claimId: "admission-new" }),
            );
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it.each(["typed", "same", "replacement"] as const)(
    "contains tombstone removal %s outcomes during recovery",
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
      const tombstone = admissionTombstone(stale);
      const replacement = { ...stale, claimId: "admission-replacement" };
      const storage = lockStorage({
        files: { [tombstone]: canonicalizeJson(stale) },
        directories: [marker],
      });
      const baseRemove = storage.durableFileSystem.removeFile;
      const baseWrite = storage.durableFileSystem.writeSynced;
      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeFile: async (path) => {
            if (path !== tombstone) return baseRemove(path);
            if (mode === "typed")
              throw new LockFailure("runtime.recovery_required", []);
            if (mode === "replacement") {
              await baseRemove(path);
              await baseWrite(tombstone, canonicalizeJson(replacement));
            }
            throw new Error("remove fault");
          },
        }),
      );
      await expect(result).rejects.toMatchObject({
        reasonCode:
          mode === "typed"
            ? "runtime.recovery_required"
            : mode === "replacement"
              ? "runtime.state_corrupt"
              : "runtime.internal_failure",
      });
      if (mode === "replacement")
        expect(storage.snapshot().files[tombstone]).toBe(
          canonicalizeJson(replacement),
        );
    },
  );

  it("clears an orphan tombstone before admitting the next contender", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const tombstone = admissionTombstone(stale);
    const storage = lockStorage({
      files: { [tombstone]: canonicalizeJson(stale) },
    });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toMatchObject({
      resource: "project",
    });
    expect(storage.snapshot().files[tombstone]).toBeUndefined();
  });

  it.each(["link"] as const)(
    "turns normal admission cleanup %s faults into recovery-required",
    async () => {
      const storage = lockStorage();
      const baseWrite = storage.durableFileSystem.writeSynced;
      const baseMarker = storage.durableFileSystem.createDirectoryExclusive;
      let admissionText: string | undefined;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            writeSynced: async (path, text) => {
              if (isAdmissionRecordPath(path)) admissionText = text;
              if (isScopeRecordPath(path) && admissionText !== undefined) {
                const admission = JSON.parse(admissionText) as LockClaimRecord &
                  Record<string, unknown>;
                void admission;
                void baseMarker;
              }
              return baseWrite(path, text);
            },
            linkFileExclusive: async (source, target) => {
              if (isPublishedAdmissionRecordPath(source))
                throw new Error("cleanup link fault");
              return storage.durableFileSystem.linkFileExclusive(
                source,
                target,
              );
            },
          }),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
    },
  );

  it("rejects source/tombstone overlap during read-only inspection and wrong markers", async () => {
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
    const overlap = lockStorage({
      files: {
        [paths.admissionRecord]: canonicalizeJson(stale),
        [admissionTombstone(stale)]: canonicalizeJson(stale),
      },
      directories: [admissionRecoveryMarker(stale)],
    });
    await expect(
      inspectLease("project", services(overlap)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    const wrong = lockStorage({
      files: { [admissionTombstone(stale)]: canonicalizeJson(stale) },
      directories: [admissionRecoveryMarker({ ...stale, claimId: "other" })],
    });
    await expect(
      acquireClaim(projectClaim, services(wrong)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it.each(["raw", "typed", "lost"] as const)(
    "contains orphan tombstone cleanup %s outcomes",
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
      const tombstone = admissionTombstone(stale);
      const storage = lockStorage({
        files: { [tombstone]: canonicalizeJson(stale) },
      });
      const baseRemove = storage.durableFileSystem.removeFile;
      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeFile: async (path) => {
            if (path !== tombstone) return baseRemove(path);
            if (mode === "typed")
              throw new LockFailure("runtime.recovery_required", []);
            if (mode === "lost") {
              await baseRemove(path);
              throw new Error("lost");
            }
            throw new Error("raw");
          },
        }),
      );
      if (mode === "typed")
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.recovery_required",
        });
      else if (mode === "lost")
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.internal_failure",
        });
      else
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.internal_failure",
        });
    },
  );

  it.each(["source", "tombstone", "missing", "replacement"] as const)(
    "stops safely after failed exclusive link exposing %s",
    async (state) => {
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
      const tombstone = admissionTombstone(stale);
      const storage = lockStorage({
        files: { [paths.admissionRecord]: canonicalizeJson(stale) },
        directories: [marker],
      });
      const baseRemove = storage.durableFileSystem.removeFile;
      const baseLink = storage.durableFileSystem.linkFileExclusive;
      const baseWrite = storage.durableFileSystem.writeSynced;
      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          linkFileExclusive: async (source, target) => {
            if (state === "tombstone") await baseLink(source, target);
            if (state === "missing") await baseRemove(source);
            if (state === "replacement") {
              await baseRemove(source);
              await baseWrite(
                source,
                canonicalizeJson({ ...stale, claimId: "admission-new" }),
              );
            }
            throw new Error("race");
          },
        }),
      );
      if (state === "tombstone")
        await expect(result).resolves.toMatchObject({ resource: "project" });
      else if (state === "replacement")
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.state_corrupt",
        });
      else if (state === "source")
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.internal_failure",
        });
      else
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.recovery_required",
        });
      if (state === "replacement")
        expect(storage.snapshot().files[paths.admissionRecord]).toBe(
          canonicalizeJson({ ...stale, claimId: "admission-new" }),
        );
      void tombstone;
    },
  );

  it("rejects a claim record bound to a different resource", async () => {
    const storage = lockStorage({
      files: {
        [publishedScopeRecord(observedRecord)]: canonicalizeJson({
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
    const baseInspect = mismatch.durableFileSystem.inspect;
    let inspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(mismatch, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (
              isScopeRecordPath(path) &&
              entry.kind === "file" &&
              ++inspections >= 1
            )
              return { ...entry, sha256: "e".repeat(64) };
            return entry;
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });

    const winner = lockStorage();
    const baseWrite = winner.durableFileSystem.writeSynced;
    const baseRename = winner.durableFileSystem.renameDirectoryExclusive;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(winner, {
          writeSynced: async (path, text) => {
            await baseWrite(path, text);
            if (isScopeRecordPath(path)) {
              const candidate = parentDirectory(parentDirectory(path));
              await baseRename(candidate, lockPaths("project").claim);
              throw new Error("raced");
            }
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
      files: { [publishedScopeRecord(observedRecord)]: content },
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
    await expect(result).rejects.toBeInstanceOf(Error);
  });

  it("maps admission cleanup inspection and read failures to internal failure", async () => {
    const inspectionStorage = lockStorage();
    const baseInspect = inspectionStorage.durableFileSystem.inspect;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(inspectionStorage, {
          inspect: async (path) =>
            isPublishedAdmissionRecordPath(path)
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
            isPublishedAdmissionRecordPath(path)
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
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          writeSynced: async (path, content) => {
            await baseWrite(path, content);
            if (isScopeRecordPath(path)) throw new Error("raced");
          },
          readText: async (path) =>
            isScopeRecordPath(path)
              ? Promise.reject(new Error("raced read"))
              : baseRead(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("does not delete a claim when its durable removal fails", async () => {
    const storage = lockStorage();
    const claimed = await acquireClaim(projectClaim, services(storage));
    const target = publishedScopeRecord(acquiredClaim(claimed));
    const baseRemove = storage.durableFileSystem.removeFile;
    await expect(
      releaseClaim(
        { resource: "project", observed: acquiredClaim(claimed) },
        withDurable(storage, {
          removeFile: async (path) => {
            if (path === target) throw new Error("remove fault");
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
      storage.snapshot().files[publishedScopeRecord(acquiredClaim(current))],
    ).toBeTypeOf("string");
  });

  it("returns conflict and preserves the claim if its fingerprint changes before delete", async () => {
    const storage = lockStorage();
    const claimed = await acquireClaim(projectClaim, services(storage));
    const target = publishedScopeRecord(acquiredClaim(claimed));
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
            return targetInspections >= 6
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
    const target = publishedScopeRecord(acquiredClaim(claimed));
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
    const claimed = await acquireClaim(projectClaim, services(storage));
    const target = publishedScopeRecord(acquiredClaim(claimed));
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
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const staleRecord = publishedAdmissionRecord(stale);
    const marker = admissionCleanupMarker(stale);
    const storage = lockStorage({
      files: { [staleRecord]: canonicalizeJson(stale) },
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
        if (path === marker && ++ordinal === 1) {
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
      reasonCode: "runtime.internal_failure",
    });
    const winner = acquiredClaim(contenderB);
    expect(winner.claimId).not.toBe("admission-stale");
    expect(storage.snapshot().files[publishedScopeRecord(winner)]).toBe(
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
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
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
    const staleRecord = publishedAdmissionRecord(stale);
    const marker = admissionCleanupMarker(stale);
    const storage = lockStorage({
      files: { [staleRecord]: canonicalizeJson(stale) },
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
            if (path === marker) {
              await baseRemove(staleRecord);
              await baseWrite(staleRecord, canonicalizeJson(replacement));
              await baseSync(parentDirectory(staleRecord));
            }
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.snapshot().files[staleRecord]).toBe(
      canonicalizeJson(replacement),
    );
    expect(storage.snapshot().directories).toContain(marker);
  });

  it("continues after an elected marker loses its record before cleanup", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const staleRecord = publishedAdmissionRecord(stale);
    const marker = admissionCleanupMarker(stale);
    const storage = lockStorage({
      files: { [staleRecord]: canonicalizeJson(stale) },
    });
    const baseExclusive = storage.durableFileSystem.createDirectoryExclusive;
    const baseRemove = storage.durableFileSystem.removeFile;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          createDirectoryExclusive: async (path) => {
            await baseExclusive(path);
            if (path === marker) await baseRemove(staleRecord);
          },
        }),
      ),
    ).resolves.toMatchObject({ resource: "project" });
  });

  it("fails recoverably when the elected recovery marker cannot be removed", async () => {
    const stale = {
      claimId: "admission-stale",
      resource: "admission" as const,
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:00:30.000Z",
    };
    const staleRecord = publishedAdmissionRecord(stale);
    const marker = admissionCleanupMarker(stale);
    const storage = lockStorage({
      files: { [staleRecord]: canonicalizeJson(stale) },
    });
    const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) =>
            path === marker
              ? Promise.reject(new Error("marker cleanup"))
              : baseRemove(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    expect(storage.snapshot().directories).toContain(marker);
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
      await expect(result).rejects.toMatchObject({
        reasonCode:
          _name === "admission-parent"
            ? "runtime.recovery_required"
            : "runtime.internal_failure",
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
              failure === "removeFile" && isPublishedAdmissionRecordPath(path)
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
      await result.rejects.toMatchObject({
        reasonCode: "runtime.recovery_required",
      });
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
        [publishedScopeRecord(observedRecord)]: canonicalizeJson({
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
            isPublishedAdmissionRecordPath(path)
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
    const target = publishedScopeRecord(acquiredClaim(claimed));
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

  it.each(["raw", "typed"] as const)(
    "%s lease binding read failures respect the port boundary",
    async (fault) => {
      const storage = lockStorage({ files: boundLeaseFiles() });
      const baseRead = storage.durableFileSystem.readText;
      const failure =
        fault === "typed"
          ? new LockFailure("runtime.recovery_required", [])
          : new Error("event read");
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            readText: async (path) =>
              path === lockPaths("project").events
                ? Promise.reject(failure)
                : baseRead(path),
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          fault === "typed"
            ? "runtime.recovery_required"
            : "runtime.internal_failure",
      });
    },
  );

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
    const baseInspect = storage.durableFileSystem.inspect;
    let seen = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (isScopeRecordPath(path) && ++seen >= 1)
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
        [publishedScopeRecord(observedRecord)]:
          canonicalizeJson(observedRecord),
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
        storage.snapshot().files[publishedScopeRecord(observedRecord)],
      ).toBeTypeOf("string");
    },
  );

  it.each(["progress.next", "staging"] as const)(
    "does not recover across terminal transaction %s residue",
    async (residue) => {
      const root = ".brain/transactions/tx-terminal";
      const storage = lockStorage({
        files: {
          [publishedScopeRecord(observedRecord)]:
            canonicalizeJson(observedRecord),
        },
        directories: residue === "staging" ? [`${root}/staging`] : [root],
        ...(residue === "progress.next"
          ? {
              files: {
                [publishedScopeRecord(observedRecord)]:
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
    const target = publishedScopeRecord(observedRecord);
    const baseInspect = storage.durableFileSystem.inspect;
    let reads = 0;
    await expect(
      recoverClaim(
        observedClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (path === target && ++reads === 6) return { kind: "missing" };
            return baseInspect(path);
          },
        }),
      ),
    ).resolves.toEqual({ kind: "recovered" });
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
    const record = publishedScopeRecord(first);
    const before = storage.snapshot().files[record];
    await expect(
      acquireClaim(
        { ...projectClaim, owner: "codex:session-03" },
        services(storage),
      ),
    ).resolves.toMatchObject({ kind: "conflict", claimId: first.claimId });
    expect(storage.snapshot().files[record]).toBe(before);
  });

  it("returns conflict when a scope claim appears after admission acquisition", async () => {
    const paths = lockPaths("project");
    const raced: LockClaimRecord = {
      claimId: "claim-raced",
      resource: "project",
      owner: "codex:session-02",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:00:00.000Z",
      expiresAt: "2026-08-11T00:01:30.000Z",
    };
    const storage = lockStorage();
    const baseWrite = storage.durableFileSystem.writeSynced;
    const baseCreate = storage.durableFileSystem.createDirectoryExclusive;
    const baseRename = storage.durableFileSystem.renameDirectoryExclusive;
    const racedRecord = publishedScopeRecord(raced);
    const racedGeneration = parentDirectory(racedRecord);
    let injected = false;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          renameDirectoryExclusive: async (source, target) => {
            await baseRename(source, target);
            if (!injected && target === paths.admissionClaim) {
              injected = true;
              await baseCreate(paths.claim);
              await baseCreate(racedGeneration);
              await baseWrite(racedRecord, canonicalizeJson(raced));
            }
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "conflict", claimId: "claim-raced" });
    expect(storage.snapshot().files[racedRecord]).toBe(canonicalizeJson(raced));
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
      const baseRemoveDirectory =
        storage.durableFileSystem.removeEmptyDirectory;
      const baseCreate = storage.durableFileSystem.createDirectoryExclusive;
      let admission: LockClaimRecord | null = null;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            writeSynced: async (path, text) => {
              await baseWrite(path, text);
              if (isAdmissionRecordPath(path))
                admission = JSON.parse(text) as LockClaimRecord;
              if (isScopeRecordPath(path)) {
                if (admission === null)
                  throw new Error("Admission was not written");
                await baseRemove(publishedAdmissionRecord(admission));
                if (mode === "replace") {
                  await baseRemoveDirectory(
                    parentDirectory(publishedAdmissionRecord(admission)),
                  );
                  await baseRemoveDirectory(paths.admissionClaim);
                  await baseCreate(paths.admissionClaim);
                  await baseCreate(
                    parentDirectory(publishedAdmissionRecord(replacement)),
                  );
                  await baseWrite(
                    publishedAdmissionRecord(replacement),
                    canonicalizeJson(replacement),
                  );
                }
              }
            },
          }),
        ),
      ).resolves.toMatchObject({ resource: "project" });
      if (mode === "replace")
        expect(
          storage.snapshot().files[publishedAdmissionRecord(replacement)],
        ).toBe(canonicalizeJson(replacement));
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
      storage.snapshot().files[publishedScopeRecord(observedRecord)],
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
        [publishedScopeRecord(observedRecord)]: canonicalizeJson({
          ...observedRecord,
          ...change,
        }),
      },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("treats a candidate whose listed record vanishes as an incomplete crash", async () => {
    const candidate: LockClaimRecord = {
      ...observedRecord,
      claimId: "candidate-vanished",
      resource: "admission",
    };
    const recordPath = candidateAdmissionRecord(candidate);
    const generation = parentDirectory(recordPath);
    const storage = lockStorage({ directories: [generation] });
    const baseList = storage.durableFileSystem.list;

    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) =>
            path === generation ? ["claim.json"] : baseList(path),
        }),
      ),
    ).resolves.toMatchObject({ resource: "project" });
  });

  it("rejects a published admission record outside its content-addressed generation", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "wrong-generation",
      resource: "admission",
    };
    const wrongGeneration = `${lockPaths("project").admissionClaim}/.claim-${"a".repeat(64)}`;
    const storage = lockStorage({
      files: { [`${wrongGeneration}/claim.json`]: canonicalizeJson(stale) },
    });

    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it.each(["missing", "special"] as const)(
    "contains a failed empty admission-parent cleanup when its reread is %s",
    async (outcome) => {
      const storage = lockStorage({
        directories: [lockPaths("project").admissionClaim],
      });
      const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
      const baseInspect = storage.durableFileSystem.inspect;

      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path !== lockPaths("project").admissionClaim)
              return baseRemove(path);
            if (outcome === "missing") {
              await baseRemove(path);
              throw new Error("lost parent");
            }
            throw new Error("parent cleanup failed");
          },
          inspect: async (path) =>
            outcome === "special" &&
            path === lockPaths("project").admissionClaim
              ? { kind: "special" as const }
              : baseInspect(path),
        }),
      );
      if (outcome === "missing")
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.recovery_required",
        });
      else
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.state_corrupt",
        });
    },
  );

  it("does not publish an admission candidate after its durable record write fails", async () => {
    const storage = lockStorage();
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          writeSynced: async (path, text) => {
            if (isAdmissionRecordPath(path)) throw new Error("candidate write");
            return storage.durableFileSystem.writeSynced(path, text);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    expect(
      storage
        .snapshot()
        .directories.some((path) => path.includes(".candidate-")),
    ).toBe(false);
  });

  it("retires a normal holder through its elected recovery marker", async () => {
    const storage = lockStorage();
    const baseLink = storage.durableFileSystem.linkFileExclusive;
    const baseCreate = storage.durableFileSystem.createDirectoryExclusive;
    let markerCreated = false;

    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          linkFileExclusive: async (source, target) => {
            await baseLink(source, target);
            if (!markerCreated) {
              markerCreated = true;
              const record = JSON.parse(
                await storage.durableFileSystem.readText(source),
              ) as LockClaimRecord;
              await baseCreate(admissionRecoveryMarker(record));
            }
          },
        }),
      ),
    ).resolves.toMatchObject({ resource: "project" });
  });

  it("rejects a simultaneous legacy admission record and tombstone during recovery", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "legacy-overlap",
      resource: "admission",
    };
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
        [admissionTombstone(stale)]: canonicalizeJson(stale),
      },
    });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it.each(["raw", "typed", "special"] as const)(
    "contains the second inspection of a published generation when it is %s",
    async (fault) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `generation-${fault}`,
        resource: "admission",
      };
      const recordPath = publishedAdmissionRecord(stale);
      const generation = parentDirectory(recordPath);
      const storage = lockStorage({
        files: { [recordPath]: canonicalizeJson(stale) },
      });
      const baseInspect = storage.durableFileSystem.inspect;
      let calls = 0;

      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            inspect: async (path) => {
              if (path !== generation || ++calls < 2) return baseInspect(path);
              if (fault === "raw") throw new Error("generation reread");
              if (fault === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              return { kind: "special" };
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          fault === "typed"
            ? "runtime.recovery_required"
            : fault === "special"
              ? "runtime.state_corrupt"
              : "runtime.internal_failure",
      });
    },
  );

  it.each(["raw", "typed"] as const)(
    "normalizes candidate enumeration %s failures after namespace setup",
    async (fault) => {
      const storage = lockStorage();
      const baseList = storage.durableFileSystem.list;
      let admissionLists = 0;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            list: async (path) => {
              if (path !== ".brain/locks/.admission") return baseList(path);
              admissionLists += 1;
              if (admissionLists < 3) return baseList(path);
              if (fault === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              throw new Error("candidate enumeration");
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          fault === "typed"
            ? "runtime.recovery_required"
            : "runtime.internal_failure",
      });
    },
  );

  it.each(["raw", "typed"] as const)(
    "normalizes a malformed legacy admission record %s failure",
    async (fault) => {
      const storage = lockStorage({
        files: { [lockPaths("project").admissionRecord]: "not-json" },
      });
      const baseRead = storage.durableFileSystem.readText;
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            readText: async (path) => {
              if (path !== lockPaths("project").admissionRecord)
                return baseRead(path);
              if (fault === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              return baseRead(path);
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          fault === "typed"
            ? "runtime.recovery_required"
            : "runtime.state_corrupt",
      });
    },
  );

  it("does not collapse a failed expired-candidate deletion while it remains present", async () => {
    const candidate: LockClaimRecord = {
      ...observedRecord,
      claimId: "candidate-delete-fault",
      resource: "admission",
    };
    const recordPath = candidateAdmissionRecord(candidate);
    const quarantinedRecord = quarantinedAdmissionRecord(candidate);
    const storage = lockStorage({
      files: { [recordPath]: canonicalizeJson(candidate) },
    });
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeFile: async (path) => {
            if (path === quarantinedRecord) throw new Error("candidate delete");
            return storage.durableFileSystem.removeFile(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it.each(["record", "generation"] as const)(
    "rejects a %s whose no-follow kind changes only during expired cleanup",
    async (target) => {
      const candidate: LockClaimRecord = {
        ...observedRecord,
        claimId: `cleanup-${target}`,
        resource: "admission",
      };
      const recordPath = candidateAdmissionRecord(candidate);
      const quarantinedRecord = quarantinedAdmissionRecord(candidate);
      const quarantinedGeneration = parentDirectory(quarantinedRecord);
      const storage = lockStorage({
        files: { [recordPath]: canonicalizeJson(candidate) },
      });
      const baseInspect = storage.durableFileSystem.inspect;
      let observations = 0;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            inspect: async (path) => {
              if (
                path !==
                (target === "record"
                  ? quarantinedRecord
                  : quarantinedGeneration)
              )
                return baseInspect(path);
              observations += 1;
              // The candidate is observed under its original name before the
              // atomic quarantine rename; this targets cleanup only.
              if (observations < 1) return baseInspect(path);
              return { kind: "special" };
            },
          }),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it("normalizes a candidate cleanup fault whose recovery observation also fails", async () => {
    const candidate: LockClaimRecord = {
      ...observedRecord,
      claimId: "cleanup-reread-fault",
      resource: "admission",
    };
    const recordPath = candidateAdmissionRecord(candidate);
    const quarantinedRecord = quarantinedAdmissionRecord(candidate);
    const quarantinedRoot = parentDirectory(parentDirectory(quarantinedRecord));
    const storage = lockStorage({
      files: { [recordPath]: canonicalizeJson(candidate) },
    });
    const baseInspect = storage.durableFileSystem.inspect;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeFile: async (path) => {
            if (path === quarantinedRecord) throw new Error("candidate delete");
            return storage.durableFileSystem.removeFile(path);
          },
          inspect: async (path) => {
            if (path === quarantinedRoot) throw new Error("candidate reread");
            return baseInspect(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it.each(["root-only", "generation-child"] as const)(
    "contains an expired candidate crash with %s layout",
    async (layout) => {
      const candidate: LockClaimRecord = {
        ...observedRecord,
        claimId: `candidate-${layout}`,
        resource: "admission",
      };
      const recordPath = candidateAdmissionRecord(candidate);
      const generation = parentDirectory(recordPath);
      const root = parentDirectory(generation);
      const storage = lockStorage(
        layout === "root-only"
          ? { directories: [root] }
          : { files: { [`${generation}/unexpected`]: "bad" } },
      );
      const expectation = acquireClaim(projectClaim, services(storage));
      if (layout === "root-only")
        await expect(expectation).resolves.toMatchObject({
          resource: "project",
        });
      else
        await expect(expectation).rejects.toMatchObject({
          reasonCode: "runtime.state_corrupt",
        });
    },
  );

  it("normalizes a raw candidate-record inspection failure after its layout is accepted", async () => {
    const candidate: LockClaimRecord = {
      ...observedRecord,
      claimId: "candidate-inspect-fault",
      resource: "admission",
    };
    const recordPath = candidateAdmissionRecord(candidate);
    const storage = lockStorage({
      files: { [recordPath]: canonicalizeJson(candidate) },
    });
    const baseInspect = storage.durableFileSystem.inspect;
    let observations = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (path !== recordPath || ++observations !== 3)
              return baseInspect(path);
            throw new Error("candidate record reread");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("contains a raw candidate-record read failure after its layout is accepted", async () => {
    const candidate: LockClaimRecord = {
      ...observedRecord,
      claimId: "candidate-read-fault",
      resource: "admission",
    };
    const recordPath = candidateAdmissionRecord(candidate);
    const storage = lockStorage({
      files: { [recordPath]: canonicalizeJson(candidate) },
    });
    const baseRead = storage.durableFileSystem.readText;
    let reads = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          readText: async (path) => {
            if (path !== recordPath || ++reads !== 3) return baseRead(path);
            throw new Error("candidate record read");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("detects a valid but different legacy tombstone during recovery", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "legacy-source",
      resource: "admission",
    };
    const replacement: LockClaimRecord = { ...stale, claimId: "legacy-other" };
    const digest = sha256Digests().sha256(canonicalizeJson(replacement));
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
        [`${lockPaths("project").admissionClaim}/.retired-${digest}.json`]:
          canonicalizeJson(replacement),
      },
    });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("treats a failed empty admission cleanup whose directory remains as internal", async () => {
    const parent = lockPaths("project").admissionClaim;
    const storage = lockStorage({ directories: [parent] });
    const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path === parent) throw new Error("empty parent retained");
            return baseRemove(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("normalizes a legacy admission cleanup reread fault", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "legacy-reread-fault",
      resource: "admission",
    };
    const parent = lockPaths("project").admissionClaim;
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
      },
      directories: [admissionRecoveryMarker(stale)],
    });
    const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
    const baseInspect = storage.durableFileSystem.inspect;
    let failed = false;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path !== parent) return baseRemove(path);
            failed = true;
            throw new Error("legacy remove");
          },
          inspect: async (path) => {
            if (failed && path === parent) throw new Error("legacy reread");
            return baseInspect(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it.each(["generation", "parent"] as const)(
    "contains nonlegacy published cleanup when %s removal loses",
    async (target) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `published-cleanup-${target}`,
        resource: "admission",
      };
      const recordPath = publishedAdmissionRecord(stale);
      const generation = parentDirectory(recordPath);
      const parent = lockPaths("project").admissionClaim;
      const storage = lockStorage({
        files: { [recordPath]: canonicalizeJson(stale) },
        directories: [admissionRecoveryMarker(stale)],
      });
      const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            removeEmptyDirectory: async (path) => {
              if (path !== (target === "generation" ? generation : parent))
                return baseRemove(path);
              throw new Error("published remove");
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          target === "generation"
            ? "runtime.internal_failure"
            : "runtime.recovery_required",
      });
    },
  );

  it.each(["legacy", "generation", "parent"] as const)(
    "fails closed when a retained %s cleanup target becomes special",
    async (target) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `cleanup-special-${target}`,
        resource: "admission",
      };
      const recordPath =
        target === "legacy"
          ? lockPaths("project").admissionRecord
          : publishedAdmissionRecord(stale);
      const generation = parentDirectory(recordPath);
      const removalTarget =
        target === "legacy"
          ? lockPaths("project").admissionClaim
          : target === "generation"
            ? generation
            : lockPaths("project").admissionClaim;
      const storage = lockStorage({
        files: { [recordPath]: canonicalizeJson(stale) },
        directories: [admissionRecoveryMarker(stale)],
      });
      const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
      const baseInspect = storage.durableFileSystem.inspect;
      let failed = false;
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            removeEmptyDirectory: async (path) => {
              if (path !== removalTarget) return baseRemove(path);
              failed = true;
              throw new Error("cleanup retained");
            },
            inspect: async (path) =>
              failed && path === removalTarget
                ? { kind: "special" as const }
                : baseInspect(path),
          }),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it("accepts a legacy admission record beside its own tombstone on inspection", async () => {
    // Retirement links the tombstone before removing the record it retires, so
    // an observer between the two publications sees both. That pair is a
    // retirement in flight rather than a namespace nothing can interpret.
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "legacy-inspection-overlap",
      resource: "admission",
    };
    const digest = sha256Digests().sha256(canonicalizeJson(stale));
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
        [`${lockPaths("project").admissionClaim}/.retired-${digest}.json`]:
          canonicalizeJson(stale),
      },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).resolves.toMatchObject({ kind: "empty" });
  });

  it("rejects a legacy admission record beside a tombstone for another claim", async () => {
    const holder: LockClaimRecord = {
      ...observedRecord,
      claimId: "legacy-inspection-holder",
      resource: "admission",
    };
    const other: LockClaimRecord = {
      ...holder,
      claimId: "legacy-inspection-other",
    };
    const digest = sha256Digests().sha256(canonicalizeJson(other));
    const storage = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(holder),
        [`${lockPaths("project").admissionClaim}/.retired-${digest}.json`]:
          canonicalizeJson(other),
      },
    });
    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("fails closed when a tombstone deletion exposes a different valid tombstone", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "tombstone-source",
      resource: "admission",
    };
    const replacement: LockClaimRecord = {
      ...stale,
      claimId: "tombstone-replacement",
    };
    const recordPath = publishedAdmissionRecord(stale);
    const target = admissionTombstone(stale);
    const replacementTarget = `${parentDirectory(target)}/.retired-${sha256Digests().sha256(
      canonicalizeJson(replacement),
    )}.json`;
    const storage = lockStorage({
      files: { [recordPath]: canonicalizeJson(stale) },
      directories: [admissionRecoveryMarker(stale)],
    });
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseWrite = storage.durableFileSystem.writeSynced;
    let tombstoneRemovals = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeFile: async (path) => {
            if (path !== target || ++tombstoneRemovals !== 1)
              return baseRemove(path);
            await baseRemove(path);
            await baseWrite(replacementTarget, canonicalizeJson(replacement));
            throw new Error("tombstone replaced");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("normalizes an empty admission-parent reread fault after removal fails", async () => {
    const parent = lockPaths("project").admissionClaim;
    const storage = lockStorage({ directories: [parent] });
    const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
    const baseInspect = storage.durableFileSystem.inspect;
    let failed = false;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path !== parent) return baseRemove(path);
            failed = true;
            throw new Error("empty parent remove");
          },
          inspect: async (path) => {
            if (failed && path === parent)
              throw new Error("empty parent reread");
            return baseInspect(path);
          },
        }),
      ),
    ).rejects.toThrow("empty parent reread");
  });

  it("fails closed when an empty admission-parent reread becomes special", async () => {
    const parent = lockPaths("project").admissionClaim;
    const storage = lockStorage({ directories: [parent] });
    const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
    const baseInspect = storage.durableFileSystem.inspect;
    let failed = false;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path !== parent) return baseRemove(path);
            failed = true;
            throw new Error("empty parent remove");
          },
          inspect: async (path) =>
            failed && path === parent
              ? { kind: "special" as const }
              : baseInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("does not delete a published candidate after its parent sync fails", async () => {
    const storage = lockStorage();
    const baseRename = storage.durableFileSystem.renameDirectoryExclusive;
    const baseSync = storage.durableFileSystem.syncDirectory;
    let published = false;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          renameDirectoryExclusive: async (source, target) => {
            await baseRename(source, target);
            published = true;
          },
          syncDirectory: async (path) => {
            if (published && path === ".brain/locks/.admission")
              throw new Error("post-publish sync");
            return baseSync(path);
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "conflict" });
  });

  it("preserves typed cleanup faults at each remaining admission boundary", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "typed-cleanup",
      resource: "admission",
    };
    const legacyParent = lockPaths("project").admissionClaim;
    const legacy = lockStorage({
      files: {
        [lockPaths("project").admissionRecord]: canonicalizeJson(stale),
      },
      directories: [admissionRecoveryMarker(stale)],
    });
    const legacyRemove = legacy.durableFileSystem.removeEmptyDirectory;
    const legacyInspect = legacy.durableFileSystem.inspect;
    let legacyFailed = false;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(legacy, {
          removeEmptyDirectory: async (path) => {
            if (path !== legacyParent) return legacyRemove(path);
            legacyFailed = true;
            throw new Error("force reread");
          },
          inspect: async (path) => {
            if (legacyFailed && path === legacyParent)
              throw new LockFailure("runtime.recovery_required", []);
            return legacyInspect(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });

    const published = lockStorage({
      files: { [publishedAdmissionRecord(stale)]: canonicalizeJson(stale) },
      directories: [admissionRecoveryMarker(stale)],
    });
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(published, {
          removeEmptyDirectory: async (path) => {
            if (path === legacyParent)
              throw new LockFailure("runtime.recovery_required", []);
            return published.durableFileSystem.removeEmptyDirectory(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });

    const empty = lockStorage({ directories: [legacyParent] });
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(empty, {
          removeEmptyDirectory: async (path) => {
            if (path === legacyParent)
              throw new LockFailure("runtime.recovery_required", []);
            return empty.durableFileSystem.removeEmptyDirectory(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
  });

  it("normalizes an expired candidate cleanup reread fault after deletion failure", async () => {
    const candidate: LockClaimRecord = {
      ...observedRecord,
      claimId: "candidate-final-reread",
      resource: "admission",
    };
    const recordPath = candidateAdmissionRecord(candidate);
    const quarantinedRecord = quarantinedAdmissionRecord(candidate);
    const quarantinedRoot = parentDirectory(parentDirectory(quarantinedRecord));
    const storage = lockStorage({
      files: { [recordPath]: canonicalizeJson(candidate) },
    });
    const baseInspect = storage.durableFileSystem.inspect;
    const baseRemove = storage.durableFileSystem.removeFile;
    let removals = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeFile: async (path) => {
            if (path !== quarantinedRecord || ++removals !== 1)
              return baseRemove(path);
            throw new Error("candidate remove");
          },
          inspect: async (path) => {
            if (path === quarantinedRoot && removals === 1)
              throw new Error("candidate reread");
            return baseInspect(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it.each(["raw", "typed"] as const)(
    "contains tombstone listing %s failures after admission lookup",
    async (fault) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `tombstone-list-${fault}`,
        resource: "admission",
      };
      const tombstone = admissionTombstone(stale);
      const generation = parentDirectory(tombstone);
      const storage = lockStorage({
        files: { [tombstone]: canonicalizeJson(stale) },
      });
      const baseList = storage.durableFileSystem.list;
      let lists = 0;
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            list: async (path) => {
              if (path !== generation || ++lists < 4) return baseList(path);
              if (fault === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              throw new Error("tombstone list");
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          fault === "typed"
            ? "runtime.recovery_required"
            : "runtime.internal_failure",
      });
    },
  );

  it.each([
    "namespace-chain",
    "admission-record",
    "admission-candidate",
    "lease-metadata",
    "transaction-residue",
  ] as const)("preserves typed %s port failures", async (boundary) => {
    const typed = new LockFailure("runtime.recovery_required", []);
    if (boundary === "namespace-chain") {
      const storage = lockStorage({ directories: [lockPaths("project").root] });
      const baseInspect = storage.durableFileSystem.inspect;
      let rootInspections = 0;
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            inspect: async (path) => {
              if (path === lockPaths("project").root && ++rootInspections >= 2)
                throw typed;
              return baseInspect(path);
            },
          }),
        ),
      ).rejects.toBe(typed);
      return;
    }
    if (boundary === "admission-record") {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: "typed-admission",
        resource: "admission",
      };
      const record = publishedAdmissionRecord(stale);
      const storage = lockStorage({
        files: { [record]: canonicalizeJson(stale) },
      });
      const baseInspect = storage.durableFileSystem.inspect;
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            inspect: async (path) => {
              if (path === record) throw typed;
              return baseInspect(path);
            },
          }),
        ),
      ).rejects.toBe(typed);
      return;
    }
    if (boundary === "admission-candidate") {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: "typed-candidate",
        resource: "admission",
      };
      const record = candidateAdmissionRecord(stale);
      const storage = lockStorage({
        files: { [record]: canonicalizeJson(stale) },
      });
      const baseInspect = storage.durableFileSystem.inspect;
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            inspect: async (path) => {
              if (path === record) throw typed;
              return baseInspect(path);
            },
          }),
        ),
      ).rejects.toBe(typed);
      return;
    }
    if (boundary === "lease-metadata") {
      const storage = lockStorage({ directories: [lockPaths("project").root] });
      const baseInspect = storage.durableFileSystem.inspect;
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            inspect: async (path) => {
              if (path === lockPaths("project").lease) throw typed;
              return baseInspect(path);
            },
          }),
        ),
      ).rejects.toBe(typed);
      return;
    }
    const storage = expiredClaimStorage();
    const baseInspect = storage.durableFileSystem.inspect;
    await expect(
      recoverClaim(observedClaim, {
        ...services(storage),
        inspectTransactions: async () => [
          {
            transactionId: "tx-typed",
            manifestDigest: null,
            recoveryToken: "token",
            phase: "committed",
            evidenceRef: ".brain/transactions/tx-typed/progress.json",
          },
        ],
        durableFileSystem: {
          ...storage.durableFileSystem,
          inspect: async (path) => {
            if (path.endsWith("/progress.next")) throw typed;
            return baseInspect(path);
          },
        },
      }),
    ).rejects.toBe(typed);
  });

  it.each(["project", "run:run-01"] as const)(
    "validates malformed and partial %s scope candidates",
    async (resource) => {
      const root = lockPaths(resource).root;
      for (const name of [
        `.candidate-0-${"a".repeat(64)}`,
        `.candidate-zero-${"a".repeat(64)}`,
        `.candidate-123-${"A".repeat(64)}`,
        `.quarantine-0-${"a".repeat(64)}`,
        `.quarantine-123-not-a-digest`,
      ]) {
        await expect(
          inspectLease(
            resource,
            services(lockStorage({ directories: [`${root}/${name}`] })),
          ),
        ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      }

      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `partial-${resource}`,
        resource,
      };
      const record = candidateScopeRecord(stale);
      const generation = parentDirectory(record);
      const candidate = parentDirectory(generation);
      await expect(
        inspectLease(
          resource,
          services(lockStorage({ directories: [candidate] })),
        ),
      ).resolves.toMatchObject({ kind: "empty" });
      await expect(
        inspectLease(
          resource,
          services(lockStorage({ directories: [generation] })),
        ),
      ).resolves.toMatchObject({ kind: "empty" });
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "rejects malformed %s scope candidate layouts",
    async (resource) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `candidate-layout-${resource}`,
        resource,
      };
      const record = candidateScopeRecord(stale);
      const generation = parentDirectory(record);
      const candidate = parentDirectory(generation);
      for (const seed of [
        { files: { [candidate]: "bad" } },
        { files: { [`${candidate}/unexpected`]: "bad" } },
        { files: { [generation]: "bad" } },
        { files: { [`${generation}/unexpected`]: "bad" } },
        { directories: [record] },
        { files: { [record]: "not-json" } },
        {
          files: {
            [record]: canonicalizeJson({
              ...stale,
              resource: "run:other",
            }),
          },
        },
      ]) {
        await expect(
          inspectLease(resource, services(lockStorage(seed))),
        ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      }
    },
  );

  it.each(["project"] as const)(
    "rejects malformed %s published scope generations",
    async (resource) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `published-layout-${resource}`,
        resource,
      };
      const record = publishedScopeRecord(stale);
      const generation = parentDirectory(record);
      const claim = parentDirectory(generation);
      const alternate = `${claim}/.claim-123-${"a".repeat(64)}`;
      for (const seed of [
        { directories: [generation, alternate] },
        { directories: [`${claim}/unexpected`] },
        {
          directories: [
            `${claim}/.claim-0-${sha256Digests().sha256(canonicalizeJson(stale))}`,
          ],
        },
        { files: { [generation]: "bad" } },
        { files: { [`${generation}/unexpected`]: "bad" } },
        { directories: [record] },
        { files: { [record]: "not-json" } },
        {
          files: {
            [record]: canonicalizeJson({
              ...stale,
              resource: "run:other",
            }),
          },
        },
      ]) {
        await expect(
          inspectLease(resource, services(lockStorage(seed))),
        ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "removes every partial expired %s scope candidate form",
    async (resource) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `partial-cleanup-${resource}`,
        resource,
      };
      const candidateRecord = candidateScopeRecord(stale);
      const quarantineRecord = quarantinedScopeRecord(stale);
      for (const directory of [
        parentDirectory(parentDirectory(candidateRecord)),
        parentDirectory(candidateRecord),
        parentDirectory(parentDirectory(quarantineRecord)),
        parentDirectory(quarantineRecord),
      ]) {
        const storage = lockStorage({ directories: [directory] });
        await expect(
          acquireClaim(
            { resource, owner: "codex:session-01", observed: null },
            services(storage),
          ),
        ).resolves.toMatchObject({ resource });
        expect(storage.snapshot().directories).not.toContain(directory);
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "contains raw and typed %s scope enumeration faults",
    async (resource) => {
      for (const fault of ["raw", "typed"] as const) {
        const storage = lockStorage();
        const baseList = storage.durableFileSystem.list;
        const root = lockPaths(resource).root;
        let rootLists = 0;
        const failure =
          fault === "typed"
            ? new LockFailure("runtime.recovery_required", [])
            : new Error("scope list");
        await expect(
          acquireClaim(
            { resource, owner: "codex:session-01", observed: null },
            withDurable(storage, {
              list: async (path) => {
                if (path === root) {
                  rootLists++;
                }
                if (path === root && rootLists >= 2) throw failure;
                return baseList(path);
              },
            }),
          ),
        ).rejects.toMatchObject({
          reasonCode:
            fault === "typed"
              ? "runtime.recovery_required"
              : "runtime.internal_failure",
        });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "classifies delayed %s generation removal outcomes",
    async (resource) => {
      for (const outcome of [
        "typed",
        "lost",
        "special",
        "directory",
      ] as const) {
        const storage = lockStorage();
        const claimed = acquiredClaim(
          await acquireClaim(
            { resource, owner: "codex:session-01", observed: null },
            services(storage),
          ),
        );
        const generation = parentDirectory(publishedScopeRecord(claimed));
        const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
        const baseInspect = storage.durableFileSystem.inspect;
        let failed = false;
        const result = releaseClaim(
          { resource, observed: claimed },
          withDurable(storage, {
            removeEmptyDirectory: async (path) => {
              if (path !== generation) return baseRemove(path);
              failed = true;
              if (outcome === "lost") await baseRemove(path);
              if (outcome === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              throw new Error(`generation ${outcome}`);
            },
            inspect: async (path) => {
              if (failed && path === generation && outcome === "special")
                return { kind: "special" as const };
              return baseInspect(path);
            },
          }),
        );
        if (outcome === "lost")
          await expect(result).resolves.toEqual({ kind: "released" });
        else
          await expect(result).rejects.toMatchObject({
            reasonCode:
              outcome === "typed"
                ? "runtime.recovery_required"
                : outcome === "special"
                  ? "runtime.state_corrupt"
                  : "runtime.internal_failure",
          });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "classifies delayed %s claim-parent removal outcomes",
    async (resource) => {
      for (const outcome of [
        "typed",
        "lost",
        "directory",
        "special",
      ] as const) {
        const storage = lockStorage();
        const claimed = acquiredClaim(
          await acquireClaim(
            { resource, owner: "codex:session-01", observed: null },
            services(storage),
          ),
        );
        const parent = lockPaths(resource).claim;
        const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
        const baseInspect = storage.durableFileSystem.inspect;
        let failed = false;
        const result = releaseClaim(
          { resource, observed: claimed },
          withDurable(storage, {
            removeEmptyDirectory: async (path) => {
              if (path !== parent) return baseRemove(path);
              failed = true;
              if (outcome === "lost") await baseRemove(path);
              if (outcome === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              throw new Error(`parent ${outcome}`);
            },
            inspect: async (path) => {
              if (failed && path === parent && outcome === "special")
                return { kind: "special" as const };
              return baseInspect(path);
            },
          }),
        );
        if (outcome === "lost" || outcome === "directory")
          await expect(result).resolves.toEqual({ kind: "released" });
        else
          await expect(result).rejects.toMatchObject({
            reasonCode:
              outcome === "typed"
                ? "runtime.recovery_required"
                : "runtime.state_corrupt",
          });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "fails closed on second-pass %s claim mutations",
    async (resource) => {
      const record: LockClaimRecord = {
        ...observedRecord,
        claimId: `second-pass-${resource}`,
        resource,
      };
      const target = publishedScopeRecord(record);
      for (const mutation of [
        "kind",
        "json",
        "identity",
        "location",
        "raw",
        "typed",
      ] as const) {
        const storage = lockStorage({
          files: { [target]: canonicalizeJson(record) },
        });
        const baseInspect = storage.durableFileSystem.inspect;
        const baseRead = storage.durableFileSystem.readText;
        let inspections = 0;
        let reads = 0;
        const result = inspectLease(
          resource,
          withDurable(storage, {
            inspect: async (path) => {
              if (path === target && ++inspections >= 3) {
                if (mutation === "kind") return { kind: "directory" as const };
                if (mutation === "raw") throw new Error("second inspect");
                if (mutation === "typed")
                  throw new LockFailure("runtime.recovery_required", []);
              }
              return baseInspect(path);
            },
            readText: async (path) => {
              const text = await baseRead(path);
              if (path !== target || ++reads < 3) return text;
              if (mutation === "json") return "not-json";
              if (mutation === "identity")
                return canonicalizeJson({
                  ...record,
                  resource: resource === "project" ? "run:other" : "project",
                });
              if (mutation === "location")
                return canonicalizeJson({ ...record, claimId: "changed" });
              return text;
            },
          }),
        );
        await expect(result).rejects.toMatchObject({
          reasonCode:
            mutation === "raw"
              ? "runtime.internal_failure"
              : mutation === "typed"
                ? "runtime.recovery_required"
                : "runtime.state_corrupt",
        });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "rejects noncanonical %s generation epochs",
    async (resource) => {
      const claim = lockPaths(resource).claim;
      await expect(
        inspectLease(
          resource,
          services(
            lockStorage({
              directories: [`${claim}/.claim-0123-${"a".repeat(64)}`],
            }),
          ),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it.each(["raw", "typed"] as const)(
    "contains %s scope candidate validation faults",
    async (fault) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `scope-validation-${fault}`,
      };
      const target = candidateScopeRecord(stale);
      const storage = lockStorage({
        files: { [target]: canonicalizeJson(stale) },
      });
      const baseRead = storage.durableFileSystem.readText;
      const failure =
        fault === "typed"
          ? new LockFailure("runtime.recovery_required", [])
          : new Error("candidate read");
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            readText: async (path) => {
              if (path === target) throw failure;
              return baseRead(path);
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          fault === "typed"
            ? "runtime.recovery_required"
            : "runtime.internal_failure",
      });
    },
  );

  it.each(["raw", "typed"] as const)(
    "contains %s admission candidate layout faults",
    async (fault) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `admission-layout-${fault}`,
        resource: "admission",
      };
      const target = candidateAdmissionRecord(stale);
      const generation = parentDirectory(target);
      const storage = lockStorage({
        files: { [target]: canonicalizeJson(stale) },
      });
      const baseList = storage.durableFileSystem.list;
      const failure =
        fault === "typed"
          ? new LockFailure("runtime.recovery_required", [])
          : new Error("candidate generation list");
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            list: async (path) => {
              if (path === generation) throw failure;
              return baseList(path);
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          fault === "typed"
            ? "runtime.recovery_required"
            : "runtime.internal_failure",
      });
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "contains every expired %s scope cleanup fault",
    async (resource) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `cleanup-fault-${resource}`,
        resource,
      };
      for (const outcome of [
        "lost",
        "typed",
        "raw",
        "reread-typed",
        "reread-raw",
        "record-special",
        "generation-special",
      ] as const) {
        const record =
          outcome === "lost"
            ? candidateScopeRecord(stale)
            : quarantinedScopeRecord(stale);
        const cleanupRecord = quarantinedScopeRecord(stale);
        const generation = parentDirectory(record);
        const candidate = parentDirectory(generation);
        const storage = lockStorage({
          files: { [record]: canonicalizeJson(stale) },
        });
        const baseRemove = storage.durableFileSystem.removeFile;
        const baseInspect = storage.durableFileSystem.inspect;
        let cleanupFailed = false;
        let inspections = 0;
        const result = acquireClaim(
          { resource, owner: "codex:session-01", observed: null },
          withDurable(storage, {
            removeFile: async (path) => {
              if (path !== cleanupRecord) return baseRemove(path);
              cleanupFailed = true;
              if (outcome === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              if (
                ["lost", "raw", "reread-typed", "reread-raw"].includes(outcome)
              )
                throw new Error("cleanup remove");
              return baseRemove(path);
            },
            inspect: async (path) => {
              if (cleanupFailed && path === candidate) {
                if (outcome === "reread-typed")
                  throw new LockFailure("runtime.recovery_required", []);
                if (outcome === "reread-raw") throw new Error("cleanup reread");
              }
              if (
                path === record &&
                outcome === "record-special" &&
                ++inspections >= 3
              )
                return { kind: "special" as const };
              if (
                path === generation &&
                outcome === "generation-special" &&
                ++inspections >= 3
              )
                return { kind: "special" as const };
              return baseInspect(path);
            },
          }),
        );
        if (outcome === "lost") await expect(result).resolves.toBeDefined();
        else
          await expect(result).rejects.toMatchObject({
            reasonCode:
              outcome === "typed" || outcome === "reread-typed"
                ? "runtime.recovery_required"
                : outcome.endsWith("special")
                  ? "runtime.state_corrupt"
                  : "runtime.internal_failure",
          });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "classifies %s release record races and mutations",
    async (resource) => {
      for (const outcome of ["missing", "special", "bytes"] as const) {
        const storage = lockStorage();
        const claimed = acquiredClaim(
          await acquireClaim(
            { resource, owner: "codex:session-01", observed: null },
            services(storage),
          ),
        );
        const target = publishedScopeRecord(claimed);
        const baseInspect = storage.durableFileSystem.inspect;
        const baseRead = storage.durableFileSystem.readText;
        let inspections = 0;
        let reads = 0;
        const result = releaseClaim(
          { resource, observed: claimed },
          withDurable(storage, {
            inspect: async (path) => {
              if (
                path === target &&
                ++inspections >= (resource === "project" ? 6 : 8)
              ) {
                if (outcome === "missing") return { kind: "missing" as const };
                if (outcome === "special") return { kind: "special" as const };
              }
              return baseInspect(path);
            },
            readText: async (path) => {
              const text = await baseRead(path);
              if (path === target && ++reads >= 4 && outcome === "bytes")
                return `${text}\n`;
              return text;
            },
          }),
        );
        if (outcome === "missing")
          await expect(result).resolves.toEqual({ kind: "absent" });
        else
          await expect(result).rejects.toMatchObject({
            reasonCode: "runtime.state_corrupt",
          });
      }
    },
  );

  it("rejects a special namespace component and contains a raw scope-root listing fault", async () => {
    const special = lockStorage({
      directories: [lockPaths("run:run-01").root],
    });
    const specialInspect = special.durableFileSystem.inspect;
    let brainInspections = 0;
    await expect(
      inspectLease(
        "run:run-01",
        withDurable(special, {
          inspect: async (path) =>
            path === ".brain" && ++brainInspections >= 2
              ? { kind: "special" as const }
              : specialInspect(path),
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });

    const raw = lockStorage({ directories: [lockPaths("project").root] });
    const rawList = raw.durableFileSystem.list;
    await expect(
      inspectLease(
        "project",
        withDurable(raw, {
          list: async (path) => {
            if (path === lockPaths("project").root)
              throw new Error("scope root list");
            return rawList(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it.each(["removed", "lost", "special"] as const)(
    "rejects a legacy root admission recovery artifact in %s form",
    async (outcome) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `orphan-generation-${outcome}`,
        resource: "admission",
      };
      const rootMarker = admissionRecoveryMarker(stale);
      const storage =
        outcome === "special"
          ? lockStorage({ files: { [rootMarker]: "legacy" } })
          : outcome === "lost"
            ? lockStorage({ files: { [`${rootMarker}/unexpected`]: "legacy" } })
            : lockStorage({ directories: [rootMarker] });
      const result = inspectLease("project", services(storage));
      if (outcome === "removed")
        await expect(result).resolves.toMatchObject({ kind: "empty" });
      else
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.state_corrupt",
        });
    },
  );

  it.each(["empty", "marker"] as const)(
    "recovers an %s empty admission generation",
    async (layout) => {
      const digest = "a".repeat(64);
      const generation = `${lockPaths("project").admissionClaim}/.claim-${digest}`;
      const marker = `${generation}/.cleanup-${digest}`;
      const storage = lockStorage({
        directories: layout === "marker" ? [marker] : [generation],
      });
      await expect(
        acquireClaim(projectClaim, services(storage)),
      ).resolves.toMatchObject({
        resource: "project",
      });
      expect(storage.snapshot().directories).not.toContain(generation);
      expect(storage.snapshot().directories).not.toContain(marker);
    },
  );

  it.each(["typed", "lost", "present"] as const)(
    "classifies empty admission marker cleanup %s races",
    async (outcome) => {
      const digest = "b".repeat(64);
      const generation = `${lockPaths("project").admissionClaim}/.claim-${digest}`;
      const marker = `${generation}/.cleanup-${digest}`;
      const storage = lockStorage({ directories: [marker] });
      const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path !== marker) return baseRemove(path);
            if (outcome === "lost") await baseRemove(path);
            if (outcome === "typed")
              throw new LockFailure("runtime.recovery_required", []);
            throw new Error("empty admission marker");
          },
        }),
      );
      if (outcome === "lost") await expect(result).resolves.toBeDefined();
      else
        await expect(result).rejects.toMatchObject({
          reasonCode:
            outcome === "typed"
              ? "runtime.recovery_required"
              : "runtime.internal_failure",
        });
    },
  );

  it.each(["lost", "typed-reread", "raw-reread"] as const)(
    "contains an admission candidate cleanup %s race",
    async (outcome) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `admission-cleanup-${outcome}`,
        resource: "admission",
      };
      const original = candidateAdmissionRecord(stale);
      const quarantine = quarantinedAdmissionRecord(stale);
      const quarantineRoot = parentDirectory(parentDirectory(quarantine));
      const storage = lockStorage({
        files: { [original]: canonicalizeJson(stale) },
      });
      const baseInspect = storage.durableFileSystem.inspect;
      const baseRemoveDirectory =
        storage.durableFileSystem.removeEmptyDirectory;
      let failed = false;
      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path !== quarantineRoot) return baseRemoveDirectory(path);
            await baseRemoveDirectory(path);
            failed = true;
            throw new Error("admission cleanup");
          },
          inspect: async (path) => {
            if (failed && path === quarantineRoot) {
              if (outcome === "typed-reread")
                throw new LockFailure("runtime.recovery_required", []);
              if (outcome === "raw-reread") throw new Error("admission reread");
            }
            return baseInspect(path);
          },
        }),
      );
      if (outcome === "lost") await expect(result).resolves.toBeDefined();
      else
        await expect(result).rejects.toMatchObject({
          reasonCode:
            outcome === "typed-reread"
              ? "runtime.recovery_required"
              : "runtime.internal_failure",
        });
    },
  );

  it("leaves an unexpired scope candidate for a later contender", async () => {
    const future: LockClaimRecord = {
      ...observedRecord,
      claimId: "future-candidate",
      expiresAt: "2026-08-11T00:03:00.000Z",
    };
    const record = candidateScopeRecord(future);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(future) },
    });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toBeDefined();
    expect(storage.snapshot().files[record]).toBe(canonicalizeJson(future));
  });

  it.each(["project", "run:run-01"] as const)(
    "closes malformed %s scope recovery marker layouts",
    async (resource) => {
      const root = lockPaths(resource).root;
      for (const name of [
        `.recovery-0-${"a".repeat(64)}`,
        `.recovery-0123-${"a".repeat(64)}`,
        `.recovery-123-${"A".repeat(64)}`,
      ]) {
        await expect(
          inspectLease(
            resource,
            services(lockStorage({ directories: [`${root}/${name}`] })),
          ),
        ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      }
      const first = `.recovery-123-${"a".repeat(64)}`;
      const second = `.recovery-124-${"b".repeat(64)}`;
      await expect(
        inspectLease(
          resource,
          services(
            lockStorage({
              directories: [`${root}/${first}`, `${root}/${second}`],
            }),
          ),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      await expect(
        inspectLease(
          resource,
          services(lockStorage({ files: { [`${root}/${first}`]: "bad" } })),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      await expect(
        inspectLease(
          resource,
          services(
            lockStorage({ files: { [`${root}/${first}/unexpected`]: "bad" } }),
          ),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it.each(["raw", "typed"] as const)(
    "contains %s scope recovery marker port faults",
    async (fault) => {
      const storage = lockStorage({ directories: [lockPaths("project").root] });
      const baseList = storage.durableFileSystem.list;
      const failure =
        fault === "typed"
          ? new LockFailure("runtime.recovery_required", [])
          : new Error("marker list");
      await expect(
        inspectLease(
          "project",
          withDurable(storage, {
            list: async (path) => {
              if (path === lockPaths("project").root) throw failure;
              return baseList(path);
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          fault === "typed"
            ? "runtime.recovery_required"
            : "runtime.internal_failure",
      });
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "rejects mutated %s recovery records",
    async (resource) => {
      for (const mutation of ["json", "identity", "special"] as const) {
        const fixture = await scopeRecoveryFixture(resource);
        const baseRead = fixture.storage.durableFileSystem.readText;
        const baseInspect = fixture.storage.durableFileSystem.inspect;
        await expect(
          releaseClaim(
            { resource, observed: fixture.claim },
            withDurable(fixture.storage, {
              readText: async (path) => {
                if (path !== fixture.record) return baseRead(path);
                if (mutation === "json") return "not-json";
                if (mutation === "identity")
                  return canonicalizeJson({
                    ...fixture.claim,
                    resource: resource === "project" ? "run:other" : "project",
                  });
                return baseRead(path);
              },
              inspect: async (path) =>
                path === fixture.record && mutation === "special"
                  ? { kind: "special" as const }
                  : baseInspect(path),
            }),
          ),
        ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "resumes a %s cleanup with missing record or generation",
    async (resource) => {
      for (const missing of ["record", "generation"] as const) {
        const fixture = await scopeRecoveryFixture(resource);
        await fixture.storage.durableFileSystem.removeFile(fixture.record);
        if (missing === "generation") {
          await fixture.storage.durableFileSystem.removeEmptyDirectory(
            fixture.marker,
          );
          await fixture.storage.durableFileSystem.removeEmptyDirectory(
            fixture.generation,
          );
        }
        await expect(
          releaseClaim(
            { resource, observed: fixture.claim },
            services(fixture.storage),
          ),
        ).resolves.toEqual({
          kind: missing === "record" ? "released" : "absent",
        });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "classifies %s recovery generation cleanup faults",
    async (resource) => {
      for (const outcome of [
        "typed",
        "lost",
        "special",
        "directory",
      ] as const) {
        const fixture = await scopeRecoveryFixture(resource);
        const baseRemove =
          fixture.storage.durableFileSystem.removeEmptyDirectory;
        const baseInspect = fixture.storage.durableFileSystem.inspect;
        let failed = false;
        const result = releaseClaim(
          { resource, observed: fixture.claim },
          withDurable(fixture.storage, {
            removeEmptyDirectory: async (path) => {
              if (path !== fixture.generation) return baseRemove(path);
              failed = true;
              if (outcome === "lost") await baseRemove(path);
              if (outcome === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              throw new Error("generation cleanup");
            },
            inspect: async (path) => {
              if (
                failed &&
                path === fixture.generation &&
                outcome === "special"
              )
                return { kind: "special" as const };
              return baseInspect(path);
            },
          }),
        );
        if (outcome === "lost")
          await expect(result).resolves.toEqual({ kind: "released" });
        else
          await expect(result).rejects.toMatchObject({
            reasonCode:
              outcome === "typed"
                ? "runtime.recovery_required"
                : outcome === "special"
                  ? "runtime.state_corrupt"
                  : "runtime.internal_failure",
          });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "classifies %s recovery parent cleanup faults",
    async (resource) => {
      for (const outcome of [
        "typed",
        "lost",
        "directory",
        "special",
      ] as const) {
        const fixture = await scopeRecoveryFixture(resource);
        const baseRemove =
          fixture.storage.durableFileSystem.removeEmptyDirectory;
        const baseInspect = fixture.storage.durableFileSystem.inspect;
        let failed = false;
        const result = releaseClaim(
          { resource, observed: fixture.claim },
          withDurable(fixture.storage, {
            removeEmptyDirectory: async (path) => {
              if (path !== fixture.parent) return baseRemove(path);
              failed = true;
              if (outcome === "lost") await baseRemove(path);
              if (outcome === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              throw new Error("parent cleanup");
            },
            inspect: async (path) => {
              if (failed && path === fixture.parent && outcome === "special")
                return { kind: "special" as const };
              return baseInspect(path);
            },
          }),
        );
        if (outcome === "lost" || outcome === "directory")
          await expect(result).resolves.toEqual({ kind: "released" });
        else
          await expect(result).rejects.toMatchObject({
            reasonCode:
              outcome === "typed"
                ? "runtime.recovery_required"
                : "runtime.state_corrupt",
          });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "classifies %s recovery marker cleanup faults",
    async (resource) => {
      for (const outcome of [
        "typed",
        "lost",
        "present",
        "reread-typed",
        "reread-raw",
      ] as const) {
        const fixture = await scopeRecoveryFixture(resource);
        const baseRemove =
          fixture.storage.durableFileSystem.removeEmptyDirectory;
        const baseInspect = fixture.storage.durableFileSystem.inspect;
        let failed = false;
        const result = releaseClaim(
          { resource, observed: fixture.claim },
          withDurable(fixture.storage, {
            removeEmptyDirectory: async (path) => {
              if (path !== fixture.marker) return baseRemove(path);
              failed = true;
              if (outcome === "lost") await baseRemove(path);
              if (outcome === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              throw new Error("marker cleanup");
            },
            inspect: async (path) => {
              if (failed && path === fixture.marker) {
                if (outcome === "reread-typed")
                  throw new LockFailure("runtime.recovery_required", []);
                if (outcome === "reread-raw") throw new Error("marker reread");
              }
              return baseInspect(path);
            },
          }),
        );
        if (outcome === "lost")
          await expect(result).resolves.toEqual({ kind: "released" });
        else
          await expect(result).rejects.toMatchObject({
            reasonCode:
              outcome === "typed" || outcome === "reread-typed"
                ? "runtime.recovery_required"
                : "runtime.internal_failure",
          });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "recovers a pending %s cleanup marker",
    async (resource) => {
      const fixture = await scopeRecoveryFixture(resource);
      await expect(
        recoverClaim(
          {
            resource,
            owner: "codex:session-02",
            observed: fixture.claim,
          },
          services(fixture.storage),
        ),
      ).resolves.toEqual({ kind: "recovered" });
    },
  );

  it.each(["special", "nonempty"] as const)(
    "rejects a scope marker changed on its second %s validation",
    async (mutation) => {
      const fixture = await scopeRecoveryFixture("project");
      const baseInspect = fixture.storage.durableFileSystem.inspect;
      const baseList = fixture.storage.durableFileSystem.list;
      let inspections = 0;
      let lists = 0;
      await expect(
        inspectLease(
          "project",
          withDurable(fixture.storage, {
            inspect: async (path) => {
              if (
                path === fixture.marker &&
                ++inspections >= 3 &&
                mutation === "special"
              )
                return { kind: "special" as const };
              return baseInspect(path);
            },
            list: async (path) => {
              const names = await baseList(path);
              if (
                path === fixture.marker &&
                ++lists >= 2 &&
                mutation === "nonempty"
              )
                return ["unexpected"];
              return names;
            },
          }),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "rejects a special %s scope recovery generation",
    async (resource) => {
      const fixture = await scopeRecoveryFixture(resource);
      await fixture.storage.durableFileSystem.removeFile(fixture.record);
      const baseInspect = fixture.storage.durableFileSystem.inspect;
      await expect(
        releaseClaim(
          { resource, observed: fixture.claim },
          withDurable(fixture.storage, {
            inspect: async (path) =>
              path === fixture.generation
                ? { kind: "special" as const }
                : baseInspect(path),
          }),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it("normalizes a raw scope marker publication failure", async () => {
    const storage = lockStorage();
    const claim = acquiredClaim(
      await acquireClaim(projectClaim, services(storage)),
    );
    const marker = scopeRecoveryMarker(claim);
    const baseCreate = storage.durableFileSystem.createDirectoryExclusive;
    await expect(
      releaseClaim(
        { resource: "project", observed: claim },
        withDurable(storage, {
          createDirectoryExclusive: async (path) => {
            if (path === marker) throw new Error("marker publish");
            return baseCreate(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
  });

  it("rejects a verified fingerprint that is not bound to its marker", async () => {
    const storage = lockStorage();
    const claim = acquiredClaim(
      await acquireClaim(projectClaim, services(storage)),
    );
    const record = publishedScopeRecord(claim);
    const fakeSha256 = "f".repeat(64);
    const observed = {
      ...claim,
      fingerprint: { ...claim.fingerprint, sha256: fakeSha256 },
    };
    const baseInspect = storage.durableFileSystem.inspect;
    let inspections = 0;
    await expect(
      releaseClaim(
        { resource: "project", observed },
        withDurable(storage, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (path === record && entry.kind === "file") inspections++;
            return path === record && entry.kind === "file" && inspections >= 6
              ? { ...entry, sha256: fakeSha256 }
              : entry;
          },
        }),
      ),
    ).resolves.toMatchObject({ kind: "conflict" });
  });

  it.each(["content", "verified"] as const)(
    "detects a %s mutation during marker election",
    async (mutation) => {
      const storage = lockStorage();
      const claim = acquiredClaim(
        await acquireClaim(projectClaim, services(storage)),
      );
      const record = publishedScopeRecord(claim);
      const baseInspect = storage.durableFileSystem.inspect;
      const baseRead = storage.durableFileSystem.readText;
      let inspections = 0;
      let reads = 0;
      const result = releaseClaim(
        { resource: "project", observed: claim },
        withDurable(storage, {
          inspect: async (path) => {
            const entry = await baseInspect(path);
            if (path !== record || entry.kind !== "file") return entry;
            inspections++;
            return mutation === "verified" && inspections >= 6
              ? { ...entry, sha256: "e".repeat(64) }
              : entry;
          },
          readText: async (path) => {
            const text = await baseRead(path);
            if (path === record) reads++;
            return mutation === "content" && path === record && reads >= 5
              ? `${text}\n`
              : text;
          },
        }),
      );
      if (mutation === "content")
        await expect(result).rejects.toMatchObject({
          reasonCode: "runtime.state_corrupt",
        });
      else await expect(result).resolves.toMatchObject({ kind: "conflict" });
    },
  );

  it("returns absent when its elected scope marker disappears", async () => {
    const fixture = await scopeRecoveryFixture("project");
    const baseList = fixture.storage.durableFileSystem.list;
    let markerListings = 0;
    await expect(
      releaseClaim(
        { resource: "project", observed: fixture.claim },
        withDurable(fixture.storage, {
          list: async (path) => {
            const names = await baseList(path);
            const markerParent = parentDirectory(fixture.marker);
            if (
              path === markerParent &&
              names.includes(fixture.marker.slice(markerParent.length + 1))
            ) {
              markerListings++;
            }
            return path === markerParent && markerListings === 6
              ? names.filter(
                  (name) =>
                    name !== fixture.marker.slice(markerParent.length + 1),
                )
              : names;
          },
        }),
      ),
    ).resolves.toEqual({ kind: "released" });
  });

  it("preserves a typed failure in the final namespace chain", async () => {
    const storage = lockStorage({
      directories: [lockPaths("run:run-01").root],
    });
    const baseInspect = storage.durableFileSystem.inspect;
    let brainInspections = 0;
    const typed = new LockFailure("runtime.recovery_required", []);
    await expect(
      inspectLease(
        "run:run-01",
        withDurable(storage, {
          inspect: async (path) => {
            if (path === ".brain" && ++brainInspections >= 2) throw typed;
            return baseInspect(path);
          },
        }),
      ),
    ).rejects.toBe(typed);
  });

  it("rejects a scope root that changes kind during marker lookup", async () => {
    const root = lockPaths("project").root;
    const storage = lockStorage({ directories: [root] });
    const baseInspect = storage.durableFileSystem.inspect;
    let rootInspections = 0;
    await expect(
      inspectLease(
        "project",
        withDurable(storage, {
          inspect: async (path) => {
            if (path === root && ++rootInspections >= 2)
              return { kind: "special" as const };
            return baseInspect(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it.each(["project", "run:run-01"] as const)(
    "closes nested %s cleanup marker layouts",
    async (resource) => {
      const claim: LockClaimRecord = {
        ...observedRecord,
        claimId: `nested-layout-${resource}`,
        resource,
      };
      const record = publishedScopeRecord(claim);
      const generation = parentDirectory(record);
      const parent = parentDirectory(generation);
      const marker = scopeRecoveryMarker(claim);
      const wrong = `${generation}/.cleanup-${"f".repeat(64)}`;
      const secondGeneration = `${parent}/.claim-123-${"a".repeat(64)}`;
      for (const seed of [
        { directories: [generation, secondGeneration] },
        { directories: [`${parent}/unexpected`] },
        { files: { [marker]: "special" } },
        { files: { [`${marker}/unexpected`]: "bad" } },
        { directories: [wrong] },
        {
          directories: [marker, `${generation}/.cleanup-${"e".repeat(64)}`],
        },
      ]) {
        await expect(
          inspectLease(resource, services(lockStorage(seed))),
        ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
      }
      const digest = marker.slice(marker.lastIndexOf("-") + 1);
      await expect(
        inspectLease(
          resource,
          services(
            lockStorage({
              directories: [
                `${parent}/.claim-0${String(Date.parse(claim.expiresAt))}-${digest}/.cleanup-${digest}`,
              ],
            }),
          ),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it.each(["special", "nonempty", "duplicate"] as const)(
    "closes %s admission cleanup marker layouts",
    async (layout) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `admission-cleanup-layout-${layout}`,
        resource: "admission",
      };
      const record = publishedAdmissionRecord(stale);
      const marker = admissionCleanupMarker(stale);
      const storage =
        layout === "special"
          ? lockStorage({
              files: { [record]: canonicalizeJson(stale), [marker]: "bad" },
            })
          : layout === "nonempty"
            ? lockStorage({
                files: {
                  [record]: canonicalizeJson(stale),
                  [`${marker}/unexpected`]: "bad",
                },
              })
            : lockStorage({
                files: { [record]: canonicalizeJson(stale) },
                directories: [
                  marker,
                  `${parentDirectory(marker)}/.cleanup-${"f".repeat(64)}`,
                ],
              });
      await expect(
        inspectLease("project", services(storage)),
      ).rejects.toMatchObject({
        reasonCode: "runtime.state_corrupt",
      });
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "recovers an empty nested %s claim generation",
    async (resource) => {
      const fixture = await scopeRecoveryFixture(resource);
      await fixture.storage.durableFileSystem.removeEmptyDirectory(
        fixture.marker,
      );
      await fixture.storage.durableFileSystem.removeFile(fixture.record);
      await fixture.storage.durableFileSystem.removeEmptyDirectory(
        fixture.generation,
      );
      await expect(
        releaseClaim(
          { resource, observed: fixture.claim },
          services(fixture.storage),
        ),
      ).resolves.toEqual({ kind: "absent" });
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "classifies empty %s generation cleanup races",
    async (resource) => {
      for (const outcome of [
        "typed",
        "lost",
        "special",
        "directory",
      ] as const) {
        const fixture = await scopeRecoveryFixture(resource);
        await fixture.storage.durableFileSystem.removeEmptyDirectory(
          fixture.marker,
        );
        const baseRemoveFile = fixture.storage.durableFileSystem.removeFile;
        const baseRemove =
          fixture.storage.durableFileSystem.removeEmptyDirectory;
        const baseInspect = fixture.storage.durableFileSystem.inspect;
        let failed = false;
        let recordInspections = 0;
        const result = releaseClaim(
          { resource, observed: fixture.claim },
          withDurable(fixture.storage, {
            removeEmptyDirectory: async (path) => {
              if (path !== fixture.generation) return baseRemove(path);
              failed = true;
              if (outcome === "lost") await baseRemove(path);
              if (outcome === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              throw new Error("empty generation cleanup");
            },
            inspect: async (path) => {
              if (
                path === fixture.record &&
                ++recordInspections >= (resource === "project" ? 3 : 4)
              ) {
                await baseRemoveFile(path);
                return { kind: "missing" as const };
              }
              if (
                failed &&
                path === fixture.generation &&
                outcome === "special"
              )
                return { kind: "special" as const };
              return baseInspect(path);
            },
          }),
        );
        if (outcome === "lost")
          await expect(result).resolves.toEqual({ kind: "absent" });
        else
          await expect(result).rejects.toMatchObject({
            reasonCode:
              outcome === "typed"
                ? "runtime.recovery_required"
                : outcome === "special"
                  ? "runtime.state_corrupt"
                  : "runtime.internal_failure",
          });
      }
    },
  );

  it.each(["project", "run:run-01"] as const)(
    "classifies empty %s claim-parent cleanup races",
    async (resource) => {
      for (const outcome of [
        "typed",
        "lost",
        "directory",
        "special",
      ] as const) {
        const fixture = await scopeRecoveryFixture(resource);
        await fixture.storage.durableFileSystem.removeEmptyDirectory(
          fixture.marker,
        );
        const baseRemoveFile = fixture.storage.durableFileSystem.removeFile;
        const baseRemove =
          fixture.storage.durableFileSystem.removeEmptyDirectory;
        const baseInspect = fixture.storage.durableFileSystem.inspect;
        let failed = false;
        let recordInspections = 0;
        const result = releaseClaim(
          { resource, observed: fixture.claim },
          withDurable(fixture.storage, {
            removeEmptyDirectory: async (path) => {
              if (path !== fixture.parent) return baseRemove(path);
              failed = true;
              if (outcome === "lost") await baseRemove(path);
              if (outcome === "typed")
                throw new LockFailure("runtime.recovery_required", []);
              throw new Error("empty parent cleanup");
            },
            inspect: async (path) => {
              if (
                path === fixture.record &&
                ++recordInspections >= (resource === "project" ? 3 : 4)
              ) {
                await baseRemoveFile(path);
                return { kind: "missing" as const };
              }
              if (failed && path === fixture.parent && outcome === "special")
                return { kind: "special" as const };
              return baseInspect(path);
            },
          }),
        );
        if (outcome === "lost" || outcome === "directory")
          await expect(result).resolves.toEqual({ kind: "released" });
        else
          await expect(result).rejects.toMatchObject({
            reasonCode:
              outcome === "typed"
                ? "runtime.recovery_required"
                : "runtime.state_corrupt",
          });
      }
    },
  );

  it("completes a nested admission cleanup marker", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "nested-admission-cleanup",
      resource: "admission",
    };
    const record = publishedAdmissionRecord(stale);
    const marker = admissionCleanupMarker(stale);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
      directories: [marker],
    });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).resolves.toBeDefined();
    expect(storage.snapshot().directories).not.toContain(marker);
  });

  it.each(["duplicate", "digest", "raw", "typed"] as const)(
    "contains a second-pass %s scope cleanup marker mutation",
    async (mutation) => {
      const fixture = await scopeRecoveryFixture("project");
      const baseList = fixture.storage.durableFileSystem.list;
      let generationLists = 0;
      const wrong = `.cleanup-${"f".repeat(64)}`;
      const typed = new LockFailure("runtime.recovery_required", []);
      await expect(
        inspectLease(
          "project",
          withDurable(fixture.storage, {
            list: async (path) => {
              const names = await baseList(path);
              if (path !== fixture.generation) return names;
              generationLists++;
              if (generationLists !== 2) return names;
              if (mutation === "raw") throw new Error("scope cleanup list");
              if (mutation === "typed") throw typed;
              if (mutation === "duplicate") return [...names, wrong];
              return names.map((name) =>
                name.startsWith(".cleanup-") ? wrong : name,
              );
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          mutation === "raw"
            ? "runtime.internal_failure"
            : mutation === "typed"
              ? "runtime.recovery_required"
              : "runtime.state_corrupt",
      });
    },
  );

  it.each(["special", "nonempty"] as const)(
    "contains a second-pass %s scope cleanup marker entry",
    async (mutation) => {
      const fixture = await scopeRecoveryFixture("project");
      const baseInspect = fixture.storage.durableFileSystem.inspect;
      const baseList = fixture.storage.durableFileSystem.list;
      let markerInspections = 0;
      let markerLists = 0;
      await expect(
        inspectLease(
          "project",
          withDurable(fixture.storage, {
            inspect: async (path) => {
              if (
                path === fixture.marker &&
                ++markerInspections >= 2 &&
                mutation === "special"
              )
                return { kind: "special" as const };
              return baseInspect(path);
            },
            list: async (path) => {
              const names = await baseList(path);
              if (
                path === fixture.marker &&
                ++markerLists >= 2 &&
                mutation === "nonempty"
              )
                return ["unexpected"];
              return names;
            },
          }),
        ),
      ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    },
  );

  it.each(["duplicate", "special", "nonempty", "raw", "typed"] as const)(
    "contains a second-pass %s admission cleanup marker mutation",
    async (mutation) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `admission-second-pass-${mutation}`,
        resource: "admission",
      };
      const record = publishedAdmissionRecord(stale);
      const generation = parentDirectory(record);
      const marker = admissionCleanupMarker(stale);
      const storage = lockStorage({
        files: { [record]: canonicalizeJson(stale) },
        directories: [marker],
      });
      const baseList = storage.durableFileSystem.list;
      const baseInspect = storage.durableFileSystem.inspect;
      let generationLists = 0;
      let markerInspections = 0;
      let markerLists = 0;
      const typed = new LockFailure("runtime.recovery_required", []);
      await expect(
        acquireClaim(
          projectClaim,
          withDurable(storage, {
            list: async (path) => {
              const names = await baseList(path);
              if (path === generation) {
                generationLists++;
                if (generationLists === 2) {
                  if (mutation === "raw") throw new Error("cleanup list");
                  if (mutation === "typed") throw typed;
                  if (mutation === "duplicate")
                    return [...names, `.cleanup-${"f".repeat(64)}`];
                }
              }
              if (
                path === marker &&
                ++markerLists >= 2 &&
                mutation === "nonempty"
              )
                return ["unexpected"];
              return names;
            },
            inspect: async (path) => {
              if (
                path === marker &&
                ++markerInspections >= 2 &&
                mutation === "special"
              )
                return { kind: "special" as const };
              return baseInspect(path);
            },
          }),
        ),
      ).rejects.toMatchObject({
        reasonCode:
          mutation === "raw"
            ? "runtime.internal_failure"
            : mutation === "typed"
              ? "runtime.recovery_required"
              : "runtime.state_corrupt",
      });
    },
  );

  it.each(["lost", "typed", "present", "reread-typed", "reread-raw"] as const)(
    "classifies nested scope cleanup marker %s races",
    async (outcome) => {
      const fixture = await scopeRecoveryFixture("project");
      const baseRemove = fixture.storage.durableFileSystem.removeEmptyDirectory;
      const baseInspect = fixture.storage.durableFileSystem.inspect;
      let failed = false;
      const result = releaseClaim(
        { resource: "project", observed: fixture.claim },
        withDurable(fixture.storage, {
          removeEmptyDirectory: async (path) => {
            if (path !== fixture.marker) return baseRemove(path);
            failed = true;
            if (outcome === "lost") await baseRemove(path);
            if (outcome === "typed")
              throw new LockFailure("runtime.recovery_required", []);
            throw new Error("nested marker cleanup");
          },
          inspect: async (path) => {
            if (failed && path === fixture.marker) {
              if (outcome === "reread-typed")
                throw new LockFailure("runtime.recovery_required", []);
              if (outcome === "reread-raw") throw new Error("marker reread");
            }
            return baseInspect(path);
          },
        }),
      );
      if (outcome === "lost")
        await expect(result).resolves.toEqual({ kind: "released" });
      else
        await expect(result).rejects.toMatchObject({
          reasonCode:
            outcome === "typed" || outcome === "reread-typed"
              ? "runtime.recovery_required"
              : "runtime.internal_failure",
        });
    },
  );

  it.each(["lost", "typed", "present", "reread-typed", "reread-raw"] as const)(
    "classifies nested admission cleanup marker %s races",
    async (outcome) => {
      const stale: LockClaimRecord = {
        ...observedRecord,
        claimId: `admission-marker-race-${outcome}`,
        resource: "admission",
      };
      const record = publishedAdmissionRecord(stale);
      const marker = admissionCleanupMarker(stale);
      const storage = lockStorage({
        files: { [record]: canonicalizeJson(stale) },
        directories: [marker],
      });
      const baseRemove = storage.durableFileSystem.removeEmptyDirectory;
      const baseInspect = storage.durableFileSystem.inspect;
      let failed = false;
      const result = acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path !== marker) return baseRemove(path);
            failed = true;
            if (outcome === "lost") await baseRemove(path);
            if (outcome === "typed")
              throw new LockFailure("runtime.recovery_required", []);
            throw new Error("admission marker cleanup");
          },
          inspect: async (path) => {
            if (failed && path === marker) {
              if (outcome === "reread-typed")
                throw new LockFailure("runtime.recovery_required", []);
              if (outcome === "reread-raw") throw new Error("marker reread");
            }
            return baseInspect(path);
          },
        }),
      );
      if (outcome === "lost") await expect(result).resolves.toBeDefined();
      else
        await expect(result).rejects.toMatchObject({
          reasonCode:
            outcome === "typed" || outcome === "reread-typed"
              ? "runtime.recovery_required"
              : "runtime.internal_failure",
        });
    },
  );

  it("rejects a special tombstone during nested admission cleanup", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-special-linked",
      resource: "admission",
    };
    const marker = admissionCleanupMarker(stale);
    const tombstone = admissionTombstone(stale);
    const storage = lockStorage({
      files: { [tombstone]: canonicalizeJson(stale) },
      directories: [marker],
    });
    const baseInspect = storage.durableFileSystem.inspect;
    let tombstoneInspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (path === tombstone && ++tombstoneInspections >= 4)
              return { kind: "special" as const };
            return baseInspect(path);
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
  });

  it("returns lost when an admission cleanup link race loses its holder", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-link-lost",
      resource: "admission",
    };
    const record = publishedAdmissionRecord(stale);
    const marker = admissionCleanupMarker(stale);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
      directories: [marker],
    });
    const baseRemove = storage.durableFileSystem.removeFile;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          linkFileExclusive: async () => {
            await baseRemove(record);
            throw new Error("link lost holder");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.recovery_required" });
  });

  it("rejects and preserves a mismatched nested admission cleanup marker", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-cleanup-mismatch",
      resource: "admission",
    };
    const record = publishedAdmissionRecord(stale);
    const generation = parentDirectory(record);
    const marker = `${generation}/.cleanup-${"f".repeat(64)}`;
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
      directories: [marker],
    });
    const before = storage.snapshot();

    await expect(
      inspectLease("project", services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    await expect(
      acquireClaim(projectClaim, services(storage)),
    ).rejects.toMatchObject({ reasonCode: "runtime.state_corrupt" });
    expect(storage.snapshot()).toEqual(before);
  });

  it("keeps acquiring when the admission parent retires while its children are listed", async () => {
    const parent = lockPaths("project").admissionClaim;
    const storage = lockStorage({ directories: [parent] });
    const baseList = storage.durableFileSystem.list;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    let listings = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) => {
            if (path !== parent || ++listings !== 1) return baseList(path);
            await baseRemoveDirectory(parent);
            throw new Error("parent retired mid-listing");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
  });

  it("locates no admission when its parent retires between the inspection and the listing", async () => {
    const held: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-parent-listing",
      resource: "admission",
      expiresAt: "2026-08-11T00:05:00.000Z",
    };
    const record = publishedAdmissionRecord(held);
    const generation = parentDirectory(record);
    const parent = lockPaths("project").admissionClaim;
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(held) },
    });
    const baseList = storage.durableFileSystem.list;
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    let listings = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) => {
            if (path !== parent || ++listings !== 2) return baseList(path);
            await baseRemove(record);
            await baseRemoveDirectory(generation);
            await baseRemoveDirectory(parent);
            throw new Error("admission retired mid-listing");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().files[record]).toBeUndefined();
  });

  it("locates no admission generation a stale parent listing still names", async () => {
    const held: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-generation-stale",
      resource: "admission",
      expiresAt: "2026-08-11T00:05:00.000Z",
    };
    const record = publishedAdmissionRecord(held);
    const generation = parentDirectory(record);
    const parent = lockPaths("project").admissionClaim;
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(held) },
    });
    const baseList = storage.durableFileSystem.list;
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    let listings = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) => {
            if (path !== parent || ++listings !== 2) return baseList(path);
            const names = await baseList(path);
            await baseRemove(record);
            await baseRemoveDirectory(generation);
            return names;
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().files[record]).toBeUndefined();
  });

  it("validates no children of an admission generation its own retirement removed", async () => {
    const held: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-generation-children",
      resource: "admission",
      expiresAt: "2026-08-11T00:05:00.000Z",
    };
    const record = publishedAdmissionRecord(held);
    const generation = parentDirectory(record);
    const parent = lockPaths("project").admissionClaim;
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(held) },
    });
    const baseList = storage.durableFileSystem.list;
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    let listings = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) => {
            if (path !== parent || ++listings !== 1) return baseList(path);
            const names = await baseList(path);
            await baseRemove(record);
            await baseRemoveDirectory(generation);
            return names;
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().files[record]).toBeUndefined();
  });

  it("locates no admission generation that vanishes as it is inspected", async () => {
    const held: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-generation-inspect",
      resource: "admission",
      expiresAt: "2026-08-11T00:05:00.000Z",
    };
    const record = publishedAdmissionRecord(held);
    const generation = parentDirectory(record);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(held) },
    });
    const baseInspect = storage.durableFileSystem.inspect;
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    let inspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (path !== generation || ++inspections !== 1)
              return baseInspect(path);
            await baseRemove(record);
            await baseRemoveDirectory(generation);
            throw new Error("generation retired mid-inspection");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().files[record]).toBeUndefined();
  });

  it("reads no admission record retired before its inspection", async () => {
    const held: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-record-inspect",
      resource: "admission",
      expiresAt: "2026-08-11T00:05:00.000Z",
    };
    const record = publishedAdmissionRecord(held);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(held) },
    });
    const baseInspect = storage.durableFileSystem.inspect;
    const baseRemove = storage.durableFileSystem.removeFile;
    let inspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (path !== record || ++inspections !== 1)
              return baseInspect(path);
            await baseRemove(record);
            throw new Error("record retired mid-inspection");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().files[record]).toBeUndefined();
  });

  it("reads no admission record retired between its inspection and its read", async () => {
    const held: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-record-read",
      resource: "admission",
      expiresAt: "2026-08-11T00:05:00.000Z",
    };
    const record = publishedAdmissionRecord(held);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(held) },
    });
    const baseReadText = storage.durableFileSystem.readText;
    const baseRemove = storage.durableFileSystem.removeFile;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          readText: async (path) => {
            if (path !== record) return baseReadText(path);
            await baseRemove(record);
            throw new Error("record retired mid-read");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().files[record]).toBeUndefined();
  });

  it("reads no admission candidate record published away before its inspection", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "candidate-record-inspect",
      resource: "admission",
    };
    const record = candidateAdmissionRecord(stale);
    const root = parentDirectory(parentDirectory(record));
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
    });
    const baseInspect = storage.durableFileSystem.inspect;
    const baseRemove = storage.durableFileSystem.removeFile;
    let inspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (path !== record || ++inspections !== 1)
              return baseInspect(path);
            await baseRemove(record);
            throw new Error("candidate published mid-inspection");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().directories).not.toContain(root);
  });

  it("reads no admission candidate record published away before its read", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "candidate-record-read",
      resource: "admission",
    };
    const record = candidateAdmissionRecord(stale);
    const root = parentDirectory(parentDirectory(record));
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
    });
    const baseReadText = storage.durableFileSystem.readText;
    const baseRemove = storage.durableFileSystem.removeFile;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          readText: async (path) => {
            if (path !== record) return baseReadText(path);
            await baseRemove(record);
            throw new Error("candidate published mid-read");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().directories).not.toContain(root);
  });

  it("drops an admission candidate whose generation vanished mid-validation", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "candidate-generation-vanished",
      resource: "admission",
    };
    const record = candidateAdmissionRecord(stale);
    const generation = parentDirectory(record);
    const root = parentDirectory(generation);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
    });
    const baseInspect = storage.durableFileSystem.inspect;
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    let inspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (path !== generation || ++inspections !== 3)
              return baseInspect(path);
            await baseRemove(record);
            await baseRemoveDirectory(generation);
            throw new Error("candidate generation published mid-validation");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().directories).toContain(root);
  });

  it("drops an admission candidate whose record vanished mid-validation", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "candidate-record-vanished",
      resource: "admission",
    };
    const record = candidateAdmissionRecord(stale);
    const generation = parentDirectory(record);
    const root = parentDirectory(generation);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
    });
    const baseList = storage.durableFileSystem.list;
    const baseRemove = storage.durableFileSystem.removeFile;
    let listings = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) => {
            if (path !== generation || ++listings !== 3) return baseList(path);
            await baseRemove(record);
            throw new Error("candidate record published mid-validation");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().directories).toContain(root);
  });

  it("drops a scope candidate whose generation vanished mid-validation", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "scope-candidate-generation-vanished",
    };
    const record = candidateScopeRecord(stale);
    const generation = parentDirectory(record);
    const root = parentDirectory(generation);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
    });
    const baseInspect = storage.durableFileSystem.inspect;
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    const baseRename = storage.durableFileSystem.renameDirectoryExclusive;
    let admitted = false;
    let raced = false;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          renameDirectoryExclusive: async (source, target) => {
            await baseRename(source, target);
            if (target === lockPaths("project").admissionClaim) admitted = true;
          },
          inspect: async (path) => {
            if (path !== generation || !admitted || raced)
              return baseInspect(path);
            raced = true;
            await baseRemove(record);
            await baseRemoveDirectory(generation);
            throw new Error("scope generation published mid-validation");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().directories).toContain(root);
  });

  it("drops a scope candidate whose record vanished mid-validation", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "scope-candidate-record-vanished",
    };
    const record = candidateScopeRecord(stale);
    const root = parentDirectory(parentDirectory(record));
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
    });
    const baseReadText = storage.durableFileSystem.readText;
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseRename = storage.durableFileSystem.renameDirectoryExclusive;
    let admitted = false;
    let raced = false;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          renameDirectoryExclusive: async (source, target) => {
            await baseRename(source, target);
            if (target === lockPaths("project").admissionClaim) admitted = true;
          },
          readText: async (path) => {
            if (path !== record || !admitted || raced)
              return baseReadText(path);
            raced = true;
            await baseRemove(record);
            throw new Error("scope record published mid-validation");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().directories).toContain(root);
  });

  it("reports no cleanup marker after a concurrent cleanup removed the one just listed", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-marker-vanished",
      resource: "admission",
    };
    const record = publishedAdmissionRecord(stale);
    const marker = admissionCleanupMarker(stale);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
      directories: [marker],
    });
    const baseInspect = storage.durableFileSystem.inspect;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    let inspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (path !== marker || ++inspections !== 6)
              return baseInspect(path);
            await baseRemoveDirectory(marker);
            throw new Error("marker cleaned mid-lookup");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().files[record]).toBeUndefined();
  });

  it("normalizes a cleanup marker lookup fault its own marker survives", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-marker-lookup-fault",
      resource: "admission",
    };
    const record = publishedAdmissionRecord(stale);
    const marker = admissionCleanupMarker(stale);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
      directories: [marker],
    });
    const baseInspect = storage.durableFileSystem.inspect;
    let inspections = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          inspect: async (path) => {
            if (path !== marker || ++inspections !== 6)
              return baseInspect(path);
            throw new Error("marker lookup fault");
          },
        }),
      ),
    ).rejects.toMatchObject({ reasonCode: "runtime.internal_failure" });
    expect(storage.snapshot().directories).toContain(marker);
    expect(storage.snapshot().files[record]).toBe(canonicalizeJson(stale));
  });

  it("reads no tombstone from a generation retired before the tombstone listing", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "tombstone-generation-retired",
      resource: "admission",
    };
    const record = publishedAdmissionRecord(stale);
    const generation = parentDirectory(record);
    const storage = lockStorage({
      files: { [record]: canonicalizeJson(stale) },
    });
    const baseList = storage.durableFileSystem.list;
    const baseRemove = storage.durableFileSystem.removeFile;
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    let listings = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) => {
            if (path !== generation || ++listings !== 4) return baseList(path);
            await baseRemove(record);
            await baseRemoveDirectory(generation);
            throw new Error("generation retired mid-listing");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().files[record]).toBeUndefined();
  });

  it("reads no tombstone a concurrent cleanup removed after listing it", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "tombstone-listed-then-removed",
      resource: "admission",
    };
    const record = publishedAdmissionRecord(stale);
    const generation = parentDirectory(record);
    const tombstone = admissionTombstone(stale);
    const storage = lockStorage({
      files: {
        [record]: canonicalizeJson(stale),
        [tombstone]: canonicalizeJson(stale),
      },
    });
    const baseList = storage.durableFileSystem.list;
    const baseRemove = storage.durableFileSystem.removeFile;
    let listings = 0;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          list: async (path) => {
            if (path !== generation || ++listings !== 4) return baseList(path);
            const names = await baseList(path);
            await baseRemove(tombstone);
            return names;
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().files[record]).toBeUndefined();
  });

  it("reads no tombstone whose file vanishes during the read", async () => {
    const stale: LockClaimRecord = {
      ...observedRecord,
      claimId: "tombstone-read-vanished",
      resource: "admission",
    };
    const record = publishedAdmissionRecord(stale);
    const tombstone = admissionTombstone(stale);
    const storage = lockStorage({
      files: {
        [record]: canonicalizeJson(stale),
        [tombstone]: canonicalizeJson(stale),
      },
    });
    const baseReadText = storage.durableFileSystem.readText;
    const baseRemove = storage.durableFileSystem.removeFile;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          readText: async (path) => {
            if (path !== tombstone) return baseReadText(path);
            await baseRemove(tombstone);
            throw new Error("tombstone cleaned mid-read");
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().files[record]).toBeUndefined();
  });

  it("reports a lost admission clear when a contender publishes into the parent", async () => {
    const contender: LockClaimRecord = {
      ...observedRecord,
      claimId: "admission-parent-contender",
      resource: "admission",
      expiresAt: "2026-08-11T00:05:00.000Z",
    };
    const parent = lockPaths("project").admissionClaim;
    const published = parentDirectory(publishedAdmissionRecord(contender));
    const storage = lockStorage({ directories: [parent] });
    const baseRemoveDirectory = storage.durableFileSystem.removeEmptyDirectory;
    const baseCreate = storage.durableFileSystem.createDirectoryExclusive;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          removeEmptyDirectory: async (path) => {
            if (path !== parent) return baseRemoveDirectory(path);
            await baseCreate(published);
            throw new Error("parent claimed mid-clear");
          },
        }),
      ),
    ).rejects.toMatchObject({
      reasonCode: "runtime.recovery_required",
      evidence: [{ kind: "artifact", ref: ".brain/locks/.admission" }],
    });
  });

  it("retires an admission through a cleanup marker another worker already elected", async () => {
    const admission: LockClaimRecord = {
      claimId: "claim-1",
      resource: "admission",
      owner: "codex:session-01",
      leaseId: null,
      fencingToken: null,
      acquiredAt: "2026-08-11T00:01:00.000Z",
      expiresAt: "2026-08-11T00:01:30.000Z",
    };
    const marker = admissionCleanupMarker(admission);
    const storage = lockStorage();
    const baseWrite = storage.durableFileSystem.writeSynced;
    const baseCreate = storage.durableFileSystem.createDirectoryExclusive;
    await expect(
      acquireClaim(
        projectClaim,
        withDurable(storage, {
          writeSynced: async (path, content) => {
            await baseWrite(path, content);
            if (isScopeRecordPath(path)) await baseCreate(marker);
          },
        }),
      ),
    ).resolves.toMatchObject({
      resource: "project",
      owner: "codex:session-01",
    });
    expect(storage.snapshot().directories).not.toContain(
      lockPaths("project").admissionClaim,
    );
  });
});
