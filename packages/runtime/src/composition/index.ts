import { types } from "node:util";

import { defaultModelRouting } from "@kratos/adapters";

import type {
  AppendEventEffect,
  Effect,
  EffectPlan,
  WriteFilePrecondition,
} from "../domain/effects.js";
import {
  isRecognizedReducerRegistryFailure,
  snapshotEventDraft,
  snapshotEventReducerRegistry,
  type EventReducerRegistry,
  type JsonState,
} from "../domain/events/index.js";
import {
  isManagedDirectoryDestination,
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
  nodeStandardInput,
  nodeTargetInspector,
  nodeWorkspace,
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
    modelRouting: defaultModelRouting(),
    environment: nodeEnvironment(),
    output: nodeOutput(),
    standardInput: nodeStandardInput(),
    targetInspector: nodeTargetInspector(root),
    workspace: nodeWorkspace(),
    ...overrides,
  };
}

export type ApplyPlanOutcome =
  { readonly kind: "committed" } | { readonly kind: "noop" };

export interface ApplyPlanOptions<State = JsonState> {
  readonly rootMode: "existing" | "initialize";
  readonly eventReducers?: EventReducerRegistry<State>;
  /**
   * Explicit reducer authority for an atomic transaction spanning distinct
   * event stores. The feature/run binding prevents one registry from being
   * silently reused for another run.
   */
  readonly eventReducerRegistries?: readonly EventReducerBinding<State>[];
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

export interface EventReducerBinding<State = JsonState> {
  readonly feature: string;
  readonly runId: string;
  readonly reducers: EventReducerRegistry<State>;
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
  const { frozenOptions, guards, services, prepared, normalized, emits } =
    decided;
  assertPreviewStillHolds(options.expectPreview, normalized, ports);

