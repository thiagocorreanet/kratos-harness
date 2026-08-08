import {
  classifyContractVersion,
  contractFailureResult,
  type ContractClassification,
} from "@mestre-yoda/contracts";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";

import type {
  ContractId,
  ContractRequest,
  ContractValue,
  SchemaRegistry,
  ValidationDiagnostic,
} from "../../domain/schema/index.js";
import {
  EMBEDDED_SCHEMA_CATALOG,
  EMBEDDED_SCHEMA_DEPENDENCIES,
  assertSchemaCatalog,
} from "./catalog.js";
import { normalizeAjvDiagnostics } from "./diagnostics.js";
import type { EmbeddedSchemaEntry } from "./types.js";

const REGISTRY_INTEGRITY_ERROR = "Embedded schema registry is invalid";

function registryIntegrityError(): Error {
  return new Error(REGISTRY_INTEGRITY_ERROR);
}

function registryKey(id: ContractId, version: string): string {
  return `${id}\u0000${version}`;
}

function schemaId(schema: object): string {
  const id = (schema as Readonly<Record<string, unknown>>).$id;
  if (typeof id !== "string" || id.length === 0) {
    throw registryIntegrityError();
  }
  return id;
}

function requestedVersion(
  classification: ContractClassification,
  value: unknown,
): string | null {
  if (classification.classification === "invalid") return null;
  if (classification.classification === "migration_required") {
    const syntax = classifyContractVersion("host", value);
    return syntax.classification === "invalid" ? null : (value as string);
  }
  return typeof value === "string" ? value : null;
}

function rejectedClassification(
  classification: ContractClassification,
): ContractClassification {
  if (classification.classification !== "migration_required") {
    return classification;
  }
  return {
    family: "state",
    classification: "unsupported",
    reasonCode: "contract.state_version_unsupported",
    selectedVersion: null,
  };
}

function versionDiagnostic(
  id: ContractId,
  version: unknown,
  classification: ContractClassification,
): ValidationDiagnostic {
  const failure = contractFailureResult(rejectedClassification(classification));
  return {
    contract: id,
    version: requestedVersion(classification, version),
    pointer: "",
    keyword: "version",
    reasonCode: failure.reasonCode,
    recovery: failure.recovery,
  };
}

export function compileSchemaRegistry(
  entries: readonly EmbeddedSchemaEntry[],
  dependencies: readonly object[],
): SchemaRegistry {
  const validators = new Map<string, ValidateFunction>();
  const families = new Map<ContractId, "state" | "host">();

  try {
    assertSchemaCatalog(entries);
    const ajv = new Ajv2020({
      allErrors: true,
      coerceTypes: false,
      ownProperties: true,
      removeAdditional: false,
      strict: true,
      useDefaults: false,
      validateFormats: false,
    });

    for (const dependency of dependencies) {
      ajv.addSchema(dependency);
    }
    for (const entry of entries) {
      ajv.addSchema(entry.schema);
      families.set(entry.id, entry.family);
    }
    for (const entry of entries) {
      const validator = ajv.getSchema(schemaId(entry.schema));
      if (validator === undefined) throw registryIntegrityError();
      validators.set(registryKey(entry.id, entry.version), validator);
    }
  } catch {
    throw registryIntegrityError();
  }

  return Object.freeze({
    validate<I extends ContractId>(request: ContractRequest<I>) {
      const family = families.get(request.id);
      if (family === undefined) throw registryIntegrityError();
      const classification = classifyContractVersion(family, request.version);
      if (classification.classification !== "current") {
        try {
          return {
            kind: "invalid" as const,
            diagnostics: [
              versionDiagnostic(request.id, request.version, classification),
            ],
          };
        } catch {
          throw registryIntegrityError();
        }
      }

      const version = classification.selectedVersion;
      if (version === null) throw registryIntegrityError();
      const validator = validators.get(registryKey(request.id, version));
      if (validator === undefined) throw registryIntegrityError();
      try {
        if (!validator(request.value)) {
          return {
            kind: "invalid" as const,
            diagnostics: normalizeAjvDiagnostics(
              validator.errors,
              request.id,
              version,
              request.structuralReasonCode,
            ),
          };
        }
      } catch {
        throw registryIntegrityError();
      }
      return {
        kind: "valid" as const,
        value: request.value as ContractValue<I>,
      };
    },
  });
}

export function ajvSchemaRegistry(): SchemaRegistry {
  return compileSchemaRegistry(
    EMBEDDED_SCHEMA_CATALOG,
    EMBEDDED_SCHEMA_DEPENDENCIES,
  );
}
