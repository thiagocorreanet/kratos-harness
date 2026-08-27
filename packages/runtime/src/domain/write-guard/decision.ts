import type { FeatureScopeV1, GuardrailsV1 } from "@kratos/contracts";

import { matchesOrderedGlobs } from "./glob-policy.js";
import { scopesAgree } from "./scope-document.js";

export type WriteGuardReason =
  | "guard.write_block"
  | "guard.scope_deny"
  | "guard.outside_allow"
  | "guard.scope_corrupt";

export type WriteTargetDecision =
  | { readonly kind: "allowed"; readonly target: string }
  | {
      readonly kind: "refused";
      readonly reasonCode: WriteGuardReason;
      readonly target: string;
    };

export interface DecideWriteTargetInput {
  /** A slash-separated, project-relative target already canonicalized by composition. */
  readonly target: string;
  readonly scope?: FeatureScopeV1 | null;
  readonly reviewerScope?: FeatureScopeV1 | null;
  readonly guardrails?: Pick<GuardrailsV1, "writeBlocks"> | null;
}

/** Apply immutable blocks, project blocks, reviewer agreement, then feature scope. */
export function decideWriteTarget(
  input: DecideWriteTargetInput,
): WriteTargetDecision {
  if (
    immutableWriteBlock(input.target) ||
    matchesOrderedGlobs(input.guardrails?.writeBlocks ?? [], input.target)
  ) {
    return refused("guard.write_block", input.target);
  }

  if (
    input.scope !== null &&
    input.scope !== undefined &&
    input.reviewerScope !== null &&
    input.reviewerScope !== undefined &&
    !scopesAgree(input.scope, input.reviewerScope)
  ) {
    return refused("guard.scope_corrupt", input.target);
  }

  const scope = input.scope;
  if (scope !== null && scope !== undefined) {
    if (matchesOrderedGlobs(scope.deny, input.target))
      return refused("guard.scope_deny", input.target);
    if (
      !isBrainTarget(input.target) &&
      scope.allow.length > 0 &&
      !matchesOrderedGlobs(scope.allow, input.target)
    ) {
      return refused("guard.outside_allow", input.target);
    }
  }
  return { kind: "allowed", target: input.target };
}

function refused(
  reasonCode: WriteGuardReason,
  target: string,
): WriteTargetDecision {
  return { kind: "refused", reasonCode, target };
}

function immutableWriteBlock(target: string): boolean {
  const segments = target.split("/");
  const basename = segments.at(-1) ?? "";
  return (
    segments.includes("migrations") ||
    basename === "AGENTS.md" ||
    basename === "CLAUDE.md" ||
    isRealEnvironmentFile(basename)
  );
}

function isRealEnvironmentFile(basename: string): boolean {
  if (basename === ".env") return true;
  if (!basename.startsWith(".env.")) return false;
  return !basename
    .slice(5)
    .split(".")
    .some(
      (part) => part === "example" || part === "sample" || part === "template",
    );
}

function isBrainTarget(target: string): boolean {
  return target === ".brain" || target.startsWith(".brain/");
}
