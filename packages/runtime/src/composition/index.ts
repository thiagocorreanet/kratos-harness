import { types } from "node:util";

import type {
  AppendEventEffect,
  Effect,
  EffectPlan,
} from "../domain/effects.js";
import {
  isRecognizedReducerRegistryFailure,
  snapshotEventDraft,
  snapshotEventReducerRegistry,
  type EventReducerRegistry,
  type JsonState,
} from "../domain/events/index.js";
import {
  managedPathCollisionKey,
  normalizeManagedMutationPlan,
  toPersistedManagedOperation,
  TransactionPolicyError,
  type ManagedMutationPlan,
  type ManagedOperation,
  type PathFingerprint,
} from "../domain/transactions/index.js";
import { canonicalizeJson } from "../domain/schema/index.js";
import type { EvidenceRef } from "../domain/result/index.js";
import {
  nodeClock,
  nodeDurableFileSystem,
  nodeEnvironment,
  nodeFileSystem,
  nodeGitRunner,
  nodeIds,
  nodeOutput,
  sha256Digests,
} from "../infra/node/index.js";
import type { DurableEntry, RuntimePorts } from "../ports/index.js";
import { readOnlyPorts, ReadOnlyViolation } from "./read-only.js";
import { previewResult } from "./preview-result.js";

import { composeGit } from "./git.js";
import { configurationValidator, createSchemaRegistry } from "./schema.js";
import {
  eventStorePaths,
  prepareEventAppend,
  type PreparedEventAppend,
} from "./events.js";
import {
  executeManagedMutation,
  inspectManagedTransactions,
  preflightManagedTransactions,
  recoverManagedMutation,
  TransactionFailure,
  type TransactionReceipt,
  type TransactionServices,
  type TransactionSummary,
} from "./transactions.js";
import {
  acquireClaim,
  createLocks,
  ensureLockNamespace,
  inspectLease,
  LockFailure,
  prepareLeaseGuard,
  recoverClaim,
  releaseClaim,
  type AcquireClaimRequest,
  type AcquireClaimOutcome,
  type ClaimInspection,
  type ClaimConflict,
  type LeaseGuardBinding,
  type LockClaimRecord,
  type LockServices,
  type ObservedLockClaim,
  type RecoverClaimOutcome,
  type ReleaseClaimOutcome,
} from "./locks.js";

export {
  configurationValidator,
  createSchemaRegistry,
  previewResult,
  readOnlyPorts,
  ReadOnlyViolation,
  executeManagedMutation,
  inspectManagedTransactions,
  preflightManagedTransactions,
  recoverManagedMutation,
  TransactionFailure,
  acquireClaim,
  createLocks,
  ensureLockNamespace,
  inspectLease,
  LockFailure,
  prepareLeaseGuard,
  recoverClaim,
  releaseClaim,
};
export type { TransactionReceipt, TransactionServices, TransactionSummary };
export type {
  AcquireClaimRequest,
  AcquireClaimOutcome,
  ClaimInspection,
  ClaimConflict,
  LeaseGuardBinding,
  LockClaimRecord,
  LockServices,
  ObservedLockClaim,
  RecoverClaimOutcome,
  ReleaseClaimOutcome,
};

/**
 * The one place effect implementations are chosen.
 *
 * Overrides come from an explicit caller argument and nothing else: there is no
 * environment check and no test-mode branch, so production code has no path to
 * a fake at all. A key that is absent keeps the real implementation; a key that
 * is present replaces exactly that port.
 */
export function createRuntime(
  overrides: Partial<RuntimePorts> = {},
): RuntimePorts {
  const root = overrides.environment?.workingDirectory() ?? process.cwd();
  return createRuntimeAt(root, overrides);
}

/** Compose mutation ports only after project discovery selects a root. */
export function createRuntimeAt(
  root: string,
  overrides: Partial<RuntimePorts> = {},
): RuntimePorts {
  const clock = nodeClock();
  const ids = nodeIds();
  const digests = sha256Digests();
  const durableFileSystem = nodeDurableFileSystem(root);
  return {
    clock,
    ids,
    digests,
    durableFileSystem,
    fileSystem: nodeFileSystem(root),
    git: composeGit(nodeGitRunner(root), digests),
    locks: createLocks({
      clock,
      ids,
      digests,
      durableFileSystem,
      schemaRegistry: createSchemaRegistry(),
    }),
    environment: nodeEnvironment(),
    output: nodeOutput(),
    ...overrides,
  };
}