  let outcome: ApplyPlanOutcome;
  if (normalized.kind === "noop") {
    outcome = { kind: "noop" };
  } else {
    const receipt = await executeManagedMutation(
      normalized.plan,
      prepared.length === 0
        ? guards.length === 0
          ? frozenOptions
          : { ...frozenOptions, guardPreconditions: guards }
        : {
            ...frozenOptions,
            eventStorePreconditions: prepared.flatMap((append) => [
              {
                path: append.paths.events,
                expected: preparedFingerprint(append, append.paths.events),
              },
              {
                path: append.paths.snapshot,
                expected: preparedFingerprint(append, append.paths.snapshot),
              },
            ]),
            ...(guards.length === 0 ? {} : { guardPreconditions: guards }),
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
  readonly guards: readonly {
    readonly path: string;
    readonly expected: Extract<PathFingerprint, { readonly kind: "file" }>;
  }[];
  readonly services: TransactionServices;
  readonly prepared: readonly PreparedEventAppend[];
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
  const appends = selectAppendEffects(frozenPlan);
  assertAppendDestinationsExclusive(frozenPlan, appends);

  const prepared: PreparedEventAppend[] = [];
  if (appends.length !== 0) {
    const reducerRegistries = snapshotAppendReducerRegistries(
      input.options,
      appends,
      services.schemaRegistry,
    );
    await preflightManagedTransactions(frozenOptions, services, reconcile);
    for (const [index, append] of appends.entries()) {
      const reducers = reducerRegistries[index];
      if (reducers === undefined) throw invalidApplyInput();
      prepared.push(
        await prepareEventAppend(
          { feature: append.feature, runId: append.runId, event: append.event },
          {
            durableFileSystem: ports.durableFileSystem,
            digests: ports.digests,
            reducers,
            schemaRegistry: services.schemaRegistry,
          },
        ),
      );
    }
  } else if (hasManagedEffects(frozenPlan)) {
    await preflightManagedTransactions(frozenOptions, services, reconcile);
  }
  const expandedPlan = expandAppendEffects(frozenPlan, appends, prepared);
  const expected = new Map<string, PathFingerprint>();
  for (const append of prepared) {
    for (const [path, fingerprint] of append.expected)
      expected.set(path, fingerprint);
  }
  const observations = await observeManagedPaths(expandedPlan, ports, expected);
  assertWritePreconditions(expandedPlan, observations);
  const guards = expandedPlan.effects
    .filter(
      (effect): effect is Extract<Effect, { readonly kind: "assert_file" }> =>
        effect.kind === "assert_file",
    )
    .map(({ path, expected }) => ({ path, expected }));
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

  for (const append of prepared)
    await assertPreparedAppendIsFresh(append, ports);

  return { frozenOptions, guards, services, prepared, normalized, emits };
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
  /* v8 ignore next -- the two previews differ, so either an index diverged in
   * the loop above or the decision holds an operation the preview did not; a
   * shorter decision is already caught by the undefined check up there. */
  return [{ kind: "artifact", ref: extra?.path ?? ".brain" }];
}

function sameOperation(
  left: PreviewOperation,
  right: PreviewOperation,
): boolean {
  // The identifier is positional, so two operations compared at the same index
  // always share it. Checking it would look like a comparison and never be one.
  return (
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
    /* v8 ignore start -- the decision boundary sanitizes every failure it can
     * raise into a typed one, so this guard only carries a fault from outside
     * it that no test can inject through the ports. */
    if (!(error instanceof TransactionFailure)) throw error;
    /* v8 ignore stop */
    return Object.freeze({
      kind: "blocked" as const,
      reasonCode: error.reasonCode,
      evidence: error.evidence,
    });
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
      const expected = snapshotWritePrecondition(value);
      return expected === undefined
        ? { kind, path, content }
        : { kind, path, content, expected };
    }
    case "assert_file": {
      const path = ownData(value, "path");
      if (typeof path !== "string") throw invalidApplyInput();
      const expected = snapshotWritePrecondition(value);
      if (expected?.kind !== "file") throw invalidApplyInput();
      return { kind, path, expected };
    }
    case "delete_file": {
      const path = ownData(value, "path");
      if (typeof path !== "string") throw invalidApplyInput();
      const expected = snapshotWritePrecondition(value);
      if (expected?.kind === "missing") throw invalidApplyInput();
      return expected === undefined ? { kind, path } : { kind, path, expected };
    }
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

function snapshotWritePrecondition(
  value: Record<string, unknown>,
): WriteFilePrecondition | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, "expected");
  if (descriptor === undefined) return undefined;
  if (!("value" in descriptor) || !isSafeRecord(descriptor.value)) {
    throw invalidApplyInput();
  }
  const expected = descriptor.value;
  const kind = ownData(expected, "kind");
  const keys = Reflect.ownKeys(expected);
  if (kind === "missing") {
    if (keys.length !== 1 || keys[0] !== "kind") throw invalidApplyInput();
    return { kind };
  }
  if (kind !== "file") throw invalidApplyInput();
  if (
    keys.length !== 3 ||
    keys.some(
      (key) =>
        typeof key !== "string" || !["kind", "size", "sha256"].includes(key),
    )
  ) {
    throw invalidApplyInput();
  }
  const size = ownData(expected, "size");
  const sha256 = ownData(expected, "sha256");
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(sha256)
  ) {
    throw invalidApplyInput();
  }
  return { kind, size, sha256 };
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
    keys.length !== 4 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !["kind", "feature", "runId", "event"].includes(key),
    )
  )
    throw invalidApplyInput();
  const kind = ownData(value, "kind");
  const feature = ownData(value, "feature");
  const runId = ownData(value, "runId");
  const event = ownData(value, "event");
  if (
    kind !== "append_event" ||
    typeof feature !== "string" ||
    typeof runId !== "string"
  )
    throw invalidApplyInput();
  let paths: ReturnType<typeof eventStorePaths> | undefined;
  try {
    paths = eventStorePaths({ feature, runId });
  } catch {
    throw invalidApplyInput();
  }
  try {
    const draft = snapshotEventDraft(event, types.isProxy);
    if (
      draft.stateContract !== "1.2.0" &&
      draft.stateContract !== "1.3.0" &&
      draft.stateContract !== "1.4.0"
    ) {
      throw invalidApplyInput();
    }
    return {
      kind,
      feature,
      runId,
      event: draft,
    };
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
      case "assert_file":
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
      kind === "assert_file" ||
      kind === "append_event",
  );
}

function selectAppendEffects(plan: EffectPlan): readonly AppendEventEffect[] {
  const appends: AppendEventEffect[] = [];
  for (const effect of plan.effects) {
    if (effect.kind !== "append_event") continue;
    appends.push(effect);
  }
  return appends;
}

function assertAppendDestinationsExclusive(
  plan: EffectPlan,
  appends: readonly AppendEventEffect[],
): void {
  if (appends.length === 0) return;
  try {
    const owned = new Set<string>();
    for (const append of appends) {
      const paths = eventStorePaths(append);
      for (const path of [paths.events, paths.snapshot]) {
        const key = managedPathCollisionKey(path);
        if (owned.has(key)) throw invalidApplyInput();
        owned.add(key);
      }
    }
    for (const effect of plan.effects) {
      if (
        (effect.kind === "write_file" || effect.kind === "delete_file") &&
        owned.has(managedPathCollisionKey(effect.path))
      ) {
        throw invalidApplyInput();
      }
    }
  } catch {
    throw invalidApplyInput();
  }
}

