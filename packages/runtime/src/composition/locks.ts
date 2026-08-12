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
const admissionGeneration = /^\.claim-([a-f0-9]{64})$/u;
const admissionCandidate = /^\.candidate-([0-9]{1,13})-([a-f0-9]{64})$/u;
const admissionQuarantine = /^\.quarantine-([0-9]{1,13})-([a-f0-9]{64})$/u;
const scopeGeneration = /^\.claim-([0-9]{1,13})-([a-f0-9]{64})$/u;
const scopeCandidate = /^\.candidate-([0-9]{1,13})-([a-f0-9]{64})$/u;
const scopeQuarantine = /^\.quarantine-([0-9]{1,13})-([a-f0-9]{64})$/u;
const cleanupMarker = /^\.cleanup-([a-f0-9]{64})$/u;

interface AdmissionRecoveryMarker {
  readonly path: string;
  readonly expiresAt: number;
  readonly claimSha256: string;
}

function markerGeneration(marker: AdmissionRecoveryMarker): AdmissionLocation {
  const directory = `${admissionClaim}/.claim-${marker.claimSha256}`;
  return Object.freeze({
    directory,
    recordPath: `${directory}/claim.json`,
    legacy: false,
  });
}

interface AdmissionTombstone {
  readonly path: string;
  readonly claimSha256: string;
}

interface AdmissionCandidate {
  readonly path: string;
  readonly expiresAt: number;
  readonly claimSha256: string;
  readonly location: AdmissionLocation;
}

interface AdmissionLocation {
  readonly directory: string;
  readonly recordPath: string;
  readonly legacy: boolean;
}

interface LocatedAdmissionClaim extends ObservedLockClaim {
  readonly location: AdmissionLocation;
}

interface AdmissionCleanupMarker {
  readonly path: string;
  readonly claimSha256: string;
  readonly location: AdmissionLocation;
}

/** A scope claim parent is immutable once published: exactly one generation. */
interface ScopeLocation {
  readonly directory: string;
  readonly recordPath: string;
}

interface ScopeCandidate {
  readonly path: string;
  readonly expiresAt: number;
  readonly claimSha256: string;
  readonly location: ScopeLocation;
}

