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
const admissionMarker = /^\.recovery-([0-9]{1,13})-([a-f0-9]{64})$/u;
const admissionTombstone = /^\.retired-([a-f0-9]{64})\.json$/u;

interface AdmissionRecoveryMarker {
  readonly path: string;
  readonly expiresAt: number;
  readonly claimSha256: string;
}

interface AdmissionTombstone {
  readonly path: string;
  readonly claimSha256: string;
}

function parseAdmissionMarker(name: string): AdmissionRecoveryMarker | null {
  const match = admissionMarker.exec(name);
  if (match === null) return null;
  const [, expiresText, claimSha256] = match as unknown as [
    string,
    string,
    string,
  ];
  const expiresAt = Number(expiresText);
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= 0 ||
    String(expiresAt) !== expiresText
  )
    return null;
  return Object.freeze({
    path: `${admissionRoot}/${name}`,
    expiresAt,
    claimSha256,
  });
}

function parseAdmissionTombstone(name: string): AdmissionTombstone | null {
  const match = admissionTombstone.exec(name);
  if (match === null) return null;
  const [, claimSha256] = match as unknown as [string, string];
  return Object.freeze({
    path: `${admissionClaim}/${name}`,
    claimSha256,
  });
}

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
  readonly claim: ObservedLockClaim | null;
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
  } catch (error) {
    if (error instanceof LockFailure) throw error;
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
  } catch (error) {
    if (error instanceof LockFailure) throw error;
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

async function admissionRecoveryMarkers(
  services: LockServices,
): Promise<readonly AdmissionRecoveryMarker[]> {
  try {
    const markers: AdmissionRecoveryMarker[] = [];
    for (const name of await services.durableFileSystem.list(admissionRoot)) {
      if (name === "claim") continue;
      const marker = parseAdmissionMarker(name);
      if (marker === null) throw corrupt(admissionRoot);
      const entry = await services.durableFileSystem.inspect(marker.path);
      if (entry.kind !== "directory") throw corrupt(marker.path);
      if ((await services.durableFileSystem.list(marker.path)).length !== 0)
        throw corrupt(marker.path);
      markers.push(marker);
    }
    if (markers.length > 1) throw corrupt(admissionRoot);
    return Object.freeze(markers);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

async function assertAdmissionChildren(services: LockServices): Promise<void> {
  await admissionRecoveryMarkers(services);
}

async function assertAdmissionClaimChildren(
  services: LockServices,
): Promise<void> {
  try {
    for (const name of await services.durableFileSystem.list(admissionClaim)) {
      if (name === "claim.json" || parseAdmissionTombstone(name) !== null)
        continue;
      throw corrupt(admissionClaim);
    }
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
      await inspectLeaseHeld(`run:${decoded}`, services);
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
    } catch (inspectError) {
      if (inspectError instanceof LockFailure) throw inspectError;
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
    await assertAdmissionChildren(services);
    const claim = await inspect(admissionClaim);
    switch (claim.kind) {
      case "missing":
        break;
      case "directory":
        await assertAdmissionClaimChildren(services);
        break;
      case "file":
        throw corrupt(admissionClaim);
    }
    const holder = await readAdmissionClaim(services);
    const retired = await readAdmissionTombstone(services);
    if (holder !== null && retired !== null) throw corrupt(admissionClaim);
    await validateAdmissionRecoveryMarkers(holder, retired, services);
  }
  const runs = await inspect(`${locksRoot}/runs`);
  if (runs.kind !== "missing") {
    if (runs.kind !== "directory") throw corrupt(`${locksRoot}/runs`);
    await assertCanonicalRunChildren(services);
  }
  const projectRoot = `${locksRoot}/project`;
  const project = await inspect(projectRoot);
  if (project.kind !== "missing") {
    if (project.kind !== "directory") throw corrupt(projectRoot);
    await assertOnlyChildren(
      projectRoot,
      ["claim", "events.jsonl", "lease.json"],
      services,
    );
    const projectClaim = await inspect(`${projectRoot}/claim`);
    if (projectClaim.kind !== "missing") {
      if (projectClaim.kind !== "directory")
        throw corrupt(`${projectRoot}/claim`);
      await assertOnlyChildren(
        `${projectRoot}/claim`,
        ["claim.json"],
        services,
      );
    }
    await inspectLeaseHeld("project", services);
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
  await assertAdmissionChildren(services);
  await createDirectoryIfMissing(admissionClaim, services);
  await assertAdmissionClaimChildren(services);
  await validateAdmissionRecoveryMarkers(
    await readAdmissionClaim(services),
    await readAdmissionTombstone(services),
    services,
  );

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
    (record.leaseId !== null &&
      (typeof record.leaseId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record.leaseId))) ||
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
): Promise<ObservedLockClaim | null> {
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
      fingerprint: {
        kind: "file" as const,
        size: entry.size,
        sha256: entry.sha256,
      },
    });
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw corrupt(path);
  }
}