function snapshotAppendReducer<State>(
  registry: unknown,
  append: AppendEventEffect,
  schemaRegistry: TransactionServices["schemaRegistry"],
): EventReducerRegistry<State> {
  const paths = eventStorePaths(append);
  const dependencyState = { proxyDetectorFailed: false };
  try {
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

function snapshotAppendReducerRegistries<State>(
  options: Record<string, unknown>,
  appends: readonly AppendEventEffect[],
  schemaRegistry: TransactionServices["schemaRegistry"],
): readonly EventReducerRegistry<State>[] {
  try {
    const singleDescriptor = Object.getOwnPropertyDescriptor(
      options,
      "eventReducers",
    );
    const multipleDescriptor = Object.getOwnPropertyDescriptor(
      options,
      "eventReducerRegistries",
    );
    if (singleDescriptor !== undefined && multipleDescriptor !== undefined)
      throw invalidApplyInput();
    if (appends.length === 1 && multipleDescriptor === undefined) {
      if (singleDescriptor !== undefined && !("value" in singleDescriptor))
        throw invalidApplyInput();
      const append = appends[0];
      if (append === undefined) throw invalidApplyInput();
      return [
        snapshotAppendReducer<State>(
          singleDescriptor?.value,
          append,
          schemaRegistry,
        ),
      ];
    }
    if (multipleDescriptor === undefined || !("value" in multipleDescriptor))
      throw invalidApplyInput();
    const bindings: unknown = multipleDescriptor.value;
    if (
      !Array.isArray(bindings) ||
      types.isProxy(bindings) ||
      Object.getPrototypeOf(bindings) !== Array.prototype ||
      bindings.length !== appends.length ||
      Reflect.ownKeys(bindings).length !== bindings.length + 1
    )
      throw invalidApplyInput();
    const byDestination = new Map<string, EventReducerRegistry<State>>();
    for (let index = 0; index < bindings.length; index += 1) {
      const binding = Object.getOwnPropertyDescriptor(bindings, String(index));
      if (binding === undefined || !("value" in binding))
        throw invalidApplyInput();
      const value: unknown = binding.value;
      if (
        !isSafeRecord(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Reflect.ownKeys(value).length !== 3
      )
        throw invalidApplyInput();
      const feature = ownData(value, "feature");
      const runId = ownData(value, "runId");
      const registry = ownData(value, "reducers");
      if (typeof feature !== "string" || typeof runId !== "string")
        throw invalidApplyInput();
      const key = `${feature}\u0000${runId}`;
      if (byDestination.has(key)) throw invalidApplyInput();
      const append = appends.find(
        (candidate) =>
          candidate.feature === feature && candidate.runId === runId,
      );
      if (append === undefined) throw invalidApplyInput();
      byDestination.set(
        key,
        snapshotAppendReducer<State>(registry, append, schemaRegistry),
      );
    }
    return appends.map((append) => {
      const registry = byDestination.get(
        `${append.feature}\u0000${append.runId}`,
      );
      if (registry === undefined) throw invalidApplyInput();
      return registry;
    });
  } catch (error) {
    if (error instanceof TransactionFailure) throw error;
    throw invalidApplyInput();
  }
}

function eventEvidence(paths: ReturnType<typeof eventStorePaths>) {
  return [
    { kind: "event" as const, ref: paths.events },
    { kind: "artifact" as const, ref: paths.snapshot },
  ];
}

function expandAppendEffects(
  plan: EffectPlan,
  appends: readonly AppendEventEffect[],
  prepared: readonly PreparedEventAppend[],
): EffectPlan {
  const effects: Effect[] = [];
  let index = 0;
  for (const effect of plan.effects) {
    if (effect.kind === "append_event") {
      const append = appends[index];
      const resolved = prepared[index];
      const paths = append === undefined ? undefined : eventStorePaths(append);
      if (
        append === undefined ||
        resolved === undefined ||
        paths?.events !== resolved.paths.events ||
        paths.snapshot !== resolved.paths.snapshot
      )
        throw invalidApplyInput();
      effects.push(...resolved.effects);
      index += 1;
    } else effects.push(effect);
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

/** Bind decision-time file observations to the managed transaction decision. */
function assertWritePreconditions(
  plan: EffectPlan,
  observations: ReadonlyMap<string, PathFingerprint>,
): void {
  for (const effect of plan.effects) {
    if (
      (effect.kind !== "write_file" &&
        effect.kind !== "delete_file" &&
        effect.kind !== "assert_file") ||
      effect.expected === undefined
    )
      continue;
    const observed = observations.get(effect.path);
    if (observed === undefined || !sameFingerprint(effect.expected, observed)) {
      throw new TransactionFailure("runtime.revision_conflict", [
        { kind: "artifact", ref: effect.path },
      ]);
    }
  }
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
      !isManagedDirectoryDestination(effect.path)
    ) {
      continue;
    }
    // The root is observed first so an unsafe root cannot be hidden behind a
    // descendant scan failure. This is a read boundary, not authorization;
    // normalization below remains the authoritative managed-path policy.
    paths.add(".brain");
    const segments = effect.path.split("/");
    // From the first component: a host root and a root file are both
    // destinations now, and an unobserved destination is one a second run
    // rewrites instead of recognizing as already right.
    for (let length = 1; length <= segments.length; length += 1) {
      paths.add(segments.slice(0, length).join("/"));
    }
  }
  return [...paths];
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
