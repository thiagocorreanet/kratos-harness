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
  return path.startsWith(".brain/");
}

function targetIdentities(target: CanonicalTarget): readonly string[] {
  return target.lexicalPath === target.canonicalPath
    ? [target.lexicalPath]
    : [target.lexicalPath, target.canonicalPath];
}

/** Evaluate one atomic request from already canonicalized, ordered targets. */
export function evaluateWriteRequest(
  targets: readonly CanonicalTarget[],
  state: PolicyState,
): PolicyEvaluation {
  if (state.kind === "invalid") {
    for (const target of targets) {
      for (const identity of targetIdentities(target)) {
        const writeBlock = decideWriteTarget({
          target: identity,
          guardrails: state.guardrails,
          scope: null,
          reviewerScope: null,
        });
        if (writeBlock.kind === "refused") {
          return {
            kind: "refused",
            reasonCode: writeBlock.reasonCode,
            evidenceRef: target.lexicalPath,
          };
        }
        if (!brainTarget(identity)) {
          return {
            kind: "refused",
            reasonCode: state.reasonCode,
            evidenceRef: state.evidenceRef,
          };
        }
      }
    }
    return { kind: "allowed" };
  }

  for (const target of targets) {
    for (const identity of targetIdentities(target)) {
      const decision = decideWriteTarget({
        target: identity,
        guardrails: state.guardrails,
        scope: state.scope,
        reviewerScope: state.reviewerScope,
      });
      if (decision.kind === "refused") {
        return {
          kind: "refused",
          reasonCode: decision.reasonCode,
          evidenceRef: target.lexicalPath,
        };
      }
    }
  }
  return { kind: "allowed" };
}
