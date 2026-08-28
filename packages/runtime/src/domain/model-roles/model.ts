import type { RunPhase } from "../workflow/index.js";

export const MODEL_ROLES = ["planner", "implementer", "judge"] as const;

export type ModelRole = (typeof MODEL_ROLES)[number];

export const PHASE_MODEL_ROLE: Readonly<Record<RunPhase, ModelRole>> = {
  prd: "planner",
  spec: "planner",
  plan: "planner",
  code: "implementer",
  review: "judge",
  acceptance: "judge",
};

export interface NormalizedModelAssignment {
  readonly model: string;
  readonly effort: string;
}

export interface HostModelCatalog {
  readonly host: "claude" | "codex";
  readonly defaults: Readonly<Record<ModelRole, NormalizedModelAssignment>>;
  readonly models: readonly {
    readonly canonicalModel: string;
    readonly aliases: readonly string[];
    readonly efforts: readonly string[];
  }[];
}

export interface ResolvedPhaseAssignment {
  readonly phase: RunPhase;
  readonly role: ModelRole;
  readonly model: string;
  readonly effort: string;
}

export type ModelRoleRefusal =
  | "model.role_missing"
  | "model.host_missing"
  | "model.resolution_unavailable"
  | "model.effort_unsupported"
  | "model.independence_violation";

export type ModelRoleResolution =
  | { readonly kind: "resolved"; readonly assignment: ResolvedPhaseAssignment }
  | { readonly kind: "refused"; readonly reasonCode: ModelRoleRefusal };