export type ApplyPlanOutcome =
  { readonly kind: "committed" } | { readonly kind: "noop" };

export interface ApplyPlanOptions<State = JsonState> {
  readonly rootMode: "existing" | "initialize";
  readonly eventReducers?: EventReducerRegistry<State>;
  /**
   * A preview this apply must still agree with.
   *
   * An apply re-decides from current state rather than replaying a plan, which
   * is what keeps it correct. But it also means a caller who previewed, showed
   * the preview to a person, and then applied could commit something the
   * person never saw. Passing the preview back turns that silent substitution
   * into `runtime.revision_conflict`.
   */
  readonly expectPreview?: MutationPreview;
}

class MissingReducerRegistry extends Error {}

/**
 * Commit every managed effect through one durable transaction, then emit.
 *
 * The outcome lets orchestration report the concrete mutation fact: a command
 * may be allowed to mutate state while its already-satisfied plan is a no-op.
 */
export async function applyPlan<State = JsonState>(
  plan: EffectPlan,
  ports: RuntimePorts,
  options: ApplyPlanOptions<State> = {
    rootMode: "existing",
  },
): Promise<ApplyPlanOutcome> {
  const decided = await decideMutation(plan, ports, options, "commit");
  const { frozenOptions, services, prepared, normalized, emits } = decided;
  assertPreviewStillHolds(options.expectPreview, normalized, ports);

  let outcome: ApplyPlanOutcome;
  if (normalized.kind === "noop") {
    outcome = { kind: "noop" };
  } else {
    const receipt = await executeManagedMutation(
      normalized.plan,
      prepared === undefined
        ? frozenOptions
        : {
            ...frozenOptions,
            eventStorePreconditions: [
              {
                path: prepared.paths.events,
                expected: preparedFingerprint(prepared, prepared.paths.events),
              },
              {
                path: prepared.paths.snapshot,
                expected: preparedFingerprint(
                  prepared,
                  prepared.paths.snapshot,
                ),
              },
            ],
          },
      services,
    );
    /* v8 ignore start -- normal execution returns committed or throws; aborted
     * is returned only by the separate explicit-recovery operation. */
    if (receipt.phase !== "committed") {
      throw new TransactionFailure("runtime.state_corrupt", [
        {
          kind: "artifact",
          ref: `.brain/transactions/${receipt.transactionId}/progress.json`,
        },
      ]);
    }
    /* v8 ignore stop */
    outcome = { kind: "committed" };
  }

  for (const effect of emits) {
    if (effect.channel === "structured") ports.output.structured(effect.text);
    else ports.output.human(effect.text);
  }
  return outcome;
}

type DecisionMode = "commit" | "preview";

interface DecidedMutation {
  readonly frozenOptions: { readonly rootMode: "existing" | "initialize" };
  readonly services: TransactionServices;
  readonly prepared: PreparedEventAppend | undefined;
  readonly normalized: ReturnType<typeof normalizeManagedMutationPlan>;
  readonly emits: readonly Extract<Effect, { readonly kind: "emit" }>[];
}

/**
 * Work out what a plan would do, without doing any of it.
 *
 * `applyPlan` and `previewPlan` share this, which is the whole point. A
 * preview produced by separate code agrees with the commit on the day it is
 * written and diverges quietly afterwards -- and people trust a preview, so
 * that is worse than having none. This is not a description of the decision.
 * It is the decision; the caller chooses whether to publish it.
 */
