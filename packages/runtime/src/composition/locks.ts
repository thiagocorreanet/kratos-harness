import { types } from "node:util";

import {
  classifyLeaseTime,
  lockPaths,
  parseOwner,
  verifyLeaseBinding,
  type LeaseObservation,
  type LeaseResource,
} from "../domain/locks/index.js";
import {
  canonicalizeJson,
  type SchemaRegistry,
} from "../domain/schema/index.js";
import type { EvidenceRef } from "../domain/result/index.js";
import type {
  Clock,
  Digests,
  DurableEntry,
  DurableFileSystem,
  Ids,
} from "../ports/index.js";
import {
  inspectManagedTransactions,
  TransactionFailure,
  type TransactionServices,
} from "./transactions.js";

const locksRoot = ".brain/locks";
const admissionRoot = ".brain/locks/.admission";
const admissionClaim = `${admissionRoot}/claim`;

export interface LockServices {
  readonly clock: Clock;
  readonly ids: Ids;
  readonly digests: Digests;
  readonly durableFileSystem: DurableFileSystem;
  readonly schemaRegistry: SchemaRegistry;
}

/** A deliberately closed, transient record; it is not a state contract. */
export interface LockClaimRecord {
  readonly claimId: string;
  readonly resource: LeaseResource | "admission";
  readonly owner: string;
  readonly leaseId: string | null;
  readonly fencingToken: number | null;
  readonly acquiredAt: string;
  readonly expiresAt: string;
}

export interface AcquireClaimRequest {
  readonly resource: LeaseResource;
  readonly owner: string;
  readonly observed: LockClaimRecord | null;
}

export interface ClaimInspection extends LeaseObservation {
  readonly claim: LockClaimRecord | null;
}

export class LockFailure extends Error {
  public constructor(
    public readonly reasonCode:
      | "runtime.state_corrupt"
      | "runtime.internal_failure"
      | "runtime.recovery_required",
    public readonly evidence: readonly EvidenceRef[],
  ) {
    super("Durable lock operation failed");
    this.name = "LockFailure";
  }
}

function corrupt(path: string): LockFailure {
  return new LockFailure("runtime.state_corrupt", [
    { kind: "artifact", ref: path },
  ]);
}

function internal(): LockFailure {
  return new LockFailure("runtime.internal_failure", []);
}

function transactionServices(services: LockServices): TransactionServices {
  return services;
}

function claimRecordPath(resource: LeaseResource): string {
  return lockPaths(resource).claimRecord;
}

async function expectDirectoryOrMissing(
  path: string,
  services: LockServices,
): Promise<"missing" | "directory"> {
  let entry: DurableEntry;
  try {
    entry = await services.durableFileSystem.inspect(path);
  } catch {
    throw internal();
  }
  if (entry.kind === "missing" || entry.kind === "directory") return entry.kind;
  throw corrupt(path);
}

async function createDirectoryIfMissing(
  path: string,
  services: LockServices,
): Promise<void> {
  if ((await expectDirectoryOrMissing(path, services)) === "directory") return;
  try {
    await services.durableFileSystem.createDirectory(path);
    await services.durableFileSystem.syncDirectory(path);
  } catch {
    throw internal();
  }
}

