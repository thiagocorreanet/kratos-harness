import { types } from "node:util";
import type { EventV1, LockLeaseV1 } from "@kratos/contracts";

import {
  LEASE_SKEW_MS,
  classifyLeaseTime,
  decideAcquire,
  decideRelease,
  decideRenew,
  decideTakeover,
  lockPaths,
  parseOwner,
  prepareLeaseTransition,
  LeasePolicyError,
  validateTtl,
  verifyLeaseBinding,
  type AcquireLeaseRequest,
  type LeaseOutcome,
  type ReleaseLeaseRequest,
  type RenewLeaseRequest,
  type TakeoverLeaseRequest,
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
  executeManagedMutation,
  inspectManagedTransactions,
  TransactionFailure,
  type EventStorePrecondition,
  type TransactionServices,
  type TransactionSummary,
} from "./transactions.js";
import type { Locks } from "../ports/locks.js";

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
      | "runtime.lease_conflict"
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
      // A recovery that completed between the listing above and this
      // inspection removed its own marker.
      /* v8 ignore next -- only a concurrent recovery removes a marker a listing just reported */
      if (entry.kind === "missing") continue;
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
      if (await assertAdmissionCandidate(candidate, services))
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
    // An admission retired mid-listing has no children left to validate.
    if (await vanishedUnderLocks(admissionClaim, services)) return;
    throw internal();
  }
}

async function assertCanonicalRunChildren(
  services: LockServices,
): Promise<void> {
  const root = `${locksRoot}/runs`;
  try {
    for (const { name, resource } of await canonicalRunResources(services)) {
      if (
        (await services.durableFileSystem.inspect(`${root}/${name}`)).kind !==
        "directory"
      )
        throw corrupt(`${root}/${name}`);
      if ((await scopeCleanupMarker(resource, services)) === null)
        await inspectLeaseHeld(resource, services);
    }
  } catch (error) {
    /* v8 ignore start -- public lifecycle methods normalize durable boundary failures */
    if (error instanceof LockFailure) throw error;
    throw internal();
    /* v8 ignore stop */
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
    // A retirement links the tombstone before removing the record it retires,
    // so an observer between the two publications legitimately sees both. Only
    // a tombstone that retires a different claim is uninterpretable, which is
    // the rule every other admission reader already applies.
    assertCompatibleAdmissionRecords(holder, retired);
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
    // The cleanup this marker elects removes the marker before the generation
    // that holds it, so a listing legitimately names one that is already gone.
    if (entry.kind === "missing") return null;
    if (entry.kind !== "directory") throw corrupt(marker.path);
    if ((await services.durableFileSystem.list(marker.path)).length !== 0)
      throw corrupt(marker.path);
    return marker;
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    // A generation retired under this lookup takes its own marker with it.
    if (await vanishedUnderLocks(claim, services)) return null;
    throw internal();
  }
}

