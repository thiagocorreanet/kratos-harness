import type { Effect, EffectPlan } from "../effects.js";
import { isManagedDestination } from "./surface.js";
import {
  TransactionPolicyError,
  type ManagedMutationPlan,
  type ManagedOperation,
  type PathFingerprint,
} from "./model.js";

type ManagedEffect = Extract<
  Effect,
  { readonly kind: "create_directory" | "delete_file" | "write_file" }
>;

type DraftOperation =
  | {
      readonly kind: "create_directory";
      readonly path: string;
      readonly expected: PathFingerprint;
      readonly result: PathFingerprint;
    }
  | {
      readonly kind: "write_file";
      readonly path: string;
      readonly expected: PathFingerprint;
      readonly result: PathFingerprint;
      readonly content: string;
    }
  | {
      readonly kind: "delete_file";
      readonly path: string;
      readonly expected: PathFingerprint;
      readonly result: PathFingerprint;
    };

const missing = { kind: "missing" } as const;
const directory = { kind: "directory" } as const;
const utf8 = new TextEncoder();

export function normalizeManagedMutationPlan(
  effectPlan: EffectPlan,
  observations: ReadonlyMap<string, PathFingerprint>,
  sha256: (text: string) => string,
):
  | { readonly kind: "noop" }
  | { readonly kind: "ready"; readonly plan: ManagedMutationPlan } {
  const managedEffects = selectManagedEffects(effectPlan);
  validateRelationships(managedEffects);

  const observedState = new Map(observations);
  const drafts: DraftOperation[] = [];
  for (const effect of managedEffects) {
    if (effect.kind === "create_directory" || effect.kind === "write_file") {
      synthesizeMissingParents(effect.path, observedState, drafts);
    }

    const expected = observedState.get(effect.path) ?? missing;
    switch (effect.kind) {
      case "create_directory":
        normalizeCreateDirectory(effect.path, expected, observedState, drafts);
        break;
      case "write_file":
        normalizeWriteFile(effect, expected, sha256, observedState, drafts);
        break;
      case "delete_file":
        normalizeDeleteFile(effect.path, expected, observedState, drafts);
        break;
    }
  }

  if (drafts.length === 0) return { kind: "noop" };
  return {
    kind: "ready",
    plan: { operations: drafts.map(finalizeOperation) },
  };
}

function selectManagedEffects(effectPlan: EffectPlan): ManagedEffect[] {
  const effects: ManagedEffect[] = [];
  for (const effect of effectPlan.effects) {
    switch (effect.kind) {
      case "emit":
        break;
      case "append_event":
        throw invalidState();
      case "create_directory":
      case "delete_file":
      case "write_file":
        assertManagedPath(effect.path);
        effects.push(effect);
        break;
    }
  }
  return effects;
}

function assertManagedPath(path: string): void {
  if (!isManagedDestination(path)) throw outsideAllowlist();
}

function validateRelationships(effects: readonly ManagedEffect[]): void {
  const spellings = new Map<string, string>();
  for (const effect of effects) {
    for (const path of managedPathPrefixes(effect.path)) {
      const key = collisionKey(path);
      const prior = spellings.get(key);
      if (prior !== undefined && prior !== path) throw invalidState();
      spellings.set(key, path);
    }
  }

  for (const [leftIndex, left] of effects.entries()) {
    for (const right of effects.slice(leftIndex + 1)) {
      const leftPath = collisionKey(left.path);
      const rightPath = collisionKey(right.path);
      if (leftPath === rightPath) throw invalidState();

      if (isParent(leftPath, rightPath)) {
        if (left.kind !== "create_directory") throw invalidState();
        continue;
      }
      if (isParent(rightPath, leftPath)) {
        throw invalidState();
      }
    }
  }
}

function managedPathPrefixes(path: string): string[] {
  const segments = path.split("/");
  const prefixes: string[] = [];
  for (let length = 2; length <= segments.length; length += 1) {
    prefixes.push(segments.slice(0, length).join("/"));
  }
  return prefixes;
}

function synthesizeMissingParents(
  path: string,
  observedState: Map<string, PathFingerprint>,
  drafts: DraftOperation[],
): void {
  const segments = path.split("/");
  for (let length = 2; length < segments.length; length += 1) {
    const parent = segments.slice(0, length).join("/");
    const expected = observedState.get(parent) ?? missing;
    if (expected.kind === "file") throw invalidState();
    if (expected.kind === "directory") continue;
    drafts.push({
      kind: "create_directory",
      path: parent,
      expected,
      result: directory,
    });
    observedState.set(parent, directory);
  }
}

function normalizeCreateDirectory(
  path: string,
  expected: PathFingerprint,
  observedState: Map<string, PathFingerprint>,
  drafts: DraftOperation[],
): void {
  if (expected.kind === "file") throw invalidState();
  if (expected.kind === "missing") {
    drafts.push({
      kind: "create_directory",
      path,
      expected,
      result: directory,
    });
  }
  observedState.set(path, directory);
}

function normalizeWriteFile(
  effect: Extract<ManagedEffect, { readonly kind: "write_file" }>,
  expected: PathFingerprint,
  sha256: (text: string) => string,
  observedState: Map<string, PathFingerprint>,
  drafts: DraftOperation[],
): void {
  if (expected.kind === "directory") throw invalidState();
  const result = {
    kind: "file",
    size: utf8.encode(effect.content).byteLength,
    sha256: sha256(effect.content),
  } as const;
  if (!sameFingerprint(expected, result)) {
    drafts.push({
      kind: "write_file",
      path: effect.path,
      expected,
      result,
      content: effect.content,
    });
  }
  observedState.set(effect.path, result);
}

function normalizeDeleteFile(
  path: string,
  expected: PathFingerprint,
  observedState: Map<string, PathFingerprint>,
  drafts: DraftOperation[],
): void {
  if (expected.kind === "directory") throw invalidState();
  if (expected.kind === "file") {
    drafts.push({
      kind: "delete_file",
      path,
      expected,
      result: missing,
    });
  }
  observedState.set(path, missing);
}

function finalizeOperation(
  draft: DraftOperation,
  index: number,
): ManagedOperation {
  const operationId = `operation-${String(index + 1).padStart(4, "0")}`;
  if (draft.kind === "write_file") {
    return {
      ...draft,
      operationId,
      stagedPath: `staging/${operationId}.payload`,
    };
  }
  return { ...draft, operationId, stagedPath: null };
}

function sameFingerprint(
  left: PathFingerprint,
  right: Extract<PathFingerprint, { readonly kind: "file" }>,
): boolean {
  return (
    left.kind === "file" &&
    left.size === right.size &&
    left.sha256 === right.sha256
  );
}

function collisionKey(path: string): string {
  return path.toLowerCase();
}

/** Validate a caller spelling under the managed-path policy and return its
 * case-insensitive collision key. Composition uses this for owned paths. */
export function managedPathCollisionKey(path: string): string {
  assertManagedPath(path);
  return collisionKey(path);
}

function isParent(parent: string, child: string): boolean {
  return child.startsWith(`${parent}/`);
}

function outsideAllowlist(): TransactionPolicyError {
  return new TransactionPolicyError("guard.outside_allow");
}

function invalidState(): TransactionPolicyError {
  return new TransactionPolicyError("runtime.state_corrupt");
}
