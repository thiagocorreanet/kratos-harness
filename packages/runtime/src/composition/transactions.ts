import {
  CONTRACT_VERSIONS,
  type TransactionManifestV1,
  type TransactionProgressV1,
} from "@kratos/contracts";
import { types } from "node:util";

import type { EvidenceRef } from "../domain/result/index.js";
import type { LeaseGuardBinding } from "./locks.js";
import {
  canonicalizeJson,
  type SchemaRegistry,
} from "../domain/schema/index.js";
import {
  assertPhaseTransition,
  decideRecovery,
  isManagedDestination,
  isManagedDirectoryDestination,
  toPersistedManagedOperation,
  type ManagedMutationPlan,
  type ManagedOperation,
  type PathFingerprint,
} from "../domain/transactions/index.js";
import type {
  Clock,
  Digests,
  DurableEntry,
  DurableFileSystem,
  Ids,
} from "../ports/index.js";

const contractVersion = "1.0.0" as const;
const stateContract = "1.0.0" as const;
const transactionsRoot = ".brain/transactions";
const lockNamespace = ".brain/locks";
const lockScope = /^\.brain\/locks\/(project|runs\/[A-Za-z0-9._:-]{1,128})\//u;

export interface TransactionReceipt {
  readonly transactionId: string;
  readonly manifestDigest: string | null;
  readonly recoveryToken: string;
  readonly phase: "committed" | "aborted";
  readonly directorySync: "not_attempted" | "supported" | "unsupported";
}

export interface TransactionSummary {
  readonly transactionId: string;
  readonly manifestDigest: string | null;
  readonly recoveryToken: string;
  readonly phase: TransactionProgressV1["phase"];
  readonly evidenceRef: string;
}

export interface TransactionServices {
  readonly clock: Clock;
  readonly ids: Ids;
  readonly digests: Digests;
  readonly durableFileSystem: DurableFileSystem;
  readonly schemaRegistry: SchemaRegistry;
}

export interface EventStorePrecondition {
  readonly path: string;
  readonly expected: PathFingerprint;
}

export interface ExecuteManagedMutationOptions {
  readonly rootMode: "existing" | "initialize";
  readonly eventStorePreconditions?: readonly EventStorePrecondition[];
  /** Read-only authority facts that must still hold at publication time. */
  readonly guardPreconditions?: readonly EventStorePrecondition[];
  /**
   * Authority for a protected caller mutation. Present means the caller claims
   * to hold a lease; it never means the claim is still true, which is re-derived
   * from durable state at publication.
   */
  readonly leaseGuard?: LeaseGuardBinding;
}

interface TransactionFailureContext {
  transactionId?: string;
  recoveryToken?: string;
  validatedRecovery: boolean;
  publishingAuthorized: boolean;
}

export class TransactionFailure extends Error {
  public constructor(
    public readonly reasonCode:
      | "guard.outside_allow"
      | "runtime.internal_failure"
      | "runtime.lease_conflict"
      | "runtime.recovery_required"
      | "runtime.revision_conflict"
      | "runtime.state_corrupt"
      | "contract.state_version_invalid"
      | "contract.state_version_unsupported",
    public readonly evidence: readonly EvidenceRef[],
  ) {
    super("Managed transaction failed");
    this.name = "TransactionFailure";
  }
}

export async function executeManagedMutation(
  plan: ManagedMutationPlan,
  options: ExecuteManagedMutationOptions,
  services: TransactionServices,
): Promise<TransactionReceipt> {
  let frozenPlan: ManagedMutationPlan;
  let frozenOptions: ExecuteManagedMutationOptions;
  try {
    frozenOptions = freezeExecuteOptions(options);
    frozenPlan = freezeManagedPlan(plan, services);
    if (frozenOptions.leaseGuard !== undefined) {
      frozenPlan = bindLeaseGuard(
        frozenPlan,
        frozenOptions.leaseGuard,
        services,
      );
    }
  } catch (error) {
    if (error instanceof TransactionFailure) throw error;
    throw new TransactionFailure("runtime.internal_failure", []);
  }
  const attempt: TransactionFailureContext = {
    validatedRecovery: false,
    publishingAuthorized: false,
  };
  try {
    // applyPlan performs this preflight before observing caller destinations;
    // repeat it here after normalization to close that asynchronous race.
    await preflightManagedTransactions(frozenOptions, services);
    await assertDeclaredEventStorePreconditions(
      frozenOptions.eventStorePreconditions,
      services,
    );
    await assertDeclaredGuardPreconditions(
      frozenOptions.guardPreconditions,
      services,
    );
    return await driveExecution(frozenPlan, frozenOptions, services, attempt);
  } catch (error) {
    return classifyDriverFailure(error, services, attempt);
  }
}

function freezeExecuteOptions(value: unknown): ExecuteManagedMutationOptions {
  try {
    const root = exactData(
      value,
      [
        "rootMode",
        "eventStorePreconditions",
        "guardPreconditions",
        "leaseGuard",
      ],
      true,
    );
    const rootMode = root.rootMode;
    if (rootMode !== "existing" && rootMode !== "initialize") throw new Error();
    const leaseGuard = freezeLeaseGuard(root);
    const guardPreconditions = freezeGuardPreconditions(root);
    if (!("eventStorePreconditions" in root)) {
      return {
        rootMode,
        ...(guardPreconditions === undefined ? {} : { guardPreconditions }),
        ...(leaseGuard === undefined ? {} : { leaseGuard }),
      };
    }
    const tuple = root.eventStorePreconditions;
    if (
      !Array.isArray(tuple) ||
      types.isProxy(tuple) ||
      Object.getPrototypeOf(tuple) !== Array.prototype ||
      tuple.length === 0 ||
      tuple.length % 2 !== 0 ||
      Reflect.ownKeys(tuple).length !== tuple.length + 1
    )
      throw new Error();
    const preconditions: EventStorePrecondition[] = [];
    for (let index = 0; index < tuple.length; index += 1)
      preconditions.push(freezePrecondition(arrayData(tuple, index)));
    // A run lives under the feature that opened it, so the pair this
    // transaction may fence is identified by both names, not by the run alone.
    const match =
      /^\.brain\/02-features\/([a-z0-9][a-z0-9-]{0,63})\/runs\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\/(events\.jsonl|state\.json)$/u;
    const destinations = new Set<string>();
    for (let index = 0; index < preconditions.length; index += 2) {
      const firstPrecondition = preconditions[index];
      const secondPrecondition = preconditions[index + 1];
      if (firstPrecondition === undefined || secondPrecondition === undefined)
        throw new Error();
      const left = match.exec(firstPrecondition.path);
      const right = match.exec(secondPrecondition.path);
      if (
        left === null ||
        right === null ||
        left[3] !== "events.jsonl" ||
        right[3] !== "state.json" ||
        left[1] !== right[1] ||
        left[2] !== right[2] ||
        left[1] === undefined ||
        left[2] === undefined
      )
        throw new Error();
      const destination = `${left[1]}\u0000${left[2]}`;
      if (destinations.has(destination)) throw new Error();
      destinations.add(destination);
    }
    const frozenPreconditions = Object.freeze(preconditions);
    return {
      rootMode,
      eventStorePreconditions: frozenPreconditions,
      ...(guardPreconditions === undefined ? {} : { guardPreconditions }),
      ...(leaseGuard === undefined ? {} : { leaseGuard }),
    };
  } catch {
    throw new TransactionFailure("runtime.internal_failure", []);
  }
}

function freezeGuardPreconditions(
  root: Record<string, unknown>,
): readonly EventStorePrecondition[] | undefined {
  if (!("guardPreconditions" in root)) return undefined;
  const entries = root.guardPreconditions;
  if (
    !Array.isArray(entries) ||
    types.isProxy(entries) ||
    Object.getPrototypeOf(entries) !== Array.prototype ||
    entries.length === 0 ||
    entries.length > 256 ||
    Reflect.ownKeys(entries).length !== entries.length + 1
  )
    throw new Error();
  const frozen = entries.map((_, index) =>
    freezePrecondition(arrayData(entries, index)),
  );
  const paths = new Set<string>();
  for (const entry of frozen) {
    const key = entry.path.toLowerCase();
    if (!isManagedDestination(entry.path) || paths.has(key)) throw new Error();
    paths.add(key);
  }
  return Object.freeze(frozen);
}

/** A frozen plain object, refusing a proxy or an exotic prototype. */
function plainObject(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error();
  return Object.freeze({ ...(value as Record<string, unknown>) });
}

/**
 * Structurally validate a caller-supplied lease guard binding.
 *
 * This proves the shape only, which is why the result is asserted rather than
 * inferred: whether the guard still holds authority is a question about durable
 * state, answered at publication by `assertLeaseAuthority` and never here. The
 * transaction reads only the serialized bytes and their preconditions, so the
 * carried lease and event objects are checked for shape and passed through.
 */
