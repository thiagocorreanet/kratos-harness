import type { CurrentEventDraft } from "./events/index.js";

/**
 * An ordered, previewable description of what an operation intends to do.
 *
 * The domain returns a plan; it never performs the work. That is what makes a
 * dry run the same decision with the plan rendered instead of applied, rather
 * than a parallel code path that can drift from the real one.
 */
export interface AppendEventEffect {
  readonly kind: "append_event";
  /**
   * The feature that owns this run.
   *
   * A run lives under its feature, so the store cannot derive where to write
   * from the run identifier alone.
   */
  readonly feature: string;
  readonly runId: string;
  readonly event: CurrentEventDraft;
}

/** The file identity a write decision observed before it built its plan. */
export type WriteFilePrecondition =
  | { readonly kind: "missing" }
  | {
      readonly kind: "file";
      readonly size: number;
      readonly sha256: string;
    };

export type Effect =
  | {
      readonly kind: "write_file";
      readonly path: string;
      readonly content: string;
      /** Refuse if the destination no longer has this exact identity. */
      readonly expected?: WriteFilePrecondition;
    }
  | {
      readonly kind: "delete_file";
      readonly path: string;
      /** Refuse deletion if authority state changed after observation. */
      readonly expected?: Extract<
        WriteFilePrecondition,
        { readonly kind: "file" }
      >;
    }
  | { readonly kind: "create_directory"; readonly path: string }
  | AppendEventEffect
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
