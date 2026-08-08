import manifest from "../../../../contracts/catalogs/contract-families.v1.json" with { type: "json" };
import adapterMessageSchema from "../../../../../schemas/host/adapter-message.v1.schema.json" with { type: "json" };
import resultSchema from "../../../../../schemas/result.v1.schema.json" with { type: "json" };
import approvalSchema from "../../../../../schemas/state/approval.v1.schema.json" with { type: "json" };
import eventSchema from "../../../../../schemas/state/event.v1.schema.json" with { type: "json" };
import evidenceSchema from "../../../../../schemas/state/evidence.v1.schema.json" with { type: "json" };
import lockSchema from "../../../../../schemas/state/lock.v1.schema.json" with { type: "json" };
import migrationSchema from "../../../../../schemas/state/migration.v1.schema.json" with { type: "json" };
import projectConfigSchema from "../../../../../schemas/state/project-config.v1.schema.json" with { type: "json" };
import snapshotSchema from "../../../../../schemas/state/snapshot.v1.schema.json" with { type: "json" };

import type { EmbeddedSchemaEntry } from "./types.js";

export const EMBEDDED_SCHEMA_CATALOG: readonly EmbeddedSchemaEntry[] =
  Object.freeze([
    Object.freeze({
      id: "host.adapter-message",
      family: "host",
      version: "1.0.0",
      path: "schemas/host/adapter-message.v1.schema.json",
      schema: adapterMessageSchema,
    }),
    Object.freeze({
      id: "state.approval",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/approval.v1.schema.json",
      schema: approvalSchema,
    }),
    Object.freeze({
      id: "state.event",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/event.v1.schema.json",
      schema: eventSchema,
    }),
    Object.freeze({
      id: "state.evidence",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/evidence.v1.schema.json",
      schema: evidenceSchema,
    }),
    Object.freeze({
      id: "state.lock",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/lock.v1.schema.json",
      schema: lockSchema,
    }),
    Object.freeze({
      id: "state.migration",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/migration.v1.schema.json",
      schema: migrationSchema,
    }),
    Object.freeze({
      id: "state.project-config",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/project-config.v1.schema.json",
      schema: projectConfigSchema,
    }),
    Object.freeze({
      id: "state.snapshot",
      family: "state",
      version: "1.0.0",
      path: "schemas/state/snapshot.v1.schema.json",
      schema: snapshotSchema,
    }),
  ] as const satisfies readonly EmbeddedSchemaEntry[]);

export const EMBEDDED_SCHEMA_DEPENDENCIES = Object.freeze([
  resultSchema,
] as const satisfies readonly object[]);

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
    if (
      entry.id !== expected.id ||
      entry.family !== expected.family ||
      entry.version !== expected.version ||
      entry.path !== expected.path ||
      keys.has(key) ||
      id === undefined ||
      schemaIds.has(id) ||
      !declaresVersion(entry)
    ) {
      failCatalogIntegrity();
    }
    keys.add(key);
    schemaIds.add(id);
  }
}

assertSchemaCatalog(EMBEDDED_SCHEMA_CATALOG);