function freezeLeaseGuard(
  root: Record<string, unknown>,
): LeaseGuardBinding | undefined {
  if (!("leaseGuard" in root)) return undefined;
  const binding = exactData(root.leaseGuard, [
    "guard",
    "renewedLease",
    "lifecycleEvent",
    "leaseText",
    "eventsText",
    "expected",
  ]);
  if (
    typeof binding.leaseText !== "string" ||
    typeof binding.eventsText !== "string"
  )
    throw new Error();
  const expected = binding.expected;
  if (
    !Array.isArray(expected) ||
    types.isProxy(expected) ||
    Object.getPrototypeOf(expected) !== Array.prototype ||
    expected.length !== 2 ||
    Reflect.ownKeys(expected).length !== 3
  )
    throw new Error();
  const pair: readonly [EventStorePrecondition, EventStorePrecondition] = [
    freezePrecondition(arrayData(expected, 0)),
    freezePrecondition(arrayData(expected, 1)),
  ];
  // The reserved writes are the lock's own events log and lease file, in that
  // order. Anything else means the binding was not built by prepareLeaseGuard.
  if (
    !reservedGuardPath(pair[0].path, "events.jsonl") ||
    !reservedGuardPath(pair[1].path, "lease.json")
  )
    throw new Error();
  return Object.freeze({
    guard: plainObject(binding.guard),
    renewedLease: plainObject(binding.renewedLease),
    lifecycleEvent: plainObject(binding.lifecycleEvent),
    leaseText: binding.leaseText,
    eventsText: binding.eventsText,
    expected: Object.freeze(pair),
  }) as unknown as LeaseGuardBinding;
}

/**
 * The one path under a run whose drift is trail evidence rather than an
 * ordinary artifact. A run lives under the feature that opened it.
 */
const EVENT_STREAM_PATH =
  /^\.brain\/02-features\/[a-z0-9][a-z0-9-]{0,63}\/runs\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\/events\.jsonl$/u;

function reservedGuardPath(path: string, name: string): boolean {
  return lockScope.test(path) && path.endsWith(`/${name}`);
}

/**
 * Prepend the reserved lock writes a guarded transaction publishes on the
 * caller's behalf, and renumber the caller's own effects behind them.
 *
 * Publishing the renewal first is what makes the fence hold. Once the renewed
 * lease is durable, a takeover observes a live lease and its own policy refuses
 * it, so no third party can slip between the last authority check and the
 * caller's writes.
 */
function bindLeaseGuard(
  plan: ManagedMutationPlan,
  binding: LeaseGuardBinding,
  services: TransactionServices,
): ManagedMutationPlan {
  for (const operation of plan.operations) {
    // Only this function may write under the lock namespace. A caller reaching
    // in directly could forge the very authority it is being checked for.
    if (
      operation.path === lockNamespace ||
      operation.path.startsWith(`${lockNamespace}/`)
    ) {
      throw new TransactionFailure("guard.outside_allow", []);
    }
  }
  const [events, lease] = binding.expected;
  const operations: readonly ManagedOperation[] = [
    reservedGuardWrite(0, events, binding.eventsText, services),
    reservedGuardWrite(1, lease, binding.leaseText, services),
    ...plan.operations.map((operation, index) =>
      renumbered(operation, index + 2),
    ),
  ];
  validateManagedRelationships(operations);
  return { operations };
}

function reservedGuardWrite(
  index: number,
  precondition: EventStorePrecondition,
  content: string,
  services: TransactionServices,
): ManagedOperation {
  const operationId = operationIdAt(index);
  return {
    operationId,
    kind: "write_file",
    path: precondition.path,
    expected: precondition.expected,
    result: contentFingerprint(content, services),
    stagedPath: `staging/${operationId}.payload`,
    content,
  };
}

function renumbered(
  operation: ManagedOperation,
  index: number,
): ManagedOperation {
  const operationId = operationIdAt(index);
  return operation.kind === "write_file"
    ? {
        ...operation,
        operationId,
        stagedPath: `staging/${operationId}.payload`,
      }
    : { ...operation, operationId };
}

function operationIdAt(index: number): string {
  return `operation-${String(index + 1).padStart(4, "0")}`;
}

function contentFingerprint(
  content: string,
  services: TransactionServices,
): PathFingerprint {
  return {
    kind: "file",
    size: new TextEncoder().encode(content).byteLength,
    sha256: services.digests.sha256(content),
  };
}

/**
 * One lock artifact a guarded transaction depends on, in the only two states
 * its holder may legitimately observe: as it stood when the guard was prepared,
 * and as this transaction itself published it.
 */
interface GuardedArtifact {
  readonly path: string;
  readonly expected: PathFingerprint;
  readonly published: PathFingerprint;
}

type LeaseAuthority = readonly [GuardedArtifact, GuardedArtifact];

function bindingAuthority(
  binding: LeaseGuardBinding,
  services: TransactionServices,
): LeaseAuthority {
  const [events, lease] = binding.expected;
  return [
    {
      path: events.path,
      expected: events.expected,
      published: contentFingerprint(binding.eventsText, services),
    },
    {
      path: lease.path,
      expected: lease.expected,
      published: contentFingerprint(binding.leaseText, services),
    },
  ];
}

/**
 * Re-derive a crashed transaction's authority from its own manifest.
 *
 * The reserved writes already record both states the check needs, so fencing
 * survives a crash without adding a manifest property or changing its schema.
 * A lock's own lifecycle transaction writes exactly those two operations and
 * nothing else, so a longer plan is what marks a protected caller mutation.
 */
function manifestAuthority(
  manifest: TransactionManifestV1,
): LeaseAuthority | undefined {
  const [events, lease] = manifest.operations;
  if (
    lease === undefined ||
    manifest.operations.length <= 2 ||
    !reservedGuardPath(events.path, "events.jsonl") ||
    !reservedGuardPath(lease.path, "lease.json")
  ) {
    return undefined;
  }
  return [
    { path: events.path, expected: events.expected, published: events.result },
    { path: lease.path, expected: lease.expected, published: lease.result },
  ];
}

/**
 * Refuse to act unless the lock artifacts still stand where this transaction
 * left them. Any third state means another writer intervened, which makes this
 * worker's fencing token stale no matter what it believed when it started.
 */
async function assertLeaseAuthority(
  authority: LeaseAuthority | undefined,
  services: TransactionServices,
): Promise<void> {
  if (authority === undefined) return;
  for (const artifact of authority) {
    const observed = await observeFingerprint(artifact.path, services);
    if (
      !sameFingerprint(observed, artifact.expected) &&
      !sameFingerprint(observed, artifact.published)
    ) {
      throw new TransactionFailure(
        "runtime.lease_conflict",
        evidence(artifact.path),
      );
    }
  }
}

function exactData(
  value: unknown,
  allowed: readonly string[],
  optional = false,
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new Error();
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string" || !allowed.includes(key)) ||
    (!optional && keys.length !== allowed.length) ||
    (optional && (keys.length < 1 || keys.length > allowed.length))
  )
    throw new Error();
  const stringKeys = keys.filter(
    (key): key is string => typeof key === "string",
  );
  const copy: Record<string, unknown> = {};
  for (const key of stringKeys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (d === undefined || !("value" in d)) throw new Error();
    copy[key] = d.value;
  }
  if (!("rootMode" in copy) && allowed.includes("rootMode")) throw new Error();
  return copy;
}
function arrayData(value: unknown[], index: number): unknown {
  const d = Object.getOwnPropertyDescriptor(value, String(index));
  if (d === undefined || !("value" in d)) throw new Error();
  return d.value;
}
function freezePrecondition(value: unknown): EventStorePrecondition {
  const entry = exactData(value, ["path", "expected"]);
  if (typeof entry.path !== "string") throw new Error();
  return {
    path: entry.path,
    expected: freezeFingerprintStrict(entry.expected),
  };
}
function freezeFingerprintStrict(value: unknown): PathFingerprint {
  const entry = exactData(value, ["kind", "size", "sha256"], true);
  if (entry.kind === "missing" && Reflect.ownKeys(value as object).length === 1)
    return { kind: "missing" };
  if (
    entry.kind === "file" &&
    typeof entry.size === "number" &&
    Number.isSafeInteger(entry.size) &&
    entry.size >= 0 &&
    typeof entry.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(entry.sha256)
  )
    return { kind: "file", size: entry.size, sha256: entry.sha256 };
  throw new Error();
}

async function assertDeclaredEventStorePreconditions(
  entries: readonly EventStorePrecondition[] | undefined,
  services: TransactionServices,
): Promise<void> {
  if (entries === undefined) return;
  const evidence: EvidenceRef[] = [];
  for (const entry of entries) {
    let observed: PathFingerprint;
    try {
      const durable = await services.durableFileSystem.inspect(entry.path);
      if (durable.kind === "special" || durable.kind === "symlink") {
        evidence.push({
          kind: entry.path.endsWith("/events.jsonl") ? "event" : "artifact",
          ref: entry.path,
        });
        continue;
      }
      observed =
        durable.kind === "file"
          ? { kind: "file", size: durable.size, sha256: durable.sha256 }
          : durable.kind === "directory"
            ? { kind: "directory" }
            : { kind: "missing" };
    } catch {
      throw new TransactionFailure("runtime.internal_failure", []);
    }
    if (!sameFingerprint(observed, entry.expected)) {
      const kind = EVENT_STREAM_PATH.test(entry.path) ? "event" : "artifact";
      evidence.push({ kind, ref: entry.path });
    }
  }
  if (evidence.length !== 0)
    throw new TransactionFailure("runtime.revision_conflict", evidence);
}

