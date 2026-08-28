import type { PreToolUseV1 } from "@kratos/contracts";

import type {
  TargetInspectionSession,
  TargetInspector,
} from "../../ports/filesystem.js";

export interface CanonicalTarget {
  readonly ordinal: number;
  readonly lexicalPath: string;
  readonly canonicalPath: string;
}

export type InspectedTargets =
  | { readonly kind: "inside"; readonly targets: readonly CanonicalTarget[] }
  | {
      readonly kind: "refused";
      readonly reasonCode: "guard.path_escape" | "guard.target_uninspectable";
      readonly ordinal: number;
    };

/** Flatten mutations without losing request order; moves are source first. */
export function extractMutationTargets(
  request: PreToolUseV1,
): readonly string[] {
  return request.mutations.flatMap((mutation) =>
    mutation.kind === "move"
      ? [mutation.source, mutation.destination]
      : [mutation.path],
  );
}

/** Canonicalize every target sequentially and stop at the first refusal. */
export async function inspectMutationTargets(
  request: PreToolUseV1,
  inspector: TargetInspector,
): Promise<InspectedTargets> {
  let session: TargetInspectionSession;
  try {
    session = await inspector.capture();
  } catch {
    return {
      kind: "refused",
      reasonCode: "guard.target_uninspectable",
      ordinal: 1,
    };
  }
  const targets: CanonicalTarget[] = [];
  for (const [index, target] of extractMutationTargets(request).entries()) {
    const ordinal = index + 1;
    const inspected = await inspectMutationTarget(target, ordinal, session);
    if (inspected.kind === "refused") return inspected;
    targets.push(inspected.target);
  }
  return { kind: "inside", targets };
}

/** Inspect one target so callers can preserve policy ordering across targets. */
export async function inspectMutationTarget(
  target: string,
  ordinal: number,
  inspector: TargetInspectionSession,
): Promise<
  | { readonly kind: "inside"; readonly target: CanonicalTarget }
  | Extract<InspectedTargets, { readonly kind: "refused" }>
> {
  let inspection: Awaited<ReturnType<TargetInspectionSession["inspect"]>>;
  try {
    inspection = await inspector.inspect(target);
  } catch {
    return {
      kind: "refused",
      reasonCode: "guard.target_uninspectable",
      ordinal,
    };
  }
  if (inspection.kind !== "inside") {
    return {
      kind: "refused",
      reasonCode:
        inspection.kind === "escape"
          ? "guard.path_escape"
          : "guard.target_uninspectable",
      ordinal,
    };
  }
  return {
    kind: "inside",
    target: {
      ordinal,
      lexicalPath: inspection.lexicalPath,
      canonicalPath: inspection.canonicalPath,
    },
  };
}