async function decideMutation<State = JsonState>(
  plan: EffectPlan,
  ports: RuntimePorts,
  options: ApplyPlanOptions<State>,
  mode: DecisionMode,
): Promise<DecidedMutation> {
  const input = snapshotApplyInput(plan, options);
  const frozenPlan = input.plan;
  const frozenOptions = { rootMode: input.rootMode };
  const emits = selectEmitEffects(frozenPlan);
  const reconcile = mode === "commit";

  const services: TransactionServices = {
    clock: ports.clock,
    ids: ports.ids,
    digests: ports.digests,
    durableFileSystem: ports.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  };
  const append = selectAppendEffect(frozenPlan);
  if (append !== undefined)
    assertAppendDestinationsExclusive(frozenPlan, append);

  let prepared: PreparedEventAppend | undefined;
  if (append !== undefined) {
    const eventReducers = snapshotAppendReducers(
      input.options,
      append,
      services.schemaRegistry,
    );
    await preflightManagedTransactions(frozenOptions, services, reconcile);
    prepared = await prepareEventAppend(
      { runId: append.runId, event: append.event },
      {
        durableFileSystem: ports.durableFileSystem,
        digests: ports.digests,
        reducers: eventReducers,
        schemaRegistry: services.schemaRegistry,
      },
    );
  } else if (hasManagedEffects(frozenPlan)) {
    await preflightManagedTransactions(frozenOptions, services, reconcile);
  }
  const expandedPlan =
    prepared === undefined
      ? frozenPlan
      : expandAppendEffect(frozenPlan, prepared);
  const observations = await observeManagedPaths(
    expandedPlan,
    ports,
    prepared?.expected,
  );
  let normalized: ReturnType<typeof normalizeManagedMutationPlan>;
  try {
    normalized = normalizeManagedMutationPlan(
      expandedPlan,
      observations,
      (text) => ports.digests.sha256(text),
    );
  } catch (error) {
    if (error instanceof TransactionPolicyError) {
      throw new TransactionFailure(
        error.reasonCode,
        error.reasonCode === "runtime.state_corrupt"
          ? [{ kind: "artifact", ref: ".brain" }]
          : [],
      );
    }
    throw new TransactionFailure("runtime.internal_failure", []);
  }

  if (prepared !== undefined)
    await assertPreparedAppendIsFresh(prepared, ports);

  return { frozenOptions, services, prepared, normalized, emits };
}

/**
 * Refuse to commit something other than what the caller was shown.
 *
 * The apply recomputes rather than replaying, so the decision it reaches may
 * differ from the one a person approved. Comparing digests is enough: they are
 * derived from the same canonical operations the manifest records, so any
 * difference in destination, order, or content changes them.
 */
function assertPreviewStillHolds(
  expected: MutationPreview | undefined,
  normalized: ReturnType<typeof normalizeManagedMutationPlan>,
  ports: RuntimePorts,
): void {
  if (expected === undefined) return;
  const decided: MutationPreview =
    normalized.kind === "noop"
      ? { kind: "noop" }
      : {
          kind: "ready",
          operations: previewOperations(normalized.plan),
          planDigest: planDigestOf(normalized.plan, ports),
        };
  if (
    expected.kind === decided.kind &&
    (expected.kind !== "ready" ||
      (decided.kind === "ready" && expected.planDigest === decided.planDigest))
  ) {
    return;
  }
  throw new TransactionFailure(
    "runtime.revision_conflict",
    firstDivergence(expected, decided),
  );
}

/** Name the destination a person can look at to see what moved. */
function firstDivergence(
  expected: MutationPreview,
  decided: MutationPreview,
): readonly EvidenceRef[] {
  const before = expected.kind === "ready" ? expected.operations : [];
  const after = decided.kind === "ready" ? decided.operations : [];
  for (const [index, operation] of before.entries()) {
    const current = after[index];
    // The precondition matters as much as the outcome here: a destination
    // someone else rewrote still ends at the same bytes, and the only trace of
    // their write is the state the decision started from.
    if (current === undefined || !sameOperation(current, operation)) {
      return [{ kind: "artifact", ref: operation.path }];
    }
  }
  const extra = after[before.length];
  return [{ kind: "artifact", ref: extra?.path ?? ".brain" }];
}

function sameOperation(
  left: PreviewOperation,
  right: PreviewOperation,
): boolean {
  return (
    left.operationId === right.operationId &&
    left.kind === right.kind &&
    left.path === right.path &&
    sameFingerprint(left.expected, right.expected) &&
    sameFingerprint(left.result, right.result)
  );
}

/** One decided destination, carrying what it depends on and never its bytes. */
export interface PreviewOperation {
  readonly operationId: string;
  readonly kind: ManagedOperation["kind"];
  readonly path: string;
  readonly expected: PathFingerprint;
  readonly result: PathFingerprint;
}

export type MutationPreview =
  | { readonly kind: "noop" }
  | {
      readonly kind: "ready";
      readonly operations: readonly PreviewOperation[];
      readonly planDigest: string;
    }
  | {
      readonly kind: "blocked";
      readonly reasonCode: TransactionFailure["reasonCode"];
      readonly evidence: readonly EvidenceRef[];
    };

/**
 * Compute the decision a plan would commit, and change nothing computing it.
 *
 * Pass `readOnlyPorts(ports)` to have that guarantee enforced rather than
 * promised. A blocked project is reported, not thrown: a preview a caller
 * cannot render is a preview that helps nobody at the moment it matters most.
 */
