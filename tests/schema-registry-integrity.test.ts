import { Ajv2020 } from "ajv/dist/2020.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import projectConfig from "../fixtures/contracts/v1/project-config.json" with { type: "json" };
import type { SchemaRegistry } from "@kratos/runtime/domain/schema";
import {
  EMBEDDED_SCHEMA_CATALOG,
  EMBEDDED_SCHEMA_DEPENDENCIES,
  compileSchemaRegistry,
  type EmbeddedSchemaEntry,
} from "@kratos/runtime/infra/schema";

const catalogModulePath = "../packages/runtime/src/infra/schema/catalog.js";

afterEach(() => {
  vi.doUnmock("@kratos/contracts");
  vi.doUnmock(catalogModulePath);
  vi.restoreAllMocks();
  vi.resetModules();
});

async function registryWithContractOverrides(
  overrides: Readonly<Record<string, unknown>>,
): Promise<SchemaRegistry> {
  vi.resetModules();
  vi.doMock("@kratos/contracts", async () => ({
    ...(await vi.importActual<object>("@kratos/contracts")),
    ...overrides,
  }));
  const registryModule =
    await import("../packages/runtime/src/infra/schema/registry.js");
  return registryModule.compileSchemaRegistry(
    EMBEDDED_SCHEMA_CATALOG,
    EMBEDDED_SCHEMA_DEPENDENCIES,
  );
}

const request = {
  id: "state.project-config" as const,
  version: "1.0.0",
  value: projectConfig,
  structuralReasonCode: "guard.config_corrupt" as const,
};

describe("schema registry integrity failures", () => {
  it("sanitizes an invalid schema identifier after catalog validation", async () => {
    const entries: EmbeddedSchemaEntry[] = EMBEDDED_SCHEMA_CATALOG.map(
      (entry) => structuredClone(entry),
    );
    const first = entries[0];
    if (first === undefined) throw new Error("schema fixture unavailable");
    const schema = first.schema as Record<string, unknown>;
    delete schema.$id;
    vi.resetModules();
    vi.doMock(catalogModulePath, () => ({
      EMBEDDED_SCHEMA_CATALOG: entries,
      EMBEDDED_SCHEMA_DEPENDENCIES,
      assertSchemaCatalog: vi.fn(),
    }));
    const registryModule =
      await import("../packages/runtime/src/infra/schema/registry.js");

    expect(() =>
      registryModule.compileSchemaRegistry(
        entries,
        EMBEDDED_SCHEMA_DEPENDENCIES,
      ),
    ).toThrow(new Error("Embedded schema registry is invalid"));
  });

  it("sanitizes a missing compiled validator", () => {
    const last = EMBEDDED_SCHEMA_CATALOG.at(-1);
    if (last === undefined) throw new Error("schema fixture unavailable");
    const missingId = (last.schema as Readonly<Record<string, unknown>>).$id;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply below restores the Ajv instance explicitly
    const intrinsicGetSchema = Ajv2020.prototype.getSchema;
    const getSchema = vi
      .spyOn(Ajv2020.prototype, "getSchema")
      .mockImplementation(function (this: Ajv2020, key) {
        return key === missingId
          ? undefined
          : Reflect.apply(intrinsicGetSchema, this, [key]);
      });

    expect(() =>
      compileSchemaRegistry(
        EMBEDDED_SCHEMA_CATALOG,
        EMBEDDED_SCHEMA_DEPENDENCIES,
      ),
    ).toThrow(new Error("Embedded schema registry is invalid"));
    expect(getSchema).toHaveBeenCalledWith(missingId);
  });

  it("sanitizes a version-diagnostic policy failure", async () => {
    const registry = await registryWithContractOverrides({
      contractFailureResult() {
        throw new Error("attacker-controlled policy failure");
      },
    });

    expect(() =>
      registry.validate({ ...request, version: "2.0.0", value: null }),
    ).toThrow(new Error("Embedded schema registry is invalid"));
  });

  it("rejects a current classification without a selected version", async () => {
    const registry = await registryWithContractOverrides({
      classifyContractVersion() {
        return {
          family: "state",
          classification: "current",
          reasonCode: null,
          selectedVersion: null,
        };
      },
    });

    expect(() => registry.validate(request)).toThrow(
      new Error("Embedded schema registry is invalid"),
    );
  });

  it("rejects a selected version without a compiled validator", async () => {
    const registry = await registryWithContractOverrides({
      classifyContractVersion() {
        return {
          family: "state",
          classification: "current",
          reasonCode: null,
          selectedVersion: "9.9.9",
        };
      },
    });

    expect(() => registry.validate(request)).toThrow(
      new Error("Embedded schema registry is invalid"),
    );
  });
});
