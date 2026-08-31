import type { FeatureScopeV1, GuardrailsV1 } from "@kratos/contracts";

import { canonicalizeProjectPath } from "../paths/index.js";
import { matchesOrderedGlobs } from "./glob-policy.js";
import { scopesAgree } from "./scope-document.js";

export type WriteGuardReason =
  | "guard.write_block"
  | "guard.scope_deny"
  | "guard.outside_allow"
  | "guard.scope_corrupt"
  | "guard.path_escape"
  | "guard.target_uninspectable";

export type WriteTargetDecision =
  | { readonly kind: "allowed"; readonly target: string }
  | {
      readonly kind: "refused";
      readonly reasonCode: WriteGuardReason;
      readonly target: string;
    };

export interface DecideWriteTargetInput {
  /** A slash-separated target evaluated against policy (will be canonicalized). */
  readonly target: string;
  readonly scope?: FeatureScopeV1 | null;
  readonly reviewerScope?: FeatureScopeV1 | null;
  readonly guardrails?: Pick<GuardrailsV1, "writeBlocks"> | null;
}

/** Apply canonicalization, immutable blocks, project blocks, reviewer agreement, then feature scope. */
export function decideWriteTarget(
  input: DecideWriteTargetInput,
): WriteTargetDecision {
  const canonical = canonicalizeProjectPath(input.target);
  if (canonical.kind === "refused") {
    return refused(canonical.reasonCode, canonical.resolvedPath);
  }
  const target = canonical.path;

  if (
    immutableWriteBlock(target) ||
    matchesOrderedGlobs(input.guardrails?.writeBlocks ?? [], target)
  ) {
    return refused("guard.write_block", target);
  }

  if (
    input.scope !== null &&
    input.scope !== undefined &&
    input.reviewerScope !== null &&
    input.reviewerScope !== undefined &&
    !scopesAgree(input.scope, input.reviewerScope)
  ) {
    return refused("guard.scope_corrupt", target);
  }

  const scope = input.scope;
  if (scope !== null && scope !== undefined) {
    if (matchesOrderedGlobs(scope.deny, target))
      return refused("guard.scope_deny", target);
    if (
      !isBrainTarget(target) &&
      scope.allow.length > 0 &&
      !matchesOrderedGlobs(scope.allow, target)
    ) {
      return refused("guard.outside_allow", target);
    }
  }
  return { kind: "allowed", target };
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
  return target.startsWith(".brain/");
}
