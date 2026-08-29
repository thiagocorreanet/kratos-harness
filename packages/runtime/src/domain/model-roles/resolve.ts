import type {
  ModelAssignmentV1_1,
  ProjectConfigV1_1,
  ProjectConfigV1_2,
} from "@kratos/contracts";

import {
  MODEL_ROLES,
  type DetailedModelRoleResolution,
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

const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const CATALOG_KEYS = ["defaults", "host", "models"] as const;
const DEFAULT_KEYS = ["implementer", "judge", "planner"] as const;
const ASSIGNMENT_KEYS = ["effort", "model"] as const;
const MODEL_KEYS = ["aliases", "canonicalModel", "efforts"] as const;

/** Map a workflow phase to its runtime-owned model role. */
export function roleForPhase(phase: RunPhase): ModelRole {
  return PHASE_MODEL_ROLE[phase];
}

/** Validate and freeze one host-supplied catalog before policy consumes it. */
export function snapshotHostModelCatalog(
  value: unknown,
  expectedHost?: "claude" | "codex",
): HostModelCatalog | null {
  try {
    if (!hasExactDataKeys(value, CATALOG_KEYS)) return null;
    const host = dataValue(value, "host");
    if (
      (host !== "claude" && host !== "codex") ||
      (expectedHost !== undefined && host !== expectedHost)
    ) {
      return null;
    }
    const defaults = snapshotDefaults(dataValue(value, "defaults"));
    const models = snapshotModels(dataValue(value, "models"));
    if (defaults === null || models === null) return null;
    return Object.freeze({ host, defaults, models });
  } catch {
    return null;
  }
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
  readonly configuration: ProjectConfigV1_2 | ProjectConfigV1_1;
  readonly catalog: HostModelCatalog;
}): ModelRoleResolution {
  const resolved = resolvePhaseAssignmentDetailed(input);
  return resolved.kind === "resolved" ? resolved : refused(resolved.reasonCode);
}

/**
 * Resolve the complete, stable routing tuple and retain the exact refusal
 * subject for callers that must diagnose configuration rather than a phase.
 */
export function resolvePhaseAssignmentDetailed(input: {
  readonly phase: RunPhase;
  readonly host: "claude" | "codex";
  readonly configuration: ProjectConfigV1_2 | ProjectConfigV1_1;
  readonly catalog: HostModelCatalog;
}): DetailedModelRoleResolution {
  const configuredRoles = input.configuration.modelRoles[input.host];
  if (configuredRoles === undefined) {
    return detailedRefused("model.host_missing", input.host, null);
  }
  const catalog = snapshotHostModelCatalog(input.catalog, input.host);
  if (catalog === null) {
    return detailedRefused("model.resolution_unavailable", input.host, null);
  }

  const role = roleForPhase(input.phase);
  const resolved = new Map<ModelRole, NormalizedModelAssignment>();
  for (const candidateRole of MODEL_ROLES) {
    const candidate = resolveModelRoleAssignment({
      host: input.host,
      role: candidateRole,
      roles: configuredRoles,
      catalog,
    });
    if (candidate.kind === "refused") {
      return detailedRefused(candidate.reasonCode, input.host, candidateRole);
    }
    resolved.set(candidateRole, candidate.assignment);
  }
  const selected = resolved.get(role);
  const implementer = resolved.get("implementer");
  const judge = resolved.get("judge");
  if (
    selected === undefined ||
    implementer === undefined ||
    judge === undefined
  ) {
    return detailedRefused("model.resolution_unavailable", input.host, null);
  }

  if (
    validateHostIndependence({
      implementer,
      judge,
    }) !== null
  ) {
    return detailedRefused("model.independence_violation", input.host, null);
  }

  return {
    kind: "resolved",
    assignment: {
      phase: input.phase,
      role,
      model: selected.model,
      effort: selected.effort,
    },
  };
}

function detailedRefused(
  reasonCode: ModelRoleRefusal,
  host: "claude" | "codex",
  role: ModelRole | null,
): DetailedModelRoleResolution {
  return { kind: "refused", reasonCode, subject: { host, role } };
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
  const catalog = snapshotHostModelCatalog(input.catalog, input.host);
  if (catalog === null) {
    return refused("model.resolution_unavailable");
  }
  const configured = input.roles[input.role];
  if (configured === undefined) return refused("model.role_missing");

  const assignment = normalizeModelAssignment(configured);
  const candidates = catalog.models.filter((model) =>
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

function snapshotDefaults(value: unknown): HostModelCatalog["defaults"] | null {
  if (!hasExactDataKeys(value, DEFAULT_KEYS)) return null;
  const planner = snapshotAssignment(dataValue(value, "planner"));
  const implementer = snapshotAssignment(dataValue(value, "implementer"));
  const judge = snapshotAssignment(dataValue(value, "judge"));
  if (planner === null || implementer === null || judge === null) return null;
  return Object.freeze({ planner, implementer, judge });
}

function snapshotAssignment(value: unknown): NormalizedModelAssignment | null {
  if (!hasExactDataKeys(value, ASSIGNMENT_KEYS)) return null;
  const model = dataValue(value, "model");
  const effort = dataValue(value, "effort");
  if (!identifier(model) || !identifier(effort)) return null;
  return Object.freeze({ model, effort });
}

function snapshotModels(value: unknown): HostModelCatalog["models"] | null {
  const values = denseArray(value);
  if (values === null || values.length === 0) return null;
  const models: HostModelCatalog["models"][number][] = [];
  for (const candidate of values) {
    const model = snapshotModel(candidate);
    if (model === null) return null;
    models.push(model);
  }
  return Object.freeze(models);
}

function snapshotModel(
  value: unknown,
): HostModelCatalog["models"][number] | null {
  if (!hasExactDataKeys(value, MODEL_KEYS)) return null;
  const canonicalModel = dataValue(value, "canonicalModel");
  const aliases = snapshotIdentifiers(dataValue(value, "aliases"), true);
  const efforts = snapshotIdentifiers(dataValue(value, "efforts"), false);
  if (!identifier(canonicalModel) || aliases === null || efforts === null) {
    return null;
  }
  return Object.freeze({ canonicalModel, aliases, efforts });
}

function snapshotIdentifiers(
  value: unknown,
  allowEmpty: boolean,
): readonly string[] | null {
  const values = denseArray(value);
  if (
    values === null ||
    (!allowEmpty && values.length === 0) ||
    !values.every(identifier)
  ) {
    return null;
  }
  return Object.freeze([...values] as string[]);
}

function denseArray(value: unknown): readonly unknown[] | null {
  if (!Array.isArray(value)) return null;
  const names = Object.getOwnPropertyNames(value);
  if (
    names.length !== value.length + 1 ||
    names.at(-1) !== "length" ||
    names.slice(0, -1).some((name, index) => name !== String(index))
  ) {
    return null;
  }
  return names.slice(0, -1).map((key) => dataValue(value, key));
}

function hasExactDataKeys(
  value: unknown,
  expected: readonly string[],
): value is Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === expected[index]) &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor;
    })
  );
}

function dataValue(
  value: Readonly<Record<string, unknown>> | readonly unknown[],
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new Error("catalog property is not inert data");
  }
  return descriptor.value;
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}