async function assertDeclaredGuardPreconditions(
  entries: readonly EventStorePrecondition[] | undefined,
  services: TransactionServices,
): Promise<void> {
  if (entries === undefined) return;
  const changed: EvidenceRef[] = [];
  for (const entry of entries) {
    const observed = await observeFingerprint(entry.path, services);
    if (!sameFingerprint(observed, entry.expected)) {
      changed.push({ kind: "artifact", ref: entry.path });
    }
  }
  if (changed.length !== 0)
    throw new TransactionFailure("runtime.revision_conflict", changed);
}

/**
 * Reconcile safe orphans and reject every transaction requiring recovery.
 *
 * `reconcile: false` asks the same question without tidying anything, which is
 * what a preview needs: a read-only operation that cleared residue on its way
 * through would be neither read-only nor a preview of what happens next.
 */
export async function preflightManagedTransactions(
  options: { readonly rootMode: "existing" | "initialize" },
  services: TransactionServices,
  reconcile = true,
): Promise<void> {
  try {
    if (reconcile) await reconcileUnmarkedTransactions(services);
    await assertPreflightRoot(options.rootMode, services);
    await rejectIncompleteTransactions(services);
  } catch (error) {
    if (error instanceof TransactionFailure) throw error;
    throw new TransactionFailure("runtime.internal_failure", []);
  }
}

async function assertPreflightRoot(
  rootMode: "existing" | "initialize",
  services: TransactionServices,
): Promise<void> {
  const brain = await services.durableFileSystem.inspect(".brain");
  if (brain.kind === "missing" && rootMode === "initialize") return;
  if (brain.kind !== "directory") throw corrupt(".brain");
  const transactions =
    await services.durableFileSystem.inspect(transactionsRoot);
  if (transactions.kind === "missing" && rootMode === "initialize") {
    await assertInitializeNamespaceAvailable(false, services);
    return;
  }
  if (transactions.kind !== "directory") throw corrupt(transactionsRoot);
}

function freezeManagedPlan(
  value: unknown,
  services: TransactionServices,
): ManagedMutationPlan {
  if (
    !isExactRecord(value, ["operations"]) ||
    !Array.isArray(value.operations)
  ) {
    throw invalidPlan();
  }
  if (value.operations.length === 0) throw invalidPlan();

  const operations = value.operations.map((operation, index) =>
    freezeManagedOperation(operation, index, services),
  );
  validateManagedRelationships(operations);
  return { operations };
}

function freezeManagedOperation(
  value: unknown,
  index: number,
  services: TransactionServices,
): ManagedOperation {
  if (!isRecord(value)) throw invalidPlan();
  const operationId = operationIdAt(index);
  if (value.operationId !== operationId || typeof value.path !== "string") {
    throw invalidPlan();
  }
  assertCallerManagedDestination(value.path, value.kind);
  const expected = freezeFingerprint(value.expected);
  const result = freezeFingerprint(value.result);
  if (sameFingerprint(expected, result)) throw invalidPlan();

  switch (value.kind) {
    case "create_directory":
      if (
        !isExactRecord(value, [
          "expected",
          "kind",
          "operationId",
          "path",
          "result",
          "stagedPath",
        ]) ||
        value.stagedPath !== null ||
        expected.kind !== "missing" ||
        result.kind !== "directory"
      ) {
        throw invalidPlan();
      }
      return {
        operationId,
        kind: value.kind,
        path: value.path,
        expected,
        result,
        stagedPath: null,
      };
    case "write_file": {
      if (
        !isExactRecord(value, [
          "content",
          "expected",
          "kind",
          "operationId",
          "path",
          "result",
          "stagedPath",
        ]) ||
        value.stagedPath !== `staging/${operationId}.payload` ||
        typeof value.content !== "string" ||
        expected.kind === "directory" ||
        result.kind !== "file"
      ) {
        throw invalidPlan();
      }
      const contentSize = new TextEncoder().encode(value.content).byteLength;
      if (
        result.size !== contentSize ||
        result.sha256 !== services.digests.sha256(value.content)
      ) {
        throw invalidPlan();
      }
      return {
        operationId,
        kind: value.kind,
        path: value.path,
        expected,
        result,
        stagedPath: value.stagedPath,
        content: value.content,
      };
    }
    case "delete_file":
      if (
        !isExactRecord(value, [
          "expected",
          "kind",
          "operationId",
          "path",
          "result",
          "stagedPath",
        ]) ||
        value.stagedPath !== null ||
        expected.kind !== "file" ||
        result.kind !== "missing"
      ) {
        throw invalidPlan();
      }
      return {
        operationId,
        kind: value.kind,
        path: value.path,
        expected,
        result,
        stagedPath: null,
      };
    default:
      throw invalidPlan();
  }
}

function freezeFingerprint(value: unknown): PathFingerprint {
  if (!isRecord(value)) throw invalidPlan();
  switch (value.kind) {
    case "missing":
      if (!isExactRecord(value, ["kind"])) throw invalidPlan();
      return { kind: "missing" };
    case "directory":
      if (!isExactRecord(value, ["kind"])) throw invalidPlan();
      return { kind: "directory" };
    case "file":
      if (
        !isExactRecord(value, ["kind", "sha256", "size"]) ||
        !Number.isSafeInteger(value.size) ||
        typeof value.size !== "number" ||
        value.size < 0 ||
        typeof value.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(value.sha256)
      ) {
        throw invalidPlan();
      }
      return { kind: "file", size: value.size, sha256: value.sha256 };
    default:
      throw invalidPlan();
  }
}

function validateManagedRelationships(
  operations: readonly ManagedOperation[],
): void {
  const spellings = new Map<string, string>();
  for (const operation of operations) {
    for (const path of managedPathPrefixes(operation.path)) {
      const key = path.toLowerCase();
      const prior = spellings.get(key);
      if (prior !== undefined && prior !== path) throw invalidPlan();
      spellings.set(key, path);
    }
  }

  for (const [leftIndex, left] of operations.entries()) {
    for (const right of operations.slice(leftIndex + 1)) {
      const leftPath = left.path.toLowerCase();
      const rightPath = right.path.toLowerCase();
      if (leftPath === rightPath) throw invalidPlan();
      if (rightPath.startsWith(`${leftPath}/`)) {
        if (
          left.kind !== "create_directory" ||
          right.expected.kind !== "missing"
        ) {
          throw invalidPlan();
        }
      } else if (leftPath.startsWith(`${rightPath}/`)) {
        throw invalidPlan();
      }
    }
  }

  const createdDirectories = new Set<string>();
  for (const operation of operations) {
    let beneathCreatedDirectory = false;
    for (const prefix of managedPathPrefixes(operation.path).slice(0, -1)) {
      if (createdDirectories.has(prefix.toLowerCase())) {
        beneathCreatedDirectory = true;
      } else if (beneathCreatedDirectory) {
        throw invalidPlan();
      }
    }
    if (operation.kind === "create_directory") {
      createdDirectories.add(operation.path.toLowerCase());
    }
  }
}

function managedPathPrefixes(path: string): readonly string[] {
  const segments = path.split("/");
  return segments.map((_segment, index) =>
    segments.slice(0, index + 1).join("/"),
  );
}

/**
 * Refuse a destination the caller may not target, by what it does to it.
 *
 * A plan may create a host root and may not write a file at one, so the
 * question depends on the operation. An unknown kind fails the shape check
 * below this call, which is where a malformed plan belongs.
 */