export async function previewPlan<State = JsonState>(
  plan: EffectPlan,
  ports: RuntimePorts,
  options: ApplyPlanOptions<State> = { rootMode: "existing" },
): Promise<MutationPreview> {
  let decided: DecidedMutation;
  try {
    decided = await decideMutation(plan, ports, options, "preview");
  } catch (error) {
    if (error instanceof TransactionFailure)
      return Object.freeze({
        kind: "blocked" as const,
        reasonCode: error.reasonCode,
        evidence: error.evidence,
      });
    throw error;
  }
  if (decided.normalized.kind === "noop")
    return Object.freeze({ kind: "noop" });
  return Object.freeze({
    kind: "ready" as const,
    operations: previewOperations(decided.normalized.plan),
    planDigest: planDigestOf(decided.normalized.plan, ports),
  });
}

/**
 * Project the committed plan into what a person may safely be shown.
 *
 * The content a write would persist never leaves this boundary. The size and
 * digest do, which answers "what changes, and to what" without handing over a
 * secret the command was about to store.
 */
function previewOperations(
  plan: ManagedMutationPlan,
): readonly PreviewOperation[] {
  return Object.freeze(
    plan.operations.map((operation) =>
      Object.freeze({
        operationId: operation.operationId,
        kind: operation.kind,
        path: operation.path,
        expected: operation.expected,
        result: operation.result,
      }),
    ),
  );
}

/** The digest the manifest will record, computed the same way it computes it. */
function planDigestOf(plan: ManagedMutationPlan, ports: RuntimePorts): string {
  return ports.digests.sha256(
    canonicalizeJson({
      operations: plan.operations.map(toPersistedManagedOperation),
    }),
  );
}

function preparedFingerprint(
  prepared: PreparedEventAppend,
  path: string,
): PathFingerprint {
  // The prepared effect owns exactly these two map keys.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return prepared.expected.get(path)!;
}

function snapshotApplyInput(
  plan: unknown,
  options: unknown,
): {
  readonly plan: EffectPlan;
  readonly rootMode: "existing" | "initialize";
  readonly options: Record<string, unknown>;
} {
  try {
    if (!isSafeRecord(plan) || !isSafeRecord(options))
      throw invalidApplyInput();
    const effects = ownData(plan, "effects");
    if (!Array.isArray(effects)) throw invalidApplyInput();
    const rootMode = ownData(options, "rootMode");
    if (rootMode !== "existing" && rootMode !== "initialize") {
      throw invalidApplyInput();
    }
    return {
      plan: { effects: snapshotEffectArray(effects) },
      rootMode,
      options,
    };
  } catch (error) {
    if (error instanceof TransactionFailure) throw error;
    throw new TransactionFailure("runtime.internal_failure", []);
  }
}

function snapshotEffect(value: unknown): EffectPlan["effects"][number] {
  if (!isSafeRecord(value)) throw invalidApplyInput();
  const kind = ownData(value, "kind");
  if (typeof kind !== "string") throw invalidApplyInput();
  switch (kind) {
    case "write_file": {
      const path = ownData(value, "path");
      const content = ownData(value, "content");
      if (typeof path !== "string" || typeof content !== "string") {
        throw invalidApplyInput();
      }
      return { kind, path, content };
    }
    case "delete_file":
    case "create_directory": {
      const path = ownData(value, "path");
      if (typeof path !== "string") throw invalidApplyInput();
      return { kind, path };
    }
    case "append_event":
      return snapshotAppendEffect(value);
    case "emit": {
      const channel = ownData(value, "channel");
      const text = ownData(value, "text");
      if (
        (channel !== "structured" && channel !== "human") ||
        typeof text !== "string"
      ) {
        throw invalidApplyInput();
      }
      return { kind, channel, text };
    }
    default:
      throw invalidApplyInput();
  }
}

function isSafeRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !types.isProxy(value) &&
    !Array.isArray(value)
  );
}

function ownData(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor))
    throw invalidApplyInput();
  return descriptor.value;
}

function snapshotEffectArray(value: unknown[]): readonly Effect[] {
  if (types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw invalidApplyInput();
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    !keys.includes("length") ||
    keys.some(
      (key) =>
        key !== "length" &&
        (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key)),
    )
  ) {
    throw invalidApplyInput();
  }
  const effects: Effect[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor))
      throw invalidApplyInput();
    effects.push(snapshotEffect(descriptor.value));
  }
  return effects;
}