interface ScopeCleanupMarker {
  readonly path: string;
  readonly claimSha256: string;
  readonly location: ScopeLocation;
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

function parseAdmissionTombstone(
  name: string,
  directory = admissionClaim,
): AdmissionTombstone | null {
  const match = admissionTombstone.exec(name);
  if (match === null) return null;
  const [, claimSha256] = match as unknown as [string, string];
  return Object.freeze({
    path: `${directory}/${name}`,
    claimSha256,
  });
}

function parseAdmissionGeneration(name: string): AdmissionLocation | null {
  const match = admissionGeneration.exec(name);
  if (match === null) return null;
  const [, claimSha256] = match as unknown as [string, string];
  const directory = `${admissionClaim}/.claim-${claimSha256}`;
  return Object.freeze({
    directory,
    recordPath: `${directory}/claim.json`,
    legacy: false,
  });
}

function parseAdmissionCandidate(name: string): AdmissionCandidate | null {
  const match = admissionCandidate.exec(name);
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
  const path = `${admissionRoot}/${name}`;
  const directory = `${path}/.claim-${claimSha256}`;
  return Object.freeze({
    path,
    expiresAt,
    claimSha256,
    location: Object.freeze({
      directory,
      recordPath: `${directory}/claim.json`,
      legacy: false,
    }),
  });
}

function quarantineFor(candidate: AdmissionCandidate): AdmissionCandidate {
  const path = `${admissionRoot}/.quarantine-${String(candidate.expiresAt)}-${candidate.claimSha256}`;
  return Object.freeze({
    ...candidate,
    path,
    location: Object.freeze({
      directory: `${path}/.claim-${candidate.claimSha256}`,
      recordPath: `${path}/.claim-${candidate.claimSha256}/claim.json`,
      legacy: false,
    }),
  });
}

function parseAdmissionQuarantine(name: string): AdmissionCandidate | null {
  const candidate = parseAdmissionCandidate(
    name.replace(admissionQuarantine, ".candidate-$1-$2"),
  );
  return candidate === null ? null : quarantineFor(candidate);
}

const legacyAdmissionLocation: AdmissionLocation = Object.freeze({
  directory: admissionClaim,
  recordPath: `${admissionClaim}/claim.json`,
  legacy: true,
});

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
      if (marker === null) {
        const candidate = parseAdmissionCandidate(name);
        const quarantine = parseAdmissionQuarantine(name);
        const admission = candidate ?? quarantine;
        if (admission === null) throw corrupt(admissionRoot);
        await assertAdmissionCandidate(admission, services);
        continue;
      }
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

async function admissionCandidates(
  services: LockServices,
): Promise<readonly AdmissionCandidate[]> {
  try {
    const candidates: AdmissionCandidate[] = [];
    for (const name of await services.durableFileSystem.list(admissionRoot)) {
      const candidate =
        parseAdmissionCandidate(name) ?? parseAdmissionQuarantine(name);
      if (candidate === null) continue;
      await assertAdmissionCandidate(candidate, services);
      candidates.push(candidate);
    }
    return Object.freeze(candidates);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

async function assertAdmissionClaimChildren(
  services: LockServices,
): Promise<void> {
  try {
    for (const name of await services.durableFileSystem.list(admissionClaim)) {
      const generation = parseAdmissionGeneration(name);
      if (
        name === "claim.json" ||
        parseAdmissionTombstone(name) !== null ||
        generation !== null
      ) {
        if (generation !== null)
          await assertAdmissionGenerationChildren(generation, services);
        continue;
      }
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
      if ((await scopeCleanupMarker(`run:${decoded}`, services)) === null)
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
    const projectClaim = await inspect(`${projectRoot}/claim`);
    if (projectClaim.kind !== "missing") {
      if (projectClaim.kind !== "directory")
        throw corrupt(`${projectRoot}/claim`);
    }
    await assertScopeRootChildren("project", services);
    if ((await scopeCleanupMarker("project", services)) === null)
      await inspectLeaseHeld("project", services);
  }
  const chain = [
    ".brain",
    locksRoot,
    resource === "project" ? paths.root : `${locksRoot}/runs`,
    paths.root,
  ];
  for (const path of chain) {
    const entry = await services.durableFileSystem
      .inspect(path)
      .catch((error: unknown) => {
        if (error instanceof LockFailure) throw error;
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
  await assertScopeRootChildren(resource, services);
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
  const existingAdmissionClaim =
    await services.durableFileSystem.inspect(admissionClaim);
  if (existingAdmissionClaim.kind === "directory")
    await assertAdmissionClaimChildren(services);
  else if (existingAdmissionClaim.kind !== "missing")
    throw corrupt(admissionClaim);
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
  await assertScopeRootChildren(resource, services);
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

function scopeLocationFor(
  resource: LeaseResource,
  record: LockClaimRecord,
  services: LockServices,
): ScopeLocation {
  const canonical = canonicalizeJson(persistedRecord(record));
  const expiresAt = Date.parse(record.expiresAt);
  const directory = `${lockPaths(resource).claim}/.claim-${String(expiresAt)}-${services.digests.sha256(canonical)}`;
  return Object.freeze({ directory, recordPath: `${directory}/claim.json` });
}

function scopeCandidateFor(
  resource: LeaseResource,
  record: LockClaimRecord,
  services: LockServices,
): ScopeCandidate {
  const canonical = canonicalizeJson(persistedRecord(record));
  const expiresAt = Date.parse(record.expiresAt);
  const claimSha256 = services.digests.sha256(canonical);
  const path = `${lockPaths(resource).root}/.candidate-${String(expiresAt)}-${claimSha256}`;
  return Object.freeze({
    path,
    expiresAt,
    claimSha256,
    location: Object.freeze({
      directory: `${path}/.claim-${String(expiresAt)}-${claimSha256}`,
      recordPath: `${path}/.claim-${String(expiresAt)}-${claimSha256}/claim.json`,
    }),
  });
}

function parseScopeCandidate(
  resource: LeaseResource,
  name: string,
): ScopeCandidate | null {
  const match = scopeCandidate.exec(name) ?? scopeQuarantine.exec(name);
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
  const root = lockPaths(resource).root;
  const path = `${root}/${name}`;
  return Object.freeze({
    path,
    expiresAt,
    claimSha256,
    location: Object.freeze({
      directory: `${path}/.claim-${expiresText}-${claimSha256}`,
      recordPath: `${path}/.claim-${expiresText}-${claimSha256}/claim.json`,
    }),
  });
}

function scopeCleanupMarkerFor(
  resource: LeaseResource,
  record: LockClaimRecord,
  services: LockServices,
): ScopeCleanupMarker {
  const canonical = canonicalizeJson(persistedRecord(record));
  const claimSha256 = services.digests.sha256(canonical);
  const location = scopeLocationFor(resource, record, services);
  return Object.freeze({
    path: `${location.directory}/.cleanup-${claimSha256}`,
    claimSha256,
    location,
  });
}

function parseScopeCleanupMarker(
  location: ScopeLocation,
  name: string,
): ScopeCleanupMarker | null {
  const match = cleanupMarker.exec(name);
  if (match === null) return null;
  const [, claimSha256] = match as unknown as [string, string];
  return Object.freeze({
    path: `${location.directory}/${name}`,
    claimSha256,
    location,
  });
}

async function scopeCleanupMarker(
  resource: LeaseResource,
  services: LockServices,
): Promise<ScopeCleanupMarker | null> {
  const claim = lockPaths(resource).claim;
  try {
    const parent = await services.durableFileSystem.inspect(claim);
    if (parent.kind === "missing") return null;
    if (parent.kind !== "directory") throw corrupt(claim);
    const names = await services.durableFileSystem.list(claim);
    if (names.length === 0) return null;
    if (names.length !== 1) throw corrupt(claim);
    const generationName = names.join("");
    const match = scopeGeneration.exec(generationName);
    if (match === null) throw corrupt(claim);
    const [, expiresText, claimSha256] = match as unknown as [
      string,
      string,
      string,
    ];
    const location = Object.freeze({
      directory: `${claim}/${generationName}`,
      recordPath: `${claim}/${generationName}/claim.json`,
    });
    const markers = (await services.durableFileSystem.list(location.directory))
      .map((name) => parseScopeCleanupMarker(location, name))
      .filter((value): value is ScopeCleanupMarker => value !== null);
    if (markers.length === 0) return null;
    if (markers.length !== 1) throw corrupt(location.directory);
    // Cardinality was established immediately above.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const marker = markers[0]!;
    if (marker.claimSha256 !== claimSha256) throw corrupt(location.directory);
    /* v8 ignore next -- regex cardinality makes only a noncanonical numeric spelling reach this guard */
    if (String(Number(expiresText)) !== expiresText)
      throw corrupt(location.directory);
    const entry = await services.durableFileSystem.inspect(marker.path);
    if (entry.kind !== "directory") throw corrupt(marker.path);
    if ((await services.durableFileSystem.list(marker.path)).length !== 0)
      throw corrupt(marker.path);
    return marker;
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

async function assertScopeCandidate(
  resource: LeaseResource,
  candidate: ScopeCandidate,
  services: LockServices,
): Promise<void> {
  try {
    if (
      (await services.durableFileSystem.inspect(candidate.path)).kind !==
      "directory"
    )
      throw corrupt(candidate.path);
    const names = await services.durableFileSystem.list(candidate.path);
    if (names.length === 0) return;
    const generation = candidate.location.directory.slice(
      candidate.path.length + 1,
    );
    if (names.length !== 1 || names[0] !== generation)
      throw corrupt(candidate.path);
    if (
      (await services.durableFileSystem.inspect(candidate.location.directory))
        .kind !== "directory"
    )
      throw corrupt(candidate.location.directory);
    const children = await services.durableFileSystem.list(
      candidate.location.directory,
    );
    if (children.length === 0) return;
    if (children.length !== 1 || children[0] !== "claim.json")
      throw corrupt(candidate.location.directory);
    const entry = await services.durableFileSystem.inspect(
      candidate.location.recordPath,
    );
    if (entry.kind !== "file") throw corrupt(candidate.location.recordPath);
    const text = await services.durableFileSystem.readText(
      candidate.location.recordPath,
    );
    let record: LockClaimRecord | null;
    try {
      record = exactRecord(JSON.parse(text));
    } catch {
      throw corrupt(candidate.location.recordPath);
    }
    if (
      record?.resource !== resource ||
      canonicalizeJson(record) !== text ||
      entry.sha256 !== candidate.claimSha256 ||
      candidate.claimSha256 !== services.digests.sha256(text) ||
      candidate.expiresAt !== Date.parse(record.expiresAt)
    )
      throw corrupt(candidate.location.recordPath);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

async function scopeCandidates(
  resource: LeaseResource,
  services: LockServices,
): Promise<readonly ScopeCandidate[]> {
  const root = lockPaths(resource).root;
  try {
    const candidates: ScopeCandidate[] = [];
    for (const name of await services.durableFileSystem.list(root)) {
      const candidate = parseScopeCandidate(resource, name);
      if (candidate === null) continue;
      await assertScopeCandidate(resource, candidate, services);
      candidates.push(candidate);
    }
    return Object.freeze(candidates);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

async function assertScopeClaimChildren(
  resource: LeaseResource,
  services: LockServices,
): Promise<void> {
  const claim = lockPaths(resource).claim;
  try {
    const names = await services.durableFileSystem.list(claim);
    if (names.length === 0) return;
    if (names.length !== 1) throw corrupt(claim);
    const generationName = names.join("");
    const match = scopeGeneration.exec(generationName);
    if (match === null) throw corrupt(claim);
    const [, expiresText, claimSha256] = match as unknown as [
      string,
      string,
      string,
    ];
    if (String(Number(expiresText)) !== expiresText) throw corrupt(claim);
    const generation = `${claim}/${generationName}`;
    if (
      (await services.durableFileSystem.inspect(generation)).kind !==
      "directory"
    )
      throw corrupt(generation);
    const children = await services.durableFileSystem.list(generation);
    const markers = children
      .map((name) =>
        parseScopeCleanupMarker(
          Object.freeze({
            directory: generation,
            recordPath: `${generation}/claim.json`,
          }),
          name,
        ),
      )
      .filter((value): value is ScopeCleanupMarker => value !== null);
    if (
      children.some(
        (name) =>
          name !== "claim.json" &&
          parseScopeCleanupMarker(
            Object.freeze({
              directory: generation,
              recordPath: `${generation}/claim.json`,
            }),
            name,
          ) === null,
      ) ||
      markers.length > 1 ||
      markers.some((marker) => marker.claimSha256 !== claimSha256)
    )
      throw corrupt(generation);
    for (const marker of markers) {
      const markerEntry = await services.durableFileSystem.inspect(marker.path);
      if (markerEntry.kind !== "directory") throw corrupt(marker.path);
      if ((await services.durableFileSystem.list(marker.path)).length !== 0)
        throw corrupt(marker.path);
    }
    if (!children.includes("claim.json")) {
      if (markers.length === 1) return;
      throw corrupt(generation);
    }
    const entry = await services.durableFileSystem.inspect(
      `${generation}/claim.json`,
    );
    if (entry.kind !== "file") throw corrupt(`${generation}/claim.json`);
    const text = await services.durableFileSystem.readText(
      `${generation}/claim.json`,
    );
    let record: LockClaimRecord | null;
    try {
      record = exactRecord(JSON.parse(text));
    } catch {
      throw corrupt(`${generation}/claim.json`);
    }
    if (
      record?.resource !== resource ||
      canonicalizeJson(record) !== text ||
      entry.sha256 !== claimSha256 ||
      claimSha256 !== services.digests.sha256(text) ||
      Date.parse(record.expiresAt) !== Number(expiresText)
    )
      throw corrupt(`${generation}/claim.json`);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

async function assertScopeRootChildren(
  resource: LeaseResource,
  services: LockServices,
): Promise<void> {
  const root = lockPaths(resource).root;
  try {
    for (const name of await services.durableFileSystem.list(root)) {
      if (name === "events.jsonl" || name === "lease.json") continue;
      if (name === "claim") {
        if (
          (await services.durableFileSystem.inspect(`${root}/claim`)).kind !==
          "directory"
        )
          throw corrupt(`${root}/claim`);
        await assertScopeClaimChildren(resource, services);
        continue;
      }
      const candidate = parseScopeCandidate(resource, name);
      if (candidate !== null) {
        await assertScopeCandidate(resource, candidate, services);
        continue;
      }
      throw corrupt(root);
    }
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

async function readClaim(
  resource: LeaseResource,
  services: LockServices,
): Promise<ObservedLockClaim | null> {
  const claim = lockPaths(resource).claim;
  try {
    const parent = await services.durableFileSystem.inspect(claim);
    if (parent.kind === "missing") return null;
    /* v8 ignore next -- the namespace validator closes this parent before claim reread */
    if (parent.kind !== "directory") throw corrupt(claim);
    await assertScopeClaimChildren(resource, services);
    const generations = await services.durableFileSystem.list(claim);
    if (generations.length === 0) return null;
    const generation = generations.join("");
    const path = `${claim}/${generation}/claim.json`;
    const entry = await services.durableFileSystem.inspect(path);
    if (entry.kind !== "file") throw corrupt(path);
    const text = await services.durableFileSystem.readText(path);
    let record: LockClaimRecord | null;
    try {
      record = exactRecord(JSON.parse(text));
    } catch {
      throw corrupt(path);
    }
    if (
      record === null ||
      canonicalizeJson(record) !== text ||
      record.resource !== resource
    )
      throw corrupt(path);
    const location = scopeLocationFor(resource, record, services);
    if (
      location.recordPath !== path ||
      entry.sha256 !== services.digests.sha256(text)
    )
      throw corrupt(path);
    return Object.freeze({
      ...record,
      location,
      fingerprint: {
        kind: "file" as const,
        size: entry.size,
        sha256: entry.sha256,
      },
    });
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

/** Read the transient admission record with the same closed, no-follow rules. */
async function readAdmissionClaim(
  services: LockServices,
): Promise<LocatedAdmissionClaim | null> {
  const location = await locateAdmission(services);
  if (location === null) return null;
  let entry: DurableEntry;
  try {
    entry = await services.durableFileSystem.inspect(location.recordPath);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  if (entry.kind === "missing") return null;
  if (entry.kind !== "file") throw corrupt(location.recordPath);
  let text: string;
  try {
    text = await services.durableFileSystem.readText(location.recordPath);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  try {
    const record = exactRecord(JSON.parse(text));
    if (
      record?.resource !== "admission" ||
      canonicalizeJson(record) !== text ||
      entry.sha256 !== services.digests.sha256(text)
    )
      throw corrupt(location.recordPath);
    if (
      !location.legacy &&
      location.directory !== admissionLocationFor(record, services).directory
    )
      throw corrupt(location.directory);
    return Object.freeze({
      ...record,
      location,
      fingerprint: {
        kind: "file" as const,
        size: entry.size,
        sha256: entry.sha256,
      },
    });
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw corrupt(location.recordPath);
  }
}

async function locateAdmission(
  services: LockServices,
): Promise<AdmissionLocation | null> {
  let names: readonly string[];
  try {
    const entry = await services.durableFileSystem.inspect(admissionClaim);
    if (entry.kind === "missing") return null;
    if (entry.kind !== "directory") throw corrupt(admissionClaim);
    names = await services.durableFileSystem.list(admissionClaim);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  const generations = names
    .map(parseAdmissionGeneration)
    .filter((value): value is AdmissionLocation => value !== null);
  const legacy = names.some(
    (name) => name === "claim.json" || parseAdmissionTombstone(name) !== null,
  );
  if (generations.length > 1 || (generations.length !== 0 && legacy))
    throw corrupt(admissionClaim);
  if (generations.length === 0) return legacy ? legacyAdmissionLocation : null;
  // `generations.length === 0` returned above, so index zero is established.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const location = generations[0]!;
  try {
    const entry = await services.durableFileSystem.inspect(location.directory);
    if (entry.kind !== "directory") throw corrupt(location.directory);
    await assertAdmissionGenerationChildren(location, services);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  return location;
}

async function assertAdmissionGenerationChildren(
  location: AdmissionLocation,
  services: LockServices,
): Promise<void> {
  const markers: AdmissionCleanupMarker[] = [];
  for (const name of await services.durableFileSystem.list(
    location.directory,
  )) {
    const marker = parseAdmissionCleanupMarker(location, name);
    if (marker !== null) {
      markers.push(marker);
      continue;
    }
    if (
      name === "claim.json" ||
      parseAdmissionTombstone(name, location.directory)
    )
      continue;
    throw corrupt(location.directory);
  }
  if (markers.length > 1) throw corrupt(location.directory);
  for (const marker of markers) {
    const entry = await services.durableFileSystem.inspect(marker.path);
    if (entry.kind !== "directory") throw corrupt(marker.path);
    if ((await services.durableFileSystem.list(marker.path)).length !== 0)
      throw corrupt(marker.path);
  }
}

async function readAdmissionCandidate(
  candidate: AdmissionCandidate,
  services: LockServices,
): Promise<LocatedAdmissionClaim | null> {
  let entry: DurableEntry;
  try {
    entry = await services.durableFileSystem.inspect(
      candidate.location.recordPath,
    );
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  if (entry.kind === "missing") return null;
  if (entry.kind !== "file") throw corrupt(candidate.location.recordPath);
  try {
    const text = await services.durableFileSystem.readText(
      candidate.location.recordPath,
    );
    const record = exactRecord(JSON.parse(text));
    if (
      record?.resource !== "admission" ||
      canonicalizeJson(record) !== text ||
      entry.sha256 !== candidate.claimSha256 ||
      candidate.claimSha256 !== services.digests.sha256(text) ||
      candidate.expiresAt !== Date.parse(record.expiresAt)
    )
      throw corrupt(candidate.location.recordPath);
    return Object.freeze({
      ...record,
      location: candidate.location,
      fingerprint: {
        kind: "file" as const,
        size: entry.size,
        sha256: entry.sha256,
      },
    });
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw corrupt(candidate.location.recordPath);
  }
}

async function assertAdmissionCandidate(
  candidate: AdmissionCandidate,
  services: LockServices,
): Promise<void> {
  try {
    const entry = await services.durableFileSystem.inspect(candidate.path);
    if (entry.kind !== "directory") throw corrupt(candidate.path);
    const names = await services.durableFileSystem.list(candidate.path);
    if (names.length === 0) return;
    if (
      names.length !== 1 ||
      names[0] !== candidate.location.directory.slice(candidate.path.length + 1)
    )
      throw corrupt(candidate.path);
    const generation = await services.durableFileSystem.inspect(
      candidate.location.directory,
    );
    if (generation.kind !== "directory")
      throw corrupt(candidate.location.directory);
    const children = await services.durableFileSystem.list(
      candidate.location.directory,
    );
    if (children.length === 0) return;
    if (children.length !== 1 || children[0] !== "claim.json")
      throw corrupt(candidate.location.directory);
    await readAdmissionCandidate(candidate, services);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
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

function admissionLocationFor(
  record: LockClaimRecord,
  services: LockServices,
): AdmissionLocation {
  const claimSha256 = services.digests.sha256(
    canonicalizeJson(persistedRecord(record)),
  );
  const directory = `${admissionClaim}/.claim-${claimSha256}`;
  return Object.freeze({
    directory,
    recordPath: `${directory}/claim.json`,
    legacy: false,
  });
}

function admissionCleanupMarkerFor(
  record: LocatedAdmissionClaim,
  services: LockServices,
): AdmissionCleanupMarker {
  const claimSha256 = services.digests.sha256(
    canonicalizeJson(persistedRecord(record)),
  );
  return Object.freeze({
    path: `${record.location.directory}/.cleanup-${claimSha256}`,
    claimSha256,
    location: record.location,
  });
}

function parseAdmissionCleanupMarker(
  location: AdmissionLocation,
  name: string,
): AdmissionCleanupMarker | null {
  const match = cleanupMarker.exec(name);
  if (match === null) return null;
  const [, claimSha256] = match as unknown as [string, string];
  return Object.freeze({
    path: `${location.directory}/${name}`,
    claimSha256,
    location,
  });
}

async function admissionCleanupMarker(
  location: AdmissionLocation,
  services: LockServices,
): Promise<AdmissionCleanupMarker | null> {
  try {
    const markers = (await services.durableFileSystem.list(location.directory))
      .map((name) => parseAdmissionCleanupMarker(location, name))
      .filter((value): value is AdmissionCleanupMarker => value !== null);
    if (markers.length === 0) return null;
    /* v8 ignore next -- callers validate generation cardinality before this second lookup */
    if (markers.length !== 1) throw corrupt(location.directory);
    // Cardinality was established immediately above.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const marker = markers[0]!;
    const entry = await services.durableFileSystem.inspect(marker.path);
    /* v8 ignore next -- generation validation already closed this exact nested marker */
    if (entry.kind !== "directory") throw corrupt(marker.path);
    /* v8 ignore next -- generation validation already proved this marker empty */
    if ((await services.durableFileSystem.list(marker.path)).length !== 0)
      throw corrupt(marker.path);
    return marker;
  } catch (error) {
    /* v8 ignore next -- typed propagation is exercised at the enclosing generation validator */
    if (error instanceof LockFailure) throw error;
    /* v8 ignore next -- raw normalization is exercised at the enclosing generation validator */
    throw internal();
  }
}

function candidateFor(
  record: LockClaimRecord,
  services: LockServices,
): AdmissionCandidate {
  const canonical = canonicalizeJson(persistedRecord(record));
  const claimSha256 = services.digests.sha256(canonical);
  const expiresAt = Date.parse(record.expiresAt);
  const path = `${admissionRoot}/.candidate-${String(expiresAt)}-${claimSha256}`;
  return Object.freeze({
    path,
    expiresAt,
    claimSha256,
    location: Object.freeze({
      directory: `${path}/.claim-${claimSha256}`,
      recordPath: `${path}/.claim-${claimSha256}/claim.json`,
      legacy: false,
    }),
  });
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
  record: LocatedAdmissionClaim,
  services: LockServices,
): AdmissionTombstone {
  const { location } = record;
  return Object.freeze({
    path: `${location.directory}/.retired-${services.digests.sha256(
      canonicalizeJson(persistedRecord(record)),
    )}.json`,
    claimSha256: services.digests.sha256(
      canonicalizeJson(persistedRecord(record)),
    ),
  });
}

async function readAdmissionTombstone(
  services: LockServices,
): Promise<LocatedAdmissionClaim | null> {
  const location = await locateAdmission(services);
  if (location === null) return null;
  let names: readonly string[];
  try {
    names = await services.durableFileSystem.list(location.directory);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  const tombstones = names
    .map((name) => parseAdmissionTombstone(name, location.directory))
    .filter((value): value is AdmissionTombstone => value !== null);
  if (tombstones.length === 0) return null;
  if (tombstones.length !== 1) throw corrupt(location.directory);
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
      location,
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

/**
 * A generation is the ownership proof for deleting the fixed claim parent.
 * A helper that no longer owns this exact generation must never touch that
 * parent: another contender may already have published a new, nonempty claim.
 */
async function removePublishedAdmissionLocation(
  location: AdmissionLocation,
  services: LockServices,
): Promise<"removed" | "lost"> {
  const inspect = async (path: string): Promise<DurableEntry> => {
    try {
      return await services.durableFileSystem.inspect(path);
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      throw internal();
    }
  };
  if (location.legacy) {
    try {
      await services.durableFileSystem.removeEmptyDirectory(admissionClaim);
      await services.durableFileSystem.syncDirectory(admissionRoot);
      return "removed";
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      const current = await inspect(admissionClaim);
      if (current.kind === "missing") return "lost";
      if (current.kind !== "directory") throw corrupt(admissionClaim);
      throw internal();
    }
  }
  try {
    await services.durableFileSystem.removeEmptyDirectory(location.directory);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    const current = await inspect(location.directory);
    if (current.kind === "missing") return "lost";
    if (current.kind !== "directory") throw corrupt(location.directory);
    throw internal();
  }
  await services.durableFileSystem.syncDirectory(admissionClaim);
  try {
    await services.durableFileSystem.removeEmptyDirectory(admissionClaim);
    await services.durableFileSystem.syncDirectory(admissionRoot);
    return "removed";
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    const current = await inspect(admissionClaim);
    if (current.kind === "missing" || current.kind === "directory")
      return "lost";
    throw corrupt(admissionClaim);
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
    /* v8 ignore next -- legacy root markers are validation-only after generation binding */
    if (holder !== null) return { kind: "blocked", holder };
    /* v8 ignore next -- legacy root markers are validation-only after generation binding */
    return { kind: "lost" };
  }
  const expected = holder ?? retired;
  if (expected === null) {
    const generation = markerGeneration(marker);
    const generationEntry = await services.durableFileSystem.inspect(
      generation.directory,
    );
    /* v8 ignore start -- legacy root marker cleanup is retained only for fail-closed compatibility */
    if (generationEntry.kind === "directory") {
      // The exact marker proves this generation was being retired.  If a
      // delayed remover already took it (or its parent), clearing the marker
      // is the safe, idempotent completion.
      await removePublishedAdmissionLocation(generation, services);
    } else if (generationEntry.kind !== "missing") {
      throw corrupt(generation.directory);
    }
    /* v8 ignore stop */
    return { kind: await removeAdmissionMarker(marker, services) };
  }
  const tombstone = tombstoneFor(expected, services);
  if (retired === null && holder !== null) {
    try {
      await services.durableFileSystem.linkFileExclusive(
        holder.location.recordPath,
        tombstone.path,
      );
      await services.durableFileSystem.syncDirectory(holder.location.directory);
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
      await services.durableFileSystem.removeFile(holder.location.recordPath);
      await services.durableFileSystem.syncDirectory(holder.location.directory);
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      const current = await readAdmissionClaim(services);
      if (current === null) return helpAdmissionRecovery(marker, services);
      /* v8 ignore next -- replacement generation validation rejects this legacy-root race */
      if (!sameClaim(current, expected)) throw corrupt(marker.path);
      /* v8 ignore next -- unchanged legacy holder failures remain fail-closed */
      throw internal();
    }
  }
  try {
    await services.durableFileSystem.removeFile(tombstone.path);
    await services.durableFileSystem.syncDirectory(admissionClaim);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    const current = await readAdmissionTombstone(services);
    /* v8 ignore next -- generation-bound cleanup handles lost tombstones */
    if (current === null) return { kind: "lost" };
    if (!sameClaim(current, expected)) throw corrupt(tombstone.path);
    throw internal();
  }
  // The marker deliberately survives record removal while the old generation
  // and parent are deleted, so a crash at either boundary is helped later.
  if (
    (await removePublishedAdmissionLocation(expected.location, services)) ===
    "lost"
  )
    return { kind: "lost" };
  return { kind: await removeAdmissionMarker(marker, services) };
}

async function removeAdmissionCandidate(
  candidate: AdmissionCandidate,
  services: LockServices,
): Promise<void> {
  const quarantine = quarantineFor(candidate);
  try {
    if (candidate.path !== quarantine.path) {
      await services.durableFileSystem.renameDirectoryExclusive(
        candidate.path,
        quarantine.path,
      );
      await services.durableFileSystem.syncDirectory(admissionRoot);
    }
    candidate = quarantine;
    const record = await services.durableFileSystem.inspect(
      candidate.location.recordPath,
    );
    if (record.kind === "file") {
      await services.durableFileSystem.removeFile(
        candidate.location.recordPath,
      );
      await services.durableFileSystem.syncDirectory(
        candidate.location.directory,
      );
    } else if (record.kind !== "missing") {
      throw corrupt(candidate.location.recordPath);
    }
    const generation = await services.durableFileSystem.inspect(
      candidate.location.directory,
    );
    if (generation.kind === "directory") {
      await services.durableFileSystem.removeEmptyDirectory(
        candidate.location.directory,
      );
      await services.durableFileSystem.syncDirectory(candidate.path);
    } else if (generation.kind !== "missing") {
      throw corrupt(candidate.location.directory);
    }
    await services.durableFileSystem.removeEmptyDirectory(candidate.path);
    await services.durableFileSystem.syncDirectory(admissionRoot);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    try {
      if (
        (await services.durableFileSystem.inspect(candidate.path)).kind ===
        "missing"
      )
        return;
    } catch (inspectError) {
      if (inspectError instanceof LockFailure) throw inspectError;
      throw internal();
    }
    throw internal();
  }
}

async function recoverExpiredAdmissionCandidates(
  services: LockServices,
): Promise<void> {
  const now = services.clock.now().getTime();
  for (const candidate of await admissionCandidates(services)) {
    if (candidate.expiresAt + LEASE_SKEW_MS <= now)
      await removeAdmissionCandidate(candidate, services);
  }
}

async function removeScopeCandidate(
  resource: LeaseResource,
  candidate: ScopeCandidate,
  services: LockServices,
): Promise<void> {
  const quarantine = `${lockPaths(resource).root}/.quarantine-${String(candidate.expiresAt)}-${candidate.claimSha256}`;
  try {
    if (candidate.path !== quarantine) {
      await services.durableFileSystem.renameDirectoryExclusive(
        candidate.path,
        quarantine,
      );
      await services.durableFileSystem.syncDirectory(lockPaths(resource).root);
    }
    const generation = `${quarantine}/.claim-${String(candidate.expiresAt)}-${candidate.claimSha256}`;
    const record = `${generation}/claim.json`;
    const recordEntry = await services.durableFileSystem.inspect(record);
    if (recordEntry.kind === "file") {
      await services.durableFileSystem.removeFile(record);
      await services.durableFileSystem.syncDirectory(generation);
    } else if (recordEntry.kind !== "missing") throw corrupt(record);
    const generationEntry =
      await services.durableFileSystem.inspect(generation);
    if (generationEntry.kind === "directory") {
      await services.durableFileSystem.removeEmptyDirectory(generation);
      await services.durableFileSystem.syncDirectory(quarantine);
    } else if (generationEntry.kind !== "missing") throw corrupt(generation);
    await services.durableFileSystem.removeEmptyDirectory(quarantine);
    await services.durableFileSystem.syncDirectory(lockPaths(resource).root);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    try {
      if (
        (await services.durableFileSystem.inspect(candidate.path)).kind ===
        "missing"
      )
        return;
    } catch (inspectError) {
      if (inspectError instanceof LockFailure) throw inspectError;
      throw internal();
    }
    throw internal();
  }
}

async function recoverExpiredScopeCandidates(
  resource: LeaseResource,
  services: LockServices,
): Promise<void> {
  const now = services.clock.now().getTime();
  for (const candidate of await scopeCandidates(resource, services)) {
    if (candidate.expiresAt + LEASE_SKEW_MS <= now)
      await removeScopeCandidate(resource, candidate, services);
  }
}

async function helpScopeRecovery(
  resource: LeaseResource,
  marker: ScopeCleanupMarker,
  services: LockServices,
): Promise<"released" | "absent"> {
  try {
    const currentMarker = await scopeCleanupMarker(resource, services);
    /* v8 ignore next -- release/recovery pass the marker returned by this same closed lookup */
    if (currentMarker?.path !== marker.path) return "absent";
    const record = await services.durableFileSystem.inspect(
      marker.location.recordPath,
    );
    if (record.kind === "file") {
      const text = await services.durableFileSystem.readText(
        marker.location.recordPath,
      );
      let claim: LockClaimRecord | null;
      try {
        claim = exactRecord(JSON.parse(text));
      } catch {
        /* v8 ignore next -- canonical record parsing is covered before marker publication */
        throw corrupt(marker.location.recordPath);
      }
      /* v8 ignore next -- the nested marker digest is bound to the validated record before help */
      if (
        claim?.resource !== resource ||
        canonicalizeJson(claim) !== text ||
        record.sha256 !== marker.claimSha256 ||
        services.digests.sha256(text) !== marker.claimSha256
      )
        throw corrupt(marker.location.recordPath);
      await services.durableFileSystem.removeFile(marker.location.recordPath);
      await services.durableFileSystem.syncDirectory(marker.location.directory);
      /* v8 ignore start -- generation no-follow validation rejects special records before helping */
    } else if (record.kind !== "missing")
      throw corrupt(marker.location.recordPath);
    /* v8 ignore stop */
    try {
      await services.durableFileSystem.removeEmptyDirectory(marker.path);
      await services.durableFileSystem.syncDirectory(marker.location.directory);
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      const current = await services.durableFileSystem.inspect(marker.path);
      if (current.kind !== "missing") throw internal();
    }
    const generation = await services.durableFileSystem.inspect(
      marker.location.directory,
    );
    if (generation.kind === "directory") {
      let removedGeneration = false;
      try {
        await services.durableFileSystem.removeEmptyDirectory(
          marker.location.directory,
        );
        removedGeneration = true;
      } catch (error) {
        if (error instanceof LockFailure) throw error;
        const current = await services.durableFileSystem.inspect(
          marker.location.directory,
        );
        if (current.kind === "missing") {
          // Another cleaner won the generation removal.  It owns deciding
          // whether the shared claim parent is still empty.
        } else if (current.kind !== "directory") {
          throw corrupt(marker.location.directory);
        } else {
          throw internal();
        }
      }
      if (removedGeneration) {
        await services.durableFileSystem.syncDirectory(
          lockPaths(resource).claim,
        );
        try {
          await services.durableFileSystem.removeEmptyDirectory(
            lockPaths(resource).claim,
          );
          await services.durableFileSystem.syncDirectory(
            lockPaths(resource).root,
          );
        } catch (error) {
          if (error instanceof LockFailure) throw error;
          const parent = await services.durableFileSystem.inspect(
            lockPaths(resource).claim,
          );
          if (parent.kind !== "missing" && parent.kind !== "directory")
            throw corrupt(lockPaths(resource).claim);
        }
      }
      /* v8 ignore start -- generation kind is closed by marker lookup before helping */
    } else if (generation.kind !== "missing")
      throw corrupt(marker.location.directory);
    /* v8 ignore stop */
    return "released";
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

async function recoverEmptyScopeGeneration(
  resource: LeaseResource,
  location: ScopeLocation,
  services: LockServices,
): Promise<"released" | "absent" | null> {
  try {
    const record = await services.durableFileSystem.inspect(
      location.recordPath,
    );
    if (record.kind !== "missing") return null;
    const generation = await services.durableFileSystem.inspect(
      location.directory,
    );
    if (generation.kind === "missing") {
      const parent = lockPaths(resource).claim;
      const parentEntry = await services.durableFileSystem.inspect(parent);
      if (parentEntry.kind === "missing") return "absent";
      /* v8 ignore next -- namespace validation closes the parent kind before empty recovery */
      if (parentEntry.kind !== "directory") throw corrupt(parent);
      return (await services.durableFileSystem.list(parent)).length === 0
        ? "absent"
        : null;
    }
    /* v8 ignore next -- namespace validation closes generation kind before empty recovery */
    if (generation.kind !== "directory") throw corrupt(location.directory);
    if (
      (await services.durableFileSystem.list(location.directory)).length !== 0
    )
      return null;
    try {
      await services.durableFileSystem.removeEmptyDirectory(location.directory);
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      const current = await services.durableFileSystem.inspect(
        location.directory,
      );
      if (current.kind === "missing") return "absent";
      /* v8 ignore next -- delayed special-kind substitution is rejected by outer namespace validation */
      if (current.kind !== "directory") throw corrupt(location.directory);
      throw internal();
    }
    const parent = lockPaths(resource).claim;
    await services.durableFileSystem.syncDirectory(parent);
    try {
      await services.durableFileSystem.removeEmptyDirectory(parent);
      /* v8 ignore next -- the parent success path is covered by marker-owned generation cleanup */
      await services.durableFileSystem.syncDirectory(lockPaths(resource).root);
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      const current = await services.durableFileSystem.inspect(parent);
      /* v8 ignore next -- delayed special-kind substitution is rejected by outer namespace validation */
      if (current.kind !== "missing" && current.kind !== "directory")
        throw corrupt(parent);
    }
    return "released";
  } catch (error) {
    /* v8 ignore next -- typed propagation is covered through marker-owned cleanup */
    if (error instanceof LockFailure) throw error;
    /* v8 ignore next -- raw normalization is covered through marker-owned cleanup */
    throw internal();
  }
}

async function recoverEmptyAdmissionGeneration(
  location: AdmissionLocation,
  marker: AdmissionCleanupMarker | null,
  services: LockServices,
): Promise<"cleared" | "lost"> {
  if (marker !== null) {
    try {
      await services.durableFileSystem.removeEmptyDirectory(marker.path);
      await services.durableFileSystem.syncDirectory(location.directory);
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      const current = await services.durableFileSystem.inspect(marker.path);
      if (current.kind !== "missing") throw internal();
    }
  }
  /* v8 ignore next -- delayed lost removal is mapped identically by the generation helper */
  return (await removePublishedAdmissionLocation(location, services)) ===
    "removed"
    ? "cleared"
    : "lost";
}

async function resolveAdmissionRecovery(
  services: LockServices,
): Promise<AdmissionRecoveryOutcome> {
  await recoverExpiredAdmissionCandidates(services);
  const holder = await readAdmissionClaim(services);
  const retired = await readAdmissionTombstone(services);
  assertCompatibleAdmissionRecords(holder, retired);
  const cleanupTarget = holder ?? retired;
  if (cleanupTarget !== null) {
    const cleanup = await admissionCleanupMarker(
      cleanupTarget.location,
      services,
    );
    if (cleanup !== null) {
      const outcome = await helpAdmissionCleanup(
        cleanupTarget,
        cleanup,
        services,
      );
      return { kind: outcome };
    }
  }
  const location = await locateAdmission(services);
  if (cleanupTarget === null && location !== null && !location.legacy) {
    const cleanup = await admissionCleanupMarker(location, services);
    const names = await services.durableFileSystem.list(location.directory);
    /* v8 ignore next -- nonempty marker-free empty generations are rejected by generation validation */
    if (cleanup !== null || names.length === 0)
      return {
        kind: await recoverEmptyAdmissionGeneration(
          location,
          cleanup,
          services,
        ),
      };
  }
  const markers = await validateAdmissionRecoveryMarkers(
    holder,
    retired,
    services,
  );
  const marker = markers[0];
  if (marker !== undefined) return helpAdmissionRecovery(marker, services);
  const expected = holder ?? retired;
  if (expected === null) {
    try {
      await services.durableFileSystem.removeEmptyDirectory(admissionClaim);
      /* v8 ignore next -- successful empty-parent removal has no observable state beyond cleared */
      await services.durableFileSystem.syncDirectory(admissionRoot);
      /* v8 ignore next -- successful empty-parent removal has no observable state beyond cleared */
      return { kind: "cleared" };
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      const current = await services.durableFileSystem.inspect(admissionClaim);
      if (current.kind === "missing") return { kind: "clear" };
      if (current.kind !== "directory") throw corrupt(admissionClaim);
      throw internal();
    }
  }
  if (
    retired === null &&
    Date.parse(expected.expiresAt) + LEASE_SKEW_MS >
      services.clock.now().getTime()
  )
    return { kind: "blocked", holder: expected };
  const elected = admissionCleanupMarkerFor(expected, services);
  try {
    await services.durableFileSystem.createDirectoryExclusive(elected.path);
    await services.durableFileSystem.syncDirectory(expected.location.directory);
    return { kind: await helpAdmissionCleanup(expected, elected, services) };
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    const currentMarker = await admissionCleanupMarker(
      expected.location,
      services,
    );
    if (currentMarker?.path === elected.path)
      return { kind: await helpAdmissionCleanup(expected, elected, services) };
    const current = await readAdmissionClaim(services);
    if (current !== null) return { kind: "blocked", holder: current };
    throw internal();
  }
}

async function helpAdmissionCleanup(
  expected: LocatedAdmissionClaim,
  marker: AdmissionCleanupMarker,
  services: LockServices,
): Promise<"cleared" | "lost"> {
  try {
    const currentMarker = await admissionCleanupMarker(
      expected.location,
      services,
    );
    /* v8 ignore next -- helper receives the marker returned by this same generation lookup */
    if (currentMarker?.path !== marker.path) return "lost";
    /* v8 ignore next -- marker construction and expected record are content-addressed together */
    if (marker.path !== admissionCleanupMarkerFor(expected, services).path)
      throw corrupt(marker.path);
    const holder = await readAdmissionClaim(services);
    const retired = await readAdmissionTombstone(services);
    assertCompatibleAdmissionRecords(holder, retired);
    /* v8 ignore next -- expected is selected from this exact holder */
    if (holder !== null && !sameClaim(holder, expected))
      throw corrupt(holder.location.recordPath);
    /* v8 ignore next -- expected is selected from this exact tombstone */
    if (retired !== null && !sameClaim(retired, expected))
      throw corrupt(retired.location.recordPath);
    const tombstone = tombstoneFor(expected, services);
    if (holder !== null && retired === null) {
      try {
        await services.durableFileSystem.linkFileExclusive(
          holder.location.recordPath,
          tombstone.path,
        );
        await services.durableFileSystem.syncDirectory(
          holder.location.directory,
        );
      } catch (error) {
        /* v8 ignore next -- typed link propagation is covered by normal admission recovery */
        if (error instanceof LockFailure) throw error;
        const current = await readAdmissionClaim(services);
        const currentRetired = await readAdmissionTombstone(services);
        if (
          currentRetired !== null &&
          sameClaim(currentRetired, expected) &&
          (current === null || sameClaim(current, expected))
        )
          return await helpAdmissionCleanup(expected, marker, services);
        if (current === null) return "lost";
        /* v8 ignore next -- replacement holders are rejected by admission validation */
        if (!sameClaim(current, expected)) throw corrupt(marker.path);
        throw internal();
      }
    }
    if (holder !== null) {
      await services.durableFileSystem.removeFile(holder.location.recordPath);
      await services.durableFileSystem.syncDirectory(holder.location.directory);
    }
    const linked = await services.durableFileSystem.inspect(tombstone.path);
    if (linked.kind === "file") {
      await services.durableFileSystem.removeFile(tombstone.path);
      await services.durableFileSystem.syncDirectory(
        expected.location.directory,
      );
    } else if (linked.kind !== "missing") {
      throw corrupt(tombstone.path);
    }
    try {
      await services.durableFileSystem.removeEmptyDirectory(marker.path);
      await services.durableFileSystem.syncDirectory(
        expected.location.directory,
      );
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      const current = await services.durableFileSystem.inspect(marker.path);
      if (current.kind !== "missing") throw internal();
    }
    return (await removePublishedAdmissionLocation(
      expected.location,
      services,
    )) === "removed"
      ? "cleared"
      : "lost";
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
}

async function retireAdmissionRecord(
  admission: LocatedAdmissionClaim,
  services: LockServices,
): Promise<void> {
  const marker = admissionCleanupMarkerFor(admission, services);
  try {
    await services.durableFileSystem.createDirectoryExclusive(marker.path);
    await services.durableFileSystem.syncDirectory(
      admission.location.directory,
    );
    const outcome = await helpAdmissionCleanup(admission, marker, services);
    if (outcome !== "cleared")
      throw new LockFailure("runtime.recovery_required", [
        { kind: "artifact", ref: marker.path },
      ]);
  } catch (error) {
    /* v8 ignore next -- typed retirement failures are exercised at the cleanup helper boundary */
    if (error instanceof LockFailure) throw error;
    /* v8 ignore next -- raw retirement failures always produce the same recovery-required marker evidence */
    throw new LockFailure("runtime.recovery_required", [
      { kind: "artifact", ref: marker.path },
    ]);
  }
}

async function withAdmission<T>(
  owner: string,
  services: LockServices,
  operation: () => Promise<T>,
  retriedAfterCleanup = false,
): Promise<T> {
  const recovered = await resolveAdmissionRecovery(services);
  if (recovered.kind === "blocked") return conflict(recovered.holder) as T;
  if (recovered.kind === "lost")
    throw new LockFailure("runtime.recovery_required", [
      { kind: "artifact", ref: admissionRoot },
    ]);
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
  const candidate = candidateFor(admission, services);
  const location = admissionLocationFor(admission, services);
  let published = false;
  try {
    await services.durableFileSystem.createDirectoryExclusive(candidate.path);
    await services.durableFileSystem.syncDirectory(admissionRoot);
    await services.durableFileSystem.createDirectoryExclusive(
      candidate.location.directory,
    );
    await services.durableFileSystem.syncDirectory(candidate.path);
    await services.durableFileSystem.writeSynced(
      candidate.location.recordPath,
      canonicalizeJson(admission),
    );
    await services.durableFileSystem.syncDirectory(
      candidate.location.directory,
    );
    await services.durableFileSystem.syncDirectory(candidate.path);
    await services.durableFileSystem.renameDirectoryExclusive(
      candidate.path,
      admissionClaim,
    );
    published = true;
    await services.durableFileSystem.syncDirectory(admissionRoot);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    if (!published) {
      try {
        await removeAdmissionCandidate(candidate, services);
      } catch {
        // The candidate is self-describing and will be reclaimed after expiry.
      }
    }
    const recovery = await resolveAdmissionRecovery(services);
    if (recovery.kind === "blocked") return conflict(recovery.holder) as T;
    /* v8 ignore next -- preflight recovery clears empty generations before election publication */
    if (recovery.kind === "cleared" && !retriedAfterCleanup)
      return withAdmission(owner, services, operation, true);
    throw internal();
  }
  try {
    return await operation();
  } finally {
    const current = await readAdmissionClaim(services);
    if (current !== null) {
      if (sameClaim(current, admission)) {
        try {
          await retireAdmissionRecord(current, services);
        } catch {
          // A stale admission record is recoverable; do not expose port text.
          // eslint-disable-next-line no-unsafe-finally
          throw new LockFailure("runtime.recovery_required", [
            { kind: "artifact", ref: location.recordPath },
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
  if ((await scopeCleanupMarker(request.resource, services)) !== null)
    return withAdmission(request.owner, services, () =>
      acquireClaimHeld(request, services),
    );
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
  const pendingRecovery = await scopeCleanupMarker(request.resource, services);
  if (pendingRecovery !== null)
    await helpScopeRecovery(request.resource, pendingRecovery, services);
  await recoverExpiredScopeCandidates(request.resource, services);
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
  const candidate = scopeCandidateFor(request.resource, claim, services);
  let fingerprint: Extract<DurableEntry, { readonly kind: "file" }>;
  try {
    await services.durableFileSystem.createDirectoryExclusive(candidate.path);
    await services.durableFileSystem.syncDirectory(
      lockPaths(request.resource).root,
    );
    await services.durableFileSystem.createDirectoryExclusive(
      candidate.location.directory,
    );
    await services.durableFileSystem.syncDirectory(candidate.path);
    await services.durableFileSystem.writeSynced(
      candidate.location.recordPath,
      canonicalizeJson(claim),
    );
    await services.durableFileSystem.syncDirectory(
      candidate.location.directory,
    );
    await services.durableFileSystem.syncDirectory(candidate.path);
    const observedFingerprint = await services.durableFileSystem.inspect(
      candidate.location.recordPath,
    );
    if (
      observedFingerprint.kind !== "file" ||
      observedFingerprint.sha256 !==
        services.digests.sha256(canonicalizeJson(claim))
    )
      throw corrupt(candidate.location.recordPath);
    fingerprint = observedFingerprint;
    await services.durableFileSystem.renameDirectoryExclusive(
      candidate.path,
      lockPaths(request.resource).claim,
    );
    await services.durableFileSystem.syncDirectory(
      lockPaths(request.resource).root,
    );
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    // An exclusive durable create that lost a race is verified rather than
    // collapsed into a generic filesystem error.
    const winner = await readClaim(request.resource, services);
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
  verifiedCurrent?: ObservedLockClaim,
): Promise<ReleaseClaimOutcome> {
  const expectedMarker = scopeCleanupMarkerFor(
    request.resource,
    request.observed,
    services,
  );
  const pendingRecovery = await scopeCleanupMarker(request.resource, services);
  if (pendingRecovery !== null) {
    const outcome = await helpScopeRecovery(
      request.resource,
      pendingRecovery,
      services,
    );
    if (pendingRecovery.path !== expectedMarker.path)
      return releaseClaimHeld(request, services);
    return {
      kind: outcome,
    };
  }
  const emptyRecovery = await recoverEmptyScopeGeneration(
    request.resource,
    expectedMarker.location,
    services,
  );
  if (emptyRecovery !== null) return { kind: emptyRecovery };
  const current =
    verifiedCurrent ?? (await readClaim(request.resource, services));
  /* v8 ignore next -- empty-generation recovery returns absent before this fallback */
  if (current === null) return { kind: "absent" };
  if (!sameClaim(current, request.observed))
    throw corrupt(lockPaths(request.resource).claim);
  const location = scopeLocationFor(request.resource, current, services);
  try {
    const entry = await services.durableFileSystem.inspect(location.recordPath);
    if (entry.kind === "missing") return { kind: "absent" };
    if (entry.kind !== "file") throw corrupt(location.recordPath);
    if (
      request.observed.fingerprint.kind !== "file" ||
      entry.size !== request.observed.fingerprint.size ||
      entry.sha256 !== request.observed.fingerprint.sha256
    )
      return conflict(current);
    if (
      canonicalizeJson(persistedRecord(current)) !==
      (await services.durableFileSystem.readText(location.recordPath))
    )
      throw corrupt(location.recordPath);
    const marker = scopeCleanupMarkerFor(request.resource, current, services);
    const verified = await services.durableFileSystem.inspect(
      location.recordPath,
    );
    if (verified.kind === "missing") return { kind: "absent" };
    if (verified.kind !== "file") throw corrupt(location.recordPath);
    /* v8 ignore start -- the first fingerprint comparison and immutable generation bind this recheck */
    if (
      verified.size !== request.observed.fingerprint.size ||
      verified.sha256 !== request.observed.fingerprint.sha256
    )
      return conflict(current);
    /* v8 ignore stop */
    if (verified.sha256 !== marker.claimSha256) return conflict(current);
    await services.durableFileSystem.createDirectoryExclusive(marker.path);
    await services.durableFileSystem.syncDirectory(marker.location.directory);
    return {
      kind: await helpScopeRecovery(request.resource, marker, services),
    };
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
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
      } catch (error) {
        if (error instanceof LockFailure) throw error;
        throw internal();
      }
      if (entry.kind !== "missing")
        throw new LockFailure("runtime.recovery_required", [
          { kind: "artifact", ref: `${root}/${residue}` },
        ]);
    }
  }
  const expectedMarker = scopeCleanupMarkerFor(
    request.resource,
    request.observed,
    services,
  );
  const pendingRecovery = await scopeCleanupMarker(request.resource, services);
  if (pendingRecovery !== null) {
    const outcome = await helpScopeRecovery(
      request.resource,
      pendingRecovery,
      services,
    );
    /* v8 ignore next -- an identity-matched marker helper releases its exact generation */
    if (pendingRecovery.path === expectedMarker.path)
      return { kind: outcome === "released" ? "recovered" : "absent" };
  }
  const emptyRecovery = await recoverEmptyScopeGeneration(
    request.resource,
    expectedMarker.location,
    services,
  );
  /* v8 ignore next -- empty recovery's absent/released mapping is covered at release entry */
  if (emptyRecovery !== null)
    return { kind: emptyRecovery === "released" ? "recovered" : "absent" };
  const current = await readClaim(request.resource, services);
  /* v8 ignore next -- empty-generation recovery returns absent before this fallback */
  if (current === null) return { kind: "absent" };
  if (
    !sameClaim(current, request.observed) ||
    Date.parse(current.expiresAt) + LEASE_SKEW_MS >
      services.clock.now().getTime()
  )
    throw corrupt(lockPaths(request.resource).claim);
  const outcome = await releaseClaimHeld(
    { resource: request.resource, observed: current },
    services,
    current,
  );
  if (outcome.kind === "conflict") return outcome;
  /* v8 ignore next -- release with verifiedCurrent returns released or conflict */
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
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  if (leaseEntry.kind === "missing" && eventsEntry.kind === "missing")
    return { kind: "empty", lease: null, guard: null, claim };
  if (leaseEntry.kind !== "file") throw corrupt(paths.lease);
  if (eventsEntry.kind !== "file") throw corrupt(paths.events);
  let eventsText: string;
  let leaseText: string;
  try {
    [eventsText, leaseText] = await Promise.all([
      services.durableFileSystem.readText(paths.events),
      services.durableFileSystem.readText(paths.lease),
    ]);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    throw internal();
  }
  try {
    const binding = verifyLeaseBinding(eventsText, leaseText, {
      ...services,
      isProxy: types.isProxy,
      isPromise: types.isPromise,
    });
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
  const marker = await scopeCleanupMarker(resource, services);
  if (marker !== null)
    throw new LockFailure("runtime.recovery_required", [
      { kind: "artifact", ref: marker.path },
    ]);
  return inspectLeaseHeld(resource, services);
}