function assertCallerManagedDestination(path: string, kind: unknown): void {
  const allowed =
    kind === "create_directory"
      ? isManagedDirectoryDestination(path)
      : isManagedDestination(path);
  if (!allowed) throw new TransactionFailure("guard.outside_allow", []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  const expected = [...expectedKeys].sort((left, right) =>
    left.localeCompare(right, "en-US"),
  );
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function invalidPlan(): TransactionFailure {
  return new TransactionFailure("runtime.state_corrupt", []);
}

async function driveExecution(
  plan: ManagedMutationPlan,
  options: ExecuteManagedMutationOptions,
  services: TransactionServices,
  attempt: TransactionFailureContext,
): Promise<TransactionReceipt> {
  const authority =
    options.leaseGuard === undefined
      ? undefined
      : bindingAuthority(options.leaseGuard, services);
  // A worker that has already lost the lease leaves no residue behind: the
  // refusal lands before this attempt creates a transaction directory at all.
  await assertLeaseAuthority(authority, services);
  await assertExistingRoot(options.rootMode, services);

  const transactionId = services.ids.next();
  attempt.transactionId = transactionId;
  const createdAt = services.clock.now().toISOString();
  const root = transactionRoot(transactionId);
  const stagingRoot = `${root}/staging`;
  const begunToken = services.digests.sha256(
    canonicalizeJson({
      contractVersion,
      stateContract,
      transactionId,
      createdAt,
    }),
  );
  let directorySync: TransactionProgressV1["directorySync"] = "not_attempted";

  const begun = validateProgress(
    {
      contractVersion,
      stateContract,
      transactionId,
      manifestDigest: null,
      recoveryToken: begunToken,
      phase: "begun",
      publishedOperationIds: [],
      fileSync: "required",
      directorySync,
      createdAt,
      updatedAt: services.clock.now().toISOString(),
    },
    services,
  );

  await services.durableFileSystem.createDirectoryExclusive(root);
  directorySync = mergeDirectorySync(
    directorySync,
    await services.durableFileSystem.syncDirectory(transactionsRoot),
  );
  directorySync = await persistProgress({ ...begun, directorySync }, services);

  await services.durableFileSystem.createDirectory(stagingRoot);
  directorySync = mergeDirectorySync(
    directorySync,
    await services.durableFileSystem.syncDirectory(root),
  );

  for (const operation of plan.operations) {
    if (operation.kind !== "write_file") continue;
    await services.durableFileSystem.writeSynced(
      stagedPayloadPath(root, operation),
      operation.content,
    );
    await assertExecutionPayload(operation, root, services);
    directorySync = mergeDirectorySync(
      directorySync,
      await services.durableFileSystem.syncDirectory(stagingRoot),
    );
  }

  const manifest = createManifest(
    plan,
    transactionId,
    createdAt,
    root,
    services,
  );
  const manifestEncoded = canonicalizeJson(manifest);
  const manifestDigest = services.digests.sha256(manifestEncoded);
  await services.durableFileSystem.writeSynced(
    `${root}/manifest.json`,
    `${manifestEncoded}\n`,
  );
  directorySync = mergeDirectorySync(
    directorySync,
    await services.durableFileSystem.syncDirectory(root),
  );

  await assertDeclaredGuardPreconditions(options.guardPreconditions, services);
  await assertPreconditions(manifest, services);
  let progress = validateProgress(
    {
      ...begun,
      manifestDigest,
      recoveryToken: manifestDigest,
      phase: "prepared",
      directorySync,
      updatedAt: services.clock.now().toISOString(),
    },
    services,
  );
  directorySync = await persistProgress(progress, services);

  // Authorizing publication is the last point at which a refusal still leaves a
  // transaction recovery can simply abort, so the guard is re-derived here.
  await assertLeaseAuthority(authority, services);
  await assertDeclaredGuardPreconditions(options.guardPreconditions, services);
  progress = validateProgress(
    {
      ...progress,
      phase: "publishing",
      directorySync,
      updatedAt: services.clock.now().toISOString(),
    },
    services,
  );
  directorySync = await persistProgress(progress, services);
  attempt.publishingAuthorized = true;

  const publishedOperationIds: string[] = [];
  for (const operation of plan.operations) {
    await assertLeaseAuthority(authority, services);
    await assertDeclaredGuardPreconditions(
      options.guardPreconditions,
      services,
    );
    await assertPublishable(operation, services);
    if (operation.kind === "write_file") {
      await assertExecutionPayload(operation, root, services);
    }
    await publishOperation(operation, root, services);
    directorySync = mergeDirectorySync(
      directorySync,
      await services.durableFileSystem.syncDirectory(parentOf(operation.path)),
    );
    await assertResult(operation, services);
    publishedOperationIds.push(operation.operationId);
    progress = validateProgress(
      {
        ...progress,
        publishedOperationIds: [...publishedOperationIds],
        directorySync,
        updatedAt: services.clock.now().toISOString(),
      },
      services,
    );
    directorySync = await persistProgress(progress, services);
  }

  await assertResults(manifest, services);
  await assertDeclaredGuardPreconditions(options.guardPreconditions, services);
  progress = validateProgress(
    {
      ...progress,
      phase: "committed",
      publishedOperationIds: manifest.operations.map(
        (operation) => operation.operationId,
      ),
      directorySync,
      updatedAt: services.clock.now().toISOString(),
    },
    services,
  );
  directorySync = await persistProgress(progress, services);

  directorySync = await cleanupTransaction(manifest, directorySync, services);
  progress = await persistTerminalDirectorySync(
    progress,
    directorySync,
    services,
  );
  return receiptFromProgress(progress);
}

export async function inspectManagedTransactions(
  services: TransactionServices,
): Promise<readonly TransactionSummary[]> {
  const brain = await services.durableFileSystem.inspect(".brain");
  if (brain.kind === "missing") return [];
  if (brain.kind !== "directory") {
    throw corrupt(".brain");
  }
  const transactions =
    await services.durableFileSystem.inspect(transactionsRoot);
  if (transactions.kind === "missing") return [];
  if (transactions.kind !== "directory") {
    throw corrupt(transactionsRoot);
  }

  const transactionIds = [
    ...(await services.durableFileSystem.list(transactionsRoot)),
  ].sort((left, right) => left.localeCompare(right, "en-US"));
  const summaries: TransactionSummary[] = [];
  for (const transactionId of transactionIds) {
    const root = transactionRoot(transactionId);
    if ((await services.durableFileSystem.inspect(root)).kind !== "directory") {
      throw corrupt(root);
    }
    await validateTransactionLayout(root, services);
    const progressPath = `${root}/progress.json`;
    const progress = await readProgress(progressPath, services);
    if (progress.transactionId !== transactionId) {
      throw corrupt(progressPath);
    }
    await validatePersistedIdentity(progress, root, services);
    summaries.push({
      transactionId,
      manifestDigest: progress.manifestDigest,
      recoveryToken: progress.recoveryToken,
      phase: progress.phase,
      evidenceRef: progressPath,
    });
  }
  return summaries;
}

export async function recoverManagedMutation(
  request: { readonly transactionId: string; readonly recoveryToken: string },
  services: TransactionServices,
): Promise<TransactionReceipt> {
  const attempt: TransactionFailureContext = {
    transactionId: request.transactionId,
    recoveryToken: request.recoveryToken,
    validatedRecovery: false,
    publishingAuthorized: false,
  };
  try {
    const summaries = await inspectManagedTransactions(services);
    const summary = summaries.find(
      (candidate) => candidate.transactionId === request.transactionId,
    );
    if (summary === undefined) {
      const incomplete = await firstIncompleteSummary(summaries, services);
      if (incomplete !== undefined) throw recoveryRequired(incomplete);
      throw corrupt(transactionRoot(request.transactionId));
    }
    if (summary.recoveryToken !== request.recoveryToken) {
      throw recoveryRequired(summary);
    }
    attempt.validatedRecovery = true;
    attempt.publishingAuthorized =
      summary.phase === "publishing" || summary.phase === "committed";
    return await driveRecovery(summary, services);
  } catch (error) {
    return classifyDriverFailure(error, services, attempt);
  }
}

async function driveRecovery(
  summary: TransactionSummary,
  services: TransactionServices,
): Promise<TransactionReceipt> {
  const root = transactionRoot(summary.transactionId);
  const progressPath = `${root}/progress.json`;
  let progress = await readProgress(progressPath, services);
  if (
    progress.transactionId !== summary.transactionId ||
    progress.recoveryToken !== summary.recoveryToken ||
    progress.manifestDigest !== summary.manifestDigest
  ) {
    throw recoveryRequired(summary);
  }
  const manifestEntry = await services.durableFileSystem.inspect(
    `${root}/manifest.json`,
  );
  if (progress.manifestDigest === null) {
    return recoverWithoutManifest(progress, services);
  }
  /* v8 ignore next -- validated inspection already rejects a bound progress
   * document whose required manifest is absent. */
  if (manifestEntry.kind === "missing") throw corrupt(`${root}/manifest.json`);
  /* v8 ignore next -- inspection validated this entry before recovery */
  if (manifestEntry.kind !== "file") throw corrupt(`${root}/manifest.json`);
  const manifest = await readRequiredManifest(root, progress, services);
  // Only a transaction that will publish or accept results needs authority. A
  // recovery that can still abort is safe under any lease, and refusing it
  // would strand the very residue the abort exists to clear.
  const authority =
    progress.phase === "publishing" || progress.phase === "committed"
      ? manifestAuthority(manifest)
      : undefined;
  await assertLeaseAuthority(authority, services);

  for (;;) {
    const observation = await observeTransaction(manifest, services);
    const decision = decideRecovery(manifest, progress, observation);
    switch (decision.kind) {
      case "abort": {
        assertPhaseTransition(progress.phase, "aborted");
        progress = validateProgress(
          {
            ...progress,
            phase: "aborted",
            publishedOperationIds: [],
            updatedAt: services.clock.now().toISOString(),
          },
          services,
        );
        const directorySync = await persistProgress(progress, services);
        progress = { ...progress, directorySync };
        break;
      }
      case "record_published": {
        progress = validateProgress(
          {
            ...progress,
            publishedOperationIds: [
              ...progress.publishedOperationIds,
              decision.operationId,
            ],
            updatedAt: services.clock.now().toISOString(),
          },
          services,
        );
        const directorySync = await persistProgress(progress, services);
        progress = { ...progress, directorySync };
        break;
      }
      case "publish": {
        const operation = manifest.operations.find(
          (candidate) => candidate.operationId === decision.operationId,
        );
        /* v8 ignore next -- decideRecovery returns an ID from this manifest */
        if (operation === undefined) throw corrupt(`${root}/manifest.json`);
        const parent = parentOf(operation.path);
        if (
          (await services.durableFileSystem.inspect(parent)).kind !==
          "directory"
        ) {
          throw corrupt(operation.path);
        }
        const immediateTarget = await observeFingerprint(
          operation.path,
          services,
        );
        if (sameFingerprint(immediateTarget, operation.result)) {
          progress = await recordPublishedOperation(
            progress,
            operation.operationId,
            services,
          );
          break;
        }
        if (!sameFingerprint(immediateTarget, operation.expected)) {
          throw corrupt(operation.path);
        }
        if (operation.kind === "write_file") {
          await assertPersistedPayload(operation, services);
        }
        await assertLeaseAuthority(authority, services);
        await publishPersistedOperation(operation, services);
        let directorySync = mergeDirectorySync(
          progress.directorySync,
          await services.durableFileSystem.syncDirectory(parent),
        );
        const result = await observeFingerprint(operation.path, services);
        if (!sameFingerprint(result, operation.result)) {
          throw corrupt(operation.path);
        }
        progress = validateProgress(
          {
            ...progress,
            publishedOperationIds: [
              ...progress.publishedOperationIds,
              operation.operationId,
            ],
            directorySync,
            updatedAt: services.clock.now().toISOString(),
          },
          services,
        );
        directorySync = await persistProgress(progress, services);
        progress = { ...progress, directorySync };
        break;
      }
      case "commit": {
        assertPhaseTransition(progress.phase, "committed");
        progress = validateProgress(
          {
            ...progress,
            phase: "committed",
            publishedOperationIds: manifest.operations.map(
              (operation) => operation.operationId,
            ),
            updatedAt: services.clock.now().toISOString(),
          },
          services,
        );
        const directorySync = await persistProgress(progress, services);
        progress = { ...progress, directorySync };
        break;
      }
      case "cleanup": {
        const directorySync = await cleanupTransaction(
          manifest,
          progress.directorySync,
          services,
        );
        progress = await persistTerminalDirectorySync(
          progress,
          directorySync,
          services,
        );
        break;
      }
      case "complete": {
        if (
          await hasCleanupEntries(
            root,
            services,
            progress.manifestDigest === null,
          )
        ) {
          const directorySync = await cleanupTransaction(
            manifest,
            progress.directorySync,
            services,
          );
          progress = await persistTerminalDirectorySync(
            progress,
            directorySync,
            services,
          );
        }
        return receiptFromProgress(progress);
      }
      case "blocked": {
        const blockedOperation =
          decision.operationId === null
            ? undefined
            : manifest.operations.find(
                (operation) => operation.operationId === decision.operationId,
              );
        const blockedEvidenceRef =
          decision.operationId === null ? progressPath : blockedOperation?.path;
        /* v8 ignore start -- decideRecovery only returns IDs from this manifest */
        if (blockedEvidenceRef === undefined) {
          throw corrupt(`${root}/manifest.json`);
        }
        /* v8 ignore stop */
        throw new TransactionFailure(
          decision.reasonCode,
          evidence(blockedEvidenceRef),
        );
      }
    }
  }
}

async function recordPublishedOperation(
  progress: TransactionProgressV1,
  operationId: string,
  services: TransactionServices,
): Promise<TransactionProgressV1> {
  const next = validateProgress(
    {
      ...progress,
      publishedOperationIds: [...progress.publishedOperationIds, operationId],
      updatedAt: services.clock.now().toISOString(),
    },
    services,
  );
  const directorySync = await persistProgress(next, services);
  return { ...next, directorySync };
}

function transactionRoot(transactionId: string): string {
  return `${transactionsRoot}/${transactionId}`;
}

function evidence(path: string): readonly EvidenceRef[] {
  return [{ kind: "artifact", ref: path }];
}

async function rejectIncompleteTransactions(
  services: TransactionServices,
): Promise<void> {
  const summaries = await inspectManagedTransactions(services);
  const incomplete = await firstIncompleteSummary(summaries, services);
  if (incomplete !== undefined) throw recoveryRequired(incomplete);
}

async function firstIncompleteSummary(
  summaries: readonly TransactionSummary[],
  services: TransactionServices,
): Promise<TransactionSummary | undefined> {
  for (const summary of summaries) {
    if (summary.phase !== "committed" && summary.phase !== "aborted") {
      return summary;
    }
    const root = transactionRoot(summary.transactionId);
    const staging = await services.durableFileSystem.inspect(`${root}/staging`);
    const next = await services.durableFileSystem.inspect(
      `${root}/progress.next`,
    );
    const unboundManifest =
      summary.manifestDigest === null
        ? await services.durableFileSystem.inspect(`${root}/manifest.json`)
        : { kind: "missing" as const };
    if (
      staging.kind !== "missing" ||
      next.kind !== "missing" ||
      unboundManifest.kind !== "missing"
    ) {
      return summary;
    }
  }
  return undefined;
}

function recoveryRequired(summary: TransactionSummary): TransactionFailure {
  return new TransactionFailure(
    "runtime.recovery_required",
    evidence(summary.evidenceRef),
  );
}

async function classifyDriverFailure(
  error: unknown,
  services: TransactionServices,
  context: TransactionFailureContext,
): Promise<TransactionReceipt> {
  const { transactionId, recoveryToken } = context;
  const typedFailure = error instanceof TransactionFailure ? error : undefined;
  if (typedFailure !== undefined && transactionId === undefined) {
    throw typedFailure;
  }
  // A lease conflict is a statement about durable lock state, not about this
  // transaction's own residue. Re-classifying it as recoverable would invite
  // the caller to republish under a fencing token that no longer holds.
  if (typedFailure?.reasonCode === "runtime.lease_conflict") throw typedFailure;
  try {
    if (typedFailure === undefined && transactionId !== undefined) {
      await cleanupUnmarkedTransaction(transactionId, services);
    }
    const summaries = await inspectManagedTransactions(services);
    const current = summaries.find(
      (summary) => summary.transactionId === transactionId,
    );
    if (current !== undefined) {
      if (
        recoveryToken !== undefined &&
        current.recoveryToken !== recoveryToken
      ) {
        throw recoveryRequired(current);
      }
      if (current.phase === "committed" || current.phase === "aborted") {
        const root = transactionRoot(current.transactionId);
        if (
          await hasCleanupEntries(
            root,
            services,
            current.manifestDigest === null,
          )
        ) {
          throw recoveryRequired(current);
        }
        const progress = await readProgress(`${root}/progress.json`, services);
        return receiptFromProgress(
          await finalizeTerminalProgress(progress, services),
        );
      }
      if (current.phase === "publishing") {
        try {
          await classifyPublishingState(current, services);
        } catch (freshError) {
          if (freshError instanceof TransactionFailure) throw freshError;
          throw recoveryRequired(current);
        }
      }
      if (typedFailure !== undefined) throw typedFailure;
      throw recoveryRequired(current);
    }
    const incomplete = await firstIncompleteSummary(summaries, services);
    if (incomplete !== undefined) throw recoveryRequired(incomplete);
  } catch (inspectionError) {
    if (inspectionError instanceof TransactionFailure) throw inspectionError;
    if (
      (context.validatedRecovery || context.publishingAuthorized) &&
      transactionId !== undefined
    ) {
      throw recoveryRequiredForTransaction(transactionId);
    }
  }
  if (typedFailure !== undefined) throw typedFailure;
  throw new TransactionFailure("runtime.internal_failure", []);
}

function recoveryRequiredForTransaction(
  transactionId: string,
): TransactionFailure {
  return new TransactionFailure(
    "runtime.recovery_required",
    evidence(`${transactionRoot(transactionId)}/progress.json`),
  );
}

async function classifyPublishingState(
  summary: TransactionSummary,
  services: TransactionServices,
): Promise<never> {
  const root = transactionRoot(summary.transactionId);
  const progress = await readProgress(`${root}/progress.json`, services);
  if (
    progress.transactionId !== summary.transactionId ||
    progress.recoveryToken !== summary.recoveryToken ||
    progress.manifestDigest !== summary.manifestDigest
  ) {
    throw recoveryRequired(summary);
  }
  const manifest = await readRequiredManifest(root, progress, services);
  const observation = await observeTransaction(manifest, services);
  const decision = decideRecovery(manifest, progress, observation);
  if (decision.kind === "blocked") {
    const operation =
      decision.operationId === null
        ? undefined
        : manifest.operations.find(
            (candidate) => candidate.operationId === decision.operationId,
          );
    if (operation?.kind === "write_file") {
      const payload = observation.stagedPayloads.get(operation.stagedPath);
      if (
        payload === undefined ||
        !sameFingerprint(payload, operation.result)
      ) {
        throw corrupt(operation.stagedPath);
      }
    }
    throw corrupt(operation?.path ?? `${root}/progress.json`);
  }
  if (decision.kind === "publish") {
    const operation = manifest.operations.find(
      (candidate) => candidate.operationId === decision.operationId,
    );
    /* v8 ignore next -- decideRecovery only returns IDs from the manifest */
    if (operation === undefined) throw corrupt(`${root}/manifest.json`);
    if (
      (await services.durableFileSystem.inspect(parentOf(operation.path)))
        .kind !== "directory"
    ) {
      throw corrupt(operation.path);
    }
  }
  throw recoveryRequired(summary);
}

async function reconcileUnmarkedTransactions(
  services: TransactionServices,
): Promise<void> {
  if (
    (await services.durableFileSystem.inspect(".brain")).kind !== "directory" ||
    (await services.durableFileSystem.inspect(transactionsRoot)).kind !==
      "directory"
  ) {
    return;
  }
  const transactionIds = [
    ...(await services.durableFileSystem.list(transactionsRoot)),
  ].sort((left, right) => left.localeCompare(right, "en-US"));
  for (const transactionId of transactionIds) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(transactionId)) {
      throw corrupt(transactionsRoot);
    }
    const root = transactionRoot(transactionId);
    if ((await services.durableFileSystem.inspect(root)).kind !== "directory") {
      throw corrupt(root);
    }
    const progress = await services.durableFileSystem.inspect(
      `${root}/progress.json`,
    );
    if (progress.kind !== "missing") continue;
    await removeSafeUnmarkedTransaction(root, services, true);
  }
}

