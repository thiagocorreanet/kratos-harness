import type {
  LanguagePolicyV1,
  ProjectConfigV1,
  ProjectConfigV1_1,
  ProjectConfigV1_2,
  ProjectConfigV1_3,
} from "@kratos/contracts";

import {
  unresolvedProjectProfile,
  type ResolvedProjectProfile,
} from "../init/profile.js";

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

/** Deterministically map a legacy single-field language setting into a granular language policy. */
export function migrateLegacyLanguage(
  language: "en" | "pt-BR",
): LanguagePolicyV1 {
  return {
    conversation: language,
    documentation: language,
    comments: "en",
    identifiers: "en",
    commits: "en",
    preserveConventions: true,
    enforcement: "advisory",
  };
}

/** Upgrade a v1.1 configuration payload to v1.2 with granular language policy. */
export function upgradeProjectConfigurationV1_2(
  source: ProjectConfigV1_1,
): ProjectConfigV1_2 {
  return {
    contractVersion: "1.2.0",
    stateContract: "1.2.0",
    pluginVersion: source.pluginVersion,
    hostContract: "1.2.0",
    language: migrateLegacyLanguage(source.language),
    policyMode: source.policyMode,
    managedState: { ...source.managedState },
    modelRoles: source.modelRoles,
  };
}

/** Upgrade a v1.2 configuration payload to v1.3 with its typed project profile. */
export function upgradeProjectConfigurationV1_3(
  source: ProjectConfigV1_2,
  projectProfile: ResolvedProjectProfile = unresolvedProjectProfile(),
): ProjectConfigV1_3 {
  return {
    contractVersion: "1.3.0",
    stateContract: "1.3.0",
    pluginVersion: source.pluginVersion,
    hostContract: "1.3.0",
    language: { ...source.language },
    policyMode: source.policyMode,
    managedState: { ...source.managedState },
    modelRoles: source.modelRoles,
    projectProfile: structuredClone(
      projectProfile,
    ) as ProjectConfigV1_3["projectProfile"],
  };
}

/**
 * Upgrade the legacy v1.0 project payload to v1.2.
 *
 * Every pre-existing setting comes from the validated source configuration.
 * Migration answers contribute only the newly required, already normalized
 * role map, so an upgrade cannot silently reset language, policy, or snapshot
 * behavior to initialization defaults.
 */
export function upgradeProjectConfiguration(
  source: ProjectConfigV1,
  modelRoles: ProjectConfigV1_1["modelRoles"],
): ProjectConfigV1_2 {
  return upgradeProjectConfigurationV1_2({
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    pluginVersion: source.pluginVersion,
    hostContract: "1.1.0",
    language: source.language,
    policyMode: source.policyMode,
    managedState: { ...source.managedState },
    modelRoles,
  });
}
