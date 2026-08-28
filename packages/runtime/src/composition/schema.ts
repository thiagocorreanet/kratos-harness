import {
  CONTRACT_VERSIONS,
  type ReadableProjectConfig,
} from "@kratos/contracts";

import type { ConfigurationValidator } from "../domain/project/index.js";
import {
  declaredContractVersion,
  type SchemaRegistry,
} from "../domain/schema/index.js";
import { ajvSchemaRegistry } from "../infra/schema/index.js";

const productionSchemaRegistry = ajvSchemaRegistry();

export function createSchemaRegistry(): SchemaRegistry {
  return productionSchemaRegistry;
}

export function configurationValidator(
  registry: SchemaRegistry,
): ConfigurationValidator {
  return (value) => {
    const version = declaredContractVersion(
      value,
      "stateContract",
      CONTRACT_VERSIONS["state.project-config"],
    );
    const result = registry.validate({
      id: "state.project-config",
      version,
      value,
      structuralReasonCode: "guard.config_corrupt",
    });
    return result.kind === "valid"
      ? { kind: "valid", value: result.value as ReadableProjectConfig }
      : { kind: "invalid" };
  };
}
