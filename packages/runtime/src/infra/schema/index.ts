import { assertObjectPrototypeEnvironmentSafe } from "./prototype-environment.js";

export type { EmbeddedSchemaEntry } from "./types.js";

assertObjectPrototypeEnvironmentSafe();

const catalogModule = await import("./catalog.js");
const registryModule = await import("./registry.js");

export const EMBEDDED_SCHEMA_CATALOG = catalogModule.EMBEDDED_SCHEMA_CATALOG;
export const EMBEDDED_SCHEMA_DEPENDENCIES =
  catalogModule.EMBEDDED_SCHEMA_DEPENDENCIES;
export const assertSchemaCatalog = catalogModule.assertSchemaCatalog;
export const ajvSchemaRegistry = registryModule.ajvSchemaRegistry;
export const compileSchemaRegistry = registryModule.compileSchemaRegistry;
