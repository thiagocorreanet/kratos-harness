import type {
  ModelAssignmentV1_1,
  ProjectConfigV1_1,
} from "@kratos/contracts";
import type {
  HostModelCatalog,
  ModelRole,
  resolvePhaseAssignment,
} from "@kratos/runtime/domain/model-roles";
import type { RunPhase } from "@kratos/runtime/domain/workflow";

const defaults = {
  planner: { model: "planner-canonical", effort: "medium" },
  implementer: { model: "implementer-canonical", effort: "high" },
  judge: { model: "judge-canonical", effort: "medium" },
} as const;

function catalog(host: "claude" | "codex"): HostModelCatalog {
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

export function roleConfig(
  host: "claude" | "codex",
  roles: Partial<Record<ModelRole, ModelAssignmentV1_1>>,
): ProjectConfigV1_1 {
  return {
    contractVersion: "1.1.0",
    stateContract: "1.1.0",
    pluginVersion: "0.0.0-development",
    hostContract: "1.1.0",
    language: "en",
    policyMode: "strict",
    managedState: {
      directory: ".brain",
      eventLog: "events.jsonl",
      snapshots: true,
    },
    modelRoles: {
      [host]: roles,
    },
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
