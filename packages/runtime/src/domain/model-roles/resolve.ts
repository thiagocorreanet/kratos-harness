import type { ModelAssignmentV1_1, ProjectConfigV1_1 } from "@kratos/contracts";

import {
  PHASE_MODEL_ROLE,
  type HostModelCatalog,
  type ModelRole,
  type ModelRoleAssignmentResolution,
  type ModelRoleRefusal,
  type ModelRoleResolution,
  type NormalizedModelAssignment,
  type ResolvedPhaseAssignment,
} from "./model.js";
import type { RunPhase } from "../workflow/index.js";

/** Map a workflow phase to its runtime-owned model role. */
export function roleForPhase(phase: RunPhase): ModelRole {
  return PHASE_MODEL_ROLE[phase];
}

/** Normalize a model assignment without selecting a fallback model or effort. */
export function normalizeModelAssignment(
  assignment: ModelAssignmentV1_1,
): NormalizedModelAssignment {
  return typeof assignment === "string"
    ? { model: assignment, effort: "medium" }
    : { model: assignment.model, effort: assignment.effort };
}

/** Compare canonical implementer and judge identities, never configured aliases. */
export function validateHostIndependence(input: {
  readonly implementer: Pick<ResolvedPhaseAssignment, "model">;
  readonly judge: Pick<ResolvedPhaseAssignment, "model">;
}): ModelRoleRefusal | null {
  return input.implementer.model === input.judge.model
    ? "model.independence_violation"
    : null;
}

/** Resolve the configured role for a phase and fail closed on invalid routing. */
export function resolvePhaseAssignment(input: {
  readonly phase: RunPhase;
  readonly host: "claude" | "codex";
  readonly configuration: ProjectConfigV1_1;
  readonly catalog: HostModelCatalog;
}): ModelRoleResolution {
  const configuredRoles = input.configuration.modelRoles[input.host];
  if (configuredRoles === undefined) return refused("model.host_missing");
  if (input.catalog.host !== input.host) {
    return refused("model.resolution_unavailable");
  }

  const role = roleForPhase(input.phase);
  const selected = resolveModelRoleAssignment({
    host: input.host,
    role,
    roles: configuredRoles,
    catalog: input.catalog,
  });
  if (selected.kind === "refused") return selected;

  const implementer =
    role === "implementer"
      ? selected
      : resolveModelRoleAssignment({
          host: input.host,
          role: "implementer",
          roles: configuredRoles,
          catalog: input.catalog,
        });
  if (implementer.kind === "refused") return implementer;

  const judge =
    role === "judge"
      ? selected
      : resolveModelRoleAssignment({
          host: input.host,
          role: "judge",
          roles: configuredRoles,
          catalog: input.catalog,
        });
  if (judge.kind === "refused") return judge;

  if (
    validateHostIndependence({
      implementer: implementer.assignment,
      judge: judge.assignment,
    }) !== null
  ) {
    return refused("model.independence_violation");
  }

  return {
    kind: "resolved",
    assignment: {
      phase: input.phase,
      role,
      model: selected.assignment.model,
      effort: selected.assignment.effort,
    },
  };
}

function refused(reasonCode: ModelRoleRefusal): ModelRoleResolution {
  return { kind: "refused", reasonCode };
}

/** Resolve one configured role to its canonical, closed assignment. */
export function resolveModelRoleAssignment(input: {
  readonly host: "claude" | "codex";
  readonly role: ModelRole;
  readonly roles: Partial<Record<ModelRole, ModelAssignmentV1_1>>;
  readonly catalog: HostModelCatalog;
}): ModelRoleAssignmentResolution {
  if (input.catalog.host !== input.host) {
    return refused("model.resolution_unavailable");
  }
  const configured = input.roles[input.role];
  if (configured === undefined) return refused("model.role_missing");

  const assignment = normalizeModelAssignment(configured);
  const candidates = input.catalog.models.filter((model) =>
    modelNames(model).includes(assignment.model),
  );
  if (candidates.length !== 1) return refused("model.resolution_unavailable");

  const [candidate] = candidates;
  if (candidate === undefined || candidate.canonicalModel.length === 0) {
    return refused("model.resolution_unavailable");
  }
  if (!sortedUnique(candidate.efforts).includes(assignment.effort)) {
    return refused("model.effort_unsupported");
  }

  return {
    kind: "resolved",
    assignment: { model: candidate.canonicalModel, effort: assignment.effort },
  };
}

function modelNames(
  model: HostModelCatalog["models"][number],
): readonly string[] {
  return sortedUnique([model.canonicalModel, ...model.aliases]);
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}