async function cleanupUnmarkedTransaction(
  transactionId: string,
  services: TransactionServices,
): Promise<void> {
  const root = transactionRoot(transactionId);
  if ((await services.durableFileSystem.inspect(root)).kind !== "directory") {
    return;
  }
  const progress = await services.durableFileSystem.inspect(
    `${root}/progress.json`,
  );
  if (progress.kind !== "missing") return;
  await removeSafeUnmarkedTransaction(root, services, false);
}

async function removeSafeUnmarkedTransaction(
  root: string,
  services: TransactionServices,
  blockUnknown: boolean,
): Promise<void> {
  const entries = await services.durableFileSystem.list(root);
  if (entries.some((entry) => entry !== "progress.next")) {
    if (blockUnknown) throw corrupt(root);
    return;
  }
  const nextPath = `${root}/progress.next`;
  const next = await services.durableFileSystem.inspect(nextPath);
  if (next.kind === "file") {
    await services.durableFileSystem.removeFile(nextPath);
  } else if (next.kind !== "missing") {
    if (blockUnknown) throw corrupt(nextPath);
    return;
  }
  if ((await services.durableFileSystem.list(root)).length !== 0) {
    if (blockUnknown) throw corrupt(root);
    return;
  }
  await services.durableFileSystem.removeEmptyDirectory(root);
  await services.durableFileSystem.syncDirectory(transactionsRoot);
}

