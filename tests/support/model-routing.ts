import type { ModelAssignmentV1_1, ProjectConfigV1_4 } from "@kratos/contracts";
import type { HostModelCatalog } from "@kratos/adapters";
import { unresolvedProjectProfile } from "@kratos/runtime/domain/init";
import type {
  ModelRole,
  resolvePhaseAssignment,
} from "@kratos/runtime/domain/model-roles";
import type { RunPhase } from "@kratos/runtime/domain/workflow";

const defaults = {
  planner: { model: "planner-canonical", effort: "medium" },
  implementer: { model: "implementer-canonical", effort: "high" },
  judge: { model: "judge-canonical", effort: "medium" },
} as const;

function catalog(host: "claude" | "codex" | "antigravity"): HostModelCatalog {
  return {
    host,
    defaults,
    models: [
      {
        canonicalModel: "implementer-canonical",
        aliases: ["implementer", "impl-alias", "implementer"],
        efforts: ["high", "medium", "high"],
      },
      {
        canonicalModel: "judge-canonical",
        aliases: ["judge", "judge-alias", "judge"],
        efforts: ["medium", "high", "medium"],
      },
      {
        canonicalModel: "planner-canonical",
        aliases: ["planner", "planner-alias", "planner"],
        efforts: ["medium", "low", "medium"],
      },
    ],
  };
}

export function codexCatalog(): HostModelCatalog {
  return catalog("codex");
}

export function claudeCatalog(): HostModelCatalog {
  return catalog("claude");
}

export function antigravityCatalog(): HostModelCatalog {
  return catalog("antigravity");
}

export function roleConfig(
  host: "claude" | "codex" | "antigravity",
  roles: Partial<Record<ModelRole, ModelAssignmentV1_1>>,
): ProjectConfigV1_4 {
  return {
    contractVersion: "1.4.0",
    stateContract: "1.4.0",
    pluginVersion: "0.4.0",
    hostContract: "1.4.0",
    language: {
      conversation: "en",
      documentation: "en",
      comments: "en",
      identifiers: "en",
      commits: "en",
      preserveConventions: true,
      enforcement: "advisory",
    },
    policyMode: "strict",
    gateModes: {},
    managedState: {
      directory: ".brain",
      eventLog: "events.jsonl",
      snapshots: true,
    },
    modelRoles: {
      [host]: roles,
    },
    projectProfile: structuredClone(
      unresolvedProjectProfile(),
    ) as ProjectConfigV1_4["projectProfile"],
  };
}

export function equalAliasInput(
  phase: RunPhase,
): Parameters<typeof resolvePhaseAssignment>[0] {
  const baseCatalog = codexCatalog();
  return {
    phase,
    host: "codex",
    configuration: roleConfig("codex", {
      planner: "planner",
      implementer: "impl-alias",
      judge: "judge-alias",
    }),
    catalog: {
      ...baseCatalog,
      models: [
        ...baseCatalog.models.filter(
          ({ canonicalModel }) => canonicalModel === "planner-canonical",
        ),
        {
          canonicalModel: "implementer-canonical",
          aliases: ["impl-alias", "judge-alias"],
          efforts: ["medium"],
        },
      ],
    },
  };
}
