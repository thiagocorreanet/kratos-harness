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