async function assertOnlyChildren(
  path: string,
  allowed: readonly string[],
  services: LockServices,
): Promise<void> {
  try {
    const names = await services.durableFileSystem.list(path);
    if (names.some((name) => !allowed.includes(name))) throw corrupt(path);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

/** Create the only layouts lock operations will subsequently accept. */
export async function ensureLockNamespace(
  resource: LeaseResource,
  services: LockServices,
): Promise<void> {
  try {
    lockPaths(resource);
  } catch {
    throw internal();
  }
  await createDirectoryIfMissing(".brain", services);
  await createDirectoryIfMissing(locksRoot, services);
  await assertOnlyChildren(
    locksRoot,
    [".admission", "project", "runs"],
    services,
  );
  await createDirectoryIfMissing(admissionRoot, services);
  await assertOnlyChildren(admissionRoot, ["claim"], services);
  await createDirectoryIfMissing(admissionClaim, services);
  await assertOnlyChildren(admissionClaim, [], services);

  const paths = lockPaths(resource);
  if (resource.startsWith("run:")) {
    await createDirectoryIfMissing(`${locksRoot}/runs`, services);
    const runDirectory = paths.root.split("/").at(-1);
    if (runDirectory === undefined) throw internal();
    await assertOnlyChildren(`${locksRoot}/runs`, [runDirectory], services);
  }
  await createDirectoryIfMissing(paths.root, services);
  await assertOnlyChildren(
    paths.root,
    ["claim", "events.jsonl", "lease.json"],
    services,
  );
  await createDirectoryIfMissing(paths.claim, services);
  await assertOnlyChildren(paths.claim, ["claim.json"], services);
}

function exactRecord(value: unknown): LockClaimRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [
    "acquiredAt",
    "claimId",
    "expiresAt",
    "fencingToken",
    "leaseId",
    "owner",
    "resource",
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  )
    return null;
  const resource = record.resource;
  const fencingToken = record.fencingToken;
  if (
    typeof record.claimId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record.claimId) ||
    (resource !== "project" &&
      (typeof resource !== "string" || !resource.startsWith("run:"))) ||
    typeof record.owner !== "string" ||
    (record.leaseId !== null && typeof record.leaseId !== "string") ||
    (fencingToken !== null &&
      (!Number.isSafeInteger(fencingToken) ||
        typeof fencingToken !== "number" ||
        fencingToken < 0)) ||
    typeof record.acquiredAt !== "string" ||
    Number.isNaN(Date.parse(record.acquiredAt)) ||
    typeof record.expiresAt !== "string" ||
    Number.isNaN(Date.parse(record.expiresAt))
  )
    return null;
  try {
    lockPaths(resource);
    parseOwner(record.owner);
  } catch {
    return null;
  }
  return Object.freeze({
    claimId: record.claimId,
    resource: resource as LeaseResource | "admission",
    owner: record.owner,
    leaseId: record.leaseId,
    fencingToken,
    acquiredAt: record.acquiredAt,
    expiresAt: record.expiresAt,
  });
}

async function readClaim(
  resource: LeaseResource,
  services: LockServices,
): Promise<LockClaimRecord | null> {
  const path = claimRecordPath(resource);
  let entry: DurableEntry;
  try {
    entry = await services.durableFileSystem.inspect(path);
  } catch {
    throw internal();
  }
  if (entry.kind === "missing") return null;
  if (entry.kind !== "file") throw corrupt(path);
  try {
    const record = exactRecord(
      JSON.parse(await services.durableFileSystem.readText(path)),
    );
    if (record?.resource !== resource) throw corrupt(path);
    return record;
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw corrupt(path);
  }
}

function sameClaim(left: LockClaimRecord, right: LockClaimRecord): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

export async function acquireClaim(
  request: AcquireClaimRequest,
  services: LockServices,
): Promise<LockClaimRecord> {
  try {
    lockPaths(request.resource);
    parseOwner(request.owner);
  } catch {
    throw internal();
  }
  await ensureLockNamespace(request.resource, services);
  const existing = await readClaim(request.resource, services);
  if (existing !== null) throw corrupt(claimRecordPath(request.resource));
  const now = services.clock.now();
  const claim: LockClaimRecord = Object.freeze({
    claimId: services.ids.next(),
    resource: request.resource,
    owner: request.owner,
    leaseId: null,
    fencingToken: null,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  });
  const path = claimRecordPath(request.resource);
  try {
    await services.durableFileSystem.writeSynced(path, canonicalizeJson(claim));
    const fingerprint = await services.durableFileSystem.inspect(path);
    if (
      fingerprint.kind !== "file" ||
      fingerprint.sha256 !== services.digests.sha256(canonicalizeJson(claim))
    )
      throw corrupt(path);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    // An exclusive durable create that lost a race is verified rather than
    // collapsed into a generic filesystem error.
    const winner = await readClaim(request.resource, services).catch(
      () => null,
    );
    if (winner !== null) throw corrupt(path);
    throw internal();
  }
  return claim;
}

