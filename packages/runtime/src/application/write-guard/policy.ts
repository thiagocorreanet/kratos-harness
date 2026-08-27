import type { FeatureScopeV1, GuardrailsV1 } from "@kratos/contracts";

import {
  decideWriteTarget,
  type WriteGuardReason,
} from "../../domain/write-guard/index.js";
import type { CanonicalTarget } from "./targets.js";

export type PolicyState =
  | {
      readonly kind: "valid";
      readonly guardrails: GuardrailsV1;
      readonly scope: FeatureScopeV1 | null;
      readonly reviewerScope: FeatureScopeV1 | null;
    }
  | {
      readonly kind: "invalid";
      readonly guardrails: GuardrailsV1 | null;
      readonly reasonCode:
        | "guard.active_feature_corrupt"
        | "guard.guardrails_corrupt"
        | "guard.guardrails_missing"
        | "guard.scope_corrupt";
      readonly evidenceRef: string;
    };

export type PolicyEvaluation =
  | { readonly kind: "allowed" }
  | {
      readonly kind: "refused";
      readonly reasonCode:
        | WriteGuardReason
        | Exclude<PolicyState, { kind: "valid" }>["reasonCode"];
      readonly evidenceRef: string;
    };

function brainTarget(path: string): boolean {
  return path === ".brain" || path.startsWith(".brain/");
}

/** Evaluate one atomic request from already canonicalized, ordered targets. */
export function evaluateWriteRequest(
  targets: readonly CanonicalTarget[],
  state: PolicyState,
): PolicyEvaluation {
  if (state.kind === "invalid") {
    for (const target of targets) {
      const writeBlock = decideWriteTarget({
        target: target.path,
        guardrails: state.guardrails,
        scope: null,
        reviewerScope: null,
      });
      if (writeBlock.kind === "refused") {
        return {
          kind: "refused",
          reasonCode: writeBlock.reasonCode,
          evidenceRef: writeBlock.target,
        };
      }
      if (!brainTarget(target.path)) {
        return {
          kind: "refused",
          reasonCode: state.reasonCode,
          evidenceRef: state.evidenceRef,
        };
      }
    }
    return { kind: "allowed" };
  }

  for (const target of targets) {
    const decision = decideWriteTarget({
      target: target.path,
      guardrails: state.guardrails,
      scope: state.scope,
      reviewerScope: state.reviewerScope,
    });
    if (decision.kind === "refused") {
      return {
        kind: "refused",
        reasonCode: decision.reasonCode,
        evidenceRef: decision.target,
      };
    }
  }
  return { kind: "allowed" };
}