/** Validate one candidate, or report that it is no longer there to validate. */
async function assertScopeCandidate(
  resource: LeaseResource,
  candidate: ScopeCandidate,
  services: LockServices,
): Promise<boolean> {
  try {
    const root = await services.durableFileSystem.inspect(candidate.path);
    /* v8 ignore next -- only a concurrent cleanup removes an entry a listing just reported */
    if (root.kind === "missing") return false;
    if (root.kind !== "directory") throw corrupt(candidate.path);
    const names = await services.durableFileSystem.list(candidate.path);
    if (names.length === 0) return true;
    const generation = candidate.location.directory.slice(
      candidate.path.length + 1,
    );
    if (names.length !== 1 || names[0] !== generation)
      throw corrupt(candidate.path);
    const directory = await services.durableFileSystem.inspect(
      candidate.location.directory,
    );
    /* v8 ignore next -- only a concurrent cleanup removes an entry a listing just reported */
    if (directory.kind === "missing") return false;
    if (directory.kind !== "directory")
      throw corrupt(candidate.location.directory);
    const children = await services.durableFileSystem.list(
      candidate.location.directory,
    );
    if (children.length === 0) return true;
    if (children.length !== 1 || children[0] !== "claim.json")
      throw corrupt(candidate.location.directory);
    const entry = await services.durableFileSystem.inspect(
      candidate.location.recordPath,
    );
    /* v8 ignore next -- only a concurrent cleanup removes an entry a listing just reported */
    if (entry.kind === "missing") return false;
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
    return true;
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    // A listing or read can fail because the entry went away mid-inspection,
    // which the explicit checks above cannot observe on their own. The
    // generation and the record disappear ahead of the candidate that holds
    // them, so a check confined to the candidate would miss the common shape.
    /* v8 ignore next -- only a concurrent cleanup makes a just-listed entry unreadable */
    if (await vanishedUnderLocks(candidate.path, services)) return false;
    if (await vanishedUnderLocks(candidate.location.directory, services))
      return false;
    if (await vanishedUnderLocks(candidate.location.recordPath, services))
      return false;
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
      if (await assertScopeCandidate(resource, candidate, services))
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
    const generationEntry =
      await services.durableFileSystem.inspect(generation);
    // The generation leaves ahead of the `claim` directory that holds it, so a
    // listing that just named it can be overtaken by its own retirement. The
    // claim itself is still there, which is why the vanish check below cannot
    // rescue this shape and it has to be read here.
    if (generationEntry.kind === "missing") return;
    if (generationEntry.kind !== "directory") throw corrupt(generation);
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
      // The cleanup that owns this marker removes it before the generation, so
      // a listing can name a marker that has already finished its work.
      if (markerEntry.kind === "missing") continue;
      if (markerEntry.kind !== "directory") throw corrupt(marker.path);
      if ((await services.durableFileSystem.list(marker.path)).length !== 0)
        throw corrupt(marker.path);
    }
    // A generation holding neither a record nor a marker is a cleanup between
    // its own two removals, which `recoverEmptyScopeGeneration` finishes. The
    // child guard above already closed every other shape, so what remains here
    // is the retirement in flight rather than damage.
    if (!children.includes("claim.json")) return;
    const entry = await services.durableFileSystem.inspect(
      `${generation}/claim.json`,
    );
    // The record leaves ahead of the generation that holds it, so a listing
    // that named it a moment ago can be overtaken by its own retirement.
    if (entry.kind === "missing") return;
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
    // A claim retired mid-listing has no children left to validate.
    if (await vanishedUnderLocks(claim, services)) return;
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
    // A record its own retirement removed under this read is unpublished, and
    // an unpublished claim is nothing rather than something to repair.
    if (entry.kind === "missing") return null;
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
    // A claim the protocol retired under this read is gone, not damaged.
    if (await vanishedUnderLocks(claim, services)) return null;
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
    if (await vanishedUnderLocks(location.recordPath, services)) return null;
    throw internal();
  }
  if (entry.kind === "missing") return null;
  if (entry.kind !== "file") throw corrupt(location.recordPath);
  let text: string;
  try {
    text = await services.durableFileSystem.readText(location.recordPath);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    if (await vanishedUnderLocks(location.recordPath, services)) return null;
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
  let generations: readonly AdmissionLocation[] = [];
  let legacy = false;
  // A retirement removes a generation while a successor publishes another, so
  // an observer landing between the two sees both. That pair is the protocol
  // handing over, not damage, and re-observing lets the retirement finish —
  // the same rule `inspectLeaseHeld` applies to a trail published before the
  // lease that seals it. Only a pair that survives the bound is
  // uninterpretable.
  for (
    let observation = 0;
    observation < MAX_LEASE_OBSERVATIONS;
    observation++
  ) {
    let names: readonly string[];
    try {
      const entry = await services.durableFileSystem.inspect(admissionClaim);
      if (entry.kind === "missing") return null;
      if (entry.kind !== "directory") throw corrupt(admissionClaim);
      names = await services.durableFileSystem.list(admissionClaim);
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      // A published admission that its own holder retired between the
      // inspection and the listing is gone, and nothing locates it.
      if (await vanishedUnderLocks(admissionClaim, services)) return null;
      throw internal();
    }
    generations = names
      .map(parseAdmissionGeneration)
      .filter((value): value is AdmissionLocation => value !== null);
    legacy = names.some(
      (name) => name === "claim.json" || parseAdmissionTombstone(name) !== null,
    );
    if (generations.length <= 1 && !(generations.length !== 0 && legacy)) break;
    await Promise.resolve();
  }
  if (generations.length > 1 || (generations.length !== 0 && legacy))
    throw corrupt(admissionClaim);
  if (generations.length === 0) return legacy ? legacyAdmissionLocation : null;
  // `generations.length === 0` returned above, so index zero is established.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const location = generations[0]!;
  try {
    const entry = await services.durableFileSystem.inspect(location.directory);
    // A generation retired between the listing above and this inspection is
    // gone, and nothing locates an admission that is no longer published.
    if (entry.kind === "missing") return null;
    if (entry.kind !== "directory") throw corrupt(location.directory);
    await assertAdmissionGenerationChildren(location, services);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    if (await vanishedUnderLocks(location.directory, services)) return null;
    throw internal();
  }
  return location;
}

async function assertAdmissionGenerationChildren(
  location: AdmissionLocation,
  services: LockServices,
): Promise<void> {
  const generationName = location.directory.slice(
    location.directory.lastIndexOf("/") + 1,
  );
  const generation = admissionGeneration.exec(generationName);
  /* v8 ignore next -- locateAdmission constructs this location only after the same canonical generation match */
  if (generation === null) throw corrupt(location.directory);
  const [, generationSha256] = generation as unknown as [string, string];
  const markers: AdmissionCleanupMarker[] = [];
  let names: readonly string[];
  try {
    names = await services.durableFileSystem.list(location.directory);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    // A generation its own retirement removed has no children left to check.
    if (await vanishedUnderLocks(location.directory, services)) return;
    throw internal();
  }
  for (const name of names) {
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
    if (marker.claimSha256 !== generationSha256) throw corrupt(marker.path);
    const entry = await services.durableFileSystem.inspect(marker.path);
    // The cleanup this marker elects takes the marker with it when it
    // finishes, so a listing can name one that no longer exists.
    /* v8 ignore next -- only a concurrent cleanup removes a marker a listing just reported */
    if (entry.kind === "missing") continue;
    if (entry.kind !== "directory") throw corrupt(marker.path);
    let children: readonly string[];
    try {
      children = await services.durableFileSystem.list(marker.path);
    } catch (error) {
      /* v8 ignore next -- the listing above rejects raw port errors only */
      if (error instanceof LockFailure) throw error;
      /* v8 ignore next -- only a concurrent cleanup unlists a just-inspected marker */
      if (await vanishedUnderLocks(marker.path, services)) continue;
      /* v8 ignore next -- storage that fails a listing it just inspected */
      throw internal();
    }
    if (children.length !== 0) throw corrupt(marker.path);
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
    if (await vanishedUnderLocks(candidate.location.recordPath, services))
      return null;
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
    // The record can go away between the inspection above and this read: its
    // owner publishes the candidate or reclaims it. A path that is gone was
    // never damaged, and reading it as corruption blames a sibling for
    // finishing.
    if (await vanishedUnderLocks(candidate.location.recordPath, services))
      return null;
    throw corrupt(candidate.location.recordPath);
  }
}

/**
 * Whether a path is gone rather than broken.
 *
 * A candidate that disappeared between being enumerated and being validated was
 * published or reclaimed by whoever owned it. Reading that as corruption would
 * turn every concurrent cleanup into a fault nobody can repair.
 */
async function vanished(
  path: string,
  services: LockServices,
): Promise<boolean> {
  try {
    return (await services.durableFileSystem.inspect(path)).kind === "missing";
    /* v8 ignore start -- a re-check that fails proves nothing, so the original
     * failure keeps the floor; only a storage fault during the re-read reaches
     * here and no single-process test can schedule one. */
  } catch {
    return false;
  }
  /* v8 ignore stop */
}

