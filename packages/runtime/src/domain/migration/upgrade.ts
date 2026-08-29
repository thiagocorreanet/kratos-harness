import type { ProjectConfigV1, ProjectConfigV1_1 } from "@kratos/contracts";

export interface StateUpgrade {
  readonly from: string;
  readonly to: string;
  readonly upgrade: (value: unknown) => unknown;
}

export type UpgradeResult =
  | {
      readonly kind: "upgraded";
      readonly value: unknown;
      readonly path: readonly string[];
    }
  | {
      readonly kind: "current";
      readonly value: unknown;
      readonly path: readonly string[];
    }
  | { readonly kind: "unsupported"; readonly path: readonly string[] };

/** Apply only declared adjacent upgrades; no version is guessed or skipped. */
export function upgradeState(
  value: unknown,
  from: string,
  target: string,
  upgrades: readonly StateUpgrade[],
): UpgradeResult {
  if (from === target) return { kind: "current", value, path: [from] };
  let current = from;
  let state = value;
  const path = [from];
  const visited = new Set<string>();
  while (current !== target) {
    if (visited.has(current)) return { kind: "unsupported", path };
    visited.add(current);
    const candidates = upgrades.filter(
      ({ from: source }) => source === current,
    );
    if (candidates.length !== 1) return { kind: "unsupported", path };
    const step = candidates[0];
    if (step === undefined) return { kind: "unsupported", path };
    try {
      state = step.upgrade(state);
    } catch {
      return { kind: "unsupported", path };
    }
    current = step.to;
    path.push(current);
  }
  return { kind: "upgraded", value: state, path };
}

/**
 * Upgrade the one project payload whose old revision cannot execute phases.
 *
 * Every pre-existing setting comes from the validated source configuration.
 * Migration answers contribute only the newly required, already normalized
 * role map, so an upgrade cannot silently reset language, policy, or snapshot
 * behavior to initialization defaults.
 */
export function upgradeProjectConfiguration(
  source: ProjectConfigV1,
  modelRoles: ProjectConfigV1_1["modelRoles"],
): ProjectConfigV1_1 {
  return {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    pluginVersion: source.pluginVersion,
    hostContract: "1.1.0",
    language: source.language,
    policyMode: source.policyMode,
    managedState: { ...source.managedState },
    modelRoles,
  };
}
