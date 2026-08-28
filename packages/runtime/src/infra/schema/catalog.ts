import manifest from "../../../../contracts/catalogs/contract-families.v1.json" with { type: "json" };
import adapterMessageSchema from "../../../../../schemas/host/adapter-message.v1.schema.json" with { type: "json" };
import agentOutputSchema from "../../../../../schemas/host/agent-output.v1.schema.json" with { type: "json" };
import gapProposalSchema from "../../../../../schemas/host/gap-proposal.v1.schema.json" with { type: "json" };
import initAnswersSchema from "../../../../../schemas/host/init-answers.v1.schema.json" with { type: "json" };
import operationMessageSchema from "../../../../../schemas/host/operation-message.v1.schema.json" with { type: "json" };
import preToolUseSchema from "../../../../../schemas/host/pre-tool-use.v1.schema.json" with { type: "json" };
import resultSchema from "../../../../../schemas/result.v1.schema.json" with { type: "json" };
import acceptanceCriterionIdSchema from "../../../../../schemas/contracts/acceptance-criterion-id.v1.schema.json" with { type: "json" };
import acceptanceCriteriaSnapshotSchema from "../../../../../schemas/state/acceptance-criteria-snapshot.v1.schema.json" with { type: "json" };
import acceptanceVerdictSchema from "../../../../../schemas/state/acceptance-verdict.v1.schema.json" with { type: "json" };
import approvalSchema from "../../../../../schemas/state/approval.v1.schema.json" with { type: "json" };
import eventSchema from "../../../../../schemas/state/event.v1.schema.json" with { type: "json" };
import featureSchema from "../../../../../schemas/state/feature.v1.schema.json" with { type: "json" };
import featureScopeSchema from "../../../../../schemas/state/feature-scope.v1.schema.json" with { type: "json" };
import evidenceSchema from "../../../../../schemas/state/evidence.v1.schema.json" with { type: "json" };
import gapSchema from "../../../../../schemas/state/gap.v1.schema.json" with { type: "json" };
import gatesSchema from "../../../../../schemas/state/gates.v1.schema.json" with { type: "json" };
import guardrailsSchema from "../../../../../schemas/state/guardrails.v1.schema.json" with { type: "json" };
import lockSchema from "../../../../../schemas/state/lock.v1.schema.json" with { type: "json" };
import migrationSchema from "../../../../../schemas/state/migration.v1.schema.json" with { type: "json" };
import projectConfigSchema from "../../../../../schemas/state/project-config.v1.schema.json" with { type: "json" };
import requirementDiscoverySchema from "../../../../../schemas/state/requirement-discovery.v1.schema.json" with { type: "json" };
import snapshotSchema from "../../../../../schemas/state/snapshot.v1.schema.json" with { type: "json" };
import transactionManifestSchema from "../../../../../schemas/state/transaction-manifest.v1.schema.json" with { type: "json" };
import transactionProgressSchema from "../../../../../schemas/state/transaction-progress.v1.schema.json" with { type: "json" };

import type { EmbeddedSchemaEntry } from "./types.js";

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return value;
  }
  seen.add(value);
  const nested: readonly unknown[] = Array.isArray(value)
    ? (value as readonly unknown[])
    : Object.values(value as Record<string, unknown>);
  for (const child of nested) deepFreeze(child, seen);
  Object.freeze(value);
  return value;
}

export const EMBEDDED_SCHEMA_CATALOG: readonly EmbeddedSchemaEntry[] =
  deepFreeze([
    {
      id: "host.adapter-message",
      family: "host",
      version: "1.0.0",
      path: "schemas/host/adapter-message.v1.schema.json",
      schema: adapterMessageSchema,
    },
    {
      id: "host.agent-output",
      family: "host",
      version: "1.0.0",
      path: "schemas/host/agent-output.v1.schema.json",
      schema: agentOutputSchema,
    },
    {
      id: "host.gap-proposal",
      family: "host",
      version: "1.0.0",
      path: "schemas/host/gap-proposal.v1.schema.json",
      schema: gapProposalSchema,
    },
    {
      id: "host.init-answers",
      family: "host",
      version: "1.0.0",
      path: "schemas/host/init-answers.v1.schema.json",
      schema: initAnswersSchema,
    },
    {
      id: "host.operation-message",
      family: "host",
      version: "1.0.0",
      path: "schemas/host/operation-message.v1.schema.json",
      schema: operationMessageSchema,
    },
    {
      id: "host.pre-tool-use",
      family: "host",
      version: "1.0.0",
      path: "schemas/host/pre-tool-use.v1.schema.json",
      schema: preToolUseSchema,
    },
    {
      id: "state.acceptance-criteria-snapshot",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/acceptance-criteria-snapshot.v1.schema.json",
      schema: acceptanceCriteriaSnapshotSchema,
    },
    {
      id: "state.acceptance-verdict",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/acceptance-verdict.v1.schema.json",
      schema: acceptanceVerdictSchema,
    },
    {
      id: "state.approval",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/approval.v1.schema.json",
      schema: approvalSchema,
    },
    {
      id: "state.event",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/event.v1.schema.json",
      schema: eventSchema,
    },
    {
      id: "state.evidence",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/evidence.v1.schema.json",
      schema: evidenceSchema,
    },
    {
      id: "state.feature",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/feature.v1.schema.json",
      schema: featureSchema,
    },
    {
      id: "state.feature-scope",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/feature-scope.v1.schema.json",
      schema: featureScopeSchema,
    },
    {
      id: "state.gap",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/gap.v1.schema.json",
      schema: gapSchema,
    },
    {
      id: "state.gates",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/gates.v1.schema.json",
      schema: gatesSchema,
    },
    {
      id: "state.guardrails",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/guardrails.v1.schema.json",
      schema: guardrailsSchema,
    },
    {
      id: "state.lock",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/lock.v1.schema.json",
      schema: lockSchema,
    },
    {
      id: "state.migration",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/migration.v1.schema.json",
      schema: migrationSchema,
    },
    {
      id: "state.project-config",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/project-config.v1.schema.json",
      schema: projectConfigSchema,
    },
    {
      id: "state.requirement-discovery",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/requirement-discovery.v1.schema.json",
      schema: requirementDiscoverySchema,
    },
    {
      id: "state.snapshot",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/snapshot.v1.schema.json",
      schema: snapshotSchema,
    },
    {
      id: "state.transaction-manifest",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/transaction-manifest.v1.schema.json",
      schema: transactionManifestSchema,
    },
    {
      id: "state.transaction-progress",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/transaction-progress.v1.schema.json",
      schema: transactionProgressSchema,
    },
  ] as const satisfies readonly EmbeddedSchemaEntry[]);

