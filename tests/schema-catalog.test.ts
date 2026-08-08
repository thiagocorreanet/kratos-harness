import manifest from "../packages/contracts/catalogs/contract-families.v1.json" with { type: "json" };
import {
  EMBEDDED_SCHEMA_CATALOG,
  assertSchemaCatalog,
} from "@mestre-yoda/runtime/infra/schema";
import { describe, expect, it } from "vitest";

describe("embedded schema catalog", () => {
  it("contains every and only current state and host manifest entry", () => {
    expect(
      EMBEDDED_SCHEMA_CATALOG.map(({ id, version }) => ({ id, version })),
    ).toEqual(manifest.schemas.map(({ id, version }) => ({ id, version })));
  });

  it("rejects duplicate keys and inconsistent metadata", () => {
    const first = EMBEDDED_SCHEMA_CATALOG[0];
    if (first === undefined) throw new Error("catalog fixture unavailable");
    expect(() => {
      assertSchemaCatalog([...EMBEDDED_SCHEMA_CATALOG, first]);
    }).toThrow("Embedded schema catalog is inconsistent");
    expect(() => {
      assertSchemaCatalog([{ ...first, version: "9.9.9" }]);
    }).toThrow("Embedded schema catalog is inconsistent");
  });
});
