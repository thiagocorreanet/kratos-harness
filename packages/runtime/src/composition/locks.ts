import { types } from "node:util";

import {
  LEASE_SKEW_MS,
  classifyLeaseTime,
  lockPaths,
  parseOwner,
  verifyLeaseBinding,
  type LeaseObservation,
  type LeaseGuard,
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
import type { PathFingerprint } from "../domain/transactions/index.js";
import {
  inspectManagedTransactions,
  TransactionFailure,
  type TransactionServices,
  type TransactionSummary,
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
  /** Testable transaction inspection boundary; production uses the durable implementation. */
  readonly inspectTransactions?: () => Promise<readonly TransactionSummary[]>;
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

export interface ObservedLockClaim extends LockClaimRecord {
  readonly fingerprint: PathFingerprint;
}

export type AcquireClaimOutcome = ObservedLockClaim | ClaimConflict;
export type ReleaseClaimOutcome =
  { readonly kind: "released" | "absent" } | ClaimConflict;
export type RecoverClaimOutcome =
  { readonly kind: "recovered" | "absent" } | ClaimConflict;

export interface AcquireClaimRequest {
  readonly resource: LeaseResource;
  readonly owner: string;
  /** The verified lease epoch observed before attempting administration. */
  readonly observed: LeaseGuard | null;
}

export interface ClaimInspection extends LeaseObservation {
  readonly claim: LockClaimRecord | null;
}

/** The claim record itself is the safe observation carried by contention. */
export type ClaimConflict = LockClaimRecord & {
  readonly kind: "conflict";
  readonly conflict: {
    readonly owner: string;
    readonly resource: LeaseResource;
    readonly expiresAt: string;
    readonly retryable: true;
    readonly recovery: "wait_or_takeover";
  };
};

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

function parentDirectory(path: string): string {
  const parent = path.lastIndexOf("/");
  return parent === -1 ? "." : path.slice(0, parent);
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
    await services.durableFileSystem.syncDirectory(parentDirectory(path));
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

async function assertCanonicalRunChildren(
  services: LockServices,
): Promise<void> {
  const root = `${locksRoot}/runs`;
  try {
    for (const name of await services.durableFileSystem.list(root)) {
      // Canonical unpadded Base64URL is the output alphabet of lockPaths().
      if (!/^[A-Za-z0-9_-]{2,171}$/u.test(name)) throw corrupt(root);
      const decoded = Buffer.from(name, "base64url").toString("utf8");
      try {
        if (lockPaths(`run:${decoded}`).root !== `${root}/${name}`)
          throw corrupt(`${root}/${name}`);
      } catch (error) {
        if (error instanceof LockFailure) throw error;
        throw corrupt(`${root}/${name}`);
      }
      if (
        (await services.durableFileSystem.inspect(`${root}/${name}`)).kind !==
        "directory"
      )
        throw corrupt(`${root}/${name}`);
    }
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

/** Validate existing metadata without materializing a lock namespace. */
async function inspectLockNamespace(
  resource: LeaseResource,
  services: LockServices,
): Promise<void> {
  const paths = lockPaths(resource);
  const inspect = async (path: string): Promise<DurableEntry> => {
    try {
      return await services.durableFileSystem.inspect(path);
    } catch {
      throw internal();
    }
  };
  const brain = await inspect(".brain");
  if (brain.kind === "missing") return;
  if (brain.kind !== "directory") throw corrupt(".brain");
  const locks = await inspect(locksRoot);
  if (locks.kind === "missing") return;
  if (locks.kind !== "directory") throw corrupt(locksRoot);
  await assertOnlyChildren(
    locksRoot,
    [".admission", "project", "runs"],
    services,
  );
  const admission = await inspect(admissionRoot);
  if (admission.kind !== "missing") {
    if (admission.kind !== "directory") throw corrupt(admissionRoot);
    await assertOnlyChildren(admissionRoot, ["claim"], services);
    const claim = await inspect(admissionClaim);
    if (claim.kind !== "missing") {
      if (claim.kind !== "directory") throw corrupt(admissionClaim);
      await assertOnlyChildren(admissionClaim, ["claim.json"], services);
    }
  }
  const runs = await inspect(`${locksRoot}/runs`);
  if (runs.kind !== "missing") {
    if (runs.kind !== "directory") throw corrupt(`${locksRoot}/runs`);
    await assertCanonicalRunChildren(services);
  }
  const chain = [
    ".brain",
    locksRoot,
    resource === "project" ? paths.root : `${locksRoot}/runs`,
    paths.root,
    paths.claim,
  ];
  for (const path of chain) {
    const entry = await services.durableFileSystem.inspect(path).catch(() => {
      throw internal();
    });
    if (entry.kind === "missing") {
      if (resource.startsWith("run:") && path === paths.root)
        await assertCanonicalRunChildren(services);
      return;
    }
    if (entry.kind !== "directory") throw corrupt(path);
  }
  if (resource.startsWith("run:")) await assertCanonicalRunChildren(services);
  await assertOnlyChildren(
    paths.root,
    ["claim", "events.jsonl", "lease.json"],
    services,
  );
  await assertOnlyChildren(paths.claim, ["claim.json"], services);
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
  await assertOnlyChildren(admissionClaim, ["claim.json"], services);

  const paths = lockPaths(resource);
  if (resource.startsWith("run:")) {
    await createDirectoryIfMissing(`${locksRoot}/runs`, services);
    await assertCanonicalRunChildren(services);
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
    (resource !== "admission" &&
      resource !== "project" &&
      (typeof resource !== "string" || !resource.startsWith("run:"))) ||
    typeof record.owner !== "string" ||
    (record.leaseId !== null && typeof record.leaseId !== "string") ||
    (record.leaseId === null) !== (fencingToken === null) ||
    (fencingToken !== null &&
      (!Number.isSafeInteger(fencingToken) ||
        typeof fencingToken !== "number" ||
        fencingToken < 0)) ||
    !strictTimestamp(record.acquiredAt) ||
    !strictTimestamp(record.expiresAt)
  )
    return null;
  try {
    if (resource !== "admission") lockPaths(resource);
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

function strictTimestamp(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
  )
    return false;
  const instant = new Date(value);
  return !Number.isNaN(instant.getTime()) && instant.toISOString() === value;
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
    const text = await services.durableFileSystem.readText(path);
    const record = exactRecord(JSON.parse(text));
    if (record === null || canonicalizeJson(record) !== text)
      throw corrupt(path);
    if (record.resource !== resource) throw corrupt(path);
    return Object.freeze({
      ...record,
      fingerprint: { kind: "file", size: entry.size, sha256: entry.sha256 },
    });
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw corrupt(path);
  }
}

function persistedRecord(record: LockClaimRecord): LockClaimRecord {
  return {
    claimId: record.claimId,
    resource: record.resource,
    owner: record.owner,
    leaseId: record.leaseId,
    fencingToken: record.fencingToken,
    acquiredAt: record.acquiredAt,
    expiresAt: record.expiresAt,
  };
}

function sameClaim(left: LockClaimRecord, right: LockClaimRecord): boolean {
  return (
    canonicalizeJson(persistedRecord(left)) ===
    canonicalizeJson(persistedRecord(right))
  );
}

function validateObservedGuard(
  resource: LeaseResource,
  observed: LeaseGuard | null,
): void {
  if (observed === null) return;
  if (
    observed.resource !== resource ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(observed.leaseId) ||
    !Number.isSafeInteger(observed.fencingToken) ||
    observed.fencingToken < 0 ||
    !Number.isSafeInteger(observed.stateRevision) ||
    observed.stateRevision < 0 ||
    observed.leaseFingerprint.kind !== "file" ||
    observed.eventsFingerprint.kind !== "file"
  )
    throw internal();
}

function conflict(record: LockClaimRecord): ClaimConflict {
  return Object.freeze({
    ...record,
    kind: "conflict" as const,
    conflict: Object.freeze({
      owner: record.owner,
      resource: record.resource as LeaseResource,
      expiresAt: record.expiresAt,
      retryable: true as const,
      recovery: "wait_or_takeover" as const,
    }),
  });
}

async function activeRunClaim(
  services: LockServices,
): Promise<LockClaimRecord | null> {
  const root = `${locksRoot}/runs`;
  const runs = await services.durableFileSystem.inspect(root);
  if (runs.kind === "missing") return null;
  if (runs.kind !== "directory") throw corrupt(root);
  for (const name of await services.durableFileSystem.list(root)) {
    const decoded = Buffer.from(name, "base64url").toString("utf8");
    let paths;
    try {
      paths = lockPaths(`run:${decoded}`);
    } catch {
      throw corrupt(`${root}/${name}`);
    }
    if (paths.root !== `${root}/${name}`) throw corrupt(`${root}/${name}`);
    const record = await readClaim(`run:${decoded}`, services);
    if (record) return record;
  }
  return null;
}

async function withAdmission<T>(
  owner: string,
  services: LockServices,
  operation: () => Promise<T>,
): Promise<T> {
  const paths = lockPaths("project");
  const now = services.clock.now();
  const admission: LockClaimRecord = Object.freeze({
    claimId: "admission",
    resource: "admission",
    owner,
    leaseId: null,
    fencingToken: null,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  });
  try {
    await services.durableFileSystem.writeSynced(
      paths.admissionRecord,
      canonicalizeJson(admission),
    );
    await services.durableFileSystem.syncDirectory(paths.admissionClaim);
  } catch {
    const entry = await services.durableFileSystem
      .inspect(paths.admissionRecord)
      .catch(() => null);
    if (entry?.kind === "file") {
      const holder = exactRecord(
        JSON.parse(
          await services.durableFileSystem.readText(paths.admissionRecord),
        ),
      );
      if (holder?.resource === "admission") {
        if (
          Date.parse(holder.expiresAt) + LEASE_SKEW_MS <=
          services.clock.now().getTime()
        ) {
          try {
            const text = canonicalizeJson(holder);
            if (
              (await services.durableFileSystem.readText(
                paths.admissionRecord,
              )) === text
            ) {
              await services.durableFileSystem.removeFile(
                paths.admissionRecord,
              );
              await services.durableFileSystem.syncDirectory(
                paths.admissionClaim,
              );
              return withAdmission(owner, services, operation);
            }
          } catch {
            throw internal();
          }
        }
        return conflict(holder) as T;
      }
    }
    throw internal();
  }
  try {
    return await operation();
  } finally {
    const entry = await services.durableFileSystem
      .inspect(paths.admissionRecord)
      .catch(() => null);
    if (entry?.kind === "file") {
      const text = await services.durableFileSystem
        .readText(paths.admissionRecord)
        .catch(() => "");
      if (text === canonicalizeJson(admission)) {
        try {
          await services.durableFileSystem.removeFile(paths.admissionRecord);
          await services.durableFileSystem.syncDirectory(paths.admissionClaim);
        } catch {
          // A stale admission record is recoverable; do not expose port text.
          throw new LockFailure("runtime.recovery_required", [
            { kind: "artifact", ref: paths.admissionRecord },
          ]);
        }
      }
    }
  }
}

export async function acquireClaim(
  request: AcquireClaimRequest,
  services: LockServices,
): Promise<AcquireClaimOutcome> {
  try {
    lockPaths(request.resource);
    parseOwner(request.owner);
    validateObservedGuard(request.resource, request.observed);
  } catch {
    throw internal();
  }
  await ensureLockNamespace(request.resource, services);
  return withAdmission(request.owner, services, () =>
    acquireClaimHeld(request, services),
  );
}

async function acquireClaimHeld(
  request: AcquireClaimRequest,
  services: LockServices,
): Promise<AcquireClaimOutcome> {
  try {
    lockPaths(request.resource);
    parseOwner(request.owner);
  } catch {
    throw internal();
  }
  const existing = await readClaim(request.resource, services);
  if (existing !== null) return conflict(existing);
  const family =
    request.resource === "project"
      ? await activeRunClaim(services)
      : await readClaim("project", services);
  if (family !== null) return conflict(family);
  const now = services.clock.now();
  const claim: LockClaimRecord = Object.freeze({
    claimId: services.ids.next(),
    resource: request.resource,
    owner: request.owner,
    leaseId: request.observed?.leaseId ?? null,
    fencingToken: request.observed?.fencingToken ?? null,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  });
  const path = claimRecordPath(request.resource);
  let fingerprint: Extract<DurableEntry, { readonly kind: "file" }>;
  try {
    await services.durableFileSystem.writeSynced(path, canonicalizeJson(claim));
    await services.durableFileSystem.syncDirectory(
      lockPaths(request.resource).claim,
    );
    const observedFingerprint = await services.durableFileSystem.inspect(path);
    if (
      observedFingerprint.kind !== "file" ||
      observedFingerprint.sha256 !==
        services.digests.sha256(canonicalizeJson(claim))
    )
      throw corrupt(path);
    fingerprint = observedFingerprint;
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    // An exclusive durable create that lost a race is verified rather than
    // collapsed into a generic filesystem error.
    const winner = await readClaim(request.resource, services).catch(
      () => null,
    );
    if (winner !== null) return conflict(winner);
    throw internal();
  }
  return Object.freeze({
    ...claim,
    fingerprint: {
      kind: "file" as const,
      size: fingerprint.size,
      sha256: fingerprint.sha256,
    },
  });
}

export async function releaseClaim(
  request: {
    readonly resource: LeaseResource;
    readonly observed: LockClaimRecord;
  },
  services: LockServices,
): Promise<ReleaseClaimOutcome> {
  try {
    lockPaths(request.resource);
    parseOwner(request.observed.owner);
  } catch {
    throw internal();
  }
  await ensureLockNamespace(request.resource, services);
  return withAdmission(request.observed.owner, services, () =>
    releaseClaimHeld(request, services),
  );
}

async function releaseClaimHeld(
  request: {
    readonly resource: LeaseResource;
    readonly observed: LockClaimRecord;
  },
  services: LockServices,
): Promise<ReleaseClaimOutcome> {
  const current = await readClaim(request.resource, services);
  if (current === null) return { kind: "absent" };
  if (!sameClaim(current, request.observed))
    throw corrupt(claimRecordPath(request.resource));
  const paths = lockPaths(request.resource);
  try {
    const entry = await services.durableFileSystem.inspect(paths.claimRecord);
    if (entry.kind !== "file") throw corrupt(paths.claimRecord);
    const observed = request.observed as Partial<ObservedLockClaim>;
    if (
      observed.fingerprint !== undefined &&
      (observed.fingerprint.kind !== "file" ||
        entry.size !== observed.fingerprint.size ||
        entry.sha256 !== observed.fingerprint.sha256)
    )
      return conflict(current);
    if (
      canonicalizeJson(persistedRecord(current)) !==
      (await services.durableFileSystem.readText(paths.claimRecord))
    )
      throw corrupt(paths.claimRecord);
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
): Promise<RecoverClaimOutcome> {
  try {
    lockPaths(request.resource);
    parseOwner(request.owner);
    if (request.observed.resource !== request.resource) throw new Error();
  } catch {
    throw internal();
  }
  await ensureLockNamespace(request.resource, services);
  return withAdmission(request.owner, services, () =>
    recoverClaimHeld(request, services),
  );
}

async function recoverClaimHeld(
  request: {
    readonly resource: LeaseResource;
    readonly owner: string;
    readonly observed: LockClaimRecord;
  },
  services: LockServices,
): Promise<RecoverClaimOutcome> {
  let summaries;
  try {
    summaries = await (services.inspectTransactions?.() ??
      inspectManagedTransactions(transactionServices(services)));
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
  for (const summary of summaries) {
    const root = `.brain/transactions/${summary.transactionId}`;
    for (const residue of ["progress.next", "staging"]) {
      const entry = await services.durableFileSystem.inspect(
        `${root}/${residue}`,
      );
      if (entry.kind !== "missing")
        throw new LockFailure("runtime.recovery_required", [
          { kind: "artifact", ref: `${root}/${residue}` },
        ]);
    }
  }
  const current = await readClaim(request.resource, services);
  if (current === null) return { kind: "absent" };
  if (
    !sameClaim(current, request.observed) ||
    Date.parse(current.expiresAt) + LEASE_SKEW_MS >
      services.clock.now().getTime()
  )
    throw corrupt(claimRecordPath(request.resource));
  const outcome = await releaseClaimHeld(
    { resource: request.resource, observed: current },
    services,
  );
  if (outcome.kind === "conflict") return outcome;
  if (outcome.kind !== "released") return { kind: "absent" };
  return { kind: "recovered" };
}

export async function inspectLease(
  resource: LeaseResource,
  services: LockServices,
): Promise<ClaimInspection> {
  await inspectLockNamespace(resource, services);
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
