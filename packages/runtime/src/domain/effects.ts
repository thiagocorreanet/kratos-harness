/**
 * An ordered, previewable description of what an operation intends to do.
 *
 * The domain returns a plan; it never performs the work. That is what makes a
 * dry run the same decision with the plan rendered instead of applied, rather
 * than a parallel code path that can drift from the real one.
 */
export type Effect =
  | {
      readonly kind: "write_file";
      readonly path: string;
      readonly content: string;
    }
  | { readonly kind: "delete_file"; readonly path: string }
  | { readonly kind: "create_directory"; readonly path: string }
  | { readonly kind: "append_event"; readonly event: string }
  | {
      readonly kind: "emit";
      readonly channel: "structured" | "human";
      readonly text: string;
    };

export interface EffectPlan {
  readonly effects: readonly Effect[];
}

export const emptyPlan: EffectPlan = { effects: [] };

export function planOf(...effects: readonly Effect[]): EffectPlan {
  return { effects };
}

/** Concatenate plans in order, so composing decisions cannot reorder work. */
export function concatPlans(...plans: readonly EffectPlan[]): EffectPlan {
  return { effects: plans.flatMap(({ effects }) => effects) };
}

/** Paths a plan would touch, in first-touch order and without duplicates. */
export function touchedPaths(plan: EffectPlan): readonly string[] {
  const seen = new Set<string>();
  for (const effect of plan.effects) {
    if ("path" in effect) seen.add(effect.path);
  }
  return [...seen];
}