async function assertExistingRoot(
  rootMode: "existing" | "initialize",
  services: TransactionServices,
): Promise<void> {
  let brain = await services.durableFileSystem.inspect(".brain");
  let createdBrain = false;
  if (rootMode === "initialize" && brain.kind === "missing") {
    await services.durableFileSystem.createDirectory(".brain");
    await services.durableFileSystem.syncDirectory(".");
    brain = { kind: "directory" };
    createdBrain = true;
  }
  if (brain.kind !== "directory") {
    throw new TransactionFailure("runtime.state_corrupt", evidence(".brain"));
  }

  let transactions = await services.durableFileSystem.inspect(transactionsRoot);
  if (rootMode === "initialize" && transactions.kind === "missing") {
    await assertInitializeNamespaceAvailable(createdBrain, services);
    await services.durableFileSystem.createDirectory(transactionsRoot);
    await services.durableFileSystem.syncDirectory(".brain");
    transactions = { kind: "directory" };
  }
  if (transactions.kind !== "directory") {
    throw new TransactionFailure(
      "runtime.state_corrupt",
      evidence(transactionsRoot),
    );
  }
}

async function assertInitializeNamespaceAvailable(
  createdBrain: boolean,
  services: TransactionServices,
): Promise<void> {
  if (
    !createdBrain &&
    (await services.durableFileSystem.list(".brain")).length !== 0
  ) {
    throw corrupt(".brain");
  }
}

async function validateTransactionLayout(
  root: string,
  services: TransactionServices,
): Promise<void> {
  const allowed = new Set([
    "manifest.json",
    "progress.json",
    "progress.next",
    "staging",
  ]);
  const entries = await services.durableFileSystem.list(root);
  if (entries.some((entry) => !allowed.has(entry))) throw corrupt(root);

  for (const file of ["manifest.json", "progress.json", "progress.next"]) {
    const observed = await services.durableFileSystem.inspect(
      `${root}/${file}`,
    );
    if (observed.kind !== "missing" && observed.kind !== "file") {
      throw corrupt(`${root}/${file}`);
    }
  }
  const staging = await services.durableFileSystem.inspect(`${root}/staging`);
  if (staging.kind !== "missing" && staging.kind !== "directory") {
    throw corrupt(`${root}/staging`);
  }
}

async function validatePersistedIdentity(
  progress: TransactionProgressV1,
  root: string,
  services: TransactionServices,
): Promise<void> {
  const progressPath = `${root}/progress.json`;
  if (progress.manifestDigest === null) {
    const identityToken = services.digests.sha256(
      canonicalizeJson({
        contractVersion: progress.contractVersion,
        stateContract: progress.stateContract,
        transactionId: progress.transactionId,
        createdAt: progress.createdAt,
      }),
    );
    if (progress.recoveryToken !== identityToken) throw corrupt(progressPath);
  } else if (progress.recoveryToken !== progress.manifestDigest) {
    throw corrupt(progressPath);
  }

  const manifestPath = `${root}/manifest.json`;
  const manifestEntry = await services.durableFileSystem.inspect(manifestPath);
  if (progress.manifestDigest === null) return;
  if (manifestEntry.kind === "missing") {
    throw corrupt(manifestPath);
  }
  /* v8 ignore next -- validateTransactionLayout already proved file kind */
  if (manifestEntry.kind !== "file") throw corrupt(manifestPath);
  const { value: manifest, canonical } = await readManifest(
    manifestPath,
    services,
  );
  assertManifestSemantics(manifest, root, services);
  if (
    manifest.transactionId !== progress.transactionId ||
    manifest.createdAt !== progress.createdAt ||
    services.digests.sha256(canonical) !== progress.manifestDigest
  ) {
    throw corrupt(manifestPath);
  }
}

async function readRequiredManifest(
  root: string,
  progress: TransactionProgressV1,
  services: TransactionServices,
): Promise<TransactionManifestV1> {
  const manifestPath = `${root}/manifest.json`;
  const { value, canonical } = await readManifest(manifestPath, services);
  assertManifestSemantics(value, root, services);
  if (
    value.transactionId !== progress.transactionId ||
    value.createdAt !== progress.createdAt ||
    (progress.manifestDigest !== null &&
      services.digests.sha256(canonical) !== progress.manifestDigest)
  ) {
    throw corrupt(manifestPath);
  }
  return value;
}

function assertManifestSemantics(
  manifest: TransactionManifestV1,
  root: string,
  services: TransactionServices,
): void {
  for (const [index, operation] of manifest.operations.entries()) {
    const operationId = `operation-${String(index + 1).padStart(4, "0")}`;
    if (
      operation.operationId !== operationId ||
      !isManagedDirectoryDestination(operation.path)
    ) {
      throw corrupt(`${root}/manifest.json`);
    }
    switch (operation.kind) {
      case "create_directory":
        if (
          operation.expected.kind !== "missing" ||
          operation.result.kind !== "directory"
        ) {
          throw corrupt(`${root}/manifest.json`);
        }
        break;
      case "write_file":
        if (
          operation.stagedPath !== `${root}/staging/${operationId}.payload` ||
          operation.expected.kind === "directory" ||
          operation.result.kind !== "file"
        ) {
          throw corrupt(`${root}/manifest.json`);
        }
        break;
      case "delete_file":
        if (
          operation.expected.kind !== "file" ||
          operation.result.kind !== "missing"
        ) {
          throw corrupt(`${root}/manifest.json`);
        }
        break;
    }
  }

  const relativeOperations = manifest.operations.map((operation) =>
    operation.stagedPath === null
      ? operation
      : {
          ...operation,
          stagedPath: `staging/${operation.operationId}.payload`,
        },
  );
  const planDigest = services.digests.sha256(
    canonicalizeJson({ operations: relativeOperations }),
  );
  if (manifest.planDigest !== planDigest) {
    throw corrupt(`${root}/manifest.json`);
  }
}

