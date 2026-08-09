import type { EffectPlan } from "../domain/effects.js";
import {
  normalizeManagedMutationPlan,
  TransactionPolicyError,
  type PathFingerprint,
} from "../domain/transactions/index.js";
import {
  nodeClock,
  nodeDurableFileSystem,
  nodeEnvironment,
  nodeFileSystem,
  nodeGit,
  nodeIds,
  nodeLocks,
  nodeOutput,
  sha256Digests,
} from "../infra/node/index.js";
import type { DurableEntry, RuntimePorts } from "../ports/index.js";

import { configurationValidator, createSchemaRegistry } from "./schema.js";
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

export {
  configurationValidator,
  createSchemaRegistry,
  executeManagedMutation,
  inspectManagedTransactions,
  preflightManagedTransactions,
  recoverManagedMutation,
  TransactionFailure,
};
export type { TransactionReceipt, TransactionServices, TransactionSummary };

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
  return {
    clock: nodeClock(),
    ids: nodeIds(),
    digests: sha256Digests(),
    durableFileSystem: nodeDurableFileSystem(root),
    fileSystem: nodeFileSystem(root),
    git: nodeGit(root),
    locks: nodeLocks(root),
    environment: nodeEnvironment(),
    output: nodeOutput(),
    ...overrides,
  };
}

/** Reserved destination for the future canonical append operation. */
const eventLogPath = ".brain/events.jsonl";

export type ApplyPlanOutcome =
  { readonly kind: "committed" } | { readonly kind: "noop" };

/**
 * Commit every managed effect through one durable transaction, then emit.
 *
 * The outcome lets orchestration report the concrete mutation fact: a command
 * may be allowed to mutate state while its already-satisfied plan is a no-op.
 */
export async function applyPlan(
  plan: EffectPlan,
  ports: RuntimePorts,
  options: { readonly rootMode: "existing" | "initialize" } = {
    rootMode: "existing",
  },
): Promise<ApplyPlanOutcome> {
  const input = snapshotApplyInput(plan, options);
  const frozenPlan = input.plan;
  const frozenOptions = { rootMode: input.rootMode };
  const emits = selectEmitEffects(frozenPlan);

  const services: TransactionServices = {
    clock: ports.clock,
    ids: ports.ids,
    digests: ports.digests,
    durableFileSystem: ports.durableFileSystem,
    schemaRegistry: createSchemaRegistry(),
  };
  if (hasManagedEffects(frozenPlan)) {
    await preflightManagedTransactions(frozenOptions, services);
  }
  const append = frozenPlan.effects.find(({ kind }) => kind === "append_event");
  if (append !== undefined) {
    throw new TransactionFailure("runtime.state_corrupt", [
      { kind: "artifact", ref: eventLogPath },
    ]);
  }
  const observations = await observeManagedPaths(frozenPlan, ports);
  let normalized: ReturnType<typeof normalizeManagedMutationPlan>;
  try {
    normalized = normalizeManagedMutationPlan(
      frozenPlan,
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

  let outcome: ApplyPlanOutcome;
  if (normalized.kind === "noop") {
    outcome = { kind: "noop" };
  } else {
    const receipt = await executeManagedMutation(
      normalized.plan,
      frozenOptions,
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

function snapshotApplyInput(
  plan: unknown,
  options: unknown,
): {
  readonly plan: EffectPlan;
  readonly rootMode: "existing" | "initialize";
} {
  try {
    if (!isRecord(plan) || !Array.isArray(plan.effects)) {
      throw invalidApplyInput();
    }
    if (!isRecord(options)) throw invalidApplyInput();
    const rootMode = options.rootMode;
    if (rootMode !== "existing" && rootMode !== "initialize") {
      throw invalidApplyInput();
    }
    return {
      plan: { effects: plan.effects.map(snapshotEffect) },
      rootMode,
    };
  } catch (error) {
    if (error instanceof TransactionFailure) throw error;
    throw new TransactionFailure("runtime.internal_failure", []);
  }
}

function snapshotEffect(value: unknown): EffectPlan["effects"][number] {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw invalidApplyInput();
  }
  switch (value.kind) {
    case "write_file":
      if (typeof value.path !== "string" || typeof value.content !== "string") {
        throw invalidApplyInput();
      }
      return { kind: value.kind, path: value.path, content: value.content };
    case "delete_file":
    case "create_directory":
      if (typeof value.path !== "string") throw invalidApplyInput();
      return { kind: value.kind, path: value.path };
    case "append_event":
      if (typeof value.event !== "string") throw invalidApplyInput();
      return { kind: value.kind, event: value.event };
    case "emit":
      if (
        (value.channel !== "structured" && value.channel !== "human") ||
        typeof value.text !== "string"
      ) {
        throw invalidApplyInput();
      }
      return { kind: value.kind, channel: value.channel, text: value.text };
    default:
      throw invalidApplyInput();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      kind === "write_file",
  );
}

async function observeManagedPaths(
  plan: EffectPlan,
  ports: RuntimePorts,
): Promise<ReadonlyMap<string, PathFingerprint>> {
  const observations = new Map<string, PathFingerprint>();
  try {
    for (const path of managedObservationPaths(plan)) {
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
