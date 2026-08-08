import manifest from "../packages/contracts/catalogs/contract-families.v1.json" with { type: "json" };
import {
  EMBEDDED_SCHEMA_CATALOG,
  EMBEDDED_SCHEMA_DEPENDENCIES,
  assertSchemaCatalog,
  type EmbeddedSchemaEntry,
} from "@mestre-yoda/runtime/infra/schema";
import { describe, expect, it } from "vitest";

function mutableEntries(): EmbeddedSchemaEntry[] {
  return EMBEDDED_SCHEMA_CATALOG.map((entry) => structuredClone(entry));
}

function entryAt(
  entries: readonly EmbeddedSchemaEntry[],
  index: number,
): EmbeddedSchemaEntry {
  const entry = entries[index];
  if (entry === undefined) throw new Error("catalog fixture unavailable");
  return entry;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("catalog fixture unavailable");
  }
  return value as Record<string, unknown>;
}

function expectInconsistent(entries: readonly EmbeddedSchemaEntry[]): void {
  expect(() => {
    assertSchemaCatalog(entries);
  }).toThrow("Embedded schema catalog is inconsistent");
}

function expectDeeplyFrozen(
  value: unknown,
  seen = new WeakSet<object>(),
): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  const nested: readonly unknown[] = Array.isArray(value)
    ? (value as readonly unknown[])
    : Object.values(value as Record<string, unknown>);
  for (const child of nested) expectDeeplyFrozen(child, seen);
}

describe("embedded schema catalog", () => {
  it("contains every and only current state and host manifest entry", () => {
    expect(
      EMBEDDED_SCHEMA_CATALOG.map(({ id, version }) => ({ id, version })),
    ).toEqual(manifest.schemas.map(({ id, version }) => ({ id, version })));
  });

  it("rejects a duplicate key without changing catalog length", () => {
    const entries = mutableEntries();
    const first = entryAt(entries, 0);
    const second = entryAt(entries, 1);
    entries[1] = { ...second, id: first.id, version: first.version };

    expectInconsistent(entries);
  });

  it("rejects a duplicate schema identity without changing catalog length", () => {
    const entries = mutableEntries();
    const firstSchema = objectRecord(entryAt(entries, 0).schema);
    const secondSchema = objectRecord(entryAt(entries, 1).schema);
    secondSchema.$id = firstSchema.$id;

    expectInconsistent(entries);
  });

  it.each([
    ["path", "schemas/state/not-approval.v1.schema.json"],
    ["family", "host"],
  ] as const)(
    "rejects wrong %s metadata without changing catalog length",
    (field, value) => {
      const entries = mutableEntries();
      const approval = entryAt(entries, 1);
      entries[1] = { ...approval, [field]: value };

      expectInconsistent(entries);
    },
  );

  it("rejects a wrong family-version declaration without changing catalog length", () => {
    const entries = mutableEntries();
    const approval = objectRecord(entryAt(entries, 1).schema);
    const properties = objectRecord(approval.properties);
    const stateContract = objectRecord(properties.stateContract);
    stateContract.const = "9.9.9";

    expectInconsistent(entries);
  });

  it("binds every schema identity to its exact catalog entry", () => {
    const entries = mutableEntries();
    const approval = entryAt(entries, 1);
    const event = entryAt(entries, 2);
    entries[1] = { ...approval, schema: event.schema };
    entries[2] = { ...event, schema: approval.schema };

    expectInconsistent(entries);
  });

  it("deeply freezes registered schemas and dependency schemas", () => {
    const event = EMBEDDED_SCHEMA_CATALOG.find(
      ({ id }) => id === "state.event",
    );
    const result = EMBEDDED_SCHEMA_DEPENDENCIES[0];
    if (event === undefined) throw new Error("catalog fixture unavailable");
    const eventProperties = objectRecord(objectRecord(event.schema).properties);
    const originalContract = eventProperties.stateContract;
    const eventPropertiesWereFrozen = Object.isFrozen(eventProperties);
    try {
      expect(() => {
        eventProperties.stateContract = { const: "9.9.9" };
      }).toThrow(TypeError);
    } finally {
      if (!eventPropertiesWereFrozen) {
        eventProperties.stateContract = originalContract;
      }
    }

    const required = objectRecord(result).required;
    if (!Array.isArray(required))
      throw new Error("catalog fixture unavailable");
    const requiredValues = required as unknown[];
    const requiredValuesWereFrozen = Object.isFrozen(requiredValues);
    try {
      expect(() => {
        requiredValues.push("not-a-real-field");
      }).toThrow(TypeError);
    } finally {
      if (!requiredValuesWereFrozen) requiredValues.pop();
    }

    expectDeeplyFrozen(EMBEDDED_SCHEMA_CATALOG);
    expectDeeplyFrozen(EMBEDDED_SCHEMA_DEPENDENCIES);
  });
});