async function observeTransaction(
  manifest: TransactionManifestV1,
  services: TransactionServices,
): Promise<{
  readonly destinations: ReadonlyMap<string, PathFingerprint>;
  readonly stagedPayloads: ReadonlyMap<string, PathFingerprint>;
}> {
  const destinations = new Map<string, PathFingerprint>();
  const stagedPayloads = new Map<string, PathFingerprint>();
  for (const operation of manifest.operations) {
    destinations.set(
      operation.path,
      await observeFingerprint(operation.path, services),
    );
    if (operation.stagedPath !== null) {
      stagedPayloads.set(
        operation.stagedPath,
        await observeFingerprint(operation.stagedPath, services),
      );
    }
  }

  const root = transactionRoot(manifest.transactionId);
  const stagingRoot = `${root}/staging`;
  const staging = await services.durableFileSystem.inspect(stagingRoot);
  if (staging.kind === "directory") {
    const known = new Set(
      manifest.operations.flatMap((operation) =>
        operation.stagedPath === null ? [] : [operation.stagedPath],
      ),
    );
    for (const name of await services.durableFileSystem.list(stagingRoot)) {
      const path = `${stagingRoot}/${name}`;
      if (!known.has(path)) {
        stagedPayloads.set(path, await observeFingerprint(path, services));
      }
    }
    /* v8 ignore start -- transaction layout was validated immediately above */
  } else if (staging.kind !== "missing") {
    throw corrupt(stagingRoot);
  }
  /* v8 ignore stop */
  return { destinations, stagedPayloads };
}

async function readProgress(
  path: string,
  services: TransactionServices,
): Promise<TransactionProgressV1> {
  const text = await readRegularText(path, services);
  const parsed = parseCanonicalJson(text, path);
  try {
    return validateProgress(parsed, services);
  } catch (error) {
    if (error instanceof TransactionFailure) throw corrupt(path);
    throw new TransactionFailure("runtime.internal_failure", []);
  }
}

async function readManifest(
  path: string,
  services: TransactionServices,
): Promise<{
  readonly value: TransactionManifestV1;
  readonly canonical: string;
}> {
  const text = await readRegularText(path, services);
  const parsed = parseCanonicalJson(text, path);
  try {
    return {
      value: validateManifest(parsed, services),
      canonical: text.slice(0, -1),
    };
  } catch (error) {
    if (error instanceof TransactionFailure) throw corrupt(path);
    throw new TransactionFailure("runtime.internal_failure", []);
  }
}

async function readRegularText(
  path: string,
  services: TransactionServices,
): Promise<string> {
  /* v8 ignore start -- callers validate the transaction layout before reading */
  if ((await services.durableFileSystem.inspect(path)).kind !== "file") {
    throw corrupt(path);
  }
  /* v8 ignore stop */
  return services.durableFileSystem.readText(path);
}

function parseCanonicalJson(text: string, path: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    if (text !== `${canonicalizeJson(parsed)}\n`) throw corrupt(path);
    return parsed;
  } catch (error) {
    if (error instanceof TransactionFailure) throw error;
    throw corrupt(path);
  }
}

function corrupt(path: string): TransactionFailure {
  return new TransactionFailure("runtime.state_corrupt", evidence(path));
}

function createManifest(
  plan: ManagedMutationPlan,
  transactionId: string,
  createdAt: string,
  root: string,
  services: TransactionServices,
): TransactionManifestV1 {
  const persisted = plan.operations.map((operation) => {
    const value = toPersistedManagedOperation(operation);
    return value.stagedPath === null
      ? value
      : { ...value, stagedPath: `${root}/${value.stagedPath}` };
  });
  const first = persisted[0];
  /* v8 ignore start -- the synchronous preflight rejects empty plans */
  if (first === undefined) {
    throw new TransactionFailure("runtime.state_corrupt", []);
  }
  /* v8 ignore stop */
  const manifest: TransactionManifestV1 = {
    contractVersion,
    stateContract,
    transactionId,
    planDigest: services.digests.sha256(
      canonicalizeJson({
        operations: plan.operations.map(toPersistedManagedOperation),
      }),
    ),
    createdAt,
    operations: [first, ...persisted.slice(1)],
  };
  return validateManifest(manifest, services);
}

function validateManifest(
  value: unknown,
  services: TransactionServices,
): TransactionManifestV1 {
  const result = services.schemaRegistry.validate({
    id: "state.transaction-manifest",
    version: CONTRACT_VERSIONS["state.transaction-manifest"],
    value,
    structuralReasonCode: "runtime.state_corrupt",
  });
  if (result.kind === "invalid") {
    throw new TransactionFailure("runtime.state_corrupt", []);
  }
  return result.value;
}

function validateProgress(
  value: unknown,
  services: TransactionServices,
): TransactionProgressV1 {
  const result = services.schemaRegistry.validate({
    id: "state.transaction-progress",
    version: CONTRACT_VERSIONS["state.transaction-progress"],
    value,
    structuralReasonCode: "runtime.state_corrupt",
  });
  if (result.kind === "invalid") {
    throw new TransactionFailure("runtime.state_corrupt", []);
  }
  return result.value;
}

async function persistProgress(
  progress: TransactionProgressV1,
  services: TransactionServices,
): Promise<"supported" | "unsupported"> {
  const validated = validateProgress(progress, services);
  const root = transactionRoot(validated.transactionId);
  const nextPath = `${root}/progress.next`;
  const next = await services.durableFileSystem.inspect(nextPath);
  if (next.kind === "file") {
    await services.durableFileSystem.removeFile(nextPath);
    await services.durableFileSystem.syncDirectory(root);
  } else if (next.kind !== "missing") {
    throw corrupt(nextPath);
  }
  await services.durableFileSystem.writeSynced(
    nextPath,
    `${canonicalizeJson(validated)}\n`,
  );
  await services.durableFileSystem.replaceFile(
    nextPath,
    `${root}/progress.json`,
  );
  return mergeDirectorySync(
    validated.directorySync,
    await services.durableFileSystem.syncDirectory(root),
  );
}

async function publishPersistedOperation(
  operation: TransactionManifestV1["operations"][number],
  services: TransactionServices,
): Promise<void> {
  switch (operation.kind) {
    case "create_directory":
      await services.durableFileSystem.createDirectory(operation.path);
      break;
    case "write_file":
      await services.durableFileSystem.replaceFile(
        operation.stagedPath,
        operation.path,
      );
      break;
    case "delete_file":
      await services.durableFileSystem.removeFile(operation.path);
      break;
  }
}

async function cleanupTransaction(
  manifest: TransactionManifestV1,
  currentDirectorySync: TransactionProgressV1["directorySync"],
  services: TransactionServices,
): Promise<"supported" | "unsupported"> {
  const root = transactionRoot(manifest.transactionId);
  const stagingRoot = `${root}/staging`;
  for (const operation of manifest.operations) {
    if (operation.stagedPath === null) continue;
    const payload = await services.durableFileSystem.inspect(
      operation.stagedPath,
    );
    if (payload.kind === "file") {
      await services.durableFileSystem.removeFile(operation.stagedPath);
      /* v8 ignore start -- decideRecovery validates every known payload first */
    } else if (payload.kind !== "missing") {
      throw corrupt(operation.stagedPath);
    }
    /* v8 ignore stop */
  }

  const staging = await services.durableFileSystem.inspect(stagingRoot);
  if (staging.kind === "directory") {
    /* v8 ignore next -- decideRecovery blocks unknown staging content */
    if ((await services.durableFileSystem.list(stagingRoot)).length !== 0) {
      throw corrupt(stagingRoot);
    }
    await services.durableFileSystem.removeEmptyDirectory(stagingRoot);
    /* v8 ignore start -- validated observation permits only directory or missing */
  } else if (staging.kind !== "missing") {
    throw corrupt(stagingRoot);
  }
  /* v8 ignore stop */

  const nextPath = `${root}/progress.next`;
  const next = await services.durableFileSystem.inspect(nextPath);
  if (next.kind === "file") {
    await services.durableFileSystem.removeFile(nextPath);
    /* v8 ignore start -- validateTransactionLayout permits only file or missing */
  } else if (next.kind !== "missing") {
    throw corrupt(nextPath);
  }
  /* v8 ignore stop */
  return mergeDirectorySync(
    currentDirectorySync,
    await services.durableFileSystem.syncDirectory(root),
  );
}

async function persistTerminalDirectorySync(
  progress: TransactionProgressV1,
  observed: "supported" | "unsupported",
  services: TransactionServices,
): Promise<TransactionProgressV1> {
  const directorySync = mergeDirectorySync(progress.directorySync, observed);
  if (directorySync === progress.directorySync) {
    return { ...progress, directorySync };
  }
  const next = validateProgress(
    {
      ...progress,
      directorySync,
      updatedAt: services.clock.now().toISOString(),
    },
    services,
  );
  const persistedDirectorySync = await persistProgress(next, services);
  return { ...next, directorySync: persistedDirectorySync };
}