function snapshotAppendEffect(
  value: Record<string, unknown>,
): AppendEventEffect {
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    keys.some(
      (key) =>
        typeof key !== "string" || !["kind", "runId", "event"].includes(key),
    )
  )
    throw invalidApplyInput();
  const kind = ownData(value, "kind");
  const runId = ownData(value, "runId");
  const event = ownData(value, "event");
  if (kind !== "append_event" || typeof runId !== "string")
    throw invalidApplyInput();
  let paths: ReturnType<typeof eventStorePaths> | undefined;
  try {
    paths = eventStorePaths(runId);
  } catch {
    throw invalidApplyInput();
  }
  try {
    return { kind, runId, event: snapshotEventDraft(event, types.isProxy) };
  } catch {
    throw new TransactionFailure("runtime.state_corrupt", eventEvidence(paths));
  }
}

function invalidApplyInput(): TransactionFailure {
  return new TransactionFailure("runtime.state_corrupt", [
    { kind: "artifact", ref: ".brain" },
  ]);
}

function selectEmitEffects(
  plan: EffectPlan,
): readonly Extract<
  EffectPlan["effects"][number],
  { readonly kind: "emit" }
>[] {
  const emits: Extract<
    EffectPlan["effects"][number],
    { readonly kind: "emit" }
  >[] = [];
  for (const effect of plan.effects) {
    switch (effect.kind) {
      case "append_event":
      case "create_directory":
      case "delete_file":
      case "write_file":
        break;
      case "emit":
        emits.push(effect);
        break;
      /* v8 ignore start -- the compile-time exhaustiveness assertion */
      default: {
        const unhandled: never = effect;
        throw new Error(`Unhandled effect kind: ${JSON.stringify(unhandled)}`);
      }
      /* v8 ignore stop */
    }
  }
  return emits;
}

function hasManagedEffects(plan: EffectPlan): boolean {
  return plan.effects.some(
    ({ kind }) =>
      kind === "create_directory" ||
      kind === "delete_file" ||
      kind === "write_file" ||
      kind === "append_event",
  );
}

function selectAppendEffect(plan: EffectPlan): AppendEventEffect | undefined {
  let append: AppendEventEffect | undefined;
  for (const effect of plan.effects) {
    if (effect.kind !== "append_event") continue;
    if (append !== undefined) throw invalidApplyInput();
    append = effect;
  }
  return append;
}

function assertAppendDestinationsExclusive(
  plan: EffectPlan,
  append: AppendEventEffect,
): void {
  let paths: ReturnType<typeof eventStorePaths> | undefined;
  try {
    paths = eventStorePaths(append.runId);
    const owned = [
      managedPathCollisionKey(paths.events),
      managedPathCollisionKey(paths.snapshot),
    ];
    for (const effect of plan.effects) {
      if (
        (effect.kind === "write_file" || effect.kind === "delete_file") &&
        owned.includes(managedPathCollisionKey(effect.path))
      ) {
        throw invalidApplyInput();
      }
    }
  } catch {
    throw invalidApplyInput();
  }
}

function snapshotAppendReducers<State>(
  options: Record<string, unknown>,
  append: AppendEventEffect,
  schemaRegistry: TransactionServices["schemaRegistry"],
): EventReducerRegistry<State> {
  const paths = eventStorePaths(append.runId);
  const dependencyState = { proxyDetectorFailed: false };
  try {
    let registry: unknown;
    try {
      registry = ownData(options, "eventReducers");
    } catch {
      throw new MissingReducerRegistry();
    }
    if (registry === undefined) throw new MissingReducerRegistry();
    return snapshotEventReducerRegistry(
      registry as EventReducerRegistry<State>,
      {
        isProxy(value) {
          try {
            return types.isProxy(value);
          } catch {
            dependencyState.proxyDetectorFailed = true;
            throw new Error("Reducer proxy detector failed");
          }
        },
        isPromise: types.isPromise,
        schemaRegistry,
      },
    );
  } catch (error) {
    const evidence = eventEvidence(paths);
    if (
      !dependencyState.proxyDetectorFailed &&
      (error instanceof MissingReducerRegistry ||
        isRecognizedReducerRegistryFailure(error))
    ) {
      throw new TransactionFailure("runtime.state_corrupt", evidence);
    }
    throw new TransactionFailure("runtime.internal_failure", []);
  }
}

function eventEvidence(paths: ReturnType<typeof eventStorePaths>) {
  return [
    { kind: "event" as const, ref: paths.events },
    { kind: "artifact" as const, ref: paths.snapshot },
  ];
}

