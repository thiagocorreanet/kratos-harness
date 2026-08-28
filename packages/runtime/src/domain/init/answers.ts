import type { InitAnswersV1_1, ProjectConfigV1_1 } from "@kratos/contracts";

import {
  resolvePhaseAssignment,
  type HostModelCatalog,
  type ModelRole,
  type NormalizedModelAssignment,
} from "../model-roles/index.js";
import type { ModelRouting } from "../../ports/model-routing.js";
import type { SchemaRegistry } from "../schema/index.js";

/** Answers after every default has been made visible and every model resolved. */
export type ResolvedAnswers = Omit<Required<InitAnswersV1_1>, "modelRoles"> & {
  readonly modelRoles: ProjectConfigV1_1["modelRoles"];
};

const DEFAULTS = {
  language: "en",
  policyMode: "standard",
  snapshots: true,
} as const;

const DEFAULTABLE = ["language", "policyMode", "snapshots"] as const;
const HOSTS = ["claude", "codex"] as const;
const ROLES = ["planner", "implementer", "judge"] as const;

type Host = "claude" | "codex";
type RoleMap = NonNullable<ProjectConfigV1_1["modelRoles"][Host]>;
type ExplicitRoleMap = NonNullable<InitAnswersV1_1["modelRoles"]>[Host];

export type ResolvedInitAnswers =
  | {
      readonly kind: "resolved";
      readonly answers: ResolvedAnswers;
      /** Which answers the caller did not supply, in documented order. */
      readonly defaulted: readonly string[];
    }
  | { readonly kind: "invalid"; readonly reasonCode: string };

/**
 * Validate an answers document, resolve its host catalogs, and fill in every
 * omitted answer. Persisted model assignments are always canonical objects;
 * aliases and bare model names never leak into project state.
 */
export async function resolveInitAnswers(
  document: unknown,
  registry: SchemaRegistry,
  modelRouting: ModelRouting,
): Promise<ResolvedInitAnswers> {
  const validated = registry.validate({
    id: "host.init-answers",
    version: version(document),
    value: document,
    structuralReasonCode: "trail.output_invalido",
  });
  if (validated.kind === "invalid") {
    const first = validated.diagnostics[0];
    return {
      kind: "invalid",
      /* v8 ignore next -- an invalid result always carries a diagnostic */
      reasonCode: first?.reasonCode ?? "trail.output_invalido",
    };
  }
  if (validated.value.contractVersion !== "1.1.0") {
    return { kind: "invalid", reasonCode: "trail.output_invalido" };
  }

  const supplied = validated.value;
  const defaulted: string[] = DEFAULTABLE.filter(
    (key) => supplied[key] === undefined,
  );
  const modelRoles: ProjectConfigV1_1["modelRoles"] = {};

  // Catalog lookup is intentionally confined to enabled hosts. A role map for
  // a disabled host is not project state and is neither selected nor observed.
  for (const host of supplied.hosts) {
    const catalog = await modelRouting.observe(host);
    if (catalog === null) {
      return { kind: "invalid", reasonCode: "model.resolution_unavailable" };
    }
    const explicit = supplied.modelRoles?.[host];
    const resolved = resolveHostRoles(host, explicit, catalog);
    if (resolved.kind === "invalid") return resolved;
    modelRoles[host] = resolved.roles;
  }
  for (const host of HOSTS) {
    if (
      supplied.hosts.includes(host) &&
      supplied.modelRoles?.[host] === undefined
    ) {
      for (const role of ROLES) defaulted.push(`modelRoles.${host}.${role}`);
    }
  }

  return {
    kind: "resolved",
    answers: {
      contractVersion: supplied.contractVersion,
      hostContract: supplied.hostContract,
      hosts: supplied.hosts,
      language: supplied.language ?? DEFAULTS.language,
      policyMode: supplied.policyMode ?? DEFAULTS.policyMode,
      snapshots: supplied.snapshots ?? DEFAULTS.snapshots,
      modelRoles,
    },
    defaulted,
  };
}

function resolveHostRoles(
  host: Host,
  explicit: ExplicitRoleMap | undefined,
  catalog: HostModelCatalog,
):
  | { readonly kind: "resolved"; readonly roles: RoleMap }
  | { readonly kind: "invalid"; readonly reasonCode: string } {
  const selected = explicit ?? catalog.defaults;
  const configuration: ProjectConfigV1_1 = {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    pluginVersion: "0.0.0-development",
    hostContract: "1.1.0",
    language: "en",
    policyMode: "standard",
    managedState: {
      directory: ".brain",
      eventLog: "events.jsonl",
      snapshots: true,
    },
    modelRoles: { [host]: selected },
  };
  const assignments = new Map<ModelRole, NormalizedModelAssignment>();

  for (const [phase, role] of [
    ["prd", "planner"],
    ["code", "implementer"],
    ["review", "judge"],
  ] as const) {
    const resolved = resolvePhaseAssignment({
      phase,
      host,
      configuration,
      catalog,
    });
    if (resolved.kind === "refused") {
      return { kind: "invalid", reasonCode: resolved.reasonCode };
    }
    assignments.set(role, {
      model: resolved.assignment.model,
      effort: resolved.assignment.effort,
    });
  }

  const planner = assignments.get("planner");
  const implementer = assignments.get("implementer");
  const judge = assignments.get("judge");
  /* v8 ignore start -- the closed phase/role tuple above covers all entries */
  if (
    planner === undefined ||
    implementer === undefined ||
    judge === undefined
  ) {
    return { kind: "invalid", reasonCode: "model.role_missing" };
  }
  /* v8 ignore stop */
  return { kind: "resolved", roles: { planner, implementer, judge } };
}

/** The host contract version the registry checks before the payload. */
function version(document: unknown): unknown {
  if (typeof document !== "object" || document === null) return undefined;
  return (document as Record<string, unknown>).hostContract;
}
