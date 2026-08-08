import { CONTRACT_IDENTITIES } from "@mestre-yoda/contracts";

import type { ConfigurationValidator } from "../domain/project/index.js";
import type { SchemaRegistry } from "../domain/schema/index.js";
import { ajvSchemaRegistry } from "../infra/schema/index.js";

export function createSchemaRegistry(): SchemaRegistry {
  return ajvSchemaRegistry();
}

export function configurationValidator(
  registry: SchemaRegistry,
): ConfigurationValidator {
  return (value) => {
    const result = registry.validate({
      id: "state.project-config",
      version: CONTRACT_IDENTITIES.state,
      value,
      structuralReasonCode: "guard.config_corrupt",
    });
    return result.kind === "valid"
      ? { kind: "valid", value: result.value }
      : { kind: "invalid" };
  };
}
