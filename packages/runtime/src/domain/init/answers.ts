import type {
  InitAnswersV1_3,
  InitAnswersV1_4,
  InitAnswersV1_5,
  InitAnswersV1_6,
  LanguagePolicyV1,
} from "@kratos/contracts";

import {
  resolveModelRoleAssignment,
  validateHostIndependence,
  type HostModelCatalog,
  type ModelRole,
  type ModelRoleRefusal,
  type NormalizedModelAssignment,
} from "../model-roles/index.js";
import type { ModelRouting } from "../../ports/model-routing.js";
import type { SchemaRegistry } from "../schema/index.js";
import {
  resolveProjectProfile,
  type PartialProjectProfile,
  type ResolvedProjectProfile,
} from "./profile.js";

/** Answers after every default has been made visible and every model resolved. */
export type ResolvedAnswers = Omit<
  Required<InitAnswersV1_6>,
  | "contractVersion"
  | "hostContract"
  | "modelRoles"
  | "projectProfile"
  | "acceptanceAttemptCeiling"
> & {
  readonly contractVersion: "1.6.0";
  readonly hostContract: "1.4.0";
  readonly modelRoles: ResolvedModelRoles;
  readonly projectProfile: ResolvedProjectProfile;
  readonly acceptanceAttemptCeiling?: number | undefined;
};

export const DEFAULT_LANGUAGE_POLICY: LanguagePolicyV1 = {
  conversation: "en",
  documentation: "en",
  comments: "en",
  identifiers: "en",
  commits: "en",
  preserveConventions: true,
  enforcement: "advisory",
};

const DEFAULTS = {
  language: DEFAULT_LANGUAGE_POLICY,
  policyMode: "standard",
  snapshots: true,
} as const;

const DEFAULTABLE = ["language", "policyMode", "snapshots"] as const;
const HOSTS = ["claude", "codex", "antigravity"] as const;
const ROLES = ["planner", "implementer", "judge"] as const;

export interface PersistedInitSettings {
  readonly projectProfile?: ResolvedProjectProfile | undefined;
  readonly acceptanceAttemptCeiling?: number | undefined;
  readonly gateModes?: NonNullable<InitAnswersV1_6["gateModes"]> | undefined;
  readonly derived?: PartialProjectProfile | undefined;
}
type Host = "claude" | "codex" | "antigravity";
type ExplicitRoleMap = NonNullable<InitAnswersV1_6["modelRoles"]>[Host];

/** The only model assignment shape a resolved initializer may persist. */
export type ResolvedRoleMap = Readonly<
  Record<ModelRole, NormalizedModelAssignment>
>;
export type ResolvedModelRoles = Partial<Record<Host, ResolvedRoleMap>>;

export interface ModelResolutionSubject {
  readonly host: Host;
  readonly role?: ModelRole;
}

export interface ModelResolutionRefusal {
  readonly kind: "invalid";
  readonly reasonCode: ModelRoleRefusal;
  readonly subject: ModelResolutionSubject;
}

export type ResolvedInitAnswers =
  | {
      readonly kind: "resolved";
      readonly answers: ResolvedAnswers;
      /** Which answers the caller did not supply, in documented order. */
      readonly defaulted: readonly string[];
    }
  | {
      readonly kind: "invalid";
      readonly reasonCode: string;
      readonly subject?: never;
    }
  | ModelResolutionRefusal;

/**
 * Validate an answers document, resolve its host catalogs, and fill in every
 * omitted answer. Persisted model assignments are always canonical objects;
 * aliases and bare model names never leak into project state.
 */
