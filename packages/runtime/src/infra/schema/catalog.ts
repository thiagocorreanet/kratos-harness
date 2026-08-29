import manifest from "../../../../contracts/catalogs/contract-families.v1.json" with { type: "json" };
import adapterMessageSchema from "../../../../../schemas/host/adapter-message.v1.schema.json" with { type: "json" };
import adapterMessageV1_1Schema from "../../../../../schemas/host/adapter-message.v1.1.schema.json" with { type: "json" };
import agentOutputSchema from "../../../../../schemas/host/agent-output.v1.schema.json" with { type: "json" };
import gapProposalSchema from "../../../../../schemas/host/gap-proposal.v1.schema.json" with { type: "json" };
import hookObservationSchema from "../../../../../schemas/host/hook-observation.v1.schema.json" with { type: "json" };
import initAnswersSchema from "../../../../../schemas/host/init-answers.v1.schema.json" with { type: "json" };
import initAnswersV1_1Schema from "../../../../../schemas/host/init-answers.v1.1.schema.json" with { type: "json" };
import operationMessageSchema from "../../../../../schemas/host/operation-message.v1.schema.json" with { type: "json" };
import preToolUseSchema from "../../../../../schemas/host/pre-tool-use.v1.schema.json" with { type: "json" };
import phaseHandoffV1_1Schema from "../../../../../schemas/host/phase-handoff.v1.1.schema.json" with { type: "json" };
import resultSchema from "../../../../../schemas/result.v1.schema.json" with { type: "json" };
import acceptanceCriterionIdSchema from "../../../../../schemas/contracts/acceptance-criterion-id.v1.schema.json" with { type: "json" };
import acceptanceCriteriaSnapshotSchema from "../../../../../schemas/state/acceptance-criteria-snapshot.v1.schema.json" with { type: "json" };
import acceptanceVerdictSchema from "../../../../../schemas/state/acceptance-verdict.v1.schema.json" with { type: "json" };
import approvalSchema from "../../../../../schemas/state/approval.v1.schema.json" with { type: "json" };
import eventSchema from "../../../../../schemas/state/event.v1.schema.json" with { type: "json" };
import eventV1_1Schema from "../../../../../schemas/state/event.v1.1.schema.json" with { type: "json" };
import featureSchema from "../../../../../schemas/state/feature.v1.schema.json" with { type: "json" };
import featureScopeSchema from "../../../../../schemas/state/feature-scope.v1.schema.json" with { type: "json" };
import evidenceSchema from "../../../../../schemas/state/evidence.v1.schema.json" with { type: "json" };
import failureCandidateSchema from "../../../../../schemas/state/failure-candidate.v1.schema.json" with { type: "json" };
import gapSchema from "../../../../../schemas/state/gap.v1.schema.json" with { type: "json" };
import gatesSchema from "../../../../../schemas/state/gates.v1.schema.json" with { type: "json" };
import guardrailsSchema from "../../../../../schemas/state/guardrails.v1.schema.json" with { type: "json" };
import lockSchema from "../../../../../schemas/state/lock.v1.schema.json" with { type: "json" };
import migrationSchema from "../../../../../schemas/state/migration.v1.schema.json" with { type: "json" };
import migrationV1_1Schema from "../../../../../schemas/state/migration.v1.1.schema.json" with { type: "json" };
import projectConfigSchema from "../../../../../schemas/state/project-config.v1.schema.json" with { type: "json" };
import projectConfigV1_1Schema from "../../../../../schemas/state/project-config.v1.1.schema.json" with { type: "json" };
import requirementDiscoverySchema from "../../../../../schemas/state/requirement-discovery.v1.schema.json" with { type: "json" };
import runUsageSchema from "../../../../../schemas/state/run-usage.v1.schema.json" with { type: "json" };
import sessionTelemetrySchema from "../../../../../schemas/state/session-telemetry.v1.schema.json" with { type: "json" };
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
      id: "host.adapter-message",
      family: "host",
      version: "1.1.0",
      path: "schemas/host/adapter-message.v1.1.schema.json",
      schema: adapterMessageV1_1Schema,
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
      id: "host.hook-observation",
      family: "host",
      version: "1.0.0",
      path: "schemas/host/hook-observation.v1.schema.json",
      schema: hookObservationSchema,
    },
    {
      id: "host.init-answers",
      family: "host",
      version: "1.0.0",
      path: "schemas/host/init-answers.v1.schema.json",
      schema: initAnswersSchema,
    },
    {
      id: "host.init-answers",
      family: "host",
      version: "1.1.0",
      path: "schemas/host/init-answers.v1.1.schema.json",
      schema: initAnswersV1_1Schema,
    },
    {
      id: "host.operation-message",
      family: "host",
      version: "1.0.0",
      path: "schemas/host/operation-message.v1.schema.json",
      schema: operationMessageSchema,
    },
    {
      id: "host.phase-handoff",
      family: "host",
      version: "1.1.0",
      path: "schemas/host/phase-handoff.v1.1.schema.json",
      schema: phaseHandoffV1_1Schema,
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
      id: "state.event",
      family: "state",
      version: "1.1.0",
      path: "schemas/state/event.v1.1.schema.json",
      schema: eventV1_1Schema,
    },
    {
      id: "state.evidence",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/evidence.v1.schema.json",
      schema: evidenceSchema,
    },
    {
      id: "state.failure-candidate",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/failure-candidate.v1.schema.json",
      schema: failureCandidateSchema,
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
      id: "state.migration",
      family: "state",
      version: "1.1.0",
      path: "schemas/state/migration.v1.1.schema.json",
      schema: migrationV1_1Schema,
    },
    {
      id: "state.project-config",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/project-config.v1.schema.json",
      schema: projectConfigSchema,
    },
    {
      id: "state.project-config",
      family: "state",
      version: "1.1.0",
      path: "schemas/state/project-config.v1.1.schema.json",
      schema: projectConfigV1_1Schema,
    },
    {
      id: "state.requirement-discovery",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/requirement-discovery.v1.schema.json",
      schema: requirementDiscoverySchema,
    },
    {
      id: "state.run-usage",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/run-usage.v1.schema.json",
      schema: runUsageSchema,
    },
    {
      id: "state.session-telemetry",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/session-telemetry.v1.schema.json",
      schema: sessionTelemetrySchema,
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

function expectedSchemaId(entry: EmbeddedSchemaEntry): string {
  const [family, name] = entry.id.split(".");
  if (family === undefined || name === undefined) failCatalogIntegrity();
  const revision = entry.version === "1.0.0" ? "1" : "1.1";
  return `https://kratos.dev/schemas/${family}/${name}/v${revision}`;
}

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
      id !== expectedSchemaId(entry) ||
      !declaresVersion(entry)
    ) {
      failCatalogIntegrity();
    }
    keys.add(key);
    schemaIds.add(id);
  }
}

assertSchemaCatalog(EMBEDDED_SCHEMA_CATALOG);
