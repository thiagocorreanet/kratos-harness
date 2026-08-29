import manifest from "../packages/contracts/catalogs/contract-families.v1.json" with { type: "json" };
import {
  EMBEDDED_SCHEMA_CATALOG,
  EMBEDDED_SCHEMA_DEPENDENCIES,
  assertSchemaCatalog,
  type EmbeddedSchemaEntry,
} from "@kratos/runtime/infra/schema";
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

/**
 * Where `state.approval` sits, found by identity rather than by position.
 *
 * These assertions mutate the state family's version constraint, which only
 * that entry carries. Pinning it to an index means a contract added ahead of it
 * retargets them at a schema shaped differently, and the failure that follows
 * names a fixture rather than the rule under test.
 */
function approvalIndex(entries: readonly EmbeddedSchemaEntry[]): number {
  const index = entries.findIndex(({ id }) => id === "state.approval");
  if (index < 0) throw new Error("catalog fixture unavailable");
  return index;
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
  it("registers readable 1.0.0 and current 1.1.0 schemas by id and version", () => {
    expect(
      EMBEDDED_SCHEMA_CATALOG.filter(({ id }) => id === "state.event").map(
        ({ version }) => version,
      ),
    ).toEqual(["1.0.0", "1.1.0"]);
  });

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

  it.each([undefined, ""])(
    "rejects a missing or empty schema identity",
    (id) => {
      const entries = mutableEntries();
      const schema = objectRecord(entryAt(entries, 0).schema);
      if (id === undefined) delete schema.$id;
      else schema.$id = id;

      expectInconsistent(entries);
    },
  );

  it.each([
    ["path", "schemas/state/not-approval.v1.schema.json"],
    ["family", "host"],
  ] as const)(
    "rejects wrong %s metadata without changing catalog length",
    (field, value) => {
      const entries = mutableEntries();
      const index = approvalIndex(entries);
      const approval = entryAt(entries, index);
      entries[index] = { ...approval, [field]: value };

      expectInconsistent(entries);
    },
  );

  it("rejects a wrong family-version declaration without changing catalog length", () => {
    const entries = mutableEntries();
    const approval = objectRecord(
      entryAt(entries, approvalIndex(entries)).schema,
    );
    const properties = objectRecord(approval.properties);
    const stateContract = objectRecord(properties.stateContract);
    stateContract.const = "9.9.9";

    expectInconsistent(entries);
  });

  it("rejects a non-object family-version constraint", () => {
    const entries = mutableEntries();
    const approval = objectRecord(
      entryAt(entries, approvalIndex(entries)).schema,
    );
    const properties = objectRecord(approval.properties);
    properties.stateContract = null;

    expectInconsistent(entries);
  });

  it("accepts an enum-backed current family version", () => {
    const entries = mutableEntries();
    const approval = objectRecord(
      entryAt(entries, approvalIndex(entries)).schema,
    );
    const properties = objectRecord(approval.properties);
    const stateContract = objectRecord(properties.stateContract);
    delete stateContract.const;
    stateContract.enum = ["1.0.0"];

    expect(() => {
      assertSchemaCatalog(entries);
    }).not.toThrow();
  });

  it("rejects an iterable catalog entry without a manifest position", () => {
    const entries = mutableEntries();
    const forged = {
      length: entries.length,
      *entries() {
        yield* entries.entries();
        yield [entries.length, entryAt(entries, 0)] as const;
      },
    } as unknown as readonly EmbeddedSchemaEntry[];

    expectInconsistent(forged);
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