export const EMBEDDED_SCHEMA_DEPENDENCIES = deepFreeze([
  resultSchema,
  acceptanceCriterionIdSchema,
] as const satisfies readonly object[]);

const EXPECTED_SCHEMA_IDS = {
  "host.adapter-message": "https://kratos.dev/schemas/host/adapter-message/v1",
  "host.agent-output": "https://kratos.dev/schemas/host/agent-output/v1",
  "host.gap-proposal": "https://kratos.dev/schemas/host/gap-proposal/v1",
  "host.init-answers": "https://kratos.dev/schemas/host/init-answers/v1",
  "host.operation-message":
    "https://kratos.dev/schemas/host/operation-message/v1",
  "host.pre-tool-use": "https://kratos.dev/schemas/host/pre-tool-use/v1",
  "state.approval": "https://kratos.dev/schemas/state/approval/v1",
  "state.acceptance-criteria-snapshot":
    "https://kratos.dev/schemas/state/acceptance-criteria-snapshot/v1",
  "state.acceptance-verdict":
    "https://kratos.dev/schemas/state/acceptance-verdict/v1",
  "state.event": "https://kratos.dev/schemas/state/event/v1",
  "state.evidence": "https://kratos.dev/schemas/state/evidence/v1",
  "state.feature": "https://kratos.dev/schemas/state/feature/v1",
  "state.feature-scope": "https://kratos.dev/schemas/state/feature-scope/v1",
  "state.gap": "https://kratos.dev/schemas/state/gap/v1",
  "state.gates": "https://kratos.dev/schemas/state/gates/v1",
  "state.guardrails": "https://kratos.dev/schemas/state/guardrails/v1",
  "state.lock": "https://kratos.dev/schemas/state/lock/v1",
  "state.migration": "https://kratos.dev/schemas/state/migration/v1",
  "state.project-config": "https://kratos.dev/schemas/state/project-config/v1",
  "state.requirement-discovery":
    "https://kratos.dev/schemas/state/requirement-discovery/v1",
  "state.snapshot": "https://kratos.dev/schemas/state/snapshot/v1",
  "state.transaction-manifest":
    "https://kratos.dev/schemas/state/transaction-manifest/v1",
  "state.transaction-progress":
    "https://kratos.dev/schemas/state/transaction-progress/v1",
} as const satisfies Readonly<Record<EmbeddedSchemaEntry["id"], string>>;

function failCatalogIntegrity(): never {
  throw new Error("Embedded schema catalog is inconsistent");
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Readonly<Record<string, unknown>>;
}

function schemaId(schema: object): string | undefined {
  const id = record(schema)?.$id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function declaresVersion(entry: EmbeddedSchemaEntry): boolean {
  const propertyName =
    entry.family === "state" ? "stateContract" : "hostContract";
  const pending: unknown[] = [entry.schema];
  const seen = new WeakSet<object>();
  let found = false;

  while (pending.length > 0) {
    const value = pending.pop();
    if (Array.isArray(value)) {
      pending.push(...(value as unknown[]));
      continue;
    }
    const node = record(value);
    if (node === undefined || seen.has(node)) continue;
    seen.add(node);

    const properties = record(node.properties);
    if (properties !== undefined && propertyName in properties) {
      found = true;
      const constraint = record(properties[propertyName]);
      if (
        constraint === undefined ||
        (constraint.const !== entry.version &&
          (!Array.isArray(constraint.enum) ||
            !constraint.enum.includes(entry.version)))
      ) {
        return false;
      }
    }
    pending.push(...Object.values(node));
  }

  return found;
}

export function assertSchemaCatalog(
  entries: readonly EmbeddedSchemaEntry[],
): void {
  if (entries.length !== manifest.schemas.length) failCatalogIntegrity();

  const keys = new Set<string>();
  const schemaIds = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const expected = manifest.schemas[index];
    if (expected === undefined) failCatalogIntegrity();
    const key = `${entry.id}\u0000${entry.version}`;
    const id = schemaId(entry.schema);
    if (keys.has(key) || id === undefined || schemaIds.has(id)) {
      failCatalogIntegrity();
    }
    if (
      entry.id !== expected.id ||
      entry.family !== expected.family ||
      entry.version !== expected.version ||
      entry.path !== expected.path ||
      id !== EXPECTED_SCHEMA_IDS[entry.id] ||
      !declaresVersion(entry)
    ) {
      failCatalogIntegrity();
    }
    keys.add(key);
    schemaIds.add(id);
  }
}

assertSchemaCatalog(EMBEDDED_SCHEMA_CATALOG);