async function finalizeTerminalProgress(
  progress: TransactionProgressV1,
  services: TransactionServices,
): Promise<TransactionProgressV1> {
  const observed = await services.durableFileSystem.syncDirectory(
    transactionRoot(progress.transactionId),
  );
  return persistTerminalDirectorySync(progress, observed, services);
}

async function recoverWithoutManifest(
  initial: TransactionProgressV1,
  services: TransactionServices,
): Promise<TransactionReceipt> {
  const root = transactionRoot(initial.transactionId);
  const progressPath = `${root}/progress.json`;
  /* v8 ignore next -- persisted identity rejects a digest without a manifest */
  if (initial.manifestDigest !== null) {
    throw corrupt(progressPath);
  }

  const stagingRoot = `${root}/staging`;
  const staging = await services.durableFileSystem.inspect(stagingRoot);
  const payloads: string[] = [];
  if (staging.kind === "directory") {
    for (const name of await services.durableFileSystem.list(stagingRoot)) {
      if (!/^operation-[0-9]{4}\.payload$/u.test(name)) {
        throw corrupt(`${stagingRoot}/${name}`);
      }
      const path = `${stagingRoot}/${name}`;
      if ((await services.durableFileSystem.inspect(path)).kind !== "file") {
        throw corrupt(path);
      }
      payloads.push(path);
    }
    /* v8 ignore start -- validateTransactionLayout proved the staging kind */
  } else if (staging.kind !== "missing") {
    throw corrupt(stagingRoot);
  }
  /* v8 ignore stop */

  const nextPath = `${root}/progress.next`;
  const next = await services.durableFileSystem.inspect(nextPath);
  /* v8 ignore next -- validateTransactionLayout proved the scratch kind */
  if (next.kind !== "file" && next.kind !== "missing") {
    throw corrupt(nextPath);
  }

  let progress: TransactionProgressV1 = initial;
  if (progress.phase === "begun") {
    assertPhaseTransition(progress.phase, "aborted");
    progress = validateProgress(
      {
        ...progress,
        phase: "aborted",
        publishedOperationIds: [],
        updatedAt: services.clock.now().toISOString(),
      },
      services,
    );
    const directorySync = await persistProgress(progress, services);
    progress = { ...progress, directorySync };
  }

  for (const path of payloads) {
    await services.durableFileSystem.removeFile(path);
  }
  if (staging.kind === "directory") {
    await services.durableFileSystem.removeEmptyDirectory(stagingRoot);
  }
  if ((await services.durableFileSystem.inspect(nextPath)).kind === "file") {
    await services.durableFileSystem.removeFile(nextPath);
  }
  const manifestPath = `${root}/manifest.json`;
  const manifest = await services.durableFileSystem.inspect(manifestPath);
  if (manifest.kind === "file") {
    await services.durableFileSystem.removeFile(manifestPath);
    /* v8 ignore start -- the initial validated transaction layout permits only
     * a regular manifest or absence before this bounded cleanup. */
  } else if (manifest.kind !== "missing") {
    throw corrupt(manifestPath);
  }
  /* v8 ignore stop */
  const directorySync = mergeDirectorySync(
    progress.directorySync,
    await services.durableFileSystem.syncDirectory(root),
  );
  progress = await persistTerminalDirectorySync(
    progress,
    directorySync,
    services,
  );
  return receiptFromProgress(progress);
}

async function hasCleanupEntries(
  root: string,
  services: TransactionServices,
  removeUnboundManifest: boolean,
): Promise<boolean> {
  return (
    (await services.durableFileSystem.inspect(`${root}/staging`)).kind !==
      "missing" ||
    (await services.durableFileSystem.inspect(`${root}/progress.next`)).kind !==
      "missing" ||
    (removeUnboundManifest &&
      (await services.durableFileSystem.inspect(`${root}/manifest.json`))
        .kind !== "missing")
  );
}

function receiptFromProgress(
  progress: TransactionProgressV1,
): TransactionReceipt {
  /* v8 ignore next -- receipts are constructed only from terminal decisions */
  if (progress.phase !== "committed" && progress.phase !== "aborted") {
    throw corrupt(`${transactionRoot(progress.transactionId)}/progress.json`);
  }
  return {
    transactionId: progress.transactionId,
    manifestDigest: progress.manifestDigest,
    recoveryToken: progress.recoveryToken,
    phase: progress.phase,
    directorySync: progress.directorySync,
  };
}

function stagedPayloadPath(
  root: string,
  operation: Extract<ManagedOperation, { readonly kind: "write_file" }>,
): string {
  return `${root}/${operation.stagedPath}`;
}

async function assertPreconditions(
  plan: Pick<TransactionManifestV1, "operations"> | ManagedMutationPlan,
  services: TransactionServices,
): Promise<void> {
  for (const operation of plan.operations) {
    const observed = await observeFingerprint(operation.path, services);
    if (!sameFingerprint(observed, operation.expected)) {
      throw new TransactionFailure(
        "runtime.revision_conflict",
        evidence(operation.path),
      );
    }
  }
}

async function assertPublishable(
  operation: ManagedOperation,
  services: TransactionServices,
): Promise<void> {
  const parent = await services.durableFileSystem.inspect(
    parentOf(operation.path),
  );
  if (parent.kind !== "directory") {
    throw new TransactionFailure(
      "runtime.state_corrupt",
      evidence(operation.path),
    );
  }
  const observed = await observeFingerprint(operation.path, services);
  if (!sameFingerprint(observed, operation.expected)) {
    throw new TransactionFailure(
      "runtime.revision_conflict",
      evidence(operation.path),
    );
  }
}

async function assertExecutionPayload(
  operation: Extract<ManagedOperation, { readonly kind: "write_file" }>,
  root: string,
  services: TransactionServices,
): Promise<void> {
  const path = stagedPayloadPath(root, operation);
  const observed = await observeFingerprint(path, services);
  if (!sameFingerprint(observed, operation.result)) throw corrupt(path);
}

async function assertPersistedPayload(
  operation: Extract<
    TransactionManifestV1["operations"][number],
    { readonly kind: "write_file" }
  >,
  services: TransactionServices,
): Promise<void> {
  const observed = await observeFingerprint(operation.stagedPath, services);
  if (!sameFingerprint(observed, operation.result)) {
    throw corrupt(operation.stagedPath);
  }
}

async function publishOperation(
  operation: ManagedOperation,
  root: string,
  services: TransactionServices,
): Promise<void> {
  switch (operation.kind) {
    case "create_directory":
      await services.durableFileSystem.createDirectory(operation.path);
      break;
    case "write_file":
      await services.durableFileSystem.replaceFile(
        stagedPayloadPath(root, operation),
        operation.path,
      );
      break;
    case "delete_file":
      await services.durableFileSystem.removeFile(operation.path);
      break;
  }
}

async function assertResult(
  operation: ManagedOperation,
  services: TransactionServices,
): Promise<void> {
  const observed = await observeFingerprint(operation.path, services);
  if (!sameFingerprint(observed, operation.result)) {
    throw new TransactionFailure(
      "runtime.state_corrupt",
      evidence(operation.path),
    );
  }
}

async function assertResults(
  manifest: TransactionManifestV1,
  services: TransactionServices,
): Promise<void> {
  for (const operation of manifest.operations) {
    const observed = await observeFingerprint(operation.path, services);
    if (!sameFingerprint(observed, operation.result)) {
      throw new TransactionFailure(
        "runtime.state_corrupt",
        evidence(operation.path),
      );
    }
  }
}

async function observeFingerprint(
  path: string,
  services: TransactionServices,
): Promise<PathFingerprint> {
  return toFingerprint(await services.durableFileSystem.inspect(path), path);
}

function toFingerprint(entry: DurableEntry, path: string): PathFingerprint {
  switch (entry.kind) {
    case "missing":
      return entry;
    case "directory":
      return { kind: "directory" };
    case "file":
      return { kind: "file", size: entry.size, sha256: entry.sha256 };
    case "special":
    case "symlink":
      throw new TransactionFailure("runtime.state_corrupt", evidence(path));
  }
}

function sameFingerprint(
  left: PathFingerprint,
  right: PathFingerprint,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "file" || right.kind !== "file") return true;
  return left.size === right.size && left.sha256 === right.sha256;
}

/**
 * The directory a destination sits in.
 *
 * A managed root file has no separator, and its parent is the project root --
 * the sentinel `inspect` and `syncDirectory` both answer to.
 */
function parentOf(path: string): string {
  const separator = path.lastIndexOf("/");
  return separator === -1 ? "." : path.slice(0, separator);
}

function mergeDirectorySync(
  current: TransactionProgressV1["directorySync"],
  observed: "supported" | "unsupported",
): "supported" | "unsupported" {
  return current === "unsupported" || observed === "unsupported"
    ? "unsupported"
    : "supported";
}
