export type PolicyAuthority = "organization" | "project";

export interface RigorRequirements {
  readonly gateIds: readonly string[];
  readonly evidenceKinds: readonly string[];
  readonly minimumApprovals: number;
  readonly independentJudges: 0 | 1 | 2;
}

export interface RigorProfile {
  readonly id: string;
  readonly rank: number;
  readonly extends?: string;
  readonly requirements: RigorRequirements;
}

export interface RiskFacts {
  readonly changedFiles: number;
  readonly touchesProtectedPath: boolean;
  readonly securitySensitive: boolean;
  readonly changesPublicContract: boolean;
  readonly migratesData: boolean;
}

export interface RiskRule {
  readonly id: string;
  readonly profileId: string;
  readonly when: Partial<RiskFacts> & { readonly minimumChangedFiles?: number };
}

export interface PolicyPack {
  readonly packId: string;
  readonly version: string;
  readonly digest: string;
  readonly authority: PolicyAuthority;
  readonly trusted: boolean;
  readonly defaultProfileId: string;
  readonly minimumProfileId: string;
  readonly profiles: readonly RigorProfile[];
  readonly rules: readonly RiskRule[];
}

export type ProfileSelection =
  | {
      readonly kind: "selected";
      readonly profileId: string;
      readonly packId: string;
      readonly packVersion: string;
      readonly packDigest: string;
      readonly matchedRuleIds: readonly string[];
      readonly requirements: RigorRequirements;
    }
  | {
      readonly kind: "refused";
      readonly reason:
        | "policy.untrusted"
        | "policy.invalid"
        | "policy.inheritance_cycle";
    };

export interface HistoricalRigorDecision {
  readonly profileId: string;
  readonly requirements: RigorRequirements;
}

export type ShadowProfileComparison =
  | {
      readonly kind: "compared";
      readonly change: "same" | "tightened" | "would-weaken";
      readonly addedGateIds: readonly string[];
      readonly removedGateIds: readonly string[];
    }
  | { readonly kind: "blocked"; readonly reason: "refused" };

function matches(rule: RiskRule, facts: RiskFacts): boolean {
  const { minimumChangedFiles, ...expected } = rule.when;
  if (
    minimumChangedFiles !== undefined &&
    facts.changedFiles < minimumChangedFiles
  ) {
    return false;
  }
  return Object.entries(expected).every(
    ([key, value]) => facts[key as keyof RiskFacts] === value,
  );
}

function mergeRequirements(
  parent: RigorRequirements,
  own: RigorRequirements,
): RigorRequirements {
  return {
    gateIds: [...new Set([...parent.gateIds, ...own.gateIds])].sort(),
    evidenceKinds: [
      ...new Set([...parent.evidenceKinds, ...own.evidenceKinds]),
    ].sort(),
    minimumApprovals: Math.max(
      parent.minimumApprovals,
      own.minimumApprovals,
    ),
    independentJudges: Math.max(
      parent.independentJudges,
      own.independentJudges,
    ) as 0 | 1 | 2,
  };
}

function resolveRequirements(
  profile: RigorProfile,
  profiles: ReadonlyMap<string, RigorProfile>,
  visiting: ReadonlySet<string>,
): RigorRequirements | null {
  if (visiting.has(profile.id)) return null;
  if (profile.extends === undefined) return profile.requirements;
  const parent = profiles.get(profile.extends);
  if (parent === undefined) return null;
  const next = new Set(visiting);
  next.add(profile.id);
  const inherited = resolveRequirements(parent, profiles, next);
  return inherited === null
    ? null
    : mergeRequirements(inherited, profile.requirements);
}

/** Selects a visible, replayable profile and never weakens the declared floor. */
export function selectRigorProfile(
  pack: PolicyPack,
  facts: RiskFacts,
): ProfileSelection {
  if (!pack.trusted) return { kind: "refused", reason: "policy.untrusted" };
  const profiles = new Map<string, RigorProfile>();
  for (const profile of pack.profiles) profiles.set(profile.id, profile);
  if (
    profiles.size !== pack.profiles.length ||
    new Set(pack.rules.map(({ id }) => id)).size !== pack.rules.length
  ) {
    return { kind: "refused", reason: "policy.invalid" };
  }
  const floor = profiles.get(pack.minimumProfileId);
  const fallback = profiles.get(pack.defaultProfileId);
  if (floor === undefined || fallback === undefined) {
    return { kind: "refused", reason: "policy.invalid" };
  }
  const matching = pack.rules
    .filter((rule) => matches(rule, facts))
    .sort((left, right) => left.id.localeCompare(right.id, "en-US"));
  if (matching.some(({ profileId }) => !profiles.has(profileId))) {
    return { kind: "refused", reason: "policy.invalid" };
  }
  const candidates = [
    floor,
    fallback,
    ...matching.map(({ profileId }) => profiles.get(profileId) as RigorProfile),
  ];
  const selected = candidates.sort(
    (left, right) =>
      right.rank - left.rank || left.id.localeCompare(right.id, "en-US"),
  )[0];
  if (selected === undefined || selected.rank < floor.rank) {
    return { kind: "refused", reason: "policy.invalid" };
  }
  const requirements = resolveRequirements(selected, profiles, new Set());
  if (requirements === null) {
    return { kind: "refused", reason: "policy.inheritance_cycle" };
  }
  return {
    kind: "selected",
    profileId: selected.id,
    packId: pack.packId,
    packVersion: pack.version,
    packDigest: pack.digest,
    matchedRuleIds: matching.map(({ id }) => id),
    requirements,
  };
}

export function comparePolicyPackShadow(
  historical: HistoricalRigorDecision,
  candidate: ProfileSelection,
): ShadowProfileComparison {
  if (candidate.kind !== "selected") {
    return { kind: "blocked", reason: candidate.kind };
  }
  const before = new Set(historical.requirements.gateIds);
  const after = new Set(candidate.requirements.gateIds);
  const addedGateIds = [...after].filter((id) => !before.has(id)).sort();
  const removedGateIds = [...before].filter((id) => !after.has(id)).sort();
  const weaker =
    removedGateIds.length > 0 ||
    candidate.requirements.minimumApprovals <
      historical.requirements.minimumApprovals ||
    candidate.requirements.independentJudges <
      historical.requirements.independentJudges;
  const tightened =
    addedGateIds.length > 0 ||
    candidate.requirements.minimumApprovals >
      historical.requirements.minimumApprovals ||
    candidate.requirements.independentJudges >
      historical.requirements.independentJudges;
  return {
    kind: "compared",
    change: weaker ? "would-weaken" : tightened ? "tightened" : "same",
    addedGateIds,
    removedGateIds,
  };
}