export async function resolveInitAnswers(
  document: unknown,
  registry: SchemaRegistry,
  modelRouting: ModelRouting,
  persisted?: ResolvedProjectProfile | PersistedInitSettings,
  derived?: PartialProjectProfile,
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
  if (
    validated.value.contractVersion !== "1.3.0" &&
    validated.value.contractVersion !== "1.4.0" &&
    validated.value.contractVersion !== "1.5.0" &&
    validated.value.contractVersion !== "1.6.0"
  ) {
    return { kind: "invalid", reasonCode: "trail.output_invalido" };
  }

  const supplied = validated.value;
  const persistedSettings = persistedInitSettings(persisted);
  const defaulted: string[] = DEFAULTABLE.filter(
    (key) => supplied[key] === undefined,
  );
  if (
    !("gateModes" in supplied) &&
    persistedSettings?.gateModes === undefined
  ) {
    defaulted.push("gateModes");
  }
  const resolvedByHost = new Map<Host, ResolvedRoleMap>();

  // Catalog lookup is intentionally confined to enabled hosts. A role map for
  // a disabled host is not project state and is neither selected nor observed.
  for (const host of supplied.hosts) {
    const catalog = await modelRouting.observe(host);
    if (catalog === null) {
      return modelRefusal("model.resolution_unavailable", { host });
    }
    const explicit = supplied.modelRoles?.[host];
    const resolved = resolveHostRoles(host, explicit, catalog);
    if (resolved.kind === "invalid") return resolved;
    resolvedByHost.set(host, resolved.roles);
  }
  for (const host of HOSTS) {
    if (
      supplied.hosts.includes(host) &&
      supplied.modelRoles?.[host] === undefined
    ) {
      for (const role of ROLES) defaulted.push(`modelRoles.${host}.${role}`);
    }
  }
  const modelRoles: ResolvedModelRoles = {};
  for (const host of HOSTS) {
    const roles = resolvedByHost.get(host);
    if (roles !== undefined) modelRoles[host] = roles;
  }

  const effectiveDerived = derived ?? persistedSettings?.derived;

  return {
    kind: "resolved",
    answers: {
      contractVersion: "1.6.0",
      hostContract: "1.4.0",
      hosts: supplied.hosts,
      language: supplied.language ?? DEFAULT_LANGUAGE_POLICY,
      policyMode: supplied.policyMode ?? DEFAULTS.policyMode,
      gateModes: resolvedGateModes(supplied, persistedSettings),
      snapshots: supplied.snapshots ?? DEFAULTS.snapshots,
      modelRoles,
      projectProfile: resolveProjectProfile(
        supplied.projectProfile,
        persistedProjectProfile(persisted),
        effectiveDerived,
      ),
      ...(resolvedAttemptCeiling(supplied, persisted) === undefined
        ? {}
        : {
            acceptanceAttemptCeiling: resolvedAttemptCeiling(
              supplied,
              persisted,
            ),
          }),
    },
    defaulted,
  };
}

function persistedProjectProfile(
  persisted: ResolvedProjectProfile | PersistedInitSettings | undefined,
): ResolvedProjectProfile | undefined {
  if (persisted === undefined) return undefined;
  if ("projectProfile" in persisted) {
    return persisted.projectProfile;
  }
  return "commands" in persisted ? persisted : undefined;
}

function resolvedAttemptCeiling(
  supplied:
    | InitAnswersV1_3
    | InitAnswersV1_4
    | InitAnswersV1_5
    | InitAnswersV1_6,
  persisted: ResolvedProjectProfile | PersistedInitSettings | undefined,
): number | undefined {
  const requested =
    "acceptanceAttemptCeiling" in supplied
      ? supplied.acceptanceAttemptCeiling
      : undefined;
  if (requested !== undefined) return requested ?? undefined;
  return persisted !== undefined && "acceptanceAttemptCeiling" in persisted
    ? persisted.acceptanceAttemptCeiling
    : undefined;
}

function persistedInitSettings(
  persisted: ResolvedProjectProfile | PersistedInitSettings | undefined,
): PersistedInitSettings | undefined {
  if (persisted === undefined || "commands" in persisted) return undefined;
  return persisted;
}

function resolvedGateModes(
  supplied:
    | InitAnswersV1_3
    | InitAnswersV1_4
    | InitAnswersV1_5
    | InitAnswersV1_6,
  persisted: PersistedInitSettings | undefined,
): NonNullable<InitAnswersV1_6["gateModes"]> {
  if ("gateModes" in supplied) {
    return structuredClone(supplied.gateModes);
  }
  return structuredClone(persisted?.gateModes ?? {});
}

function resolveHostRoles(
  host: Host,
  explicit: ExplicitRoleMap | undefined,
  catalog: HostModelCatalog,
):
  | { readonly kind: "resolved"; readonly roles: ResolvedRoleMap }
  | ModelResolutionRefusal {
  const selected = explicit ?? catalog.defaults;
  const assignments = new Map<ModelRole, NormalizedModelAssignment>();

  for (const role of ROLES) {
    const resolved = resolveModelRoleAssignment({
      host,
      role,
      roles: selected,
      catalog,
    });
    if (resolved.kind === "refused") {
      return modelRefusal(resolved.reasonCode, { host, role });
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
    return modelRefusal("model.role_missing", { host, role: "planner" });
  }
  /* v8 ignore stop */
  if (validateHostIndependence({ implementer, judge }) !== null) {
    return modelRefusal("model.independence_violation", {
      host,
      role: "judge",
    });
  }
  return { kind: "resolved", roles: { planner, implementer, judge } };
}

function modelRefusal(
  reasonCode: ModelRoleRefusal,
  subject: ModelResolutionSubject,
): ModelResolutionRefusal {
  return { kind: "invalid", reasonCode, subject };
}

/** The answers contract version the registry checks before the payload. */
function version(document: unknown): unknown {
  if (typeof document !== "object" || document === null) return undefined;
  return (document as Record<string, unknown>).contractVersion;
}