function expandAppendEffect(
  plan: EffectPlan,
  prepared: PreparedEventAppend,
): EffectPlan {
  const effects: Effect[] = [];
  for (const effect of plan.effects) {
    if (effect.kind === "append_event") effects.push(...prepared.effects);
    else effects.push(effect);
  }
  return { effects };
}

async function assertPreparedAppendIsFresh(
  prepared: PreparedEventAppend,
  ports: RuntimePorts,
): Promise<void> {
  const changed: string[] = [];
  for (const [path, expected] of prepared.expected) {
    let observed: PathFingerprint | undefined;
    try {
      const entry = await ports.durableFileSystem.inspect(path);
      observed = freshFingerprint(entry);
    } catch {
      throw new TransactionFailure("runtime.internal_failure", []);
    }
    if (observed === undefined || !sameFingerprint(expected, observed)) {
      changed.push(path);
    }
  }
  if (changed.length !== 0) {
    throw new TransactionFailure(
      "runtime.revision_conflict",
      evidenceForChangedPaths(changed, prepared),
    );
  }
}

function freshFingerprint(entry: DurableEntry): PathFingerprint | undefined {
  if (entry.kind === "special" || entry.kind === "symlink") return undefined;
  return durableEntryFingerprint(entry, "");
}

function sameFingerprint(
  left: PathFingerprint,
  right: PathFingerprint,
): boolean {
  if (left.kind !== right.kind) return false;
  return (
    left.kind !== "file" ||
    (right.kind === "file" &&
      left.size === right.size &&
      left.sha256 === right.sha256)
  );
}

function evidenceForChangedPaths(
  paths: readonly string[],
  prepared: PreparedEventAppend,
) {
  return paths.map((path) => ({
    kind: path === prepared.paths.events ? "event" : "artifact",
    ref: path,
  })) as readonly {
    readonly kind: "event" | "artifact";
    readonly ref: string;
  }[];
}

async function observeManagedPaths(
  plan: EffectPlan,
  ports: RuntimePorts,
  expected?: ReadonlyMap<string, PathFingerprint>,
): Promise<ReadonlyMap<string, PathFingerprint>> {
  const observations = new Map<string, PathFingerprint>();
  try {
    for (const path of managedObservationPaths(plan)) {
      const prepared = expected?.get(path);
      if (prepared !== undefined) {
        observations.set(path, prepared);
        continue;
      }
      const entry = await ports.durableFileSystem.inspect(path);
      if (path === ".brain" && entry.kind === "file") {
        throw new TransactionFailure("runtime.state_corrupt", [
          { kind: "artifact", ref: path },
        ]);
      }
      observations.set(path, durableEntryFingerprint(entry, path));
    }
  } catch (error) {
    if (error instanceof TransactionFailure) throw error;
    throw new TransactionFailure("runtime.internal_failure", []);
  }
  return observations;
}

function managedObservationPaths(plan: EffectPlan): readonly string[] {
  const paths = new Set<string>();
  for (const effect of plan.effects) {
    if (
      effect.kind === "emit" ||
      effect.kind === "append_event" ||
      !isObservationCandidate(effect.path)
    ) {
      continue;
    }
    // The root is observed first so an unsafe root cannot be hidden behind a
    // descendant scan failure. This is a read boundary, not authorization;
    // normalization below remains the authoritative managed-path policy.
    paths.add(".brain");
    const segments = effect.path.split("/");
    for (let length = 2; length <= segments.length; length += 1) {
      paths.add(segments.slice(0, length).join("/"));
    }
  }
  return [...paths];
}

function isObservationCandidate(path: string): boolean {
  if (path === "" || path.includes("\\") || /^[A-Za-z]:/u.test(path)) {
    return false;
  }
  for (const character of path) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return false;
    }
  }
  const segments = path.split("/");
  return (
    segments.length >= 2 &&
    segments[0] === ".brain" &&
    !segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    ) &&
    segments[1]?.toLowerCase() !== "transactions"
  );
}

function durableEntryFingerprint(
  entry: DurableEntry,
  path: string,
): PathFingerprint {
  switch (entry.kind) {
    case "missing":
      return entry;
    case "directory":
      return { kind: "directory" };
    case "file":
      return { kind: "file", size: entry.size, sha256: entry.sha256 };
    case "special":
    case "symlink":
      throw new TransactionFailure("runtime.state_corrupt", [
        { kind: "artifact", ref: path },
      ]);
  }
}
