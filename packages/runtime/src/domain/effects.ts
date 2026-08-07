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

export function planOf(...effects: readonly Effect[]): EffectPlan {
  return { effects };
}