/**
 * Whether a lock path lost itself or an ancestor to a concurrent publisher.
 *
 * A read below `.brain/locks` fails in two shapes when a sibling retires an
 * admission or a claim: the path itself disappears, or a directory above it
 * does and the port rejects before ever reaching the path. Both mean the state
 * is gone rather than damaged, and only a walk up the chain observes the
 * second. The walk stops at the lock namespace, which the protocol creates and
 * never removes.
 */
async function vanishedUnderLocks(
  path: string,
  services: LockServices,
): Promise<boolean> {
  let current = path;
  while (current.length > locksRoot.length && current.startsWith(locksRoot)) {
    if (await vanished(current, services)) return true;
    const cut = current.lastIndexOf("/");
    /* v8 ignore next -- every lock path below the namespace has a separator */
    if (cut < 0) return false;
    current = current.slice(0, cut);
  }
  return false;
}

/** Validate one candidate, or report that it is no longer there to validate. */
async function assertAdmissionCandidate(
  candidate: AdmissionCandidate,
  services: LockServices,
): Promise<boolean> {
  try {
    const entry = await services.durableFileSystem.inspect(candidate.path);
    /* v8 ignore next -- only a concurrent cleanup removes an entry a listing just reported */
    if (entry.kind === "missing") return false;
    if (entry.kind !== "directory") throw corrupt(candidate.path);
    const names = await services.durableFileSystem.list(candidate.path);
    if (names.length === 0) return true;
    if (
      names.length !== 1 ||
      names[0] !== candidate.location.directory.slice(candidate.path.length + 1)
    )
      throw corrupt(candidate.path);
    const generation = await services.durableFileSystem.inspect(
      candidate.location.directory,
    );
    /* v8 ignore next -- only a concurrent cleanup removes an entry a listing just reported */
    if (generation.kind === "missing") return false;
    if (generation.kind !== "directory")
      throw corrupt(candidate.location.directory);
    const children = await services.durableFileSystem.list(
      candidate.location.directory,
    );
    if (children.length === 0) return true;
    if (children.length !== 1 || children[0] !== "claim.json")
      throw corrupt(candidate.location.directory);
    await readAdmissionCandidate(candidate, services);
    return true;
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    // A listing or read can fail because the entry went away mid-inspection,
    // which the explicit checks above cannot observe on their own. The
    // generation and the record disappear ahead of the candidate that holds
    // them, so a check confined to the candidate would miss the common shape.
    /* v8 ignore next -- only a concurrent cleanup makes a just-listed entry unreadable */
    if (await vanishedUnderLocks(candidate.path, services)) return false;
    if (await vanishedUnderLocks(candidate.location.directory, services))
      return false;
    if (await vanishedUnderLocks(candidate.location.recordPath, services))
      return false;
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
  let markerPath: string | null = null;
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
    markerPath = marker.path;
    const entry = await services.durableFileSystem.inspect(marker.path);
    // A cleanup that completed while this lookup ran took its own marker with
    // it, which leaves nothing to report rather than something to repair.
    /* v8 ignore next -- only a concurrent cleanup removes a marker a listing just reported */
    if (entry.kind === "missing") return null;
    /* v8 ignore next -- generation validation already closed this exact nested marker */
    if (entry.kind !== "directory") throw corrupt(marker.path);
    /* v8 ignore next -- generation validation already proved this marker empty */
    if ((await services.durableFileSystem.list(marker.path)).length !== 0)
      throw corrupt(marker.path);
    return marker;
  } catch (error) {
    /* v8 ignore next -- typed propagation is exercised at the enclosing generation validator */
    if (error instanceof LockFailure) throw error;
    if (await vanishedUnderLocks(location.directory, services)) return null;
    if (markerPath !== null && (await vanishedUnderLocks(markerPath, services)))
      return null;
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
    if (await vanishedUnderLocks(location.directory, services)) return null;
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
    // A tombstone its own cleanup removed between the listing above and this
    // inspection is gone, not damaged.
    if (entry.kind === "missing") return null;
    if (entry.kind !== "file") throw corrupt(tombstone.path);
    text = await services.durableFileSystem.readText(tombstone.path);
  } catch (error) {
    if (error instanceof LockFailure) throw error;
    if (await vanishedUnderLocks(tombstone.path, services)) return null;
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

/**
 * Reports the admission holder that is blocking `resource`.
 *
 * Admission is an internal coordination namespace, so `conflict` refuses to
 * surface a record whose resource is `"admission"`. Re-basing the holder onto
 * the requested resource keeps that guard intact while still naming who is in
 * the way: the alternative, a synthetic lease conflict, has no lease to read
 * and ends up reporting the caller as their own blocker.
 */
function admissionConflict(
  holder: LockClaimRecord,
  resource: LeaseResource,
): ClaimConflict {
  return conflict({ ...holder, resource });
}

function conflict(record: LockClaimRecord): ClaimConflict {
  if (record.resource === "admission") throw internal();
  return Object.freeze({
    ...record,
    kind: "conflict" as const,
    conflict: Object.freeze({
      owner: record.owner,
      resource: record.resource,
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
    for (const { resource } of await canonicalRunResources(services)) {
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
    /* v8 ignore start -- public lifecycle methods normalize durable boundary failures */
    if (error instanceof LockFailure) throw error;
    throw internal();
    /* v8 ignore stop */
  }
}

async function canonicalRunResources(
  services: LockServices,
): Promise<
  readonly { readonly name: string; readonly resource: LeaseResource }[]
> {
  const root = `${locksRoot}/runs`;
  try {
    const resources = (await services.durableFileSystem.list(root)).map(
      (name) => {
        // Canonical unpadded Base64URL is the output alphabet of lockPaths().
        if (!/^[A-Za-z0-9_-]{2,171}$/u.test(name)) throw corrupt(root);
        const resource =
          `run:${Buffer.from(name, "base64url").toString("utf8")}` as LeaseResource;
        try {
          if (lockPaths(resource).root !== `${root}/${name}`)
            throw corrupt(`${root}/${name}`);
        } catch (error) {
          if (error instanceof LockFailure) throw error;
          throw corrupt(`${root}/${name}`);
        }
        return Object.freeze({ name, resource });
      },
    );
    return Object.freeze(
      resources.sort((left, right) =>
        left.resource.localeCompare(right.resource, "en-US"),
      ),
    );
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
      // An empty-directory removal only fails on a directory that stopped
      // being empty, which happens when another contender published into it
      // mid-clear. One that is still empty refused for a reason no sibling
      // explains, and that is a fault rather than contention.
      if ((await services.durableFileSystem.list(admissionClaim)).length > 0)
        return { kind: "lost" };
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
    // Another contender finished this cleanup while we were performing it. A
    // marker that is gone is the election resolving, not storage failing.
    if (await vanishedUnderLocks(marker.path, services)) return "lost";
    throw internal();
  }
}

async function retireAdmissionRecord(
  admission: LocatedAdmissionClaim,
  services: LockServices,
): Promise<void> {
  const marker = admissionCleanupMarkerFor(admission, services);
  try {
    // The marker is content-addressed from this same record, so one standing
    // at that path is this retirement's own marker, elected by whichever
    // worker got there first. Creating it again would only race a helper.
    const elected = await services.durableFileSystem.inspect(marker.path);
    if (elected.kind === "missing") {
      await services.durableFileSystem.createDirectoryExclusive(marker.path);
      await services.durableFileSystem.syncDirectory(
        admission.location.directory,
      );
    }
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

/**
 * How many times an observer re-reads a lease that its trail says is coming.
 *
 * The two publications are consecutive durable writes, so an observer that
 * yields between reads sees the second one land. The bound turns a publisher
 * that never finishes into a recovery report rather than a spin.
 */
const MAX_LEASE_OBSERVATIONS = 16;
/** A contended admission election yields, re-observes, and tries again. */
const MAX_ADMISSION_ELECTION_ATTEMPTS = 64;

function independentAdmissionScope(
  holder: LockClaimRecord,
  resource: LeaseResource,
): boolean {
  return (
    resource.startsWith("run:") &&
    holder.leaseId?.startsWith("run:") === true &&
    holder.leaseId !== resource
  );
}

async function withAdmission<T>(
  resource: LeaseResource,
  owner: string,
  services: LockServices,
  operation: () => Promise<T>,
  electionAttempt = 0,
): Promise<T> {
  const recovered = await resolveAdmissionRecovery(services);
  if (recovered.kind === "blocked") {
    if (independentAdmissionScope(recovered.holder, resource)) {
      return operation();
    }
    // A contender that finds admission held is reported rather than
    // re-elected, which is the contract `docs/architecture/concurrency-locks.md`
    // records. Re-electing here would spin without yielding: the recovery that
    // produced this outcome already observed an unexpired holder, so nothing
    // this attempt can do changes the answer before that holder expires.
    return admissionConflict(recovered.holder, resource) as T;
  }
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
    // Admission is transient, but naming the administered scope lets a
    // contender distinguish unrelated work from a lease conflict. Legacy
    // null records remain readable so crash recovery is backward compatible.
    leaseId: resource,
    fencingToken: 0,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  });
  const candidate = candidateFor(admission, services);
  const location = admissionLocationFor(admission, services);
  let published = false;
  // Only failure of the exclusive publication is contention. Treating a
  // failed write or sync as a lost election would retry a broken dependency
  // and could eventually report somebody else's claim as the cause.
  let electing = false;
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
    electing = true;
    await services.durableFileSystem.renameDirectoryExclusive(
      candidate.path,
      admissionClaim,
    );
    electing = false;
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
    if (!electing) {
      // A failure outside the exclusive publication is not contention, but
      // the admission generation may still be occupied: by whoever won it
      // meanwhile, or — when the publication itself succeeded and only its
      // parent sync failed — by this very attempt, whose candidate was
      // deliberately left in place above. Naming the observable holder is
      // more useful than collapsing into an untyped internal failure.
      const observed = await readAdmissionClaim(services);
      if (observed !== null) return admissionConflict(observed, resource) as T;
      throw internal();
    }
    const recovery = await resolveAdmissionRecovery(services);
    if (recovery.kind === "blocked") {
      if (independentAdmissionScope(recovery.holder, resource)) {
        return operation();
      }
      if (electionAttempt + 1 < MAX_ADMISSION_ELECTION_ATTEMPTS) {
        await Promise.resolve();
        return withAdmission(
          resource,
          owner,
          services,
          operation,
          electionAttempt + 1,
        );
      }
      return admissionConflict(recovery.holder, resource) as T;
    }
    if (
      recovery.kind === "cleared" &&
      electionAttempt + 1 < MAX_ADMISSION_ELECTION_ATTEMPTS
    ) {
      // Yield through a resolved promise so a sibling that just retired the
      // admission generation can finish its parent-directory sync first.
      await Promise.resolve();
      return withAdmission(
        resource,
        owner,
        services,
        operation,
        electionAttempt + 1,
      );
    }
    if (recovery.kind === "cleared") {
      throw new LockFailure("runtime.lease_conflict", [
        { kind: "artifact", ref: admissionRoot },
      ]);
    }
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
    return withAdmission(request.resource, request.owner, services, () =>
      acquireClaimHeld(request, services),
    );
  const inspection = await inspectLeaseHeld(request.resource, services);
  const preAdmissionConflict = acquireLeaseConflict(
    request,
    inspection,
    services,
  );
  if (preAdmissionConflict !== null) return preAdmissionConflict;
  return withAdmission(request.resource, request.owner, services, () =>
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
  return withAdmission(request.resource, request.observed.owner, services, () =>
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
  return withAdmission(request.resource, request.owner, services, () =>
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
  // A guarded transaction publishes the trail before the lease it seals, so an
  // observer between the two publications sees a trail with no lease. That
  // pair is a publication in flight, not damage, and re-observing lets the
  // publisher finish rather than blaming it. The bound keeps a genuinely
  // stalled publication from spinning here.
  let observation = 0;
  do {
    try {
      [leaseEntry, eventsEntry] = await Promise.all([
        services.durableFileSystem.inspect(paths.lease),
        services.durableFileSystem.inspect(paths.events),
      ]);
    } catch (error) {
      if (error instanceof LockFailure) throw error;
      throw internal();
    }
    observation += 1;
  } while (
    leaseEntry.kind === "missing" &&
    eventsEntry.kind === "file" &&
    observation < MAX_LEASE_OBSERVATIONS
  );
  if (leaseEntry.kind === "missing" && eventsEntry.kind === "missing")
    return { kind: "empty", lease: null, guard: null, claim };
  // A trail that still has no lease after the bound is stalled mid-publication,
  // which is recoverable rather than uninterpretable.
  if (leaseEntry.kind === "missing" && eventsEntry.kind === "file")
    throw new LockFailure("runtime.recovery_required", [
      { kind: "artifact", ref: paths.lease },
    ]);
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
    const kind =
      binding.action === "release"
        ? "released"
        : time === "writable"
          ? "active"
          : time;
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

/* v8 ignore start -- malformed lifecycle shapes are asserted at each public entry point */
function snapshotLockInput<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null || types.isProxy(value))
    throw internal();
  try {
    return Object.freeze(JSON.parse(canonicalizeJson(value)) as Value);
  } catch {
    throw internal();
  }
}

function requestRecord(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new LeasePolicyError("invalid_input");
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== keys.length ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    names.some((name) => !keys.includes(name))
  )
    throw new LeasePolicyError("invalid_input");
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor))
      throw new LeasePolicyError("invalid_input");
    result[key] = descriptor.value;
  }
  return result;
}

function requestRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new LeasePolicyError("invalid_input");
  return value;
}

function requestFingerprint(value: unknown): PathFingerprint {
  const record = requestRecord(value, ["kind", "size", "sha256"]);
  if (
    record.kind !== "file" ||
    typeof record.size !== "number" ||
    !Number.isSafeInteger(record.size) ||
    record.size < 0 ||
    typeof record.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(record.sha256)
  )
    throw new LeasePolicyError("invalid_input");
  return Object.freeze({
    kind: "file",
    size: record.size,
    sha256: record.sha256,
  });
}

function requestGuard(value: unknown): LeaseGuard {
  const record = requestRecord(value, [
    "resource",
    "owner",
    "leaseId",
    "fencingToken",
    "stateRevision",
    "leaseFingerprint",
    "eventsFingerprint",
  ]);
  if (typeof record.resource !== "string" || typeof record.owner !== "string")
    throw new LeasePolicyError("invalid_input");
  lockPaths(record.resource);
  parseOwner(record.owner);
  if (
    typeof record.leaseId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(record.leaseId) ||
    typeof record.fencingToken !== "number" ||
    !Number.isSafeInteger(record.fencingToken) ||
    record.fencingToken < 0
  )
    throw new LeasePolicyError("invalid_input");
  const guard: LeaseGuard = {
    resource: record.resource as LeaseResource,
    owner: record.owner,
    leaseId: record.leaseId,
    fencingToken: record.fencingToken,
    stateRevision: requestRevision(record.stateRevision),
    leaseFingerprint: requestFingerprint(record.leaseFingerprint),
    eventsFingerprint: requestFingerprint(record.eventsFingerprint),
  };
  validateObservedGuard(guard);
  return Object.freeze(guard);
}

function requestObservedIdentity(value: unknown): EventV1["observedIdentity"] {
  const record = requestRecord(value, ["host", "model"]);
  if (
    typeof record.host !== "string" ||
    (typeof record.model !== "string" && record.model !== null)
  )
    throw new LeasePolicyError("invalid_input");
  return Object.freeze({ host: record.host, model: record.model });
}

function validateAcquireRequest(value: unknown): AcquireLeaseRequest {
  const record = requestRecord(value, [
    "resource",
    "owner",
    "ttlMs",
    "stateRevision",
    "observedIdentity",
  ]);
  if (
    typeof record.resource !== "string" ||
    typeof record.owner !== "string" ||
    typeof record.ttlMs !== "number"
  )
    throw new LeasePolicyError("invalid_input");
  lockPaths(record.resource);
  parseOwner(record.owner);
  return Object.freeze({
    resource: record.resource as LeaseResource,
    owner: record.owner,
    ttlMs: validateTtl(record.ttlMs),
    stateRevision: requestRevision(record.stateRevision),
    observedIdentity: requestObservedIdentity(record.observedIdentity),
  });
}

function validateRenewRequest(value: unknown): RenewLeaseRequest {
  const record = requestRecord(value, [
    "observed",
    "ttlMs",
    "resultingStateRevision",
    "observedIdentity",
  ]);
  if (typeof record.ttlMs !== "number")
    throw new LeasePolicyError("invalid_input");
  return Object.freeze({
    observed: requestGuard(record.observed),
    ttlMs: validateTtl(record.ttlMs),
    resultingStateRevision: requestRevision(record.resultingStateRevision),
    observedIdentity: requestObservedIdentity(record.observedIdentity),
  });
}

function validateReleaseRequest(value: unknown): ReleaseLeaseRequest {
  const record = requestRecord(value, ["observed", "observedIdentity"]);
  return Object.freeze({
    observed: requestGuard(record.observed),
    observedIdentity: requestObservedIdentity(record.observedIdentity),
  });
}

function validateTakeoverRequest(value: unknown): TakeoverLeaseRequest {
  const record = requestRecord(value, [
    "observed",
    "owner",
    "ttlMs",
    "stateRevision",
    "observedIdentity",
  ]);
  if (typeof record.owner !== "string" || typeof record.ttlMs !== "number")
    throw new LeasePolicyError("invalid_input");
  parseOwner(record.owner);
  return Object.freeze({
    observed: requestGuard(record.observed),
    owner: record.owner,
    ttlMs: validateTtl(record.ttlMs),
    stateRevision: requestRevision(record.stateRevision),
    observedIdentity: requestObservedIdentity(record.observedIdentity),
  });
}

function outcomeFailure(error: unknown): LeaseOutcome {
  if (error instanceof LockFailure) {
    return {
      kind:
        error.reasonCode === "runtime.state_corrupt"
          ? "corrupt"
          : error.reasonCode === "runtime.recovery_required"
            ? "recovery_required"
            : "internal_failure",
      evidence: error.evidence.map((entry) => entry.ref),
    };
  }
  if (error instanceof TransactionFailure) {
    return {
      kind:
        error.reasonCode === "runtime.revision_conflict"
          ? "revision_conflict"
          : error.reasonCode === "runtime.recovery_required"
            ? "recovery_required"
            : error.reasonCode === "runtime.state_corrupt"
              ? "corrupt"
              : "internal_failure",
      evidence: error.evidence.map((entry) => entry.ref),
    };
  }
  return { kind: "internal_failure", evidence: [] };
}
/* v8 ignore stop */

/**
 * A renewal prepared but not published, so a caller's own protected
 * transaction can publish it together with the caller's writes.
 *
 * The binding carries the exact serialized bytes rather than only the objects.
 * Re-serializing the lease or the event downstream could produce bytes that
 * differ from the ones the lifecycle hash chain was computed over, which would
 * make an honest renewal read as tampering.
 *
 * A binding is evidence of what the caller believed when it was built, never
 * proof that the belief still holds. Authority is re-derived from durable state
 * at the moment of publication.
 */
export interface LeaseGuardBinding {
  readonly guard: LeaseGuard;
  readonly renewedLease: LockLeaseV1;
  readonly lifecycleEvent: EventV1;
  readonly leaseText: string;
  readonly eventsText: string;
  readonly expected: readonly [EventStorePrecondition, EventStorePrecondition];
}

/**
 * Prepare the renewal a guarded transaction will publish.
 *
 * No durable claim is taken here. Holding one across the caller's whole
 * transaction would wedge the resource whenever a caller died mid-flight, which
 * is the failure this subsystem exists to prevent. The claim is taken at the
 * publication point instead, and the authority check is re-derived there.
 */
export async function prepareLeaseGuard(
  request: RenewLeaseRequest,
  services: LockServices,
): Promise<LeaseGuardBinding> {
  const input = validateRenewRequest(request);
  const resource = input.observed.resource;
  const inspection = await inspectLeaseHeld(resource, services);
  const decision = decideRenew({
    now: services.clock.now(),
    current: currentBinding(inspection),
    expectedIdentity: input.observed,
    ttlMs: input.ttlMs,
    stateRevision: input.resultingStateRevision,
  });
  const paths = lockPaths(resource);
  if (decision.kind !== "transition")
    throw new LockFailure("runtime.lease_conflict", [
      { kind: "artifact", ref: paths.lease },
    ]);
  const prepared = prepareLeaseTransition(
    {
      action: decision.action,
      priorEvents: await services.durableFileSystem.readText(paths.events),
      lease: decision.lease,
      leaseRef: paths.lease,
      eventId: services.ids.next(),
      occurredAt: services.clock.now().toISOString(),
      observedIdentity: input.observedIdentity,
    },
    { ...services, isProxy: types.isProxy, isPromise: types.isPromise },
  );
  // A renewal that leaves the lease byte-identical writes no evidence that this
  // transaction was ever authorized, and a durable write from a state to itself
  // is what the transaction machinery reads as corruption. A protected mutation
  // advances the state revision, so this is a malformed request, not a race.
  const current = expectedLeaseFile(inspection);
  if (
    current.kind === "file" &&
    current.sha256 === services.digests.sha256(prepared.leaseText)
  )
    throw internal();
  return Object.freeze({
    guard: input.observed,
    renewedLease: prepared.lease,
    lifecycleEvent: prepared.event,
    leaseText: prepared.leaseText,
    eventsText: prepared.eventsText,
    expected: Object.freeze([
      Object.freeze({
        path: paths.events,
        expected: expectedEventsFile(inspection),
      }),
      Object.freeze({
        path: paths.lease,
        expected: expectedLeaseFile(inspection),
      }),
    ] as const),
  });
}

function expectedLeaseFile(inspection: ClaimInspection): PathFingerprint {
  return inspection.guard?.leaseFingerprint ?? { kind: "missing" };
}

function expectedEventsFile(inspection: ClaimInspection): PathFingerprint {
  return inspection.guard?.eventsFingerprint ?? { kind: "missing" };
}

function preparedPlan(
  prepared: ReturnType<typeof prepareLeaseTransition>,
  inspection: ClaimInspection,
  services: LockServices,
) {
  const paths = lockPaths(prepared.lease.resource);
  const fingerprint = (content: string) =>
    Object.freeze({
      kind: "file" as const,
      size: new TextEncoder().encode(content).byteLength,
      sha256: services.digests.sha256(content),
    });
  return {
    operations: [
      {
        operationId: "operation-0001",
        kind: "write_file" as const,
        path: paths.events,
        expected: expectedEventsFile(inspection),
        result: fingerprint(prepared.eventsText),
        stagedPath: "staging/operation-0001.payload",
        content: prepared.eventsText,
      },
      {
        operationId: "operation-0002",
        kind: "write_file" as const,
        path: paths.lease,
        expected: expectedLeaseFile(inspection),
        result: fingerprint(prepared.leaseText),
        stagedPath: "staging/operation-0002.payload",
        content: prepared.leaseText,
      },
    ],
  };
}

async function publishLeaseTransition(
  action: "acquire" | "renew" | "release" | "takeover",
  lease: LockLeaseV1,
  inspection: ClaimInspection,
  observedIdentity: EventV1["observedIdentity"],
  services: LockServices,
) {
  const paths = lockPaths(lease.resource);
  const prepared = prepareLeaseTransition(
    {
      action,
      priorEvents:
        inspection.guard === null
          ? ""
          : await services.durableFileSystem.readText(paths.events),
      lease,
      leaseRef: paths.lease,
      eventId: services.ids.next(),
      occurredAt: services.clock.now().toISOString(),
      observedIdentity,
    },
    { ...services, isProxy: types.isProxy, isPromise: types.isPromise },
  );
  await createDirectoryIfMissing(".brain/transactions", services);
  const receipt = await executeManagedMutation(
    preparedPlan(prepared, inspection, services),
    { rootMode: "existing" },
    transactionServices(services),
  );
  /* v8 ignore next -- managed transaction recovery is covered at its boundary */
  if (receipt.phase !== "committed")
    throw new LockFailure("runtime.recovery_required", [
      {
        kind: "artifact",
        ref: `.brain/transactions/${receipt.transactionId}/progress.json`,
      },
    ]);
  const next = await inspectLeaseHeld(
    lease.resource as LeaseResource,
    services,
  );
  /* v8 ignore next -- a committed transition is verified before publication */
  if (next.guard === null || next.lease === null) throw corrupt(paths.lease);
  return Object.freeze({
    lease: next.lease,
    guard: next.guard,
    event: prepared.event,
  });
}

async function completeWithClaim<Outcome>(
  resource: LeaseResource,
  claim: ObservedLockClaim,
  services: LockServices,
  operation: () => Promise<Outcome>,
): Promise<Outcome> {
  let result: Outcome | undefined;
  let operationFailure: unknown;
  try {
    result = await operation();
  } catch (error) {
    /* v8 ignore start -- lifecycle operation failures are covered by claim cleanup tests */
    operationFailure = error;
    /* v8 ignore stop */
  }
  let released: ReleaseClaimOutcome;
  try {
    released = await releaseClaim({ resource, observed: claim }, services);
  } catch {
    /* v8 ignore start -- claim release recovery is covered at the claim boundary */
    throw new LockFailure("runtime.recovery_required", [
      { kind: "artifact", ref: lockPaths(resource).claim },
    ]);
    /* v8 ignore stop */
  }
  /* v8 ignore next -- a held exact claim either releases or enters claim recovery */
  if (released.kind !== "released")
    throw new LockFailure("runtime.recovery_required", [
      { kind: "artifact", ref: lockPaths(resource).claim },
    ]);
  /* v8 ignore next -- lifecycle operation failures are covered by claim cleanup tests */
  if (operationFailure !== undefined) {
    if (operationFailure instanceof Error) throw operationFailure;
    throw internal();
  }
  return result as Outcome;
}

function currentBinding(inspection: ClaimInspection) {
  /* v8 ignore next -- callers inspect a bound lease before selecting its policy action */
  if (inspection.lease === null) throw corrupt(".brain/locks");
  return {
    action:
      inspection.kind === "released"
        ? "release"
        : inspection.kind === "takeover_eligible"
          ? "acquire"
          : "acquire",
    lease: inspection.lease,
  } as const;
}

async function releasedOutcome(
  inspection: ClaimInspection,
  observed: LeaseGuard,
  services: LockServices,
): Promise<Extract<LeaseOutcome, { readonly kind: "released" }> | null> {
  if (
    inspection.kind !== "released" ||
    inspection.lease === null ||
    inspection.guard === null ||
    !sameGuard(inspection.guard, observed)
  )
    return null;
  const paths = lockPaths(observed.resource);
  let binding: ReturnType<typeof verifyLeaseBinding>;
  try {
    binding = verifyLeaseBinding(
      await services.durableFileSystem.readText(paths.events),
      await services.durableFileSystem.readText(paths.lease),
      { ...services, isProxy: types.isProxy, isPromise: types.isPromise },
    );
  } catch {
    /* v8 ignore start -- inspectLeaseHeld has already verified these exact artifacts */
    throw corrupt(paths.lease);
    /* v8 ignore stop */
  }
  /* v8 ignore next -- an inspection classified released has a release final event */
  if (binding.action !== "release") throw corrupt(paths.events);
  return Object.freeze({
    kind: "released" as const,
    lease: binding.lease,
    guard: inspection.guard,
    event: binding.event,
  });
}

/** Compose one durable lifecycle service over either fake or Node storage. */
export function createLocks(services: LockServices): Locks {
  return Object.freeze({
    inspect: async (resource: LeaseResource) => {
      const input = snapshotLockInput({ resource });
      return inspectLease(input.resource, services);
    },
    acquire: async (request: AcquireLeaseRequest): Promise<LeaseOutcome> => {
      try {
        const input = validateAcquireRequest(request);
        const proposed = decideAcquire({
          now: services.clock.now(),
          current: null,
          resource: input.resource,
          owner: input.owner,
          leaseId: services.ids.next(),
          ttlMs: input.ttlMs,
          stateRevision: input.stateRevision,
        });
        const beforeClaim = await inspectLease(input.resource, services);
        if (
          beforeClaim.kind === "active" ||
          beforeClaim.kind === "skew" ||
          beforeClaim.kind === "takeover_eligible"
        ) {
          return {
            kind: "conflict" as const,
            conflict: leaseConflict(
              beforeClaim,
              input.resource,
              input.owner,
              services.clock.now().toISOString(),
            ).conflict,
          };
        }
        const claim = await acquireClaim(
          {
            resource: input.resource,
            owner: input.owner,
            observed: beforeClaim.guard,
          },
          services,
        );
        if ("kind" in claim)
          return { kind: "conflict" as const, conflict: claim.conflict };
        return await completeWithClaim(
          input.resource,
          claim,
          services,
          async () => {
            const inspection = await inspectLeaseHeld(input.resource, services);
            const decision = decideAcquire({
              now: services.clock.now(),
              current:
                inspection.lease === null ? null : currentBinding(inspection),
              resource: input.resource,
              owner: input.owner,
              leaseId:
                /* v8 ignore next -- a held claim serializes acquisition, so the provisional decision is always a transition */
                proposed.kind === "transition"
                  ? proposed.lease.leaseId
                  : services.ids.next(),
              ttlMs: input.ttlMs,
              stateRevision: input.stateRevision,
            });
            /* v8 ignore next -- claim ownership serializes this second acquisition decision */
            if (decision.kind !== "transition") {
              if (inspection.lease === null)
                throw corrupt(lockPaths(input.resource).lease);
              return {
                kind: "conflict" as const,
                conflict: leaseConflict(
                  inspection,
                  input.resource,
                  input.owner,
                  services.clock.now().toISOString(),
                ).conflict,
              };
            }
            const published = await publishLeaseTransition(
              decision.action,
              decision.lease,
              inspection,
              input.observedIdentity,
              services,
            );
            return { kind: "acquired", ...published } as const;
          },
        );
      } catch (error) {
        /* v8 ignore start -- acquire validation and managed-mutation failures map through outcomeFailure */
        return outcomeFailure(error);
        /* v8 ignore stop */
      }
    },
    renew: async (request: RenewLeaseRequest): Promise<LeaseOutcome> => {
      try {
        const input = validateRenewRequest(request);
        const claim = await acquireClaim(
          {
            resource: input.observed.resource,
            owner: input.observed.owner,
            observed: input.observed,
          },
          services,
        );
        if ("kind" in claim)
          return { kind: "conflict" as const, conflict: claim.conflict };
        return await completeWithClaim(
          input.observed.resource,
          claim,
          services,
          async () => {
            const inspection = await inspectLeaseHeld(
              input.observed.resource,
              services,
            );
            const decision = decideRenew({
              now: services.clock.now(),
              current: currentBinding(inspection),
              expectedIdentity: input.observed,
              ttlMs: input.ttlMs,
              stateRevision: input.resultingStateRevision,
            });
            /* v8 ignore next -- claim ownership serializes this second renewal decision */
            if (decision.kind !== "transition")
              return {
                kind: "conflict" as const,
                conflict: leaseConflict(
                  inspection,
                  input.observed.resource,
                  input.observed.owner,
                  services.clock.now().toISOString(),
                ).conflict,
              };
            const published = await publishLeaseTransition(
              decision.action,
              decision.lease,
              inspection,
              input.observedIdentity,
              services,
            );
            return { kind: "renewed", ...published } as const;
          },
        );
      } catch (error) {
        return outcomeFailure(error);
      }
    },
    release: async (request: ReleaseLeaseRequest): Promise<LeaseOutcome> => {
      try {
        const input = validateReleaseRequest(request);
        const beforeClaim = await inspectLease(
          input.observed.resource,
          services,
        );
        const completed = await releasedOutcome(
          beforeClaim,
          input.observed,
          services,
        );
        if (completed !== null) return completed;
        const claim = await acquireClaim(
          {
            resource: input.observed.resource,
            owner: input.observed.owner,
            observed: input.observed,
          },
          services,
        );
        if ("kind" in claim)
          return { kind: "conflict" as const, conflict: claim.conflict };
        return await completeWithClaim(
          input.observed.resource,
          claim,
          services,
          async () => {
            const inspection = await inspectLeaseHeld(
              input.observed.resource,
              services,
            );
            const decision = decideRelease({
              now: services.clock.now(),
              current: currentBinding(inspection),
              expectedIdentity: input.observed,
              stateRevision: input.observed.stateRevision,
            });
            /* v8 ignore next -- claim ownership serializes this second release decision */
            if (decision.kind !== "transition")
              return {
                kind: "conflict" as const,
                conflict: leaseConflict(
                  inspection,
                  input.observed.resource,
                  input.observed.owner,
                  services.clock.now().toISOString(),
                ).conflict,
              };
            const published = await publishLeaseTransition(
              decision.action,
              decision.lease,
              inspection,
              input.observedIdentity,
              services,
            );
            return { kind: "released", ...published } as const;
          },
        );
      } catch (error) {
        return outcomeFailure(error);
      }
    },
    takeover: async (request: TakeoverLeaseRequest): Promise<LeaseOutcome> => {
      try {
        const input = validateTakeoverRequest(request);
        const claim = await acquireClaim(
          {
            resource: input.observed.resource,
            owner: input.owner,
            observed: input.observed,
          },
          services,
        );
        /* v8 ignore next -- claim conflicts are exercised by acquire and renew admission paths */
        if ("kind" in claim)
          return { kind: "conflict" as const, conflict: claim.conflict };
        return await completeWithClaim(
          input.observed.resource,
          claim,
          services,
          async () => {
            const inspection = await inspectLeaseHeld(
              input.observed.resource,
              services,
            );
            const decision = decideTakeover({
              now: services.clock.now(),
              current: currentBinding(inspection),
              expectedIdentity: input.observed,
              owner: input.owner,
              leaseId: services.ids.next(),
              ttlMs: input.ttlMs,
              stateRevision: input.stateRevision,
            });
            /* v8 ignore next -- claim ownership serializes this second takeover decision */
            if (decision.kind !== "transition")
              return {
                kind: "conflict" as const,
                conflict: leaseConflict(
                  inspection,
                  input.observed.resource,
                  input.owner,
                  services.clock.now().toISOString(),
                ).conflict,
              };
            const published = await publishLeaseTransition(
              decision.action,
              decision.lease,
              inspection,
              input.observedIdentity,
              services,
            );
            return { kind: "taken_over", ...published } as const;
          },
        );
      } catch (error) {
        return outcomeFailure(error);
      }
    },
  });
}