/** Read the transient admission record with the same closed, no-follow rules. */
async function readAdmissionClaim(
  services: LockServices,
): Promise<ObservedLockClaim | null> {
  const paths = lockPaths("project");
  let entry: DurableEntry;
  try {
    entry = await services.durableFileSystem.inspect(paths.admissionRecord);
  } catch {
    throw internal();
  }
  if (entry.kind === "missing") return null;
  if (entry.kind !== "file") throw corrupt(paths.admissionRecord);
  let text: string;
  try {
    text = await services.durableFileSystem.readText(paths.admissionRecord);
  } catch {
    throw internal();
  }
  try {
    const record = exactRecord(JSON.parse(text));
    if (
      record?.resource !== "admission" ||
      canonicalizeJson(record) !== text ||
      entry.sha256 !== services.digests.sha256(text)
    )
      throw corrupt(paths.admissionRecord);
    return Object.freeze({
      ...record,
      fingerprint: {
        kind: "file" as const,
        size: entry.size,
        sha256: entry.sha256,
      },
    });
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw corrupt(paths.admissionRecord);
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

function recoveryMarkerFor(
  record: LockClaimRecord,
  services: LockServices,
): AdmissionRecoveryMarker {
  const expiresAt = Date.parse(record.expiresAt);
  const canonical = canonicalizeJson(persistedRecord(record));
  const claimSha256 = services.digests.sha256(canonical);
  return Object.freeze({
    path: `${admissionRoot}/.recovery-${String(expiresAt)}-${claimSha256}`,
    expiresAt,
    claimSha256,
  });
}

function tombstoneFor(
  record: LockClaimRecord,
  services: LockServices,
): AdmissionTombstone {
  return Object.freeze({
    path: `${admissionClaim}/.retired-${services.digests.sha256(
      canonicalizeJson(persistedRecord(record)),
    )}.json`,
    claimSha256: services.digests.sha256(
      canonicalizeJson(persistedRecord(record)),
    ),
  });
}

async function readAdmissionTombstone(
  services: LockServices,
): Promise<ObservedLockClaim | null> {
  let claimDirectory: DurableEntry;
  try {
    claimDirectory = await services.durableFileSystem.inspect(admissionClaim);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  if (claimDirectory.kind === "missing") return null;
  if (claimDirectory.kind !== "directory") throw corrupt(admissionClaim);
  let names: readonly string[];
  try {
    names = await services.durableFileSystem.list(admissionClaim);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  const tombstones = names
    .map(parseAdmissionTombstone)
    .filter((value): value is AdmissionTombstone => value !== null);
  if (tombstones.length === 0) return null;
  if (tombstones.length !== 1) throw corrupt(admissionClaim);
  // The preceding exact cardinality check establishes index zero.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const tombstone = tombstones[0]!;
  let entry: DurableEntry;
  let text: string;
  try {
    entry = await services.durableFileSystem.inspect(tombstone.path);
    if (entry.kind !== "file") throw corrupt(tombstone.path);
    text = await services.durableFileSystem.readText(tombstone.path);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  try {
    const record = exactRecord(JSON.parse(text));
    if (
      record?.resource !== "admission" ||
      canonicalizeJson(record) !== text ||
      entry.sha256 !== services.digests.sha256(text) ||
      tombstone.claimSha256 !== entry.sha256
    )
      throw corrupt(tombstone.path);
    return Object.freeze({
      ...record,
      fingerprint: {
        kind: "file" as const,
        size: entry.size,
        sha256: entry.sha256,
      },
    });
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw corrupt(tombstone.path);
  }
}

async function validateAdmissionRecoveryMarkers(
  holder: ObservedLockClaim | null,
  retired: ObservedLockClaim | null,
  services: LockServices,
): Promise<readonly AdmissionRecoveryMarker[]> {
  const markers = await admissionRecoveryMarkers(services);
  const marker = markers[0];
  if (marker === undefined) return markers;
  const expected = holder ?? retired;
  if (expected === null) {
    if (marker.expiresAt + LEASE_SKEW_MS > services.clock.now().getTime())
      throw corrupt(marker.path);
    return markers;
  }
  const expectedMarker = recoveryMarkerFor(expected, services);
  if (marker.path !== expectedMarker.path) throw corrupt(marker.path);
  if (
    retired === null &&
    expectedMarker.expiresAt + LEASE_SKEW_MS > services.clock.now().getTime()
  )
    throw corrupt(marker.path);
  return markers;
}

function sameClaim(left: LockClaimRecord, right: LockClaimRecord): boolean {
  return (
    canonicalizeJson(persistedRecord(left)) ===
    canonicalizeJson(persistedRecord(right))
  );
}

function assertCompatibleAdmissionRecords(
  holder: ObservedLockClaim | null,
  retired: ObservedLockClaim | null,
): void {
  if (holder !== null && retired !== null && !sameClaim(holder, retired))
    throw corrupt(admissionClaim);
}

function validateObservedGuard(observed: LeaseGuard | null): void {
  if (observed === null) return;
  if (
    (() => {
      try {
        lockPaths(observed.resource);
        parseOwner(observed.owner);
        return false;
      } catch {
        return true;
      }
    })() ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(observed.leaseId) ||
    !Number.isSafeInteger(observed.fencingToken) ||
    observed.fencingToken < 0 ||
    !Number.isSafeInteger(observed.stateRevision) ||
    observed.stateRevision < 0 ||
    observed.leaseFingerprint.kind !== "file" ||
    observed.eventsFingerprint.kind !== "file" ||
    !Number.isSafeInteger(observed.leaseFingerprint.size) ||
    observed.leaseFingerprint.size < 0 ||
    !/^[a-f0-9]{64}$/u.test(observed.leaseFingerprint.sha256) ||
    !Number.isSafeInteger(observed.eventsFingerprint.size) ||
    observed.eventsFingerprint.size < 0 ||
    !/^[a-f0-9]{64}$/u.test(observed.eventsFingerprint.sha256)
  )
    throw internal();
}

function sameGuard(left: LeaseGuard, right: LeaseGuard): boolean {
  return (
    left.resource === right.resource &&
    left.owner === right.owner &&
    left.leaseId === right.leaseId &&
    left.fencingToken === right.fencingToken &&
    left.stateRevision === right.stateRevision &&
    left.leaseFingerprint.kind === "file" &&
    right.leaseFingerprint.kind === "file" &&
    left.leaseFingerprint.size === right.leaseFingerprint.size &&
    left.leaseFingerprint.sha256 === right.leaseFingerprint.sha256 &&
    left.eventsFingerprint.kind === "file" &&
    right.eventsFingerprint.kind === "file" &&
    left.eventsFingerprint.size === right.eventsFingerprint.size &&
    left.eventsFingerprint.sha256 === right.eventsFingerprint.sha256
  );
}

function leaseConflict(
  inspection: ClaimInspection,
  resource: LeaseResource,
  owner: string,
  now: string,
): ClaimConflict {
  if (inspection.claim) return conflict(inspection.claim);
  const lease = inspection.lease;
  return conflict({
    claimId: "lease-observed",
    resource,
    owner: lease?.owner ?? owner,
    leaseId: lease?.leaseId ?? null,
    fencingToken: lease?.fencingToken ?? null,
    acquiredAt: lease?.acquiredAt ?? now,
    expiresAt: lease?.expiresAt ?? now,
  });
}

function acquireLeaseConflict(
  request: AcquireClaimRequest,
  inspection: ClaimInspection,
  services: LockServices,
): ClaimConflict | null {
  if (request.observed === null) {
    if (
      inspection.kind === "empty" &&
      inspection.lease === null &&
      inspection.guard === null &&
      inspection.claim === null
    )
      return null;
  } else if (
    inspection.guard !== null &&
    sameGuard(inspection.guard, request.observed) &&
    inspection.claim === null
  )
    return null;
  return leaseConflict(
    inspection,
    request.resource,
    request.owner,
    services.clock.now().toISOString(),
  );
}

function validateObservedClaim(
  resource: LeaseResource,
  observed: ObservedLockClaim,
): void {
  const record = exactRecord(persistedRecord(observed));
  if (
    record?.resource !== resource ||
    observed.fingerprint.kind !== "file" ||
    !Number.isSafeInteger(observed.fingerprint.size) ||
    observed.fingerprint.size < 0 ||
    !/^[a-f0-9]{64}$/u.test(observed.fingerprint.sha256)
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
  try {
    const runs = await services.durableFileSystem.inspect(root);
    if (runs.kind === "missing") return null;
    if (runs.kind !== "directory") throw corrupt(root);
    for (const name of await services.durableFileSystem.list(root)) {
      const decoded = Buffer.from(name, "base64url").toString("utf8");
      const resource = `run:${decoded}` as LeaseResource;
      let paths;
      try {
        paths = lockPaths(resource);
      } catch {
        throw corrupt(`${root}/${name}`);
      }
      if (paths.root !== `${root}/${name}`) throw corrupt(`${root}/${name}`);
      const inspection = await inspectLeaseHeld(resource, services);
      if (inspection.claim !== null) return inspection.claim;
      if (inspection.kind === "active" || inspection.kind === "skew")
        return leaseConflict(
          inspection,
          resource,
          "recovery:marker",
          services.clock.now().toISOString(),
        );
    }
    return null;
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

async function activeFamilyClaim(
  resource: LeaseResource,
  services: LockServices,
): Promise<LockClaimRecord | null> {
  if (resource === "project") return activeRunClaim(services);
  const inspection = await inspectLeaseHeld("project", services);
  if (inspection.claim !== null) return inspection.claim;
  if (inspection.kind === "active" || inspection.kind === "skew")
    return leaseConflict(
      inspection,
      "project",
      "recovery:marker",
      services.clock.now().toISOString(),
    );
  return null;
}

type AdmissionRecoveryOutcome =
  | { readonly kind: "clear" | "cleared" | "lost" }
  | { readonly kind: "blocked"; readonly holder: LockClaimRecord };

async function removeAdmissionClaimParent(
  services: LockServices,
): Promise<void> {
  try {
    await services.durableFileSystem.removeEmptyDirectory(admissionClaim);
    await services.durableFileSystem.syncDirectory(admissionRoot);
  } catch {
    const current = await services.durableFileSystem.inspect(admissionClaim);
    if (current.kind === "missing") return;
    throw internal();
  }
}

async function removeAdmissionMarker(
  marker: AdmissionRecoveryMarker,
  services: LockServices,
): Promise<"cleared" | "lost"> {
  try {
    await services.durableFileSystem.removeEmptyDirectory(marker.path);
    await services.durableFileSystem.syncDirectory(admissionRoot);
    return "cleared";
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    try {
      const entry = await services.durableFileSystem.inspect(marker.path);
      if (entry.kind === "missing") return "lost";
      if (entry.kind !== "directory") throw corrupt(marker.path);
    } catch (inspectError) {
      if (inspectError instanceof LockFailure) throw inspectError;
      throw internal();
    }
    throw internal();
  }
}

async function helpAdmissionRecovery(
  marker: AdmissionRecoveryMarker,
  services: LockServices,
): Promise<AdmissionRecoveryOutcome> {
  const holder = await readAdmissionClaim(services);
  const retired = await readAdmissionTombstone(services);
  assertCompatibleAdmissionRecords(holder, retired);
  const markers = await validateAdmissionRecoveryMarkers(
    holder,
    retired,
    services,
  );
  if (!markers.some((candidate) => candidate.path === marker.path)) {
    if (holder !== null) return { kind: "blocked", holder };
    return { kind: "lost" };
  }
  const expected = holder ?? retired;
  if (expected === null) {
    await removeAdmissionClaimParent(services);
    return { kind: await removeAdmissionMarker(marker, services) };
  }
  const tombstone = tombstoneFor(expected, services);
  if (retired === null && holder !== null) {
    try {
      await services.durableFileSystem.linkFileExclusive(
        lockPaths("project").admissionRecord,
        tombstone.path,
      );
      await services.durableFileSystem.syncDirectory(admissionClaim);
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      const current = await readAdmissionClaim(services);
      const currentRetired = await readAdmissionTombstone(services);
      if (current === null && currentRetired !== null)
        return helpAdmissionRecovery(marker, services);
      if (
        current !== null &&
        currentRetired !== null &&
        sameClaim(current, holder) &&
        sameClaim(currentRetired, holder)
      )
        return helpAdmissionRecovery(marker, services);
      if (current === null) return { kind: "lost" };
      if (!sameClaim(current, holder)) throw corrupt(marker.path);
      throw internal();
    }
  }
  const linked = await readAdmissionTombstone(services);
  if (linked === null || !sameClaim(linked, expected))
    throw corrupt(tombstone.path);
  if (holder !== null) {
    try {
      await services.durableFileSystem.removeFile(
        lockPaths("project").admissionRecord,
      );
      await services.durableFileSystem.syncDirectory(admissionClaim);
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      const current = await readAdmissionClaim(services);
      if (current === null) return helpAdmissionRecovery(marker, services);
      if (!sameClaim(current, expected)) throw corrupt(marker.path);
      throw internal();
    }
  }
  try {
    await services.durableFileSystem.removeFile(tombstone.path);
    await services.durableFileSystem.syncDirectory(admissionClaim);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    const current = await readAdmissionTombstone(services);
    if (current === null) return { kind: "lost" };
    if (!sameClaim(current, expected)) throw corrupt(tombstone.path);
    throw internal();
  }
  // The marker deliberately survives record removal while the old parent is
  // deleted, so a crash at either boundary is helped by the next contender.
  await removeAdmissionClaimParent(services);
  return { kind: await removeAdmissionMarker(marker, services) };
}

async function resolveAdmissionRecovery(
  services: LockServices,
): Promise<AdmissionRecoveryOutcome> {
  const holder = await readAdmissionClaim(services);
  const retired = await readAdmissionTombstone(services);
  assertCompatibleAdmissionRecords(holder, retired);
  const markers = await validateAdmissionRecoveryMarkers(
    holder,
    retired,
    services,
  );
  const marker = markers[0];
  if (marker !== undefined) return helpAdmissionRecovery(marker, services);
  const expected = holder ?? retired;
  if (expected === null) return { kind: "clear" };
  if (
    retired === null &&
    Date.parse(expected.expiresAt) + LEASE_SKEW_MS >
      services.clock.now().getTime()
  )
    return { kind: "blocked", holder: expected };
  const elected = recoveryMarkerFor(expected, services);
  try {
    await services.durableFileSystem.createDirectoryExclusive(elected.path);
    await services.durableFileSystem.syncDirectory(admissionRoot);
    return await helpAdmissionRecovery(elected, services);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    const currentMarkers = await admissionRecoveryMarkers(services);
    if (currentMarkers.some((candidate) => candidate.path === elected.path))
      return helpAdmissionRecovery(elected, services);
    const current = await readAdmissionClaim(services);
    if (current !== null) return { kind: "blocked", holder: current };
    throw internal();
  }
}

async function retireAdmissionRecord(
  admission: LockClaimRecord,
  services: LockServices,
): Promise<void> {
  const tombstone = tombstoneFor(admission, services);
  try {
    await services.durableFileSystem.linkFileExclusive(
      lockPaths("project").admissionRecord,
      tombstone.path,
    );
    await services.durableFileSystem.syncDirectory(admissionClaim);
    const linked = await readAdmissionTombstone(services);
    if (linked === null || !sameClaim(linked, admission))
      throw corrupt(tombstone.path);
    await services.durableFileSystem.removeFile(
      lockPaths("project").admissionRecord,
    );
    await services.durableFileSystem.syncDirectory(admissionClaim);
    if ((await admissionRecoveryMarkers(services)).length !== 0)
      throw new LockFailure("runtime.recovery_required", [
        { kind: "artifact", ref: admissionRoot },
      ]);
    await services.durableFileSystem.removeFile(tombstone.path);
    await services.durableFileSystem.syncDirectory(admissionClaim);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw new LockFailure("runtime.recovery_required", [
      { kind: "artifact", ref: tombstone.path },
    ]);
  }
}

async function withAdmission<T>(
  owner: string,
  services: LockServices,
  operation: () => Promise<T>,
): Promise<T> {
  const paths = lockPaths("project");
  const recovered = await resolveAdmissionRecovery(services);
  if (recovered.kind === "blocked") return conflict(recovered.holder) as T;
  if (recovered.kind === "lost")
    throw new LockFailure("runtime.recovery_required", [
      { kind: "artifact", ref: admissionRoot },
    ]);
  if (recovered.kind === "cleared")
    await ensureLockNamespace("project", services);
  const now = services.clock.now();
  const admission: LockClaimRecord = Object.freeze({
    claimId: services.ids.next(),
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
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    const recovery = await resolveAdmissionRecovery(services);
    if (recovery.kind === "blocked") return conflict(recovery.holder) as T;
    throw internal();
  }
  try {
    return await operation();
  } finally {
    const current = await readAdmissionClaim(services);
    if (current !== null) {
      if (sameClaim(current, admission)) {
        try {
          await retireAdmissionRecord(admission, services);
        } catch {
          // A stale admission record is recoverable; do not expose port text.
          // eslint-disable-next-line no-unsafe-finally
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
    validateObservedGuard(request.observed);
  } catch {
    throw internal();
  }
  await ensureLockNamespace(request.resource, services);
  const inspection = await inspectLeaseHeld(request.resource, services);
  const preAdmissionConflict = acquireLeaseConflict(
    request,
    inspection,
    services,
  );
  if (preAdmissionConflict !== null) return preAdmissionConflict;
  return withAdmission(request.owner, services, () =>
    acquireClaimHeld(request, services),
  );
}

async function acquireClaimHeld(
  request: AcquireClaimRequest,
  services: LockServices,
): Promise<AcquireClaimOutcome> {
  const inspection = await inspectLeaseHeld(request.resource, services);
  const heldAdmissionConflict = acquireLeaseConflict(
    request,
    inspection,
    services,
  );
  if (heldAdmissionConflict !== null) return heldAdmissionConflict;
  const family = await activeFamilyClaim(request.resource, services);
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
    readonly observed: ObservedLockClaim;
  },
  services: LockServices,
): Promise<ReleaseClaimOutcome> {
  try {
    lockPaths(request.resource);
    parseOwner(request.observed.owner);
    validateObservedClaim(request.resource, request.observed);
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
    readonly observed: ObservedLockClaim;
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
    if (
      request.observed.fingerprint.kind !== "file" ||
      entry.size !== request.observed.fingerprint.size ||
      entry.sha256 !== request.observed.fingerprint.sha256
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
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  return { kind: "released" };
}

export async function recoverClaim(
  request: {
    readonly resource: LeaseResource;
    readonly owner: string;
    readonly observed: ObservedLockClaim;
  },
  services: LockServices,
): Promise<RecoverClaimOutcome> {
  try {
    lockPaths(request.resource);
    parseOwner(request.owner);
    validateObservedClaim(request.resource, request.observed);
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
    readonly observed: ObservedLockClaim;
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
      let entry: DurableEntry;
      try {
        entry = await services.durableFileSystem.inspect(`${root}/${residue}`);
      } catch {
        throw internal();
      }
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

async function inspectLeaseHeld(
  resource: LeaseResource,
  services: LockServices,
): Promise<ClaimInspection> {
  const claim = await readClaim(resource, services);
  const paths = lockPaths(resource);
  let leaseEntry: DurableEntry;
  let eventsEntry: DurableEntry;
  try {
    [leaseEntry, eventsEntry] = await Promise.all([
      services.durableFileSystem.inspect(paths.lease),
      services.durableFileSystem.inspect(paths.events),
    ]);
  } catch {
    throw internal();
  }
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

export async function inspectLease(
  resource: LeaseResource,
  services: LockServices,
): Promise<ClaimInspection> {
  await inspectLockNamespace(resource, services);
  return inspectLeaseHeld(resource, services);
}