export async function releaseClaim(
  request: {
    readonly resource: LeaseResource;
    readonly observed: LockClaimRecord;
  },
  services: LockServices,
): Promise<{ readonly kind: "released" | "absent" }> {
  await ensureLockNamespace(request.resource, services);
  const current = await readClaim(request.resource, services);
  if (current === null) return { kind: "absent" };
  if (!sameClaim(current, request.observed))
    throw corrupt(claimRecordPath(request.resource));
  const paths = lockPaths(request.resource);
  try {
    await services.durableFileSystem.removeFile(paths.claimRecord);
    await services.durableFileSystem.syncDirectory(paths.claim);
    await services.durableFileSystem.removeEmptyDirectory(paths.claim);
    await services.durableFileSystem.syncDirectory(paths.root);
  } catch {
    throw internal();
  }
  return { kind: "released" };
}

export async function recoverClaim(
  request: {
    readonly resource: LeaseResource;
    readonly owner: string;
    readonly observed: LockClaimRecord;
  },
  services: LockServices,
): Promise<{ readonly kind: "recovered" | "absent" }> {
  let summaries;
  try {
    summaries = await inspectManagedTransactions(transactionServices(services));
  } catch (error) {
    if (error instanceof TransactionFailure) {
      throw new LockFailure(
        error.reasonCode === "runtime.recovery_required"
          ? "runtime.recovery_required"
          : "runtime.state_corrupt",
        error.evidence,
      );
    }
    throw internal();
  }
  if (
    summaries.some(
      (summary) => summary.phase !== "committed" && summary.phase !== "aborted",
    )
  ) {
    throw new LockFailure(
      "runtime.recovery_required",
      summaries.map((summary) => ({
        kind: "artifact",
        ref: summary.evidenceRef,
      })),
    );
  }
  const current = await readClaim(request.resource, services);
  if (current === null) return { kind: "absent" };
  if (
    !sameClaim(current, request.observed) ||
    Date.parse(current.expiresAt) > services.clock.now().getTime()
  )
    throw corrupt(claimRecordPath(request.resource));
  return releaseClaim(
    { resource: request.resource, observed: current },
    services,
  ).then(() => ({ kind: "recovered" as const }));
}

export async function inspectLease(
  resource: LeaseResource,
  services: LockServices,
): Promise<ClaimInspection> {
  await ensureLockNamespace(resource, services);
  const claim = await readClaim(resource, services);
  const paths = lockPaths(resource);
  const [leaseEntry, eventsEntry] = await Promise.all([
    services.durableFileSystem.inspect(paths.lease),
    services.durableFileSystem.inspect(paths.events),
  ]);
  if (leaseEntry.kind === "missing" && eventsEntry.kind === "missing")
    return { kind: "empty", lease: null, guard: null, claim };
  if (leaseEntry.kind !== "file") throw corrupt(paths.lease);
  if (eventsEntry.kind !== "file") throw corrupt(paths.events);
  try {
    const binding = verifyLeaseBinding(
      await services.durableFileSystem.readText(paths.events),
      await services.durableFileSystem.readText(paths.lease),
      { ...services, isProxy: types.isProxy, isPromise: types.isPromise },
    );
    const time = classifyLeaseTime(
      services.clock.now(),
      new Date(binding.lease.expiresAt),
    );
    const kind = time === "writable" ? "active" : time;
    return {
      kind,
      lease: binding.lease,
      guard: {
        resource: binding.lease.resource as LeaseResource,
        owner: binding.lease.owner,
        leaseId: binding.lease.leaseId,
        fencingToken: binding.lease.fencingToken,
        stateRevision: binding.lease.stateRevision,
        leaseFingerprint: {
          kind: "file",
          size: leaseEntry.size,
          sha256: leaseEntry.sha256,
        },
        eventsFingerprint: {
          kind: "file",
          size: eventsEntry.size,
          sha256: eventsEntry.sha256,
        },
      },
      claim,
    };
  } catch {
    throw corrupt(paths.lease);
  }
}
